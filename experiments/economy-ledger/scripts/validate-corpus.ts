/**
 * Economy truth validation over the v3 ZIP corpus (THE single validator).
 *
 * Method: per-player per-round integer income-difference ledger
 *   income(p, r) = startMoney(p, r) − startMoney(p, r−1) + moneySpent(p, r−1)
 *   residual     = income − modeled   (modeled = round reward + loss bonus +
 *                 plant/defuse bonuses + kill rewards + CT team award + TK)
 *
 * All rewards come from generated/verified sources:
 *   - kill awards: packages/economy-advisor/rules/weapons.v2026-08-06.json
 *     (generated from GameTracking-CS2 weapons.vdata, commit 2e606a0b);
 *     UNKNOWN weapons are counted and reported — never silently guessed.
 *   - loss counter: packages/demo-oracle/src/loss-bonus-state.ts
 *     (winDecrement model passed explicitly; default count-dep).
 *
 * Output: stable machine-readable JSON (--json <path>) + short terminal
 * summary. Two layers:
 *   L1 summary residual — diff=0 rate + integer residual distribution;
 *   L2 replay settlement — for matches with replay: firstCash vs
 *     startMoney−moneySpent and lastCash vs next startMoney (diff=0 rate).
 *
 * Run: pnpm --filter @roundsense/experiment-economy-ledger validate -- <zip|dir>...
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadDemoPackage, loadDemoPackageDir, type ParsedDemoPackage } from "@roundsense/demo-oracle";
import { lossCountsForPackage } from "@roundsense/demo-oracle";
import { decodeDelta } from "cs2-demo-format/parser";
import weaponsJson from "../../../packages/economy-advisor/rules/weapons.v2026-08-06.json" with { type: "json" };

// ── weapon-id → kill award (weapons.vdata, generated — see
//    packages/economy-advisor/scripts/generate-weapons.ts) ────────────────────
const WEAPONS = (weaponsJson as { weaponAliases: Record<string, string>; weapons: Record<string, { killAward: number }> });
const unknownWeapons = new Map<string, number>();
function killAwardOf(weapon: string): number {
  // world damage / C4 explosions: no personal award
  if (weapon === "world" || weapon === "planted_c4" || weapon === "c4") return 0;
  const id = WEAPONS.weaponAliases[weapon] ?? (weapon.startsWith("weapon_") ? weapon : null);
  if (!id) { unknownWeapons.set(weapon, (unknownWeapons.get(weapon) ?? 0) + 1); return 0; } // unknown → 0 + report
  const award = WEAPONS.weapons[id]?.killAward;
  if (award === undefined) { unknownWeapons.set(weapon, (unknownWeapons.get(weapon) ?? 0) + 1); return 0; }
  return award;
}

const WIN_BY_BOMB = new Set(["target_bombed", "bomb_defused"]);
const LOSS_BONUS_MODEL = [1400, 1900, 2400, 2900, 3400];

// ── STANDARD loss-counter model (see packages/demo-oracle/src/loss-bonus-state.ts) ─
// mp_starting_losses = 1 → each half starts lossCount = 1;
// payout = min(3400, 1400 + 500 × lossCount); win decrement UNRESOLVED
// (candidate models in loss-bonus-state.ts; corpus: tier drop 1 across any
// win, candidate internal decrement 2, cap branch runtime-unverified)
let stdLossCache: Map<number, { teamA: number; teamB: number }> | null = null;
function buildStdLossCache(pkg: Parameters<typeof loadDemoPackage>[0] extends never ? never : Parameters<typeof lossCountsForPackage>[0]): void {
  const sim = lossCountsForPackage(pkg, { winDecrement: "count-dep" });
  const out = new Map<number, { teamA: number; teamB: number }>();
  for (const [r, v] of sim) out.set(r, { teamA: v.teamA, teamB: v.teamB });
  stdLossCache = out;
}
function stdLossCountAt(roundNumber: number, teamKey: string): number {
  const row = stdLossCache?.get(roundNumber);
  if (!row) return 1;
  return teamKey === "teamA" ? row.teamA : row.teamB;
}
const WIN_REWARD_ELIM = 3250;
const WIN_REWARD_BOMB = 3500;

// ── kill rewards come from the generated weapons table (weapons.vdata) ──────
const TK_PENALTY = 300; // teamkill: −$300 per teamkill (cash_player_killed_teammate)

// R4: T plant-loss bonus (whole T team) — fandom $600, corpus ≈ 585-672
const PLANT_BONUS_T_MODEL = 600;

interface Sample {
  residual: number;
  won: boolean;
  /** whether the player's team won the PREVIOUS round (team award belongs to r−1) */
  prevWon: boolean;
  wonBomb: boolean;
  lostStreak: number | null;
  tLostWithPlant: boolean;
  killCounts: Map<string, number>;
  /** own kills total (for LOO computation) */
  ownKills: number;
  /** CT team kills in prev round (CT players only; 0 for T) */
  ctTeamKillsPrev: number;
  /** leave-one-out: CT team kills EXCLUDING this player's own kills — breaks
   *  collinearity with per-class kill rewards in the OLS */
  ctTeamKillsLoo: number;
  /** true when the player was CT in the PREVIOUS round (team reward applies) */
  prevWasCt: boolean;
  side: "CT" | "T";
  playerIndex: number;
  round: number;
  month: number; // match month (1-12) — detect recent rule changes
}

