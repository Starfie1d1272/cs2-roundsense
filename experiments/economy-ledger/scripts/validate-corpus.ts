/**
 * Economy truth validation over the v3 ZIP corpus (THE single validator).
 *
 * Method: per-player per-round integer income-difference ledger
 *   income(p, r) = startMoney(p, r) − startMoney(p, r−1) + moneySpent(p, r−1)
 *   residual     = income − modeled
 *
 * ALL numeric rules come from production sources — no second set here:
 *   - kill awards/prices: @roundsense/economy-advisor rules (generated
 *     weapon table weapons.v2026-08-06.json)
 *   - round rewards / loss bonus / plant-defuse / CT team award / TK
 *     penalty / maxMoney: DEFAULT_RULES (cs2-competitive-2026-08.json)
 *   - loss counter transitions: @roundsense/demo-oracle loss-bonus-state
 *     (winDecrement model EXPLICIT: count-dep, provisional — reported)
 *
 * Unknown weapons do NOT silently contribute $0: samples with unknown-kill
 * rewards are marked contaminated and excluded from the L1 exact-match
 * denominator (reported separately).
 *
 * Layers:
 *   L1 summary residual — diff=0 rate over clean denominator + integer
 *     residual distribution;
 *   L2 replay settlement — buy-phase firstCash / next-start lastCash;
 *   L3 time_ran_out T-survivor invariant — survivors get no loss payout.
 *
 * Run: pnpm --filter @roundsense/experiment-economy-ledger validate -- <zip|dir>...
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadDemoPackage, loadDemoPackageDir, type ParsedDemoPackage } from "@roundsense/demo-oracle";
import { lossCountsForPackage, lossBonusPayout } from "@roundsense/demo-oracle";
import { extractTransitions, classifyTransition, summarizeLedger } from "@roundsense/demo-oracle";
import { DEFAULT_RULES, killReward } from "@roundsense/economy-advisor";
import { decodeDelta } from "cs2-demo-format/parser";

const RULES = DEFAULT_RULES;
const MAX_MONEY = RULES.maxMoney;
const LOSS_WIN_MODEL = "count-dep" as const; // provisional — see loss-bonus-state.ts
const LOSS_WIN_MODEL_STATUS = "provisional" as const;
const WIN_BY_BOMB = new Set(["target_bombed", "bomb_defused"]);

interface Sample {
  residual: number;
  won: boolean;
  /** whether the player's team won the PREVIOUS round (team award belongs to r−1) */
  prevWon: boolean;
  lostStreak: number | null;
  /** CT team kills in prev round (CT players only; 0 for T) */
  ctTeamKillsPrev: number;
  /** true when the player was CT in the PREVIOUS round (team reward applies) */
  prevWasCt: boolean;
  side: "CT" | "T";
  playerIndex: number;
  round: number;
  /** kills with weapons missing from the weapon table → contaminated */
  unknownKillCount: number;
}

interface Stats {
  samples: Sample[];
  fuseMs: number[];
  fuseDistinct: Map<number, number>;
  matches: number;
  rounds: number;
  cappedExcluded: number;
  /** L2 replay settlement: buy-phase firstCash check and next-start check */
  settlement: { checked: number; buyPhaseOk: number; nextStartOk: number };
  /** L3 time_ran_out T-survivor invariant */
  tSurvivor: { checked: number; lossPayoutViolations: number };
  /** L4 replay-native cash transitions (classified) */
  l4: { transitions: number; explainedExact: number; compoundExplained: number; buyWindowTransactions: number; samplingAmbiguous: number; unexplained: number; dollarWeighted: number; dollarUnexplained: number; playerRoundsWithUnexplained: number; perCategory: Record<string, number> };
  /** L1-nonzero decomposition over replay matches */
  l4Decomp: { checked: number; summaryFieldLimitation: number; replayUnexplained: number; samplingAmbiguous: number; noReplay: number };
  /** OT half-opener cash profile (server/match profile, NOT universal rule) */
  ot: { halves: number; reset10000: number; carryOver: number; other: number; byOpener: Record<number, string> };
  /** ambiguous settlement deltas (diagnostic) */
  ambDeltas: Map<number, number>;
  /** unknown weapons seen (weapon → count), all matches */
  unknownWeapons: Map<string, number>;
}

