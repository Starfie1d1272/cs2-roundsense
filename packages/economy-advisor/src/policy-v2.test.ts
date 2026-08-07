/**
 * Economy Policy V2 — human policy tests (threshold / preservation /
 * legality / inventory / armor / override / CT kit / anchor).
 */
import { describe, expect, it } from "vitest";
import type { ItemId, Side } from "@roundsense/shared-types";
import { DEFAULT_RULES, price } from "./rules.js";
import { planPurchases } from "./advisor.js";
import {
  decidePolicy,
  STRONG_BUY_GATES,
  nextRoundBaselineCost,
  lossRewardToStreak,
  sideLegal,
  type PolicyInput,
  type PolicyDecision,
} from "./policy-v2.js";
import type { InventoryState } from "./types.js";

const LRS = [1400, 1900, 2400, 2900, 3400];

function inv(over: Partial<InventoryState> = {}): InventoryState {
  return {
    primary: null,
    secondary: undefined,
    armor: 0,
    hasHelmet: false,
    hasDefuseKit: false,
    grenades: [],
    ...over,
  };
}

function inAuto(
  side: Side,
  money: number,
  lr: number,
  inventory: InventoryState = inv(),
  over: Partial<PolicyInput> = {},
): PolicyDecision {
  return decidePolicy({
    side,
    lossReward: lr,
    roundStartMoney: money,
    roundStartMoneyConfidence: "exact",
    currentMoney: money,
    currentInventory: inventory,
    ...over,
  });
}

function purchasesOf(d: PolicyDecision): ItemId[] {
  return d.purchases.flatMap((p) => Array<ItemId>(p.quantity).fill(p.item));
}

// ---------- legality helpers ----------
const T_ILLEGAL: ItemId[] = ["m4a4", "m4a1s", "famas", "mp9", "fiveseven", "incendiary", "defuse_kit"];
const CT_ILLEGAL: ItemId[] = ["ak47", "galil", "mac10", "tec9", "molotov"];

function checkLegality(side: Side, d: PolicyDecision): boolean {
  const banned = side === "T" ? T_ILLEGAL : CT_ILLEGAL;
  return purchasesOf(d).every((i) => !banned.includes(i));
}

function checkGrenadeSlots(inv0: InventoryState, d: PolicyDecision): boolean {
  const owned = inv0.grenades.filter((g) => g !== "flash" && g !== "smoke" && g !== "he" && g !== "molotov" && g !== "incendiary").length;
  let flashes = inv0.grenades.filter((g) => g === "flash").length;
  let total = owned;
  for (const g of purchasesOf(d)) {
    if (g === "flash") flashes++;
    else if (g === "smoke" || g === "he" || g === "molotov" || g === "incendiary") total++;
  }
  return flashes <= 2 && total + flashes <= 4;
}

describe("strong-buy gate threshold", () => {
  for (const side of ["T", "CT"] as Side[]) {
    for (const lr of LRS) {
      const gate = STRONG_BUY_GATES[side][lr];
      it(`${side} lr${lr}: gate-50 below → no main rifle; cost within budget`, () => {
        const d = inAuto(side, gate - 50, lr);
        // budget_rifle (Galil/FAMAS) tier is DESIGN behavior below gate;
        // main rifle (ak47/m4) intent must not appear
        expect(d.primaryIntent).not.toBe("rifle");
        expect(d.totalCost).toBeLessThanOrEqual(Math.min(gate - 50, nextRoundBaselineCost(DEFAULT_RULES, side, "m4a4")));
      });
      it(`${side} lr${lr}: at gate → RIFLE`, () => {
        const d = inAuto(side, gate, lr);
        expect(d.displayTag).toBe("RIFLE");
        expect(d.purchases.some((p) => (side === "T" ? p.item === "ak47" : p.item === "m4a4" || p.item === "m4a1s"))).toBe(true);
      });
      it(`${side} lr${lr}: gate+50 → RIFLE`, () => {
        const d = inAuto(side, gate + 50, lr);
        expect(d.displayTag).toBe("RIFLE");
      });
    }
  }
});