interface Stats {
  samples: Sample[];
  fuseMs: number[];
  fuseDistinct: Map<number, number>;
  matches: number;
  rounds: number;
  /** L2 replay settlement: buy-phase firstCash check and next-start check */
  settlement: { checked: number; buyPhaseOk: number; nextStartOk: number };
}

function analyze(pkg: ParsedDemoPackage, s: Stats, month: number, zipName = "?"): void {
  s.matches++;
  s.rounds += pkg.files.rounds.length;
  const { players, rounds, kills, bombs, playerEconomies, replay } = pkg.files;
  const tickrate = pkg.manifest.tickrate ?? 64;

  const teamByPlayer = new Map<number, string>();
  players.forEach((p, i) => teamByPlayer.set(i, p.teamKey));

  const money = new Map<number, Map<number, { start: number; spent: number }>>();
  for (const row of playerEconomies) {
    let m = money.get(row.playerIndex);
    if (!m) { m = new Map(); money.set(row.playerIndex, m); }
    m.set(row.roundNumber, { start: row.startMoney, spent: row.moneySpent });
  }

  const roundByNumber = new Map(rounds.map((r) => [r.roundNumber, r]));
  buildStdLossCache(pkg);

  const plantedByRound = new Map<number, boolean>();
  const plantPlayersByRound = new Map<number, Set<number>>();
  const defusePlayersByRound = new Map<number, Set<number>>();
  const bombsByRound = new Map<number, typeof bombs>();
  for (const b of bombs) {
    const list = bombsByRound.get(b.roundNumber) ?? [];
    list.push(b); bombsByRound.set(b.roundNumber, list);
    if (b.type === "planted") {
      plantedByRound.set(b.roundNumber, true);
      const set = plantPlayersByRound.get(b.roundNumber) ?? new Set();
      set.add(b.actorIndex); plantPlayersByRound.set(b.roundNumber, set);
    }
    if (b.type === "defused") {
      const set = defusePlayersByRound.get(b.roundNumber) ?? new Set();
      set.add(b.actorIndex); defusePlayersByRound.set(b.roundNumber, set);
    }
  }

  // fuse truth
  for (const round of rounds) {
    const bm = bombsByRound.get(round.roundNumber);
    const planted = bm?.find((b) => b.type === "planted");
    const exploded = bm?.find((b) => b.type === "exploded");
    if (planted && exploded) {
      const fuseMs = ((exploded.tick - planted.tick) / tickrate) * 1000;
      s.fuseMs.push(fuseMs);
      s.fuseDistinct.set(fuseMs, (s.fuseDistinct.get(fuseMs) ?? 0) + 1);
    }
  }

  const killsByRound = new Map<number, typeof kills>();
  for (const k of kills) {
    const list = killsByRound.get(k.roundNumber) ?? [];
    list.push(k); killsByRound.set(k.roundNumber, list);
  }

  for (const round of rounds) {
    const r = round.roundNumber;
    if (r < 2) continue;
    // r13 = second-half pistol round, r25/r28/… = OT half openers: economy
    // RESETS (startMoney back to 800), so the income-difference ledger is
    // invalid for these rounds' start.
    if (r === 13 || (r >= 25 && (r - 25) % 3 === 0)) continue;
    const prev = roundByNumber.get(r - 1);
    if (!prev) continue;

    const prevKills = killsByRound.get(r - 1) ?? [];
    // CT shared team award (2025-07-16 rule): EVERY CT player gets +$50 per
    // T ELIMINATED in the previous round — "eliminated" includes world kills
    // (C4 explosion, fall damage; killerIndex null) and team kills, i.e.
    // COUNT BY VICTIM (victim is on the T side), not by CT killer.
    // Corpus-verified 2026-08-06: r9 Cologne QF1 = 3 CT kills + 1 C4 suicide
    // kill of the planter → award 4×50=200 per CT player.
    const tTeamKeyPrev = prev.teamASide === "t" ? "teamA" : "teamB";
    const tEliminatedPrev = prevKills.filter(
      (k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKeyPrev,
    ).length;

    const prevPlanted = plantedByRound.get(r - 1) ?? false;
    const prevPlantPlayers = plantPlayersByRound.get(r - 1) ?? new Set();
    const prevDefusePlayers = defusePlayersByRound.get(r - 1) ?? new Set();
    const prevIsPistol = r - 1 === 1 || r - 1 === 13;

    for (const [playerIndex, m] of money) {
      const cur = m.get(r);
      const pre = m.get(r - 1);
      if (!cur || !pre) continue;
      if (process.env.RS_DEBUG && s.samples.length === 0 && r === 2) {
        console.error(`DEBUG p=${playerIndex} cur=${JSON.stringify(cur)} pre=${JSON.stringify(pre)}`);
      }
      const teamKey = teamByPlayer.get(playerIndex);
      if (!teamKey) continue;
      const side = (teamKey === "teamA" ? round.teamASide : round.teamBSide) as "CT" | "T";
      // NOTE: demo format uses lowercase "t"/"ct" (sideSchema); GSI uses "CT"/"T"
      const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;

      const income = cur.start - pre.start + pre.spent;
      const wonPrev = prev.winnerTeamKey === teamKey; // outcome of round r-1 feeds income(r)
      const won = round.winnerTeamKey === teamKey;

      // personal kill rewards of the PREVIOUS round (class table — versioned)
      const killCounts = new Map<string, number>();
      const myTeam = teamByPlayer.get(playerIndex);
      let ownKills = 0;
      let prevTkCount = 0;
      // dead players in prev round (victim of any kill) — for T-survivor rule
      const prevDeadSet = new Set<number>();
      for (const k of prevKills) if (k.victimIndex !== null) prevDeadSet.add(k.victimIndex);
      for (const k of prevKills) {
        if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex) {
          // team-kills pay NO reward and cost −300 each — exclude same-team victims
          if (teamByPlayer.get(k.victimIndex) === myTeam) { prevTkCount++; continue; }
          ownKills++;
          const award = killAwardOf(k.weapon);
          if (award === 0) continue; // world/C4/unknown: no modeled reward
          killCounts.set(k.weapon, (killCounts.get(k.weapon) ?? 0) + 1);
        }
      }

      // modeled rewards — FULL integer ledger (everything is modeled):
      //   win/loss + plant/defuse + PERSONAL KILL REWARDS (class table) +
      //   CT shared team award (50 × prev-round CT kills for CT players)
      let modeled = 0;
      let wonBomb = false;
      let lostStreak: number | null = null;
      if (prevSide === "ct") modeled += 50 * tEliminatedPrev; // 2025-07-16 shared team award
      if (wonPrev) {
        wonBomb = WIN_BY_BOMB.has(prev.endReason);
        modeled += wonBomb ? WIN_REWARD_BOMB : WIN_REWARD_ELIM;
      } else if (prev.endReason === "time_ran_out" && prevSide === "t" && !prevDeadSet.has(playerIndex)) {
        // C-new: on time_ran_out loss, SURVIVING T players get NO round-end
        // loss bonus (only dead T players do). Empirically confirmed.
        modeled += 0;
        lostStreak = -1;
      } else {
        // STANDARD MODEL (gamemode_competitive.cfg: mp_starting_losses=1):
        // payout = min(3400, 1400 + 500 × lossCount) with lossCount BEFORE
        // this round; pistol-round loss pays 1900 = 1400+500×1 automatically.
        const streak = stdLossCountAt(r - 1, teamKey);
        lostStreak = streak;
        modeled += Math.min(3400, 1400 + 500 * streak);
      }
      for (const [weapon, cnt] of killCounts) {
        modeled += killAwardOf(weapon) * cnt;
      }
      // TK penalty: −300 per teamkill by this player (cash_player_killed_teammate)
      modeled -= TK_PENALTY * prevTkCount;
      // R4: T plant-loss bonus (600, whole T team) — T lost prev round with a plant
      if (!wonPrev && prevSide === "t" && prevPlanted) modeled += PLANT_BONUS_T_MODEL;
      // R7/R8: planter +300 / defuser +300
      if (prevPlantPlayers.has(playerIndex)) modeled += 300;
      if (prevDefusePlayers.has(playerIndex)) modeled += 300;

      const residual = income - modeled;
      // cap (C6): $16000 truncation makes residual non-informative for the
      // affected sample — mark it and exclude from ALL statistics instead of
      // dropping it outright (modeled is now complete, so nearly every capped
      // player would otherwise be filtered).
      const capped = cur.start >= 16000 && income < modeled;
      if (capped) continue;

      const isCt = prevSide === "ct";
      if (process.env.RS_D5 && (residual === -200 || residual === -500)) {
        console.error(`D5 ${zipName} r=${r} p=${playerIndex} prevEnd=${prev.endReason} ${prevSide}${wonPrev ? "W" : "L"} std=${stdLossCountAt(r - 1, teamKey)} inc=${income} mod=${modeled} tElim=${tEliminatedPrev} tk=${prevTkCount} pre=${pre.start}/${pre.spent} cur=${cur.start} kills=[${[...killCounts.entries()].map(([c, n]) => `${c}x${n}`).join(",")}]`);
      }
      // ── L2 replay settlement check (matches with replay only) ────────────────
      // prev-round replay segment: firstCash must equal startMoney(r−1) −
      // moneySpent(r−1) (buy-phase snapshot) and lastCash must equal
      // startMoney(r) (settlement lands before the next round's start).
      if (replay && !zipName.startsWith("dir:")) {
        const rrPrev = replay.rounds.find((x) => x.roundNumber === r - 1);
        const track = rrPrev?.players.find((t) => t.playerIndex === playerIndex);
        if (track && pre && cur) {
          const m = decodeDelta(track.money);
          if (m.length >= 2) {
            s.settlement.checked++;
            if (m[0] === pre.start - pre.spent) s.settlement.buyPhaseOk++;
            if (m[m.length - 1] === cur.start) s.settlement.nextStartOk++;
          }
        }
      }
      s.samples.push({
        residual,
        won,
        prevWon: wonPrev,
        wonBomb,
        lostStreak,
        tLostWithPlant: !wonPrev && prevSide === "t" && prevPlanted,
        killCounts,
        ownKills,
        ctTeamKillsPrev: isCt ? tEliminatedPrev : 0, // CT players only (2025-07-15 rule)
        ctTeamKillsLoo: isCt ? Math.max(0, tEliminatedPrev - ownKills) : 0,
        prevWasCt: isCt,
        side,
        playerIndex,
        round: r,
        month,
      });
    }
  }
}