function analyze(pkg: ParsedDemoPackage, s: Stats, zipName = "?"): void {
  s.matches++;
  s.rounds += pkg.files.rounds.length;
  const { players, rounds, kills, bombs, playerEconomies, replay } = pkg.files;
  const tickrate = pkg.manifest.tickrate ?? 64;
  const l4Flags = new Map<string, { unexplained: boolean; ambiguous: boolean }>();

  const teamByPlayer = new Map<number, string>();
  players.forEach((p, i) => teamByPlayer.set(i, p.teamKey));

  const money = new Map<number, Map<number, { start: number; spent: number }>>();
  for (const row of playerEconomies) {
    let m = money.get(row.playerIndex);
    if (!m) { m = new Map(); money.set(row.playerIndex, m); }
    m.set(row.roundNumber, { start: row.startMoney, spent: row.moneySpent });
  }

  const roundByNumber = new Map(rounds.map((r) => [r.roundNumber, r]));
  // OT half-opener cash profile: server/match profile, NOT universal rule.
  // Corpus finding: alternating pattern — odd-order OT halves (r25, r31,
  // r37, …) carry over; even-order (r28, r34, r40, …) reset to 10000
  // (mp_overtime_startmoney). Reported per opener round.
  {
    const otByRound = new Map<number, Set<number>>();
    for (const row of playerEconomies) {
      if (row.roundNumber >= 25 && (row.roundNumber - 25) % 3 === 0) {
        let set = otByRound.get(row.roundNumber);
        if (!set) { set = new Set(); otByRound.set(row.roundNumber, set); }
        set.add(row.startMoney);
      }
    }
    for (const [rn, vals] of otByRound) {
      s.ot.halves++;
      const uniform = vals.size === 1;
      if (uniform && [...vals][0] === 10000) {
        s.ot.reset10000++;
        s.ot.byOpener[rn] = "reset10000";
      } else if (uniform) {
        s.ot.other++;
        s.ot.byOpener[rn] = `uniform-${[...vals][0]}`;
      } else {
        s.ot.carryOver++;
        s.ot.byOpener[rn] = "non-uniform";
      }
    }
  }
  // per-match loss simulation — local, explicit model (no global cache)
  const lossSim = lossCountsForPackage(pkg, { winDecrement: LOSS_WIN_MODEL });
  const stdLossCountAt = (roundNumber: number, teamKey: string): number => {
    const row = lossSim.get(roundNumber);
    if (!row) return 1;
    return teamKey === "teamA" ? row.teamA : row.teamB;
  };

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
  // deathTick per (round, victim) — T-survivor check uses deathTick ≤ endTick
  const deathTickByRound = new Map<number, Map<number, number>>();
  for (const k of kills) {
    if (k.victimIndex === null) continue;
    let m = deathTickByRound.get(k.roundNumber);
    if (!m) { m = new Map(); deathTickByRound.set(k.roundNumber, m); }
    const prev = m.get(k.victimIndex);
    if (prev === undefined || k.tick < prev) m.set(k.victimIndex, k.tick);
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
    // CT shared team award: EVERY CT player gets +50 per T ELIMINATED in the
    // previous round (victim-side count, includes world/C4 kills).
    const tTeamKeyPrev = prev.teamASide === "t" ? "teamA" : "teamB";
    const tEliminatedPrev = prevKills.filter(
      (k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKeyPrev,
    ).length;

    const prevPlanted = plantedByRound.get(r - 1) ?? false;
    const prevPlantPlayers = plantPlayersByRound.get(r - 1) ?? new Set();
    const prevDefusePlayers = defusePlayersByRound.get(r - 1) ?? new Set();

    for (const [playerIndex, m] of money) {
      const cur = m.get(r);
      const pre = m.get(r - 1);
      if (!cur || !pre) continue;
      const teamKey = teamByPlayer.get(playerIndex);
      if (!teamKey) continue;
      const side = (teamKey === "teamA" ? round.teamASide : round.teamBSide) as "CT" | "T";
      const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;

      const income = cur.start - pre.start + pre.spent;
      const wonPrev = prev.winnerTeamKey === teamKey;
      const won = round.winnerTeamKey === teamKey;

      // personal kill rewards of the PREVIOUS round (weapon table)
      const myTeam = teamByPlayer.get(playerIndex);
      let prevTkCount = 0;
      let killRewardTotal = 0;
      let unknownKillCount = 0;
      const prevDeadSet = new Set<number>();
      for (const k of prevKills) if (k.victimIndex !== null) prevDeadSet.add(k.victimIndex);
      for (const k of prevKills) {
        if (k.killerIndex !== playerIndex || k.victimIndex === playerIndex) continue;
        if (teamByPlayer.get(k.victimIndex) === myTeam) { prevTkCount++; continue; }
        try {
          killRewardTotal += killReward(RULES, { weaponId: k.weapon });
        } catch {
          unknownKillCount++;
          s.unknownWeapons.set(k.weapon, (s.unknownWeapons.get(k.weapon) ?? 0) + 1);
        }
      }

      // modeled rewards — FULL integer ledger from production rules
      let modeled = 0;
      let lostStreak: number | null = null;
      if (prevSide === "ct") modeled += RULES.roundRewards.ctTeamKillReward * tEliminatedPrev;
      if (wonPrev) {
        modeled += WIN_BY_BOMB.has(prev.endReason)
          ? RULES.roundRewards.winByBombDetonation
          : RULES.roundRewards.winByElimination;
      } else if (prev.endReason === "time_ran_out" && prevSide === "t" && !prevDeadSet.has(playerIndex)) {
        // time_ran_out loss: SURVIVING T players get NO loss bonus
        // (corpus-observed, zero counter-examples; L3 re-checks this below)
        modeled += 0;
        lostStreak = -1;
      } else {
        // payout = min(3400, 1400 + 500 × count) with count BEFORE this round;
        // mp_starting_losses=1 → first loss of a half pays 1900 automatically.
        const streak = stdLossCountAt(r - 1, teamKey);
        lostStreak = streak;
        modeled += lossBonusPayout(streak);
      }
      modeled += killRewardTotal;
      modeled -= RULES.roundRewards.tkPenalty * prevTkCount;
      if (!wonPrev && prevSide === "t" && prevPlanted) modeled += RULES.roundRewards.plantBonusT;
      if (prevPlantPlayers.has(playerIndex)) modeled += RULES.roundRewards.plantBonusPlayer;
      if (prevDefusePlayers.has(playerIndex)) modeled += RULES.roundRewards.defuseBonusPlayer;

      const residual = income - modeled;
      const capped = cur.start >= MAX_MONEY && income < modeled;
      if (capped) { s.cappedExcluded++; continue; }

      // ── L2 replay settlement check (matches with replay only) ────────────────
      if (replay && !zipName.startsWith("dir:")) {
        const rrPrev = replay.rounds.find((x) => x.roundNumber === r - 1);
        const track = rrPrev?.players.find((t) => t.playerIndex === playerIndex);
        if (track) {
          const m = decodeDelta(track.money);
          if (m.length >= 2) {
            s.settlement.checked++;
            if (m[0] === pre.start - pre.spent) s.settlement.buyPhaseOk++;
            if (m[m.length - 1] === cur.start) s.settlement.nextStartOk++;
          }
        }
      }

      // ── L3 time_ran_out T-survivor invariant ────────────────────────────────
      // dead = deathTick ≤ endTick (primary); replay hp at/before endTick as
      // cross-check. Survivors must receive NO loss payout (no jump ≥ 1400 in
      // the settlement window around endTick).
      if (prev.endReason === "time_ran_out" && prevSide === "t" && replay && !zipName.startsWith("dir:")) {
        const rrPrev = replay.rounds.find((x) => x.roundNumber === r - 1);
        const track = rrPrev?.players.find((t) => t.playerIndex === playerIndex);
        const deathTick = deathTickByRound.get(r - 1)?.get(playerIndex) ?? null;
        const endTick = prev.endTick;
        if (track && endTick) {
          const dead = deathTick !== null && deathTick <= endTick;
          if (!dead) {
            // survivor: check settlement window for a loss-payout jump
            const m = decodeDelta(track.money);
            const step = rrPrev?.tickStep ?? 8;
            const start = rrPrev?.startTick ?? 0;
            let maxJump = 0;
            for (let f = 0; f < m.length - 1; f++) {
              const tick = start + f * step;
              if (tick < endTick - 16 || tick > endTick + 400) continue;
              const d = m[f + 1]! - m[f]!;
              if (d > maxJump) maxJump = d;
            }
            s.tSurvivor.checked++;
            // loss-bonus ladder base is 1400; kill/plant jumps are ≤ 300
            if (maxJump >= 1400) s.tSurvivor.lossPayoutViolations++;
          }
        }
      }

      // L1-nonzero decomposition: consult the per-(round,player) L4 flags
      // computed in the INDEPENDENT L4 pass below (covers ALL replay rounds,
      // not only those reachable from the L1 iteration).
      if (residual !== 0) {
        if (replay && !zipName.startsWith("dir:")) {
          const flag = l4Flags.get(`${r - 1}:${playerIndex}`);
          s.l4Decomp.checked++;
          if (flag?.unexplained) s.l4Decomp.replayUnexplained++;
          else if (flag?.ambiguous) s.l4Decomp.samplingAmbiguous++;
          else s.l4Decomp.summaryFieldLimitation++;
        } else {
          s.l4Decomp.noReplay++;
        }
      }
      s.samples.push({
        residual,
        won,
        prevWon: wonPrev,
        lostStreak,
        ctTeamKillsPrev: prevSide === "ct" ? tEliminatedPrev : 0,
        prevWasCt: prevSide === "ct",
        side,
        playerIndex,
        round: r,
        unknownKillCount,
      });
    }
  }

  // ── L4 pass: INDEPENDENT of the L1 iteration — every replay round, every
  // player track, every cash transition (no r<2 / reset-round skips). ────────
  if (!replay || zipName.startsWith("dir:")) return;
  for (const rr of replay.rounds) {
    const rn = rr.roundNumber;
    const round = roundByNumber.get(rn);
    if (!round) continue;
    const rKills = killsByRound.get(rn) ?? [];
    const rBombs = bombsByRound.get(rn) ?? [];
    const plant = rBombs.find((b) => b.type === "planted") ?? null;
    const defuse = rBombs.find((b) => b.type === "defused") ?? null;
    const tTeamKey = round.teamASide === "t" ? "teamA" : "teamB";
    const tEliminated = rKills.filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKey).length;
    const deaths = deathTickByRound.get(rn) ?? new Map();

    for (const track of rr.players) {
      const pi = track.playerIndex;
      const teamKey = teamByPlayer.get(pi);
      if (!teamKey) continue;
      const side = (teamKey === "teamA" ? round.teamASide : round.teamBSide) as "CT" | "T";
      const deathTick = deaths.get(pi) ?? null;
      const ctx = {
        roundNumber: rn,
        endReason: round.endReason,
        winnerTeamKey: round.winnerTeamKey,
        playerTeamKey: teamKey,
        playerIndex: pi,
        freezeEndTick: rr.startTick, // replay segment starts at freeze end
        segmentEndTick: rr.startTick + (rr.frameCount - 1) * rr.tickStep,
        endTick: round.endTick,
        isT: side === "T" || side === "t",
        deadAtEnd: deathTick !== null && deathTick <= round.endTick,
        tEliminated,
        plantHappened: plant !== null,
        planterIndex: plant?.actorIndex ?? null,
        defuserIndex: defuse?.actorIndex ?? null,
        kills: rKills.map((k) => ({ tick: k.tick, killer: k.killerIndex, victim: k.victimIndex, weapon: k.weapon })),
        myTeamKills: rKills.filter((k) => k.killerIndex === pi && k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === teamKey).map((k) => ({ tick: k.tick, weapon: k.weapon })),
      };
      const money = decodeDelta(track.money);
      if (money.length < 2) continue;
      const transitions = extractTransitions(money, rr.startTick, rr.tickStep);
      let flagU = false;
      let flagA = false;
      for (const t of transitions) {
        const cls = classifyTransition(t, ctx);
        s.l4.transitions++;
        s.l4.perCategory[cls.category] = (s.l4.perCategory[cls.category] ?? 0) + 1;
        s.l4.dollarWeighted += Math.abs(t.delta);
        if (process.env.L4_DEBUG && (cls.category === "sampling_ambiguous" || cls.category === "unexplained")) {
          console.error(`L4DBG ${zipName} r${rn} p${pi} ${side} ${round.endReason} ${round.winnerTeamKey === teamKey ? "W" : "L"} plant=${plant ? 1 : 0} tElim=${tEliminated} d=${t.delta} → ${cls.category}${cls.matchedEvents.length ? " " + cls.matchedEvents.join("|") : ""}`);
        }
        if (cls.category === "unexplained") {
          s.l4.unexplained++;
          s.l4.dollarUnexplained += Math.abs(t.delta);
          flagU = true;
        } else if (cls.category === "sampling_ambiguous") {
          s.l4.samplingAmbiguous++;
          s.ambDeltas.set(t.delta, (s.ambDeltas.get(t.delta) ?? 0) + 1);
          flagA = true;
        } else if (cls.category === "compound_exact") {
          s.l4.compoundExplained++;
        } else if (cls.category === "buy_window_transaction") {
          s.l4.buyWindowTransactions++;
        } else {
          s.l4.explainedExact++;
        }
      }
      if (flagU) s.l4.playerRoundsWithUnexplained++;
      l4Flags.set(`${rn}:${pi}`, { unexplained: flagU, ambiguous: flagA });
    }
  }
}

