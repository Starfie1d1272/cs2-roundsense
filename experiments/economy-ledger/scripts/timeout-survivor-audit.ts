/**
 * time_ran_out T-survivor payout audit (bounded, 2026-08-06 follow-up).
 *
 * For every time_ran_out round (CT winner) in the corpus, extract per-T
 * player: alive-at-endTick (replay hp/flags), death tick, planted, the
 * round-end money jump, jump tick, equipment after, next-round start money
 * — to classify the +1400 observed on T survivor luchov at
 * s3-r1-m1-m2 r17 (counter-example to "T survivor gets no loss bonus").
 *
 * Run: pnpm --filter @roundsense/experiment-economy-ledger exec tsx scripts/timeout-survivor-audit.ts <dir|zip...> [roundNumber]
 */
import { loadDemoPackage } from "@roundsense/demo-oracle";
import { decodeDelta } from "cs2-demo-format/parser";
import { existsSync, lstatSync, readdirSync } from "node:fs";

interface SurvivorRow {
  match: string;
  round: number;
  player: string;
  aliveAtEndTick: boolean;
  hpAtEndTick: number;
  deathTick: number | null;
  planted: boolean;
  moneyJump: number;
  jumpTick: number | null;
  killAtJump: boolean;
  equipmentAfter: number;
  startMoneyNext: number | null;
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  const targetRound = paths.length > 1 && /^\d+$/.test(paths[paths.length - 1]!) ? Number(paths.pop()) : null;
  const all: string[] = [];
  for (const p of paths) {
    if (existsSync(p) && lstatSync(p).isDirectory()) { for (const f of readdirSync(p)) all.push(`${p}/${f}`); }
    else all.push(p);
  }
  const rows: SurvivorRow[] = [];
  let timeoutRounds = 0;
  for (const p of all) {
    if (!p.endsWith(".zip")) continue;
    const pkg = await loadDemoPackage(p);
    const { players, rounds, kills, bombs, playerEconomies, replay } = pkg.files;
    if (!replay) continue;
    const base = p.split("/").pop() ?? p;
    const teamByPlayer = new Map<number, string>();
    players.forEach((pl, i) => teamByPlayer.set(i, pl.teamKey));
    const nameOf = new Map(players.map((pl, i) => [i, pl.name]));
    const roundByNumber = new Map(rounds.map((r) => [r.roundNumber, r]));
    const econByPr = new Map<string, number>();
    for (const e of playerEconomies) econByPr.set(`${e.playerIndex}|${e.roundNumber}`, e.startMoney);

    for (const rd of rounds) {
      if (targetRound && rd.roundNumber !== targetRound) continue;
      if (rd.endReason !== "time_ran_out" || !rd.winnerTeamKey) continue;
      timeoutRounds++;
      const rr = replay.rounds.find((x) => x.roundNumber === rd.roundNumber);
      const rrNext = replay.rounds.find((x) => x.roundNumber === rd.roundNumber + 1);
      if (!rr) continue;
      const tTeam = rd.teamASide === "t" ? "teamA" : "teamB";
      const tPlayers = players.map((pl, i) => [i, pl.teamKey] as const).filter(([, t]) => t === tTeam).map(([i]) => i);
      const deathsInRound = kills.filter((k) => k.roundNumber === rd.roundNumber);
      const plantedBy = new Set<number>();
      for (const b of bombs) if (b.type === "planted" && b.roundNumber === rd.roundNumber && b.actorIndex != null) plantedBy.add(b.actorIndex);

      for (const pi of tPlayers) {
        const track = rr.players.find((t) => t.playerIndex === pi);
        if (!track) continue;
        const hp = track.hp;
        const flags = track.flags;
        const money = decodeDelta(track.money);
        const equip = decodeDelta(track.equipValue);
        const fEnd = Math.min(hp.length - 1, Math.max(0, Math.round((rd.endTick - rr.startTick) / rr.tickStep)));
        const alive = hp[fEnd] !== undefined && hp[fEnd] > 0;
        const death = deathsInRound.find((k) => k.victimIndex === pi);
        // settlement jump: single largest positive jump in [endTick−16, endTick+5s]
        let jump = 0, jumpTick: number | null = null;
        for (let f = 0; f < money.length - 1; f++) {
          const tick = rr.startTick + f * rr.tickStep;
          if (tick < rd.endTick - 16 || tick > rd.endTick + Math.round(5 * (pkg.manifest.tickrate ?? 64))) continue;
          const d = money[f + 1]! - money[f]!;
          if (d > jump) { jump = d; jumpTick = tick; }
        }
        // kill reward at the jump? (kills land at kill time; a survivor's
        // nonzero "settlement" jump is a kill reward if tick ≈ own kill)
        const ownKill = deathsInRound.find((k) => k.killerIndex === pi && jumpTick != null && Math.abs(k.tick - jumpTick) <= 32);
        const killAtJump = ownKill != null;
        const nextStart = rrNext ? econByPr.get(`${pi}|${rd.roundNumber + 1}`) ?? null : null;
        rows.push({
          match: base,
          round: rd.roundNumber,
          player: nameOf.get(pi) ?? `p${pi}`,
          aliveAtEndTick: alive,
          hpAtEndTick: hp[fEnd] ?? -1,
          deathTick: death ? death.tick : null,
          planted: plantedBy.has(pi),
          moneyJump: jump,
          jumpTick,
          killAtJump,
          equipmentAfter: equip[Math.min(equip.length - 1, fEnd)] ?? -1,
          startMoneyNext: nextStart,
        });
      }
    }
  }
  console.log(`time_ran_out rounds scanned: ${timeoutRounds}; T rows: ${rows.length}`);
  const fmt = (r: SurvivorRow) => `${r.match.slice(-20)} r${r.round} ${r.player.padEnd(12)} alive=${r.aliveAtEndTick ? "Y" : "N"} hpEnd=${r.hpAtEndTick} deathTick=${r.deathTick ?? "-"} planted=${r.planted ? "Y" : "N"} jump=${r.moneyJump} jumpTick=${r.jumpTick ?? "-"} kill@jump=${r.killAtJump ? "Y" : "N"} equipAfter=${r.equipmentAfter} startNext=${r.startMoneyNext ?? "-"}`;
  for (const r of rows) console.log(fmt(r));
  // classification summary
  const alive = rows.filter((r) => r.aliveAtEndTick);
  const aliveJumpDist = new Map<number, number>();
  for (const r of alive) aliveJumpDist.set(r.moneyJump, (aliveJumpDist.get(r.moneyJump) ?? 0) + 1);
  console.log("\nalive-at-endTick T players:", alive.length, "| jump distribution:", [...aliveJumpDist.entries()].sort((a, b) => a[0] - b[0]).map(([j, c]) => `${j}×${c}`).join(", "));
  const dead = rows.filter((r) => !r.aliveAtEndTick);
  const deadJumpDist = new Map<number, number>();
  for (const r of dead) deadJumpDist.set(r.moneyJump, (deadJumpDist.get(r.moneyJump) ?? 0) + 1);
  console.log("dead-at-endTick T players:", dead.length, "| jump distribution:", [...deadJumpDist.entries()].sort((a, b) => a[0] - b[0]).map(([j, c]) => `${j}×${c}`).join(", "));
}

void main();