function report(s: Stats): void {
  console.log(`matches=${s.matches} rounds=${s.rounds} samples=${s.samples.length}`);
  const fuseMean = s.fuseMs.length ? s.fuseMs.reduce((a, b) => a + b, 0) / s.fuseMs.length : NaN;
  console.log(`C4 fuse: mean=${fuseMean.toFixed(1)}ms n=${s.fuseMs.length} distinct=${JSON.stringify([...s.fuseDistinct.entries()])}`);

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const n = (xs: Sample[]) => xs.length;

  // ── L1 summary residual (integer ledger — rewards are IN modeled) ──────────
  const exactZero = s.samples.filter((x) => x.residual === 0).length;
  const intDiffs = s.samples.filter((x) => Number.isInteger(x.residual)).length;
  console.log(`LEDGER: diff=0 (exact): ${exactZero}/${s.samples.length} (${((100 * exactZero) / s.samples.length).toFixed(1)}%), integer diffs: ${intDiffs}`);
  const nz = new Map<number, number>();
  for (const x of s.samples) if (x.residual !== 0) nz.set(x.residual, (nz.get(x.residual) ?? 0) + 1);
  console.log(`LEDGER: top nonzero diffs: ${[...nz.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d, c]) => `${d}×${c}`).join(", ")}`);
  console.log(`residual all: mean=${mean(s.samples.map((x) => x.residual)).toFixed(1)} n=${n(s.samples)}`);

  // CT team-award groups (integer ledger): all groups → 0 if award = 50/kill
  const rawBy = new Map<string, number[]>();
  for (const x of s.samples) {
    if (!x.prevWasCt) continue;
    const key = `${x.prevWon ? "W" : "L"}:${x.ctTeamKillsPrev}`;
    const list = rawBy.get(key) ?? [];
    list.push(x.residual);
    rawBy.set(key, list);
  }
  const rmean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log("CT team-award residual by (PREV outcome × PREV CT kills) — all groups → 0 if award=50/kill:");
  for (const won of ["W", "L"]) {
    const base = rawBy.get(`${won}:0`) ?? [];
    const baseMean = rmean(base);
    for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const list = rawBy.get(`${won}:${k}`);
      if (!list || list.length === 0) continue;
      const pk = (rmean(list) - baseMean) / k;
      console.log(`  ${won === "W" ? "win " : "loss"} ctKills=${k}: n=${list.length} mean=${rmean(list).toFixed(0)} → +$${pk.toFixed(1)}/kill vs ctKills=0 (base=${baseMean.toFixed(0)}, n=${base.length})`);
    }
  }

  // ── L2 replay settlement (matches with replay only) ────────────────────────
  if (s.settlement.checked > 0) {
    console.log(`REPLAY-SETTLE: checked=${s.settlement.checked} buyPhase firstCash==start−spent: ${s.settlement.buyPhaseOk}/${s.settlement.checked} (${((100 * s.settlement.buyPhaseOk) / s.settlement.checked).toFixed(1)}%), lastCash==nextStart: ${s.settlement.nextStartOk}/${s.settlement.checked} (${((100 * s.settlement.nextStartOk) / s.settlement.checked).toFixed(1)}%)`);
  } else {
    console.log("REPLAY-SETTLE: no replay matches in input");
  }

  // ── unknown weapons (never silently guessed) ───────────────────────────────
  const unk = [...unknownWeapons.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`UNKNOWN-WEAPONS: ${unk.length ? unk.map(([w, c]) => `${w}×${c}`).join(", ") : "none"}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files: string[] = [];
  const dirs: string[] = [];
  for (const arg of args) {
    if (arg.endsWith(".zip")) files.push(arg);
    else if (existsSync(join(arg, "manifest.json"))) dirs.push(arg); // unpacked v3 dir
    else if (existsSync(arg)) {
      // directory of zips and/or unpacked v3 package dirs
      for (const entry of readdirSync(arg, { withFileTypes: true })) {
        const p = join(arg, entry.name);
        if (entry.isDirectory()) {
          if (existsSync(join(p, "manifest.json"))) dirs.push(p);
        } else if (entry.name.endsWith(".zip")) {
          files.push(p);
        }
      }
    }
  }
  if (files.length === 0 && dirs.length === 0) { console.error("usage: tsx validate-corpus.ts <zip|dir> ..."); process.exit(1); }
  const s: Stats = { samples: [], fuseMs: [], fuseDistinct: new Map(), matches: 0, rounds: 0, settlement: { checked: 0, buyPhaseOk: 0, nextStartOk: 0 } };
  for (const f of files) {
    try {
      const pkg = await loadDemoPackage(f);
      const base = f.split("/").pop() ?? f;
      const m = /(?:^|-)2026-(\d{2})/.exec(base);
      const month = m ? Number(m[1]) : 0;
      analyze(pkg, s, month, base);
      console.error(`✓ ${base}`);
    } catch (e) {
      console.error(`✗ ${f.split("/").pop()}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  for (const d of dirs) {
    try {
      const pkg = await loadDemoPackageDir(d);
      analyze(pkg, s, 0, `dir:${d.split("/").pop()}`); // month unknown for Windows corpus
      console.error(`✓ dir:${d.split("/").pop()}`);
    } catch (e) {
      console.error(`✗ dir:${d.split("/").pop()}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  report(s);
  const jsonIdx = process.argv.indexOf("--json");
  if (jsonIdx >= 0) {
    const { writeFileSync } = await import("node:fs");
    const residualDist: Record<string, number> = {};
    for (const x of s.samples) residualDist[String(x.residual)] = (residualDist[String(x.residual)] ?? 0) + 1;
    const reportJson = {
      matches: s.matches,
      rounds: s.rounds,
      samples: s.samples.length,
      diff0: s.samples.filter((x) => x.residual === 0).length,
      integerDiffs: s.samples.filter((x) => Number.isInteger(x.residual)).length,
      residualDistribution: residualDist,
      settlement: s.settlement,
      unknownWeapons: Object.fromEntries([...unknownWeapons.entries()].sort((a, b) => b[1] - a[1])),
      generatedAt: new Date().toISOString(),
    };
    writeFileSync(process.argv[jsonIdx + 1]!, JSON.stringify(reportJson, null, 2) + "\n");
    console.error(`wrote JSON report → ${process.argv[jsonIdx + 1]}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
