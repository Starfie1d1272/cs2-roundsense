/**
 * Replay cash-jump analysis v2 — hunt for the CT shared team award (+$50 per
 * T-elimination to EVERY CT player, 2025-07-15 patch).
 *
 * v2 fixes vs v1:
 *  1. SELF-CHECK frame alignment: victim HP must hit 0 at the kill frame —
 *     if not, our tick→frame conversion is wrong and we're looking at the
 *     wrong frames entirely (v1 never verified this!).
 *  2. Wide window: scan +40 frames (~5s) after the kill, not ±1.
 *  3. Enumerate ALL non-zero cash jumps per CT player per round, so any
 *     delayed settlement (e.g. round-end payout of the team award) shows up
 *     as a +50×kills pattern.
 *
 * Run: pnpm --filter @roundsense/experiment-economy-ledger exec tsx scripts/replay-cash-jump.ts <zip>...
 */
import { loadDemoPackage, type ParsedDemoPackage } from "@roundsense/demo-oracle";
import { decodeDelta } from "cs2-demo-format/parser";

interface KillEvent { roundNumber: number; tick: number; killerIndex: number | null; victimIndex: number; }

async function analyzeOne(pkg: ParsedDemoPackage, label: string): Promise<void> {
  const { files } = pkg;
  const teamByPlayer = new Map<number, string>();
  for (const [i, p] of files.players.entries()) teamByPlayer.set(i, p.teamKey);

  const sideOf = (teamKey: string, roundNumber: number): "ct" | "t" | null => {
    const r = files.rounds.find((x) => x.roundNumber === roundNumber);
    if (!r) return null;
    return teamKey === "teamA" ? r.teamASide : r.teamBSide;
  };

  const killsByRound = new Map<number, KillEvent[]>();
  for (const k of files.kills) {
    const list = killsByRound.get(k.roundNumber) ?? [];
    list.push({ roundNumber: k.roundNumber, tick: k.tick, killerIndex: k.killerIndex, victimIndex: k.victimIndex });
    killsByRound.set(k.roundNumber, list);
  }

  const replay = files.replay;
  if (!replay) { console.log(`${label}: no replay — skipped`); return; }

  let ctKillsChecked = 0;
  let frameAligned = 0;
  let frameMisaligned = 0;
  let plus50AfterKill = 0;
  let zeroAfterKill = 0;
  let otherAfterKill = 0;
  const examples: string[] = [];
  let roundEndTeamAwardHits = 0;
  let roundEndChecks = 0;

  for (const rr of replay.rounds) {
    const roundNumber = rr.roundNumber;
    const round = files.rounds.find((x) => x.roundNumber === roundNumber);
    if (!round) continue;
    const kills = killsByRound.get(roundNumber) ?? [];
    const ctKills = kills.filter((k) => {
      if (k.killerIndex === null) return false;
      const kTeam = teamByPlayer.get(k.killerIndex);
      const vTeam = teamByPlayer.get(k.victimIndex);
      return kTeam !== undefined && vTeam !== undefined && sideOf(kTeam, roundNumber) === "ct" && sideOf(vTeam, roundNumber) === "t";
    });
    const ctPlayers = rr.players.filter((t) => sideOf(teamByPlayer.get(t.playerIndex) ?? "", roundNumber) === "ct");
    if (ctPlayers.length === 0) continue;

    const moneyByPlayer = new Map<number, number[]>();
    const hpByPlayer = new Map<number, number[]>();
    for (const t of ctPlayers) {
      moneyByPlayer.set(t.playerIndex, decodeDelta(t.money));
      hpByPlayer.set(t.playerIndex, t.hp);
    }

    // ── per-kill: frame alignment self-check + cash window scan ────────────
    for (const kill of ctKills) {
      ctKillsChecked++;
      const fi = Math.round((kill.tick - rr.startTick) / rr.tickStep);
      if (fi <= 0 || fi >= rr.frameCount) continue;

      // self-check: victim HP must be >0 before and 0 at/after the kill frame
      const victimHp = hpByPlayer.get(kill.victimIndex);
      const victimWasAliveBefore = victimHp && victimHp[Math.max(0, fi - 2)] > 0;
      const victimDeadAt = victimHp ? victimHp[fi] === 0 || (fi + 1 < victimHp.length && victimHp[fi + 1] === 0) : false;
      if (victimWasAliveBefore && victimDeadAt) frameAligned++;
      else frameMisaligned++;

      // window: 40 frames ≈ 5s after kill
      for (const t of ctPlayers) {
        const money = moneyByPlayer.get(t.playerIndex)!;
        const isKiller = t.playerIndex === kill.killerIndex;
        if (isKiller) continue; // killer gets weapon reward — separate concern
        let found = false;
        for (let f = fi; f < Math.min(fi + 40, money.length - 1); f++) {
          const jump = money[f + 1]! - money[f]!;
          if (jump !== 0) {
            if (jump === 50) { plus50AfterKill++; if (examples.length < 8) examples.push(`r${roundNumber} tick=${kill.tick} +50 after kill (p${t.playerIndex}, frame ${f}→${f + 1})`); }
            else if (jump === 0) zeroAfterKill++;
            else otherAfterKill++;
            found = true;
            break;
          }
        }
        if (!found) zeroAfterKill++;
      }
    }

    // ── round-end settlement: does the team award land with the round result? ──
    // Round-end frame: the last frame before the next round's startTick.
    const ctKillCount = ctKills.length;
    if (ctKillCount > 0) {
      roundEndChecks++;
      const lastFrame = rr.frameCount - 1;
      const endJumps = new Map<number, number>(); // playerIndex → total jump in last 3 frames
      for (const t of ctPlayers) {
        const money = moneyByPlayer.get(t.playerIndex)!;
        const a = money[Math.max(0, lastFrame - 3)] ?? 0;
        const b = money[lastFrame] ?? a;
        endJumps.set(t.playerIndex, b - a);
      }
      // every CT player should see +50×ctKillCount if the award settles at round end
      const allMatch = [...endJumps.values()].every((j) => j === 50 * ctKillCount || j === 0);
      if (allMatch && ctKillCount > 0) {
        roundEndTeamAwardHits++;
        if (examples.length < 10) examples.push(`r${roundNumber}: round-end jumps = ${[...endJumps.values()].join(",")} (ctKills=${ctKillCount})`);
      } else if (examples.length < 12) {
        examples.push(`r${roundNumber}: round-end jumps = ${[...endJumps.values()].join(",")} (ctKills=${ctKillCount}, expected +${50 * ctKillCount} each)`);
      }
    }
  }

  console.log(`\n=== ${label} ===`);
  console.log(`CT kills checked: ${ctKillsChecked}`);
  console.log(`frame alignment (victim HP→0 at kill frame): ${frameAligned} aligned, ${frameMisaligned} misaligned`);
  console.log(`non-killer CT cash in 5s window after kill: +50: ${plus50AfterKill}, zero: ${zeroAfterKill}, other: ${otherAfterKill}`);
  console.log(`round-end settlement checks: ${roundEndChecks}, team-award pattern hits: ${roundEndTeamAwardHits}`);
  for (const ex of examples.slice(0, 14)) console.log(`  ${ex}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) { console.error("usage: replay-cash-jump.ts <zip>..."); process.exit(1); }
  for (const f of args) {
    try {
      const pkg = await loadDemoPackage(f);
      await analyzeOne(pkg, f.split("/").pop() ?? f);
    } catch (e) {
      console.error(`✗ ${f}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
}

void main();
