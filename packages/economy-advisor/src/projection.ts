import type { Side } from "@roundsense/shared-types";
import type { EconomyRules } from "./rules.js";
import { killReward, lossBonus, price } from "./rules.js";
import type { KillAttribution, ProjectionBranches } from "./types.js";

/**
 * Pure next-round money projection (C1-C3, C5, C8-C10).
 *
 * nextStartMoney(outcome) = clamp(money − spendNow + outcomeReward + kills, 0, maxMoney)
 *
 * Semantics:
 * - `lossStreak` is the team's consecutive losses BEFORE this round (GSI
 *   `consecutive_round_losses`); the loss bonus index follows the fandom
 *   table "Losing (loss count: N)" (C2, corpus-verified). With
 *   mp_starting_losses=1 the first loss of a half has lossStreak=1 and
 *   naturally pays $1900 — no pistol-round special case.
 * - `lossWithPlant` applies only to T with a plant this round (C3,
 *   corpus-approximate $600).
 * - The projection does NOT model: T surviving a time-out loss (no reward,
 *   C9), short-handed bonus, team-kill penalty, plant/defuse player bonus
 *   (+$300, C8) — these are recorded as assumptions in each scheme.
 */
export interface ProjectionInput {
  money: number;
  spendNow: number;
  side: Side;
  lossStreak: number;
  kills: KillAttribution[];
  bombPlantedThisRound: boolean;
  /** CT team kills of T this round — every CT player gets +$50 each (C5,
   *  corpus-verified 2026-08-06; server-config dependent, see rules notes) */
  ctTeamKillsOnTs?: number;
  rules: EconomyRules;
}

export function projectNextRoundMoney(input: ProjectionInput): ProjectionBranches {
  const { rules } = input;
  const teamAward =
    input.side === "CT" ? rules.roundRewards.ctTeamKillReward * (input.ctTeamKillsOnTs ?? 0) : 0;
  const base = (reward: number) =>
    Math.min(rules.maxMoney, Math.max(0, input.money - input.spendNow + reward + teamAward + killRewardsTotal(input)));
  const lossReward = lossBonus(rules, input.lossStreak);
  const loss = base(lossReward);
  const lossWithPlant =
    input.side === "T" && input.bombPlantedThisRound ? base(lossReward + rules.roundRewards.plantBonusT) : loss;
  return {
    win: base(rules.roundRewards.winByElimination),
    winBomb: base(rules.roundRewards.winByBombDetonation),
    loss,
    lossWithPlant,
  };
}

export function killRewardsTotal(input: Pick<ProjectionInput, "kills" | "rules">): number {
  return input.kills.reduce(
    (sum, k) => sum + killReward(input.rules, { weaponId: k.weaponId, fallbackClass: k.weaponClass }) * k.count,
    0,
  );
}

/** Cost of a goal for the NEXT round (used by breaksGoal). Side-aware rifle price. */
export function goalTargetCost(rules: EconomyRules, goal: "awp" | "rifle_armor" | "rifle_util", side: Side): number {
  const rifle = side === "T" ? price(rules, "ak47") : price(rules, "m4a4");
  switch (goal) {
    case "awp":
      return price(rules, "awp") + price(rules, "kevlar");
    case "rifle_armor":
      return rifle + price(rules, "kevlar_helmet");
    case "rifle_util":
      return rifle + price(rules, "kevlar") + price(rules, "smoke") + price(rules, "flash");
  }
}