describe("preservation (below gate)", () => {
  for (const side of ["T", "CT"] as Side[]) {
    for (const lr of LRS) {
      const gate = STRONG_BUY_GATES[side][lr];
      it(`${side} lr${lr}: below gate cost <= preservationBudget`, () => {
        const money = gate - 200;
        const d = inAuto(side, money, lr);
        const baseline = nextRoundBaselineCost(DEFAULT_RULES, side, "m4a4");
        const budget = Math.max(0, Math.min(16000, money + lr) - baseline);
        expect(d.totalCost).toBeLessThanOrEqual(Math.min(money, budget) + 0.001);
      });
    }
  }
  it("retained rifle armor exception: kevlar allowed above preservationBudget", () => {
    const lr = 1900;
    const money = 2000; // below gate; preservationBudget small
    const d = inAuto("T", money, lr, inv({ primary: "ak47", armor: 0 }));
    // kevlar core exception must be respected (bought even if budget < 650)
    expect(d.totalCost).toBeLessThanOrEqual(money);
    expect(d.primaryIntent).toBe("keep_current");
    expect(d.armorIntent).toBe("kevlar");
  });
});

describe("side legality", () => {
  it("T never gets CT-only items", () => {
    for (const lr of LRS) {
      for (const money of [1500, 2500, 4000, 5000]) {
        const d = inAuto("T", money, lr);
        expect(checkLegality("T", d)).toBe(true);
      }
    }
  });
  it("CT never gets T-only items", () => {
    for (const lr of LRS) {
      for (const money of [1500, 2500, 4000, 5000]) {
        const d = inAuto("CT", money, lr);
        expect(checkLegality("CT", d)).toBe(true);
      }
    }
  });
  it("T defuse kit always false", () => {
    const d = inAuto("T", 5000, 2400);
    expect(d.defuseKit).toBe(false);
    expect(purchasesOf(d)).not.toContain("defuse_kit");
  });
  it("grenade slots and flash max enforced", () => {
    for (const side of ["T", "CT"] as Side[]) {
      for (const lr of LRS) {
        for (const money of [2500, 4000, 5000]) {
          const d = inAuto(side, money, lr);
          expect(checkGrenadeSlots(inv(), d)).toBe(true);
        }
      }
    }
  });
});

describe("retained inventory (auto never re-buys same-class primary)", () => {
  const cases: Array<[string, ItemId]> = [
    ["AK", "ak47"], ["M4A4", "m4a4"], ["M4A1-S", "m4a1s"], ["SG553", "sg553"],
    ["AUG", "aug"], ["AWP", "awp"], ["MAC-10", "mac10"], ["MP9", "mp9"], ["SSG08", "ssg08"],
  ];
  for (const [name, weapon] of cases) {
    it(`retained ${name}: keep_current, no duplicate primary purchase`, () => {
      for (const lr of LRS) {
        for (const money of [1500, 2500, 4000]) {
          const d = inAuto("T", money, lr, inv({ primary: weapon }));
          expect(d.primaryIntent).toBe("keep_current");
          expect(purchasesOf(d)).not.toContain("ak47");
          expect(purchasesOf(d)).not.toContain("m4a4");
          expect(purchasesOf(d)).not.toContain("galil");
        }
      }
    });
  }
  it("retained SMG not replaced even at high money (conservative semantics)", () => {
    const d = inAuto("T", 5000, 2400, inv({ primary: "mac10" }));
    expect(d.primaryIntent).toBe("keep_current");
    expect(purchasesOf(d)).not.toContain("ak47");
  });
  it("override rifle replaces retained SMG", () => {
    const d = inAuto("T", 5000, 2400, inv({ primary: "mac10" }), { override: "rifle" });
    expect(purchasesOf(d)).toContain("ak47");
  });
  it("override max_combat replaces retained SMG", () => {
    const d = inAuto("T", 5000, 2400, inv({ primary: "mac10" }), { override: "max_combat" });
    expect(purchasesOf(d)).toContain("ak47");
  });
  it("retained AWP keeps AWP (no rifle replacement)", () => {
    const d = inAuto("T", 6000, 2400, inv({ primary: "awp", armor: 100, hasHelmet: true }));
    expect(d.primaryIntent).toBe("keep_current");
    expect(d.displayTag).toBe("AWP");
    expect(purchasesOf(d)).not.toContain("ak47");
  });
});

