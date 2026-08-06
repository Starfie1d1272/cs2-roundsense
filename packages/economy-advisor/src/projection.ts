import type { Side } from "@roundsense/shared-types";
import type { EconomyRules } from "./rules.js";
import { killReward, lossBonus } from "./rules.js";
import type { KillAttribution, ProjectionBranches } from "./types.js";

/**
 * Pure next-round money projection (C1-C3, C5, C8-C10).
 *
 * nextStartMoney(outcome) = clamp(money − spendNow + outcomeReward + kills, 0, maxMoney)
 *
 * Semantics:
 * - `lossStreak` is the team's consecutive losses BEFORE this round (GSI
 *   `consecutive_round_losses`); the loss bonus index follows the fandom
 *   table "Losing (loss count: N)" (C2, corpus-verified).
 * - A PISTOL-ROUND loss pays $1900 instead of the streak table (C10,
 *   corpus-verified): pass `pistolRound = roundNumber === 1 || 14`.
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
  /** current round is a pistol round (1 or 14) — loss pays 1900 (C10) */
  pistolRound?: boolean;
  rules: EconomyRules;
}

export function projectNextRoundMoney(input: ProjectionInput): ProjectionBranches {
  const { rules } = input;
  const base = (reward: number) =>
    Math.min(rules.maxMoney, Math.max(0, input.money - input.spendNow + reward + killRewardsTotal(input)));
  const lossReward = input.pistolRound ? 1900 : lossBonus(rules, input.lossStreak);
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
  return input.kills.reduce((sum, k) => sum + killReward(input.rules, k.weaponClass) * k.count, 0);
}

/** Cost of a goal for the NEXT round (used by breaksGoal). Side-aware rifle price. */
export function goalTargetCost(rules: EconomyRules, goal: "awp" | "rifle_armor" | "rifle_util", side: Side): number {
  const rifle = side === "T" ? rules.prices.ak47! : rules.prices.m4a4!;
  switch (goal) {
    case "awp":
      return rules.prices.awp! + rules.prices.kevlar!;
    case "rifle_armor":
      return rifle + rules.prices.kevlar_helmet!;
    case "rifle_util":
      return rifle + rules.prices.kevlar! + rules.prices.smoke! + rules.prices.flash!;
  }
}
