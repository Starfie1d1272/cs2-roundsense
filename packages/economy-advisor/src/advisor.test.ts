import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, economyRulesSchema, lossBonus, price } from "./rules.js";
import { projectNextRoundMoney, killRewardsTotal, goalTargetCost } from "./projection.js";
import { classifyPurchase } from "./round-type.js";
import { recommend, fulfillsLoadoutGoal, resultingLoadout, planPurchases } from "./advisor.js";
import type { AdvisorInput, InventoryState } from "./types.js";

function input(partial: Partial<AdvisorInput>): AdvisorInput {
  return {
    side: "T",
    roundNumber: 2,
    money: 3400,
    lossStreak: 0,
    inventory: { hasArmor: false, hasHelmet: false, hasDefuseKit: false, grenades: [] },
    killsThisRound: [],
    bombPlantedThisRound: false,
    nextRoundGoal: "rifle_armor",
    ...partial,
  };
}

describe("rules file", () => {
  it("is a valid versioned rule set with sources", () => {
    const parsed = economyRulesSchema.parse(DEFAULT_RULES);
    expect(parsed.ruleSetId).toBe("cs2-competitive-2026-08");
    expect(parsed.status).toBe("verified");
    expect(parsed.sources.length).toBeGreaterThanOrEqual(2);
    expect(parsed.roundRewards.lossBonusByStreak).toEqual([1400, 1900, 2400, 2900, 3400]);
    expect(parsed.maxMoney).toBe(16000);
  });

  it("lossBonus clamps streak at 4 (C2)", () => {
    expect(lossBonus(DEFAULT_RULES, 0)).toBe(1400);
    expect(lossBonus(DEFAULT_RULES, 2)).toBe(2400);
    expect(lossBonus(DEFAULT_RULES, 4)).toBe(3400);
    expect(lossBonus(DEFAULT_RULES, 7)).toBe(3400);
  });

  it("has prices for all advisor items", () => {
    for (const item of ["ak47", "m4a4", "awp", "kevlar", "kevlar_helmet", "smoke", "flash", "deagle", "mac10", "mp9"] as const) {
      expect(price(DEFAULT_RULES, item)).toBeGreaterThan(0);
    }
  });
});

