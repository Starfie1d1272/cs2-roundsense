/**
 * Export canonical prices + weapon identity + side legality from production
 * sources for the research scripts.
 * Output: experiments/economy-policy/results/cologne-2026/_prices.json
 * Run: pnpm exec tsx experiments/economy-policy/export_prices.ts
 *
 * Sources:
 * - prices / roundRewards / maxMoney: DEFAULT_RULES (economy-advisor rules)
 * - weapon prices / classes: rules/weapons.v2026-08-06.json (GameTracking-CS2
 *   weapons.vdata @ 2e606a0b, local D:\steam install)
 * - item -> weaponId: ITEM_TO_WEAPON (economy-advisor, canonical)
 * - display names: cs2-demo-analysis-kit/packages/presentation/src/weapons.ts
 *   (single source of truth for display names) — mirrored here with the DAK
 *   code each item id maps to; DO NOT invent display names in Python.
 * - side legality: CS2 game rule (T-only / CT-only / both), cross-checked
 *   against production rifleFor()/smgFor() below.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_RULES } from "../../packages/economy-advisor/src/rules.js";
import { ITEM_TO_WEAPON } from "../../packages/economy-advisor/src/rules.js";
import { rifleFor, smgFor } from "../../packages/economy-advisor/src/advisor.js";

const weaponsJson = JSON.parse(
  readFileSync("packages/economy-advisor/rules/weapons.v2026-08-06.json", "utf8"),
) as { weapons: Record<string, { price: number; killAward: number; class: string }> };
const weaponPrices: Record<string, number> = {};
for (const [wid, meta] of Object.entries(weaponsJson.weapons)) {
  weaponPrices[wid] = meta.price;
}

/** item id -> display name (mirror of DAK weapons.ts display names). */
const ITEM_TO_DISPLAY: Record<string, string> = {
  ak47: "AK-47", m4a4: "M4A4", m4a1s: "M4A1-S", galil: "Galil AR", famas: "FAMAS",
  sg553: "SG 553", aug: "AUG", ssg08: "SSG 08", awp: "AWP", scar20: "SCAR-20",
  g3sg1: "G3SG1", mac10: "MAC-10", mp9: "MP9", mp7: "MP7", mp5sd: "MP5-SD",
  ump45: "UMP-45", p90: "P90", bizon: "PP-Bizon", nova: "Nova", sawedoff: "Sawed-Off",
  mag7: "MAG-7", xm1014: "XM1014", m249: "M249", negev: "Negev", glock: "Glock-18",
  usp: "USP-S", p2000: "P2000", p250: "P250", dual: "Dual Berettas", tec9: "Tec-9",
  cz75: "CZ75-Auto", fiveseven: "Five-SeveN", deagle: "Desert Eagle", r8: "R8 Revolver",
  zeus: "Zeus x27",
};

/** CS2 side legality (game rule). T-only / CT-only / both.
 * Keys must match ITEM_TO_WEAPON item ids. */
const SIDE_LEGALITY: Record<string, "t" | "ct" | "both"> = {
  ak47: "t", galil: "t", mac10: "t", tec9: "t", glock: "t", molotov: "t",
  m4a4: "ct", m4a1s: "ct", famas: "ct", mp9: "ct", fiveseven: "ct", p2000: "ct",
  incendiary: "ct",
};
function sideOf(item: string): "t" | "ct" | "both" {
  return SIDE_LEGALITY[item] ?? "both";
}

// ---- hard assertions ----
const KEY_WEAPONS = ["ak47", "m4a4", "m4a1s", "galil", "famas", "awp", "ssg08",
  "mp9", "mac10", "fiveseven", "tec9", "deagle"];
for (const item of KEY_WEAPONS) {
  const wid = ITEM_TO_WEAPON[item as keyof typeof ITEM_TO_WEAPON];
  if (!wid || !(wid in weaponPrices)) {
    throw new Error(`price export: cannot resolve ${item} -> weaponId -> price`);
  }
  if (!(item in ITEM_TO_DISPLAY)) {
    throw new Error(`price export: missing display name for ${item}`);
  }
}
// cross-check side legality against production planner
if (rifleFor("T") !== "ak47" || sideOf("ak47") !== "t") throw new Error("legality mismatch: ak47/T");
if (rifleFor("CT") !== "m4a4" || sideOf("m4a4") !== "ct") throw new Error("legality mismatch: m4a4/CT");
if (smgFor("T") !== "mac10" || sideOf("mac10") !== "t") throw new Error("legality mismatch: mac10/T");
if (smgFor("CT") !== "mp9" || sideOf("mp9") !== "ct") throw new Error("legality mismatch: mp9/CT");

const displayNameToItem: Record<string, string> = {};
for (const [item, name] of Object.entries(ITEM_TO_DISPLAY)) {
  displayNameToItem[name] = item;
}

writeFileSync(
  "experiments/economy-policy/results/cologne-2026/_prices.json",
  JSON.stringify({
    prices: DEFAULT_RULES.prices,
    itemToWeapon: ITEM_TO_WEAPON,
    itemToDisplay: ITEM_TO_DISPLAY,
    displayNameToItem,
    sideLegality: SIDE_LEGALITY,
    weaponPrices,
    roundRewards: DEFAULT_RULES.roundRewards,
    maxMoney: DEFAULT_RULES.maxMoney,
  }, null, 1),
);
console.log("exported:", Object.keys(DEFAULT_RULES.prices).length, "non-weapon prices,",
  Object.keys(weaponsJson.weapons).length, "weapons,", Object.keys(ITEM_TO_DISPLAY).length,
  "display names, sideLegality", Object.keys(SIDE_LEGALITY).length);
