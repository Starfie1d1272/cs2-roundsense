import type { ItemId, RoundType } from "@roundsense/shared-types";
import type { EconomyRules } from "./rules.js";

/**
 * Classify a purchase as eco / semi / force / full (D1 vocabulary).
 * Pure classification of the BUY, not of the round:
 * - rifle + armor → full
 * - rifle without armor → semi
 * - no rifle, spend ≥ forceMinSpend → force
 * - no rifle, spend ≥ semiMinSpend → semi
 * - otherwise → eco
 * Thresholds live in the rules file.
 */
export function classifyPurchase(rules: EconomyRules, purchases: ItemId[], totalCost: number): RoundType {
  if (totalCost === 0) return "eco";
  const hasRifle = purchases.some((i) => i === "ak47" || i === "m4a4" || i === "m4a1s" || i === "galil" || i === "famas");
  const hasArmor = purchases.includes("kevlar") || purchases.includes("kevlar_helmet");
  if (hasRifle && hasArmor) return "full";
  if (hasRifle) return "semi";
  if (totalCost >= rules.roundTypeThresholds.forceMinSpend) return "force";
  if (totalCost >= rules.roundTypeThresholds.semiMinSpend) return "semi";
  return "eco";
}
