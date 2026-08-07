/**
 * Policy V2 property sweep — large-range invariant check (task §24).
 * money $0–16000 step $50 × T/CT × 5 lossReward × representative inventories.
 * Every violation prints and exits non-zero.
 *
 * Run: pnpm exec tsx experiments/economy-policy/property-sweep.ts
 */
import { decidePolicy, sideLegal, lossRewardToStreak } from "../../packages/economy-advisor/src/policy-v2.js";
import { price, DEFAULT_RULES } from "../../packages/economy-advisor/src/rules.js";
import type { InventoryState, PurchaseItem } from "../../packages/economy-advisor/src/types.js";
import type { ItemId, Side } from "@roundsense/shared-types";

const LRS = [1400, 1900, 2400, 2900, 3400];
const GRENADE_ITEMS = ["smoke", "flash", "he", "molotov", "incendiary"] as const;

function inv(over: Partial<InventoryState> = {}): InventoryState {
  return {
    primary: null, secondary: undefined, armor: 0, hasHelmet: false,
    hasDefuseKit: false, grenades: [], ...over,
  };
}

const INVENTORIES: Array<[string, InventoryState]> = [
  ["empty", inv()],
  ["retained_ak", inv({ primary: "ak47" })],
  ["retained_sg553", inv({ primary: "sg553" })],
  ["retained_aug", inv({ primary: "aug" })],
  ["retained_awp", inv({ primary: "awp" })],
  ["retained_mp9", inv({ primary: "mp9" })],
  ["retained_ssg08", inv({ primary: "ssg08" })],
  ["full_gear", inv({ primary: "ak47", armor: 100, hasHelmet: true, hasDefuseKit: false, grenades: ["smoke", "flash"] })],
  ["ct_gear", inv({ primary: "m4a4", armor: 100, hasHelmet: true, hasDefuseKit: true, grenades: ["smoke", "flash", "flash"] })],
];

const OVERRIDES = ["auto", "save", "rifle", "awp", "max_combat"] as const;

let violations = 0;
function bad(msg: string): void {
  violations++;
  console.error("VIOLATION:", msg);
}

function purchasesOf(d: { purchases: PurchaseItem[] }): ItemId[] {
  return d.purchases.flatMap((p) => Array<ItemId>(p.quantity).fill(p.item));
}

const T_BANNED = ["m4a4", "m4a1s", "famas", "mp9", "fiveseven", "incendiary", "defuse_kit"];
const CT_BANNED = ["ak47", "galil", "mac10", "tec9", "molotov"];

for (const side of ["T", "CT"] as Side[]) {
  for (const lr of LRS) {
    for (let money = 0; money <= 16000; money += 50) {
      for (const [invName, inventory] of INVENTORIES) {
        for (const override of OVERRIDES) {
          const d = decidePolicy({
            side, lossReward: lr,
            roundStartMoney: money, roundStartMoneyConfidence: "exact",
            currentMoney: money, currentInventory: inventory, override,
          });
          const items = purchasesOf(d);
          // 1. recommendation cost <= currentMoney
          if (d.totalCost > money) bad(`${side} lr${lr} $${money} ${invName} ${override}: cost ${d.totalCost} > money`);
          // 2. side legality
          const banned = side === "T" ? T_BANNED : CT_BANNED;
          for (const i of items) {
            if (banned.includes(i)) bad(`${side} ${invName} ${override}: illegal item ${i}`);
            if (!sideLegal(side, i)) bad(`${side} ${invName}: sideLegal(${i}) false`);
          }
          // 3. no duplicate primary purchase unless replacement override
          const prim = inventory.primary;
          if (prim && override === "auto") {
            const sameClass = (i: ItemId) => {
              const cls = (() => {
                if (i === "awp") return "awp";
                const w = { ak47: "rifle", m4a4: "rifle", m4a1s: "rifle", galil: "rifle", famas: "rifle", sg553: "rifle", aug: "rifle", mac10: "smg", mp9: "smg", mp7: "smg", mp5sd: "smg", ump45: "smg", p90: "smg", bizon: "smg" }[i];
                return w ?? "other";
              })();
              const pcls = (() => {
                if (prim === "awp") return "awp";
                const w = { ak47: "rifle", m4a4: "rifle", m4a1s: "rifle", galil: "rifle", famas: "rifle", sg553: "rifle", aug: "rifle", mac10: "smg", mp9: "smg", mp7: "smg", mp5sd: "smg", ump45: "smg", p90: "smg", bizon: "smg" }[prim];
                return w ?? "other";
              })();
              return cls === pcls && cls !== "other";
            };
            const dup = items.find(sameClass);
            if (dup) bad(`${side} lr${lr} $${money} ${invName} ${override}: duplicate primary class ${dup} with retained ${prim}`);
          }
          // 4. grenade legality
          let flashes = inventory.grenades.filter((g) => g === "flash").length;
          let slots = inventory.grenades.filter((g) => GRENADE_ITEMS.includes(g as (typeof GRENADE_ITEMS)[number]) && g !== "flash").length;
          for (const i of items) {
            if (i === "flash") flashes++;
            else if (GRENADE_ITEMS.includes(i as (typeof GRENADE_ITEMS)[number])) slots++;
          }
          if (flashes > 2) bad(`${side} ${invName} ${override}: flash ${flashes} > 2`);
          if (flashes + slots > 4) bad(`${side} ${invName} ${override}: grenade slots ${flashes + slots} > 4`);
          // 5. projection money in [0,16000]
          if (d.projection.lossNoMoreSpend < 0 || d.projection.lossNoMoreSpend > 16000) bad("lossNoMoreSpend out of range");
          if (d.projection.lossAfterRecommendation < 0 || d.projection.lossAfterRecommendation > 16000) bad("lossAfterRecommendation out of range");
          // 6. save override cost = 0
          if (override === "save" && (d.totalCost !== 0 || d.spendCeiling !== 0)) bad("save override not zero");
          // 7. T kit false
          if (side === "T" && d.defuseKit) bad("T defuseKit true");
          // 8. plain-loss preservation gate never uses +600 plant
          if (side === "T") {
            const plant = d.projection.lossWithPlantAfterRecommendation ?? 0;
            if (plant !== d.projection.lossAfterRecommendation + 600) {
              // projection engine's plant branch may clamp at 16000
              if (plant !== Math.min(16000, d.projection.lossAfterRecommendation + 600)) {
                bad("T plant projection inconsistent");
              }
            }
          }
          // 9. deterministic: re-run identical input
          const d2 = decidePolicy({
            side, lossReward: lr,
            roundStartMoney: money, roundStartMoneyConfidence: "exact",
            currentMoney: money, currentInventory: inventory, override,
          });
          if (JSON.stringify(d) !== JSON.stringify(d2)) bad("nondeterministic output");
        }
      }
    }
  }
}

console.log(`property sweep done: ${violations === 0 ? "ALL PASS" : violations + " VIOLATIONS"}`);
process.exit(violations === 0 ? 0 : 1);