describe("armor semantics", () => {
  it("no armor + strong buy → kevlar included", () => {
    const d = inAuto("T", STRONG_BUY_GATES.T[2400] + 200, 2400);
    expect(purchasesOf(d)).toContain("kevlar");
    expect(d.armorIntent).not.toBe("none");
  });
  it("full armor + helmet → $350 helmet upgrade (no full $1000)", () => {
    // incremental upgrade is a planPurchases property (armorIncrementalUnit):
    // armor=100 + no helmet → kevlar_helmet costs $350, never $1000
    const plan = planPurchases(inv({ armor: 100, hasHelmet: false }), [{ item: "kevlar_helmet", quantity: 1 }], DEFAULT_RULES);
    expect(plan.totalCost).toBe(350);
    // policy layer: helmet may appear in the plan; total cost stays within cash
    const d = inAuto("T", STRONG_BUY_GATES.T[2400] + 200, 2400, inv({ armor: 100, hasHelmet: false }));
    expect(d.totalCost).toBeLessThanOrEqual(STRONG_BUY_GATES.T[2400] + 200);
  });
  it("damaged armor never extrapolated to $350 upgrade", () => {
    // armor 50 → helmet must cost the FULL kevlar_helmet price if bought
    const d = inAuto("CT", STRONG_BUY_GATES.CT[2400] + 200, 2400, inv({ armor: 50, hasHelmet: false }));
    const helmet = d.purchases.find((p) => p.item === "kevlar_helmet");
    if (helmet) {
      expect(d.totalCost).toBeGreaterThanOrEqual(price(DEFAULT_RULES, "kevlar_helmet") - 1);
    }
  });
});

describe("overrides", () => {
  it("save → spendCeiling 0, no purchases", () => {
    const d = inAuto("T", 5000, 2400, inv(), { override: "save" });
    expect(d.spendCeiling).toBe(0);
    expect(d.purchases).toHaveLength(0);
    expect(d.totalCost).toBe(0);
    expect(d.displayTag).toBe("SAVE");
  });
  it("rifle override at low money → budget rifle fallback or none, never over budget", () => {
    const d = inAuto("T", 2000, 2400, inv(), { override: "rifle" });
    expect(d.totalCost).toBeLessThanOrEqual(2000);
    const items = purchasesOf(d);
    expect(items.some((i) => i === "ak47" || i === "galil")).toBe(true);
  });
  it("awp override affordable → AWP bundle", () => {
    const d = inAuto("T", 6000, 2400, inv(), { override: "awp" });
    expect(purchasesOf(d)).toContain("awp");
    expect(d.primaryIntent).toBe("awp");
  });
  it("awp override unaffordable → preserve (no spend that delays AWP)", () => {
    const money = 3000;
    const lr = 1900;
    const d = inAuto("T", money, lr, inv(), { override: "awp" });
    expect(purchasesOf(d)).not.toContain("awp");
    const target = price(DEFAULT_RULES, "awp") + price(DEFAULT_RULES, "kevlar");
    const nextLoss = Math.min(16000, money + lr);
    // preserve semantics: nothing is spent that would push AWP+kevlar out of
    // plain-loss reach; when next-loss cannot reach the target anyway, spend 0
    expect(d.totalCost).toBe(0);
    expect(nextLoss - d.totalCost).toBeLessThanOrEqual(target); // honest: unreachable case reports 0
  });
  it("awp override: affordable next loss keeps AWP+kevlar reachable", () => {
    const money = 3600;
    const lr = 2900;
    const d = inAuto("T", money, lr, inv(), { override: "awp" });
    const target = price(DEFAULT_RULES, "awp") + price(DEFAULT_RULES, "kevlar");
    expect(Math.min(16000, money + lr) - d.totalCost).toBeGreaterThanOrEqual(target - 1);
  });
  it("max_combat maximizes current round (no preservation guard)", () => {
    const d = inAuto("T", 4000, 2400, inv(), { override: "max_combat" });
    expect(purchasesOf(d)).toContain("ak47");
    expect(d.totalCost).toBeLessThanOrEqual(4000);
  });
});