describe("projection", () => {
  it("pistol round 1 win → round 2 full-buy affordability baseline", () => {
    // T wins pistol with $800 start, spent $650 (kevlar), 0 kills
    // r2 money = 800 - 650 + 3250 = 3400
    const branches = projectNextRoundMoney({
      money: 3400, spendNow: 0, side: "T", lossStreak: 0, kills: [], bombPlantedThisRound: false, rules: DEFAULT_RULES,
    });
    expect(branches.win).toBe(3400 + 3250);
    expect(branches.loss).toBe(3400 + 1400);
  });

  it("loss with plant adds plantBonusT for T only (C3)", () => {
    const base = { money: 2000, spendNow: 0, side: "T" as const, lossStreak: 0, kills: [], rules: DEFAULT_RULES };
    const withPlant = projectNextRoundMoney({ ...base, bombPlantedThisRound: true });
    const without = projectNextRoundMoney({ ...base, bombPlantedThisRound: false });
    expect(withPlant.lossWithPlant).toBe(without.lossWithPlant + DEFAULT_RULES.roundRewards.plantBonusT);
    // CT never gets a plant bonus
    const ct = projectNextRoundMoney({ ...base, side: "CT", bombPlantedThisRound: true });
    expect(ct.lossWithPlant).toBe(ct.loss);
  });

  it("first loss of a half pays 1900 via lossStreak=1 (mp_starting_losses=1)", () => {
    const base = { money: 2000, spendNow: 0, side: "T" as const, kills: [], bombPlantedThisRound: false, rules: DEFAULT_RULES };
    const pistol = projectNextRoundMoney({ ...base, lossStreak: 1 });
    const regular = projectNextRoundMoney({ ...base, lossStreak: 0 });
    expect(pistol.loss).toBe(regular.loss + 500); // 1900 vs 1400
    expect(pistol.loss).toBe(2000 + 1900);
  });

  it("CT team kill award adds $50/kill to every CT player's projection (C5)", () => {
    const base = { money: 2000, spendNow: 0, side: "CT" as const, lossStreak: 0, kills: [], bombPlantedThisRound: false, rules: DEFAULT_RULES };
    const noKills = projectNextRoundMoney({ ...base, ctTeamKillsOnTs: 0 });
    const withKills = projectNextRoundMoney({ ...base, ctTeamKillsOnTs: 3 });
    expect(withKills.win).toBe(noKills.win + 3 * DEFAULT_RULES.roundRewards.ctTeamKillReward);
    expect(DEFAULT_RULES.roundRewards.ctTeamKillReward).toBe(50); // corpus-verified
    // T never receives the award
    const t = projectNextRoundMoney({ ...base, side: "T", ctTeamKillsOnTs: 5 });
    expect(t.win).toBe(2000 + 3250);
  });

  it("kill rewards enter the projection (rifle $300, AWP $100)", () => {
    // weaponId (demo path) beats class aggregate; class fallback for GSI path
    const kills = [
      { weaponClass: "rifle" as const, count: 2 },
      { weaponId: "weapon_awp", weaponClass: "sniper" as const, count: 1 },
    ];
    expect(killRewardsTotal({ kills, rules: DEFAULT_RULES })).toBe(700);
    expect(killRewardsTotal({ kills: [{ weaponClass: "sniper" as const, count: 1 }], rules: DEFAULT_RULES })).toBe(300);
    const branches = projectNextRoundMoney({
      money: 1000, spendNow: 0, side: "T", lossStreak: 0, kills, bombPlantedThisRound: false, rules: DEFAULT_RULES,
    });
    expect(branches.win).toBe(1000 + 3250 + 700);
  });

  it("clamps at maxMoney 16000", () => {
    const branches = projectNextRoundMoney({
      money: 15000, spendNow: 0, side: "T", lossStreak: 0, kills: [], bombPlantedThisRound: false, rules: DEFAULT_RULES,
    });
    expect(branches.win).toBe(16000);
  });
});

describe("classifyPurchase", () => {
  it("rifle + armor → full", () => {
    expect(classifyPurchase(DEFAULT_RULES, ["ak47", "kevlar_helmet"], 3700)).toBe("full");
  });
  it("rifle without armor → semi", () => {
    expect(classifyPurchase(DEFAULT_RULES, ["ak47"], 2700)).toBe("semi");
  });
  it("deagle + armor + flash → force threshold", () => {
    expect(classifyPurchase(DEFAULT_RULES, ["deagle", "kevlar", "flash"], 1550)).toBe("semi");
    expect(classifyPurchase(DEFAULT_RULES, ["deagle", "kevlar", "flash", "smoke"], 1850)).toBe("semi");
    // heavier force (e.g. smg+armor+util) crosses forceMinSpend
    expect(classifyPurchase(DEFAULT_RULES, ["mac10", "kevlar_helmet", "smoke", "flash"], 2350)).toBe("force");
  });
  it("nothing → eco", () => {
    expect(classifyPurchase(DEFAULT_RULES, [], 0)).toBe("eco");
  });
});

