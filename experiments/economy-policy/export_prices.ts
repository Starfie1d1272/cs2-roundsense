/**
 * Export canonical prices from economy-advisor rules for the research
 * scripts. Output: experiments/economy-policy/results/cologne-2026/_prices.json
 * Run: pnpm exec tsx experiments/economy-policy/export_prices.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_RULES } from "../../packages/economy-advisor/src/rules.js";
import { ITEM_TO_WEAPON } from "../../packages/economy-advisor/src/rules.js";

const weaponsJson = JSON.parse(
  readFileSync("packages/economy-advisor/rules/weapons.v2026-08-06.json", "utf8"),
) as { weapons: Record<string, { price: number; killAward: number; class: string }> };
const weaponPrices: Record<string, number> = {};
for (const [wid, meta] of Object.entries(weaponsJson.weapons)) {
  weaponPrices[wid] = meta.price;
}
writeFileSync(
  "experiments/economy-policy/results/cologne-2026/_prices.json",
  JSON.stringify({
    prices: DEFAULT_RULES.prices,
    itemToWeapon: ITEM_TO_WEAPON,
    weaponPrices,
    roundRewards: DEFAULT_RULES.roundRewards,
    maxMoney: DEFAULT_RULES.maxMoney,
  }, null, 1),
);
console.log("exported:", Object.keys(DEFAULT_RULES.prices).length, "non-weapon prices,", Object.keys(weaponsJson.weapons).length, "weapons");