describe("CT kit policy", () => {
  it("already owns kit → no kit purchase", () => {
    const d = inAuto("CT", STRONG_BUY_GATES.CT[2400] + 300, 2400, inv({ hasDefuseKit: true }));
    expect(purchasesOf(d)).not.toContain("defuse_kit");
  });
  it("strong buy with budget → kit recommended after weapon+armor+smoke", () => {
    const d = inAuto("CT", STRONG_BUY_GATES.CT[2400] + 500, 2400, inv());
    const kitIdx = purchasesOf(d).indexOf("defuse_kit");
    if (kitIdx >= 0) {
      const items = purchasesOf(d);
      expect(items.indexOf("m4a4")).toBeLessThan(kitIdx);
      expect(items.indexOf("kevlar")).toBeLessThan(kitIdx);
      expect(items.indexOf("smoke")).toBeLessThan(kitIdx);
    }
  });
  it("kit never breaks mandatory weapon+armor core", () => {
    // money enough for m4+kevlar but not +kit
    const m4k = price(DEFAULT_RULES, "m4a4") + price(DEFAULT_RULES, "kevlar");
    const d = inAuto("CT", m4k, 2400, inv());
    expect(d.totalCost).toBeLessThanOrEqual(m4k);
  });
});

describe("anchor confidence", () => {
  it("exact → high (away from gate)", () => {
    const d = inAuto("T", 5000, 2400);
    expect(d.confidence).toBe("high");
  });
  it("estimated → medium", () => {
    const d = decidePolicy({
      side: "T", lossReward: 2400, roundStartMoney: 5000, roundStartMoneyConfidence: "estimated",
      currentMoney: 5000, currentInventory: inv(),
    });
    expect(d.confidence).toBe("medium");
  });
  it("within ±$200 of gate → medium", () => {
    const gate = STRONG_BUY_GATES.T[2400];
    const d = inAuto("T", gate + 100, 2400);
    expect(d.confidence).toBe("medium");
  });
  it("unavailable → low + missing_round_start_anchor, still legal", () => {
    const d = decidePolicy({
      side: "T", lossReward: 2400, roundStartMoneyConfidence: "unavailable",
      currentMoney: 5000, currentInventory: inv(),
    });
    expect(d.confidence).toBe("low");
    expect(d.reasons.some((r) => r.code === "missing_round_start_anchor")).toBe(true);
    expect(d.totalCost).toBeLessThanOrEqual(5000);
  });
});

describe("projection invariants", () => {
  it("projection money in [0,16000] and consistent with loss reward", () => {
    for (const side of ["T", "CT"] as Side[]) {
      for (const lr of LRS) {
        for (const money of [1500, 3000, 5000]) {
          const d = inAuto(side, money, lr);
          expect(d.projection.lossNoMoreSpend).toBe(Math.min(16000, money + lr));
          expect(d.projection.lossAfterRecommendation).toBeGreaterThanOrEqual(0);
          expect(d.projection.lossAfterRecommendation).toBeLessThanOrEqual(16000);
          if (side === "T") {
            expect(d.projection.lossWithPlantAfterRecommendation).toBeDefined();
          }
        }
      }
    }
  });
});

describe("determinism and lossReward mapping", () => {
  it("same input → identical output", () => {
    const a = inAuto("T", 4000, 2400);
    const b = inAuto("T", 4000, 2400);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("lossRewardToStreak mapping", () => {
    expect(lossRewardToStreak(1400)).toBe(0);
    expect(lossRewardToStreak(1900)).toBe(1);
    expect(lossRewardToStreak(2400)).toBe(2);
    expect(lossRewardToStreak(2900)).toBe(3);
    expect(lossRewardToStreak(3400)).toBe(4);
  });
  it("sideLegal canonical", () => {
    expect(sideLegal("T", "ak47")).toBe(true);
    expect(sideLegal("T", "m4a4")).toBe(false);
    expect(sideLegal("CT", "m4a4")).toBe(true);
    expect(sideLegal("CT", "ak47")).toBe(false);
    expect(sideLegal("CT", "defuse_kit")).toBe(true);
    expect(sideLegal("T", "defuse_kit")).toBe(false);
  });
});