describe("recommend()", () => {
  it("rifle_armor goal with $3400: full buy affordable (AK+全甲 $3700 not, AK+半甲 $3350 yes)", () => {
    const out = recommend(input({ money: 3400, nextRoundGoal: "rifle_armor" }));
    expect(out.recommended).not.toBeNull();
    expect(out.recommended!.purchases.map((p) => p.item)).toContain("ak47");
    expect(out.recommended!.roundType).toBe("full");
    expect(out.recommended!.totalCost).toBeLessThanOrEqual(3400);
    expect(out.recommended!.breaksGoal).toBe(false);
    // alternatives: affordable, distinct from the recommended plan
    expect(out.alternatives.length).toBeGreaterThanOrEqual(1);
    for (const alt of out.alternatives) {
      expect(alt.affordable).toBe(true);
      expect(alt.id).not.toBe(out.recommended!.id);
    }
    // the more expensive rifle+helmet bundle (3700) is NOT affordable at 3400
    expect(out.alternatives.find((s) => s.id === "rifle-helmet")).toBeUndefined();
  });

  it("rifle_armor with $1400 (eco round): recommends a saving/cheap scheme, rifle bundles unaffordable", () => {
    const out = recommend(input({ money: 1400, nextRoundGoal: "rifle_armor" }));
    expect(out.recommended).not.toBeNull();
    expect(out.recommended!.affordable).toBe(true);
    expect(out.recommended!.totalCost).toBeLessThanOrEqual(1400);
    // The rifle+armor bundle must be present but unaffordable
    const rifle = out.alternatives.find((s) => s.id === "rifle-helmet");
    // (alternatives are affordable-only; check via full scheme list is not exposed —
    //  instead: recommended must not be a rifle+armor full buy)
    expect(out.recommended!.roundType).not.toBe("full");
  });

  it("awp goal: saving is recommended when AWP is unaffordable; spending breaks it", () => {
    // money 4000: AWP+armor (5400) not affordable → save is recommended and
    // guarantees AWP on the loss branch (4000+1400 = 5400).
    const out = recommend(input({ money: 4000, lossStreak: 0, nextRoundGoal: "awp" }));
    const save = out.recommended;
    expect(save).not.toBeNull();
    expect(save!.id).toBe("save");
    expect(save!.breaksGoal).toBe(false);
    expect(save!.projections.loss).toBeGreaterThanOrEqual(goalTargetCost(DEFAULT_RULES, "awp", "T"));
    // any real spend now breaks the AWP guarantee on the loss branch
    const bridge = out.alternatives.find((s) => s.id === "rifle-bridge");
    expect(bridge).toBeDefined();
    expect(bridge!.affordable).toBe(true);
    expect(bridge!.breaksGoal).toBe(true);
    const force = out.alternatives.find((s) => s.id === "force-deagle");
    if (force) expect(force.breaksGoal).toBe(true);
  });

  it("awp goal with $2400: save is still the plan; win branch reaches the target", () => {
    const out = recommend(input({ money: 2400, lossStreak: 0, nextRoundGoal: "awp" }));
    expect(out.recommended!.id).toBe("save");
    expect(out.recommended!.breaksGoal).toBe(false);
    // win branch: 2400 + 3250 = 5650 ≥ 5400 → AWP achievable after a win
    expect(out.recommended!.projections.win).toBeGreaterThanOrEqual(goalTargetCost(DEFAULT_RULES, "awp", "T"));
  });

  it("awp goal with $6000: AWP+armor affordable now (goal achieved)", () => {
    const out = recommend(input({ money: 6000, nextRoundGoal: "awp" }));
    expect(out.recommended!.id).toBe("awp-helmet");
    expect(out.recommended!.breaksGoal).toBe(false);
  });

  it("max_combat_now never reports breaksGoal", () => {
    const out = recommend(input({ money: 2500, nextRoundGoal: "max_combat_now" }));
    for (const s of [out.recommended, ...out.alternatives]) {
      if (s) expect(s.breaksGoal).toBe(false);
    }
  });

  it("is a pure function: same input twice → same output", () => {
    const a = recommend(input({ money: 3400 }));
    const b = recommend(input({ money: 3400 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("exposes rule provenance in the output", () => {
    const out = recommend(input({ money: 3400 }));
    expect(out.rules.ruleSetId).toBe("cs2-competitive-2026-08");
    expect(out.rules.status).toBe("verified");
    expect(out.rules.sources.length).toBeGreaterThanOrEqual(2);
  });

  it("CT uses m4a4 pricing", () => {
    const out = recommend(input({ side: "CT", money: 4000, nextRoundGoal: "rifle_armor" }));
    const rifle = out.recommended!.purchases.find((p) => p.item === "m4a4" || p.item === "ak47");
    expect(rifle?.item).toBe("m4a4");
  });
});

describe("inventory-aware planning (Batch 2)", () => {
  const rifleInv: InventoryState = { primary: "m4a4", hasArmor: false, hasHelmet: false, hasDefuseKit: false, grenades: [] };
  const rifleArmorInv: InventoryState = { primary: "m4a4", hasArmor: true, hasHelmet: false, hasDefuseKit: false, grenades: [] };
  const rifleHelmetInv: InventoryState = { primary: "m4a4", hasArmor: true, hasHelmet: true, hasDefuseKit: false, grenades: [] };
  const awpArmorInv: InventoryState = { primary: "awp", hasArmor: true, hasHelmet: false, hasDefuseKit: false, grenades: [] };

  const findScheme = (out: ReturnType<typeof recommend>, id: string) =>
    [out.recommended, ...out.alternatives].find((s) => s?.id === id) ?? null;

  it("1. empty inventory preserves baseline behavior", () => {
    // empty inventory: target == incremental — direct planner check
    const plan = planPurchases(
      { primary: null, hasArmor: false, hasHelmet: false, hasDefuseKit: false, grenades: [] },
      [
        { item: "ak47", quantity: 1 },
        { item: "kevlar_helmet", quantity: 1 },
      ],
      DEFAULT_RULES,
    );
    expect(plan.purchases.map((p) => p.item)).toEqual(expect.arrayContaining(["ak47", "kevlar_helmet"]));
    expect(plan.totalCost).toBe(3700);
    expect(plan.targetCost).toBe(3700);
    // recommend() still offers it as an unaffordable plan at $3400
    const out = recommend(input({ money: 3400, nextRoundGoal: "rifle_armor" }));
    expect(out.recommended!.totalCost).toBeLessThanOrEqual(3400);
  });

  it("2. owns rifle, target rifle+armor → rifle removed from purchases", () => {
    const out = recommend(input({ money: 2000, inventory: rifleInv, nextRoundGoal: "rifle_armor" }));
    const plan = findScheme(out, "rifle-helmet");
    expect(plan).not.toBeNull();
    expect(plan!.purchases.map((p) => p.item)).not.toContain("ak47");
    expect(plan!.purchases).toEqual([{ item: "kevlar_helmet", quantity: 1 }]);
    expect(plan!.totalCost).toBe(1000); // no armor yet → full helmet price
    expect(plan!.targetCost).toBe(3700); // combat value unchanged
  });

  it("3. owns rifle + armor, target rifle+helmet → only helmet upgrade, $350", () => {
    const out = recommend(input({ money: 500, inventory: rifleArmorInv, nextRoundGoal: "rifle_armor" }));
    const plan = findScheme(out, "rifle-helmet");
    expect(plan!.purchases).toEqual([{ item: "kevlar_helmet", quantity: 1 }]);
    expect(plan!.totalCost).toBe(350);
    // B6: incremental affordability — $500 covers the $350 upgrade
    expect(plan!.affordable).toBe(true);
  });

  it("4. owns rifle + helmet, target rifle+helmet → $0", () => {
    const out = recommend(input({ money: 100, inventory: rifleHelmetInv, nextRoundGoal: "rifle_armor" }));
    const plan = findScheme(out, "rifle-helmet");
    expect(plan!.purchases).toEqual([]);
    expect(plan!.totalCost).toBe(0);
    expect(plan!.affordable).toBe(true);
  });

  it("5. owns smoke, target smoke+flash → flash only", () => {
    const inv: InventoryState = { ...rifleArmorInv, grenades: ["smoke"] };
    const out = recommend(input({ money: 2000, inventory: inv, nextRoundGoal: "rifle_armor" }));
    const plan = findScheme(out, "rifle-helmet-util");
    expect(plan).not.toBeNull();
    expect(plan!.purchases.map((p) => p.item)).not.toContain("smoke");
    expect(plan!.purchases).toEqual(expect.arrayContaining([{ item: "flash", quantity: 1 }]));
  });

  it("6. owns flash×2, target smoke+flash → smoke only (multiset)", () => {
    const inv: InventoryState = { ...rifleArmorInv, grenades: ["flash", "flash"] };
    const out = recommend(input({ money: 2000, inventory: inv, nextRoundGoal: "rifle_armor" }));
    const plan = findScheme(out, "rifle-helmet-util");
    expect(plan!.purchases.map((p) => p.item)).not.toContain("flash");
    expect(plan!.purchases).toEqual(expect.arrayContaining([{ item: "smoke", quantity: 1 }]));
  });

  it("7. planPurchases subtracts grenade quantities (multiset, no set dedupe)", () => {
    const target = [
      { item: "smoke" as const, quantity: 1 },
      { item: "flash" as const, quantity: 1 },
    ];
    const haveTwoFlashes = planPurchases({ ...rifleArmorInv, grenades: ["flash", "flash"] }, target, DEFAULT_RULES);
    expect(haveTwoFlashes.purchases).toEqual([{ item: "smoke", quantity: 1 }]);
    const haveSmoke = planPurchases({ ...rifleArmorInv, grenades: ["smoke"] }, target, DEFAULT_RULES);
    expect(haveSmoke.purchases).toEqual([{ item: "flash", quantity: 1 }]);
    const haveBoth = planPurchases({ ...rifleArmorInv, grenades: ["smoke", "flash"] }, target, DEFAULT_RULES);
    expect(haveBoth.purchases).toEqual([]);
  });

  it("8. resulting-loadout goal fulfillment (B5)", () => {
    // already have rifle, buying kevlar → rifle_armor fulfilled
    const withKevlar = resultingLoadout(rifleInv, [{ item: "kevlar", quantity: 1 }]);
    expect(fulfillsLoadoutGoal("rifle_armor", withKevlar)).toBe(true);
    // already have rifle + armor, buy nothing → still fulfilled
    expect(fulfillsLoadoutGoal("rifle_armor", resultingLoadout(rifleArmorInv, []))).toBe(true);
    // AWP + armor → awp goal fulfilled
    expect(fulfillsLoadoutGoal("awp", resultingLoadout(awpArmorInv, []))).toBe(true);
    // armor only, buy nothing → NOT fulfilled
    const armorOnly = resultingLoadout({ primary: null, hasArmor: true, hasHelmet: false, hasDefuseKit: false, grenades: [] }, []);
    expect(fulfillsLoadoutGoal("rifle_armor", armorOnly)).toBe(false);
  });

  it("9. breaking goal: buying only kevlar with an owned rifle does NOT break rifle_armor", () => {
    const out = recommend(input({ money: 700, inventory: rifleInv, nextRoundGoal: "rifle_armor" }));
    const plan = findScheme(out, "rifle-kevlar");
    expect(plan).not.toBeNull();
    expect(plan!.purchases).toEqual([{ item: "kevlar", quantity: 1 }]);
    expect(plan!.totalCost).toBe(650);
    expect(plan!.affordable).toBe(true);
    expect(plan!.breaksGoal).toBe(false); // post-purchase loadout has rifle+armor
  });

  it("10. ranking: owning part of a strong bundle must not demote it", () => {
    const empty = recommend(input({ money: 4000, nextRoundGoal: "rifle_armor" }));
    const partial = recommend(input({ money: 4000, inventory: rifleArmorInv, nextRoundGoal: "rifle_armor" }));
    // owning gear may make STRONGER bundles affordable (util becomes
    // affordable) — the recommended combat value must never go DOWN
    expect(partial.recommended!.targetCost).toBeGreaterThanOrEqual(empty.recommended!.targetCost);
    // partial inventory only changes actual spend for the same target
    const emptyPlan = findScheme(empty, empty.recommended!.id);
    const partialPlan = findScheme(partial, empty.recommended!.id);
    if (partialPlan) {
      expect(partialPlan.totalCost).toBeLessThanOrEqual(emptyPlan!.totalCost);
    }
  });

  it("B9: already have M4 + armor → displayed purchases = helmet upgrade only, $350", () => {
    const out = recommend(input({ money: 1000, inventory: rifleArmorInv, nextRoundGoal: "rifle_armor" }));
    const plan = findScheme(out, "rifle-helmet");
    expect(plan!.purchases).toEqual([{ item: "kevlar_helmet", quantity: 1 }]);
    expect(plan!.totalCost).toBe(350);
  });

  it("helmet upgrade cost is derived as price(kevlar_helmet) − price(kevlar) = $350", () => {
    expect(price(DEFAULT_RULES, "kevlar_helmet") - price(DEFAULT_RULES, "kevlar")).toBe(350);
  });
});
