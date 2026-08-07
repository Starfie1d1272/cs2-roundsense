import type {
  BombRow,
  ParsedDemoPackage,
  PlayerEconomyRow,
  RoundRow,
} from "./adapter.js";
import { lossCountsForPackage } from "./loss-bonus-state.js";

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

/**
 * Team-level loss-bonus count per round — SINGLE SOURCE OF TRUTH lives in
 * ./loss-bonus-state.ts (standard model: mp_starting_losses=1, payout =
 * min(3400, 1400+500×count), half resets at r13 and each OT half; win
 * decrement UNRESOLVED — candidate models & evidence in that module).
 *
 * This wrapper keeps the legacy Map<string, number> shape ("round:teamA").
 * Values 0..3 are exact; 4 = capped interval [4, ∞).
 */
export function teamLossStreakPerRound(pkg: ParsedDemoPackage): Map<string, number> {
  const out = new Map<string, number>();
  for (const [r, v] of lossCountsForPackage(pkg, { winDecrement: "count-dep" })) {
    out.set(`${r}:teamA`, v.teamA);
    out.set(`${r}:teamB`, v.teamB);
  }
  return out;
}
