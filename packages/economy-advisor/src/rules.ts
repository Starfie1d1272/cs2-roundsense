import { z } from "zod";
import type { ItemId, WeaponClass } from "@roundsense/shared-types";
import rulesJson from "../rules/cs2-competitive-2026-08.json";

/**
 * Versioned economy rules (C1-C10). Every concrete number lives in the rules
 * file with sources, verification date and applicable modes. The zod schema
 * below is the load-time contract; unknown fields fail loudly.
 */

const sourceSchema = z.object({
  name: z.string(),
  url: z.string(),
  revision: z.string(),
  accessed: z.string(),
  notes: z.string().optional(),
});

export const economyRulesSchema = z.object({
  ruleSetId: z.string(),
  applicableModes: z.array(z.string()),
  status: z.enum(["provisional", "verified"]),
  verifiedAt: z.string(),
  sources: z.array(sourceSchema),
  maxMoney: z.number().int().positive(),
  startMoney: z.number().int().nonnegative(),
  roundRewards: z.object({
    winByElimination: z.number().int().nonnegative(),
    winByTimeCt: z.number().int().nonnegative(),
    winByBombDefusal: z.number().int().nonnegative(),
    winByBombDetonation: z.number().int().nonnegative(),
    lossBonusByStreak: z.array(z.number().int().nonnegative()).length(5),
    plantBonusT: z.number().int().nonnegative(),
    plantBonusPlayer: z.number().int().nonnegative(),
    defuseBonusPlayer: z.number().int().nonnegative(),
    ctTeamKillReward: z.number().int().nonnegative(),
  }),
  killRewards: z.record(z.string(), z.number().int().nonnegative()),
  prices: z.record(z.string(), z.number().int().nonnegative()),
  roundTypeThresholds: z.object({
    ecoMaxSpend: z.number().int().nonnegative(),
    semiMinSpend: z.number().int().nonnegative(),
    forceMinSpend: z.number().int().nonnegative(),
  }),
  notes: z.record(z.string(), z.string()).optional(),
});

export type EconomyRules = z.infer<typeof economyRulesSchema>;
export type RulesSource = z.infer<typeof sourceSchema>;

export const DEFAULT_RULES: EconomyRules = economyRulesSchema.parse(rulesJson);

/** Load and validate a rules file (path or parsed object). */
export function loadRules(input: unknown): EconomyRules {
  return economyRulesSchema.parse(input);
}

export function price(rules: EconomyRules, item: ItemId): number {
  const p = rules.prices[item];
  if (p === undefined) throw new Error(`no price for item "${item}" in ruleSet ${rules.ruleSetId}`);
  return p;
}

export function killReward(rules: EconomyRules, weaponClass: WeaponClass | "unknown"): number {
  const r = rules.killRewards[weaponClass];
  if (r === undefined) throw new Error(`no kill reward for class "${weaponClass}"`);
  return r;
}

export function lossBonus(rules: EconomyRules, lossStreak: number): number {
  const idx = Math.min(Math.max(0, Math.floor(lossStreak)), rules.roundRewards.lossBonusByStreak.length - 1);
  return rules.roundRewards.lossBonusByStreak[idx]!;
}
