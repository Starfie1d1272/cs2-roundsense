import type {
  BombRow,
  ParsedDemoPackage,
  PlayerEconomyRow,
  RoundRow,
} from "./adapter.js";

/**
 * Ground-truth queries over a v3 package (P1).
 *
 * Truth is defined as: fields that exist VERBATIM in the package. Anything
 * derived is marked `derived: true` and the derivation is documented — this
 * keeps demo truth distinct from GSI observation and rule estimation.
 */

export interface BombTruthRow {
  roundNumber: number;
  plantedTick: number | null;
  plantedAtMs: number | null; // tick / tickrate * 1000
  explodedTick: number | null;
  explodedAtMs: number | null;
  defusedTick: number | null;
  defusedAtMs: number | null;
  /** True fuse duration from planted→exploded ticks (B2). */
  fuseMs: number | null;
  derived: true;
}

const TICKRATE_DEFAULT = 64;

export function bombTruth(pkg: ParsedDemoPackage): BombTruthRow[] {
  const tickrate = pkg.manifest.tickrate ?? TICKRATE_DEFAULT;
  const byRound = new Map<number, BombRow[]>();
  for (const row of pkg.files.bombs) {
    const list = byRound.get(row.roundNumber) ?? [];
    list.push(row);
    byRound.set(row.roundNumber, list);
  }
  const out: BombTruthRow[] = [];
  for (const round of pkg.files.rounds) {
    const rows = byRound.get(round.roundNumber) ?? [];
    const planted = rows.find((r) => r.type === "planted") ?? null;
    const exploded = rows.find((r) => r.type === "exploded") ?? null;
    const defused = rows.find((r) => r.type === "defused") ?? null;
    const toMs = (tick: number | null): number | null => (tick === null ? null : (tick / tickrate) * 1000);
    out.push({
      roundNumber: round.roundNumber,
      plantedTick: planted?.tick ?? null,
      plantedAtMs: toMs(planted?.tick ?? null),
      explodedTick: exploded?.tick ?? null,
      explodedAtMs: toMs(exploded?.tick ?? null),
      defusedTick: defused?.tick ?? null,
      defusedAtMs: toMs(defused?.tick ?? null),
      fuseMs: planted && exploded ? ((exploded.tick - planted.tick) / tickrate) * 1000 : null,
      derived: true,
    });
  }
  return out;
}

export interface EconomyTruthRow extends PlayerEconomyRow {
  /** result of this round for the player's team (from rounds.json) */
  teamResult: "win" | "loss" | null;
  derived: true;
}

export function economyTruth(pkg: ParsedDemoPackage): EconomyTruthRow[] {
  const playerTeam = new Map(pkg.files.players.map((p) => [p.teamKey, p.teamKey]));
  void playerTeam;
  const roundResultByNumber = new Map<number, RoundRow>();
  for (const r of pkg.files.rounds) roundResultByNumber.set(r.roundNumber, r);

  // playerIndex → teamKey
  const teamByPlayer = new Map<number, "teamA" | "teamB">();
  pkg.files.players.forEach((p, i) => teamByPlayer.set(i, p.teamKey));

  return pkg.files.playerEconomies.map((row) => {
    const round = roundResultByNumber.get(row.roundNumber);
    const teamKey = teamByPlayer.get(row.playerIndex);
    let teamResult: "win" | "loss" | null = null;
    if (round && teamKey) {
      teamResult = round.winnerTeamKey === teamKey ? "win" : "loss";
    }
    return { ...row, teamResult, derived: true };
  });
}

export interface RoundTruthRow extends RoundRow {
  /** bomb truth for the same round (join, may be absent) */
  bomb: BombTruthRow | null;
  derived: true;
}

export function roundTruth(pkg: ParsedDemoPackage): RoundTruthRow[] {
  const bombs = bombTruth(pkg);
  const bombByRound = new Map(bombs.map((b) => [b.roundNumber, b]));
  return pkg.files.rounds.map((row) => ({
    ...row,
    bomb: bombByRound.get(row.roundNumber) ?? null,
    derived: true,
  }));
}

/** Team-level loss streak per round, derived from consecutive losses (C2).
 * Streaks RESET at the half switch (MR12: round 15 starts the second half).
 *
 * CORPUS-verified 2026-08-06 (Cologne QF1-m1 manual ledger):
 *  - PISTOL-round loss (r1/r13) pays $1900 flat (C10); counter += 2;
 *  - a WIN decrements the counter by ONE (min 0), it does NOT reset.
 *    Verified sequence (CT): r1 pistol loss (cnt 2) → r2 loss LOSS[2]=2400 →
 *    r3 loss 2900 → r4 loss 3400 → win (4→3) → next loss LOSS[3]=2900. */
export function teamLossStreakPerRound(pkg: ParsedDemoPackage): Map<string, number> {
  const out = new Map<string, number>();
  const streak = { teamA: 0, teamB: 0 };
  for (const round of pkg.files.rounds) {
    if (round.roundNumber === 13) {
      // second half begins (MR12: r1-12 / r13-24): loss counters reset to 0 (C2)
      streak.teamA = 0;
      streak.teamB = 0;
    }
    out.set(`${round.roundNumber}:teamA`, streak.teamA);
    out.set(`${round.roundNumber}:teamB`, streak.teamB);
    const inc = round.roundNumber === 1 || round.roundNumber === 13 ? 2 : 1; // pistol loss = 2 losses
    if (round.winnerTeamKey === "teamA") {
      streak.teamA = Math.max(0, streak.teamA - (round.endReason === "time_ran_out" ? 2 : 1)); // timeout win: −2 (corpus-verified)
      streak.teamB = Math.min(4, streak.teamB + inc);
    } else {
      streak.teamB = Math.max(0, streak.teamB - (round.endReason === "time_ran_out" ? 2 : 1));
      streak.teamA = Math.min(4, streak.teamA + inc);
    }
  }
  return out;
}