function report(s: Stats): void {
  console.log(`matches=${s.matches} rounds=${s.rounds} samples=${s.samples.length}`);
  const fuseMean = s.fuseMs.length ? s.fuseMs.reduce((a, b) => a + b, 0) / s.fuseMs.length : NaN;
  console.log(`C4 fuse: mean=${fuseMean.toFixed(1)}ms n=${s.fuseMs.length} distinct=${JSON.stringify([...s.fuseDistinct.entries()])}`);

  // ── L1 summary residual (integer ledger — rewards are IN modeled) ──────────
  // denominator excludes contaminated (unknown weapon) and capped samples
  const clean = s.samples.filter((x) => x.unknownKillCount === 0);
  const contaminated = s.samples.length - clean.length;
  const exactZero = clean.filter((x) => x.residual === 0).length;
  const intDiffs = clean.filter((x) => Number.isInteger(x.residual)).length;
  const l1Denominator = clean.length;
  console.log(`LOSS-WIN-MODEL: ${LOSS_WIN_MODEL} (${LOSS_WIN_MODEL_STATUS})`);
  console.log(`LEDGER: diff=0 (exact): ${exactZero}/${l1Denominator} (${((100 * exactZero) / l1Denominator).toFixed(1)}%) [L1 denominator excludes capped=${s.cappedExcluded} contaminated=${contaminated}]`);
  console.log(`LEDGER: integer diffs: ${intDiffs}/${l1Denominator}`);
  const nz = new Map<number, number>();
  for (const x of clean) if (x.residual !== 0) nz.set(x.residual, (nz.get(x.residual) ?? 0) + 1);
  console.log(`LEDGER: top nonzero diffs: ${[...nz.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d, c]) => `${d}×${c}`).join(", ")}`);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  console.log(`residual all: mean=${mean(clean.map((x) => x.residual)).toFixed(1)} n=${clean.length}`);

  // CT team-award groups (integer ledger): all groups → 0 if award = 50/kill
  const rawBy = new Map<string, number[]>();
  for (const x of clean) {
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

  // ── L4 replay-native cash-transition ledger ────────────────────────────────
  if (s.l4.transitions > 0) {
    const t = s.l4.transitions;
    const pct = (n: number) => `${n} (${((100 * n) / t).toFixed(1)}%)`;
    console.log(`L4-CASH: transitions=${t} exact=${pct(s.l4.explainedExact)} compoundExact=${pct(s.l4.compoundExplained)} buyWindow=${pct(s.l4.buyWindowTransactions)} samplingAmbiguous=${pct(s.l4.samplingAmbiguous)} unexplained=${pct(s.l4.unexplained)}`);
    console.log(`L4-CASH: \$weighted=\$${s.l4.dollarWeighted} \$unexplained=\$${s.l4.dollarUnexplained} (${((100 * s.l4.dollarUnexplained) / Math.max(1, s.l4.dollarWeighted)).toFixed(2)}%) playerRoundsWithUnexplained=${s.l4.playerRoundsWithUnexplained}`);
    console.log(`L4-CASH: strict explainability (exact+compoundExact) = ${((100 * (s.l4.explainedExact + s.l4.compoundExplained)) / t).toFixed(1)}%; with buy-window = ${((100 * (s.l4.explainedExact + s.l4.compoundExplained + s.l4.buyWindowTransactions)) / t).toFixed(1)}%`);
    console.log(`L4-CASH: ambiguous deltas: ${[...s.ambDeltas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([d, c]) => `${d}×${c}`).join(", ")}`);
  } else {
    console.log("L4-CASH: no replay transitions in input");
  }
  // L1-nonzero decomposition (replay matches only)
  if (s.l4Decomp.checked > 0) {
    const d = s.l4Decomp;
    console.log(`L1-NONZERO-DECOMP (replay matches): total=${d.checked} summaryFieldLimitation=${d.summaryFieldLimitation} replayUnexplained=${d.replayUnexplained} samplingAmbiguous=${d.samplingAmbiguous} noReplay=${d.noReplay}`);
  }
  // OT cash profile (server/match profile — universal rule only defines WHEN)
  console.log(`OT-PROFILE: halves=${s.ot.halves} reset10000=${s.ot.reset10000} nonUniform=${s.ot.carryOver} other=${s.ot.other}`);
  console.log(`OT-PROFILE by opener: ${Object.entries(s.ot.byOpener).sort((a, b) => Number(a[0]) - Number(b[0])).map(([rn, v]) => `r${rn}=${v}`).join(", ")}`);
  // ── L2 replay settlement ────────────────────────────────────────────────────
  if (s.settlement.checked > 0) {
    console.log(`REPLAY-SETTLE: checked=${s.settlement.checked} buyPhase firstCash==start−spent: ${s.settlement.buyPhaseOk}/${s.settlement.checked} (${((100 * s.settlement.buyPhaseOk) / s.settlement.checked).toFixed(1)}%), lastCash==nextStart: ${s.settlement.nextStartOk}/${s.settlement.checked} (${((100 * s.settlement.nextStartOk) / s.settlement.checked).toFixed(1)}%)`);
  } else {
    console.log("REPLAY-SETTLE: no replay matches in input");
  }

  // ── L3 time_ran_out T-survivor invariant ───────────────────────────────────
  console.log(`T-SURVIVOR: checked=${s.tSurvivor.checked} lossPayoutViolations=${s.tSurvivor.lossPayoutViolations}`);

  // ── unknown weapons (never silently guessed) ───────────────────────────────
  const unk = [...s.unknownWeapons.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`UNKNOWN-WEAPONS: ${unk.length ? unk.map(([w, c]) => `${w}×${c}`).join(", ") : "none"}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files: string[] = [];
  const dirs: string[] = [];
  let jsonPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") {
      jsonPath = args[i + 1];
      if (!jsonPath) { console.error("--json requires a path: validate-corpus.ts <zip|dir>... --json <path>"); process.exit(1); }
      i++;
      continue;
    }
    if (arg.endsWith(".zip")) files.push(arg);
    else if (existsSync(join(arg, "manifest.json"))) dirs.push(arg);
    else if (existsSync(arg)) {
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
  if (files.length === 0 && dirs.length === 0) { console.error("usage: tsx validate-corpus.ts <zip|dir> ... [--json <path>]"); process.exit(1); }
  let loadErrors = 0;
  const s: Stats = {
    samples: [], fuseMs: [], fuseDistinct: new Map(), matches: 0, rounds: 0,
    cappedExcluded: 0, settlement: { checked: 0, buyPhaseOk: 0, nextStartOk: 0 },
    tSurvivor: { checked: 0, lossPayoutViolations: 0 },
    l4: { transitions: 0, explainedExact: 0, compoundExplained: 0, buyWindowTransactions: 0, samplingAmbiguous: 0, unexplained: 0, dollarWeighted: 0, dollarUnexplained: 0, playerRoundsWithUnexplained: 0, perCategory: {} },
    l4Decomp: { checked: 0, summaryFieldLimitation: 0, replayUnexplained: 0, samplingAmbiguous: 0, noReplay: 0 },
    ot: { halves: 0, reset10000: 0, carryOver: 0, other: 0, byOpener: {} },
    ambDeltas: new Map(),
    unknownWeapons: new Map(),
  };
  for (const f of files) {
    try {
      const pkg = await loadDemoPackage(f);
      analyze(pkg, s, f.split("/").pop() ?? f);
      console.error(`✓ ${f.split("/").pop()}`);
    } catch (e) {
      loadErrors++;
      console.error(`✗ ${f.split("/").pop()}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  for (const d of dirs) {
    try {
      const pkg = await loadDemoPackageDir(d);
      analyze(pkg, s, `dir:${d.split("/").pop()}`);
      console.error(`✓ dir:${d.split("/").pop()}`);
    } catch (e) {
      loadErrors++;
      console.error(`✗ dir:${d.split("/").pop()}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  if (loadErrors > 0) {
    console.error(`FAILED to load ${loadErrors} input(s) — refusing to report partial results`);
    process.exit(1);
  }
  report(s);
  if (jsonPath) {
    const { writeFileSync } = await import("node:fs");
    const residualDist: Record<string, number> = {};
    for (const x of s.samples) residualDist[String(x.residual)] = (residualDist[String(x.residual)] ?? 0) + 1;
    const l1Denominator = s.samples.filter((x) => x.unknownKillCount === 0).length;
    const reportJson = {
      matches: s.matches,
      rounds: s.rounds,
      lossWinModel: LOSS_WIN_MODEL,
      lossWinModelStatus: LOSS_WIN_MODEL_STATUS,
      samples: s.samples.length,
      l1Denominator,
      contaminatedSamples: s.samples.length - l1Denominator,
      cappedExcluded: s.cappedExcluded,
      diff0: s.samples.filter((x) => x.unknownKillCount === 0 && x.residual === 0).length,
      integerDiffs: s.samples.filter((x) => x.unknownKillCount === 0 && Number.isInteger(x.residual)).length,
      residualDistribution: residualDist,
      settlement: s.settlement,
      timeRanOutTSurvivor: s.tSurvivor,
      l4Cash: s.l4,
      l1NonzeroDecomp: s.l4Decomp,
      unknownWeapons: Object.fromEntries([...s.unknownWeapons.entries()].sort((a, b) => b[1] - a[1])),
      generatedAt: new Date().toISOString(),
    };
    writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2) + "\n");
    console.error(`wrote JSON report → ${jsonPath}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
