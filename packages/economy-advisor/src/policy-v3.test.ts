import { describe, expect, it } from "vitest";
import { recommendPolicyV3, utilityBundle, type PolicyV3State } from "./policy-v3.js";
import { DEFAULT_RULES, lossBonus, price } from "./rules.js";
import { rifleFor } from "./advisor.js";

const observed = <T>(value: T, source = "test") => ({ status: "OBSERVED" as const, value, source, asOfSeq: 1 });
const inventory = { primary: null, armor: 0, hasHelmet: false, hasDefuseKit: false, grenades: [] as const };

function state(over: Partial<PolicyV3State> = {}): PolicyV3State {
  return {
    round: { number: observed(2), phase: observed("freezetime"), side: observed("T" as const), score: observed({ ct: 1, t: 0 }), context: observed("POST_PISTOL" as const) },
    player: { money: observed(6000), lossIndex: observed(1), inventory: observed({ ...inventory, grenades: [] }) },
    teamLoss: { ct: observed(1), t: observed(1) },
    history: { integrity: "COMPLETE", previousRounds: [] },
    opponent: { status: "UNKNOWN", inputsAsOfSeq: 1, reason: "test fallback" },
    preference: { source: "DEFAULT", awpPriority: "NEUTRAL" },
    ...over,
  };
}

describe("Policy V3 deterministic core", () => {
  it("keeps T post-pistol PRESERVE and FORCE multimodal", () => {
    const out = recommendPolicyV3(state());
    expect(out.status).toBe("READY");
    expect(out.options.map((option) => option.mode)).toEqual(["PRESERVE", "FORCE"]);
    expect(out.defaultOptionId).toBeUndefined();
  });

  it("does not reserve a V2-style preservation bank after selecting FORCE", () => {
    const current = state();
    current.player.money = observed(3000);
    const force = recommendPolicyV3(current).options.find((option) => option.mode === "FORCE");
    expect(force?.bundleSpend).toBeGreaterThan(0);
    expect(force?.assumptions.join(" ")).toContain("no V2 preservation budget");
  });

  it.each(["CT", "T"] as const)("fits FORCE through useful discrete upgrades for %s", (side) => {
    for (const money of [1900, 2200, 2600, 3000, 3200]) {
      const current = state();
      current.round.side = observed(side);
      current.player.money = observed(money);
      const force = recommendPolicyV3(current).options.find((option) => option.mode === "FORCE");
      expect(force?.bundleSpend).toBeLessThanOrEqual(money);
      expect(force?.resultingInventory.grenades.length).toBeLessThanOrEqual(4);
      expect(force?.resultingInventory.grenades.filter((item) => item === "flash").length).toBeLessThanOrEqual(2);
    }
  });

  it("does not stop at the old low FORCE templates when $3000 has legal upgrades", () => {
    for (const side of ["CT", "T"] as const) {
      const current = state();
      current.round.side = observed(side);
      current.player.money = observed(3000);
      expect(recommendPolicyV3(current).options.find((option) => option.mode === "FORCE")?.bundleSpend).toBeGreaterThanOrEqual(2900);
    }
  });

  it("uses retained armor and the CT second-flash slot before leaving a force residual", () => {
    const current = state();
    current.round.side = observed("CT");
    current.player.money = observed(2600);
    const emptyForce = recommendPolicyV3(current).options.find((option) => option.mode === "FORCE");
    expect(emptyForce).toMatchObject({ bundleSpend: 2600 });
    expect(emptyForce?.resultingInventory.grenades.filter((item) => item === "flash")).toHaveLength(2);

    const armored = structuredClone(current);
    armored.player.inventory = observed({ ...inventory, armor: 100, grenades: [] });
    expect(recommendPolicyV3(armored).options.find((option) => option.mode === "FORCE")?.bundleSpend).toBeGreaterThanOrEqual(2550);
  });

  it("completes an affordable CT FORCE bundle with the $350 helmet upgrade", () => {
    const current = state();
    current.round = { ...current.round, number: observed(5), side: observed("CT"), context: observed("NORMAL") };
    current.player.money = observed(2550);
    current.player.inventory = observed({ ...inventory, primary: "mp9", armor: 100, hasHelmet: false, grenades: [] });
    const force = recommendPolicyV3(current).options.find((option) => option.mode === "FORCE");
    expect(force?.purchases).toContainEqual({ item: "kevlar_helmet", quantity: 1 });
    expect(force?.resultingInventory.hasHelmet).toBe(true);
    expect(force?.bundleSpend).toBeGreaterThanOrEqual(1650);
  });

  it("offers NORMAL LIGHT as a boundary-bounded secondary bundle rather than fixed SMG plus armor", () => {
    const current = state();
    current.round = { ...current.round, number: observed(5), side: observed("CT"), context: observed("NORMAL") };
    current.player.money = observed(2600);
    const out = recommendPolicyV3(current);
    const light = out.options.find((option) => option.mode === "LIGHT");
    expect(light?.adviceStrength).toBe("ALTERNATIVE");
    expect(light?.spendingGuidance).toMatchObject({ layer: "ADVICE", kind: "BOUNDED" });
    expect(light?.purchases.some((purchase) => purchase.item === "mp9" || purchase.item === "mac10")).toBe(false);
    const protectedCapability = light?.spendingGuidance.kind === "BOUNDED" ? light.spendingGuidance.protectedCapability : undefined;
    const boundary = out.futureAffordability.status === "PROJECTED"
      ? out.futureAffordability.boundaries.find((item) => item.capability === protectedCapability)
      : undefined;
    expect(boundary?.reachableWithNoSpend).toBe(true);
    expect(light?.bundleSpend).toBeLessThanOrEqual(boundary?.maxSpendNow ?? -1);
  });

  it.each(["T", "CT"] as const)("derives both NORMAL future-affordability boundaries from canonical %s prices and loss reward", (side) => {
    const current = state({ round: { ...state().round, number: observed(5), side: observed(side), context: observed("NORMAL") } });
    current.player.money = observed(3000);
    current.player.lossIndex = observed(2);
    const output = recommendPolicyV3(current);
    expect(output.futureAffordability.status).toBe("PROJECTED");
    if (output.futureAffordability.status !== "PROJECTED") return;
    const rifleArmor = output.futureAffordability.boundaries.find((boundary) => boundary.capability === "RIFLE_ARMOR");
    const basicUtility = output.futureAffordability.boundaries.find((boundary) => boundary.capability === "RIFLE_ARMOR_BASIC_UTILITY");
    const rifleArmorTarget = price(DEFAULT_RULES, rifleFor(side)) + price(DEFAULT_RULES, "kevlar");
    expect(rifleArmor).toMatchObject({
      layer: "SCENARIO", scenario: "LOSS_NO_PLANT", targetCash: rifleArmorTarget,
      requiredReserveNow: Math.max(0, rifleArmorTarget - lossBonus(DEFAULT_RULES, 2)),
    });
    expect(basicUtility).toMatchObject({ targetCash: rifleArmorTarget + price(DEFAULT_RULES, "smoke") + price(DEFAULT_RULES, "flash") });
  });

  it("keeps a legal NORMAL LIGHT bundle below its ceiling instead of filling the boundary", () => {
    const current = state({ round: { ...state().round, number: observed(5), side: observed("CT"), context: observed("NORMAL") } });
    current.player.money = observed(3400);
    const light = recommendPolicyV3(current).options.find((option) => option.mode === "LIGHT" && option.resultingInventory.armor > 0);
    const output = recommendPolicyV3(current);
    const protectedCapability = light?.spendingGuidance.kind === "BOUNDED" ? light.spendingGuidance.protectedCapability : undefined;
    const boundary = output.futureAffordability.status === "PROJECTED"
      ? output.futureAffordability.boundaries.find((item) => item.capability === protectedCapability)
      : undefined;
    expect(light?.bundleSpend).toBeGreaterThan(0);
    expect(light?.bundleSpend).toBeLessThan(boundary?.maxSpendNow ?? 0);
  });

  it("tops up a retained primary in NORMAL LIGHT without purchasing a lower-tier primary", () => {
    const current = state({ round: { ...state().round, number: observed(5), side: observed("CT"), context: observed("NORMAL") } });
    current.player.money = observed(2600);
    current.player.inventory = observed({ ...inventory, primary: "mp9", armor: 0, grenades: [] });
    const light = recommendPolicyV3(current).options.find((option) => option.mode === "LIGHT" && option.resultingInventory.armor > 0);
    expect(light?.purchases.some((purchase) => purchase.item === "mp9" || purchase.item === "fiveseven" || purchase.item === "m4a4")).toBe(false);
    expect(light?.resultingInventory.primary).toBe("mp9");
    expect(light?.resultingInventory.armor).toBeGreaterThan(0);
  });

  it("uses a CT FORCE-dominant post-pistol recommendation while retaining fallback", () => {
    const current = state();
    current.round.side = observed("CT");
    current.history = { integrity: "COMPLETE", previousRounds: [{ roundNumber: 1, winner: observed("T" as const), planted: observed(false) }] };
    const out = recommendPolicyV3(current);
    expect(out.options.map((option) => [option.mode, option.adviceStrength])).toEqual([["FORCE", "DOMINANT"], ["PRESERVE", "ALTERNATIVE"]]);
    expect(out.defaultOptionId).toBe(out.options[0]?.id);
  });

  it.each(["T", "CT"] as const)("classifies a witnessed pistol winner as strategic FULL for %s", (side) => {
    const current = state();
    current.round.side = observed(side);
    current.player.money = observed(4000);
    current.history = { integrity: "COMPLETE", previousRounds: [{ roundNumber: 1, winner: observed(side), planted: observed(false) }] };
    const out = recommendPolicyV3(current);
    expect(out.options.map((option) => option.mode)).toEqual(["FULL"]);
    expect(out.options[0]?.reasons.some((reason) => reason.code === "POST_PISTOL_CONVERSION")).toBe(true);
    expect(out.defaultOptionId).toBeUndefined();
  });

  it.each(["T", "CT"] as const)("keeps pistol-loser %s post-pistol policy unchanged", (side) => {
    const current = state();
    current.round.side = observed(side);
    current.history = { integrity: "COMPLETE", previousRounds: [{ roundNumber: 1, winner: observed(side === "T" ? "CT" : "T"), planted: observed(false) }] };
    const out = recommendPolicyV3(current);
    expect(out.options.map((option) => option.mode)).toEqual(side === "T" ? ["PRESERVE", "FORCE"] : ["FORCE", "PRESERVE"]);
    expect(out.defaultOptionId).toBe(side === "CT" ? out.options[0]?.id : undefined);
  });

  it("keeps a non-dominant post-pistol fallback when the previous winner is UNKNOWN", () => {
    const current = state();
    current.round.side = observed("CT");
    current.history = { integrity: "COMPLETE", previousRounds: [{ roundNumber: 1, winner: { status: "UNKNOWN", source: "test", asOfSeq: 1, reason: "terminal winner missing" }, planted: observed(false) }] };
    const out = recommendPolicyV3(current);
    expect(out.options.map((option) => option.mode)).toEqual(["PRESERVE", "FORCE"]);
    expect(out.options.every((option) => option.adviceStrength !== "DOMINANT")).toBe(true);
    expect(out.defaultOptionId).toBeUndefined();
  });

  it.each(["T", "CT"] as const)("never emits armor-zero generic FORCE for %s", (side) => {
    for (const money of [0, 200, 500, 650, 900, 1500, 2500, 4000]) {
      const current = state({ round: { ...state().round, number: observed(5), side: observed(side), context: observed("NORMAL") } });
      current.player.money = observed(money);
      const force = recommendPolicyV3(current).options.filter((option) => option.mode === "FORCE");
      expect(force.every((option) => option.resultingInventory.armor > 0)).toBe(true);
    }
  });

  it("omits generic FORCE when no armored bundle is affordable", () => {
    const current = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    current.player.money = observed(500);
    expect(recommendPolicyV3(current).options.some((option) => option.mode === "FORCE")).toBe(false);
  });

  it.each([1900, 2000])("fits a legal CT post-pistol force at $%i", (money) => {
    const current = state();
    current.round.side = observed("CT");
    current.player.money = observed(money);
    const force = recommendPolicyV3(current).options.find((option) => option.mode === "FORCE");
    expect(force?.bundleSpend).toBeLessThanOrEqual(money);
    expect(force?.purchases).toContainEqual({ item: "mp9", quantity: 1 });
    expect(force?.purchases).toContainEqual({ item: "kevlar", quantity: 1 });
  });

  it("uses retained CT armor or SMG to fit the legal force bundle", () => {
    const armored = state();
    armored.round.side = observed("CT");
    armored.player.money = observed(1500);
    armored.player.inventory = observed({ ...inventory, armor: 100, grenades: [] });
    expect(recommendPolicyV3(armored).options.find((option) => option.mode === "FORCE")?.bundleSpend).toBeLessThanOrEqual(1500);
    const smgOwned = state();
    smgOwned.round.side = observed("CT");
    smgOwned.player.money = observed(900);
    smgOwned.player.inventory = observed({ ...inventory, primary: "mp9", grenades: [] });
    expect(recommendPolicyV3(smgOwned).options.find((option) => option.mode === "FORCE")?.purchases).toEqual(expect.arrayContaining([{ item: "kevlar", quantity: 1 }]));
  });

  it("retains observed high-value primaries and paid pistols across FORCE/FULL", () => {
    const force = (side: "CT" | "T", primary: "ak47" | "m4a4" | "awp" | "mp9", secondary?: "deagle" | "tec9") => {
      const current = state();
      current.round = { ...current.round, number: observed(5), side: observed(side), context: observed("NORMAL") };
      current.player.money = observed(4000);
      current.player.inventory = observed({ ...inventory, primary, secondary, grenades: [] });
      return recommendPolicyV3(current);
    };
    const tRifle = force("T", "ak47").options.find((option) => option.mode === "FORCE");
    expect(tRifle?.purchases.some((purchase) => purchase.item === "mac10")).toBe(false);
    const ctRifle = force("CT", "m4a4").options.find((option) => option.mode === "FORCE");
    expect(ctRifle?.purchases.some((purchase) => purchase.item === "mp9")).toBe(false);
    const awp = force("CT", "awp");
    expect(awp.options.find((option) => option.mode === "FORCE")?.purchases.some((purchase) => purchase.item === "mp9" || purchase.item === "m4a4")).toBe(false);
    expect(awp.options.find((option) => option.mode === "FULL")?.purchases.some((purchase) => purchase.item === "m4a4")).toBe(false);
    const smg = force("CT", "mp9").options.find((option) => option.mode === "FORCE");
    expect(smg?.purchases.some((purchase) => purchase.item === "mp9")).toBe(false);
    expect(force("CT", "mp9", "deagle").options.find((option) => option.mode === "FORCE")?.purchases.some((purchase) => purchase.item === "fiveseven")).toBe(false);
    expect(force("T", "ak47", "tec9").options.find((option) => option.mode === "FORCE")?.purchases.some((purchase) => purchase.item === "tec9")).toBe(false);
  });

  it("does not let opponent UNKNOWN remove base plans", () => {
    const unknown = recommendPolicyV3(state());
    const inferredState = state();
    inferredState.opponent = { status: "INFERRED", value: "LIKELY_ESTABLISHED_RIFLE", probability: 0.9, calibrationId: "test", inputsAsOfSeq: 1 };
    const inferred = recommendPolicyV3(inferredState);
    expect(inferred.options.map((option) => option.id)).toEqual(unknown.options.map((option) => option.id));
  });

  it("defaults CT fresh armor to vesthelm even with established-rifle context", () => {
    const current = state();
    current.round = { ...current.round, number: observed(5), side: observed("CT"), context: observed("NORMAL") };
    current.opponent = { status: "INFERRED", value: "LIKELY_ESTABLISHED_RIFLE", probability: 0.9, calibrationId: "test", inputsAsOfSeq: 1 };
    const full = recommendPolicyV3(current).options.find((option) => option.mode === "FULL");
    expect(full?.purchases.some((purchase) => purchase.item === "kevlar_helmet")).toBe(true);
  });

  it("prices a 100-armor helmet upgrade incrementally at $350", () => {
    const current = state();
    current.round = { ...current.round, number: observed(5), context: observed("NORMAL") };
    current.player.inventory = observed({ ...inventory, armor: 100, hasHelmet: false, grenades: [] });
    const full = recommendPolicyV3(current).options.find((option) => option.mode === "FULL");
    expect(full?.purchases.find((purchase) => purchase.item === "kevlar_helmet")?.quantity).toBe(1);
    expect(full?.bundleSpend).toBeLessThan(6000);
  });

  it("keeps utility legal: maximum four grenade slots and two flashes", () => {
    for (const side of ["CT", "T"] as const) {
      const current = state();
      current.round = { ...current.round, number: observed(5), side: observed(side), context: observed("NORMAL") };
      const full = recommendPolicyV3(current).options.find((option) => option.mode === "FULL");
      const grenades = full?.resultingInventory.grenades ?? [];
      expect(grenades.length).toBeLessThanOrEqual(4);
      expect(grenades.filter((item) => item === "flash").length).toBeLessThanOrEqual(2);
      expect(grenades).toContain("smoke");
      expect(grenades).toContain(side === "CT" ? "incendiary" : "molotov");
      if (side === "CT") expect(grenades).toContain("he");
      else expect(full?.conditionalAlternatives.some((alternative) => alternative.condition === "T fourth utility slot")).toBe(true);
    }
  });

  it("makes kit a conditional independent CT option", () => {
    const current = state();
    current.round = { ...current.round, number: observed(5), side: observed("CT"), context: observed("NORMAL") };
    const full = recommendPolicyV3(current).options.find((option) => option.mode === "FULL");
    const kit = full?.conditionalAlternatives.find((alternative) => alternative.condition.includes("队友暂无钳子"));
    expect(kit?.purchases).toContainEqual({ item: "defuse_kit", quantity: 1 });
    expect(full?.resultingInventory.hasDefuseKit).toBe(false);
  });

  it("requires armor for an AWP path and preserves existing armor", () => {
    const empty = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    empty.preference = { source: "USER_DECLARED", awpPriority: "PREFER" };
    const awp = recommendPolicyV3(empty).options.find((option) => option.mode === "AWP_PATH");
    expect(awp?.purchases).toEqual(expect.arrayContaining([{ item: "awp", quantity: 1 }, { item: "kevlar", quantity: 1 }]));

    const armored = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    armored.preference = { source: "USER_DECLARED", awpPriority: "PREFER" };
    armored.player.inventory = observed({ ...inventory, armor: 100, grenades: [] });
    const existingArmor = recommendPolicyV3(armored).options.find((option) => option.mode === "AWP_PATH");
    expect(existingArmor?.purchases.some((purchase) => purchase.item === "kevlar")).toBe(false);
  });

  it("does not emit a fake complete AWP path below AWP plus armor cost", () => {
    const current = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    current.player.money = observed(5000);
    current.preference = { source: "USER_DECLARED", awpPriority: "PREFER" };
    expect(recommendPolicyV3(current).options.some((option) => option.mode === "AWP_PATH")).toBe(false);
  });

  it("keeps unverified WIN loss-index transition UNKNOWN and WIN money bounded", () => {
    const current = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    current.player.lossIndex = observed(3);
    const scenario = recommendPolicyV3(current).options[0]?.trajectory.find((item) => item.id === "WIN");
    expect(scenario?.nextLossIndex.status).toBe("UNKNOWN");
    expect(scenario?.nextMoney.min).toBeLessThan(scenario?.nextMoney.max ?? 0);
    expect(scenario?.followingRound.money.status).toBe("UNKNOWN");
  });

  it("propagates a known WIN t+1 money range into t+2", () => {
    const current = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    current.player.lossIndex = observed(1);
    const win = recommendPolicyV3(current).options[0]?.trajectory.find((scenario) => scenario.id === "WIN");
    expect(win?.nextMoney.max).toBe((win?.nextMoney.min ?? 0) + 250);
    expect(win?.followingRound.money.status).toBe("TRACKED");
    expect(win?.followingRound.money.value?.max).toBe((win?.followingRound.money.value?.min ?? 0) + 250);
  });

  it("keeps single-point loss branches single-point through t+2", () => {
    const current = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    const loss = recommendPolicyV3(current).options[0]?.trajectory.find((scenario) => scenario.id === "LOSS_NO_PLANT");
    expect(loss?.followingRound.money.value?.min).toBe(loss?.followingRound.money.value?.max);
    const tPlant = recommendPolicyV3(current).options[0]?.trajectory.find((scenario) => scenario.id === "LOSS_WITH_PLANT");
    expect(tPlant?.followingRound.money.value?.min).toBe(tPlant?.followingRound.money.value?.max);
  });

  it("offers Kevlar only when vesthelm itself makes the CT full bundle unaffordable", () => {
    const current = state({ round: { ...state().round, number: observed(5), side: observed("CT"), context: observed("NORMAL") } });
    current.player.money = observed(3800);
    const full = recommendPolicyV3(current).options.find((option) => option.mode === "FULL");
    expect(full?.purchases.some((purchase) => purchase.item === "kevlar")).toBe(true);
    expect(full?.purchases.some((purchase) => purchase.item === "kevlar_helmet")).toBe(false);
    expect(full?.reasons.some((reason) => reason.code === "CT_KEVLAR_OWN_STATE")).toBe(true);
  });

  it("does not let opponent class create or remove the CT Kevlar alternative", () => {
    const unknown = state({ round: { ...state().round, number: observed(5), side: observed("CT"), context: observed("NORMAL") } });
    unknown.player.money = observed(3800);
    const inferred = structuredClone(unknown);
    inferred.opponent = { status: "INFERRED", value: "LIKELY_ESTABLISHED_RIFLE", probability: 0.9, calibrationId: "test", inputsAsOfSeq: 1 };
    const kitItem = (current: PolicyV3State) => recommendPolicyV3(current).options.find((option) => option.mode === "FULL")?.purchases.find((purchase) => purchase.item === "kevlar" || purchase.item === "kevlar_helmet")?.item;
    expect(kitItem(inferred)).toBe(kitItem(unknown));
  });

  it("uses retained utility without rebuying or consuming virtual budget", () => {
    expect(utilityBundle("T", { ...inventory, grenades: ["smoke"] }, 500)).toEqual(["smoke", "flash"]);
    expect(utilityBundle("T", { ...inventory, grenades: ["flash"] }, 300)).toEqual(["flash", "smoke"]);
    expect(utilityBundle("T", { ...inventory, grenades: ["smoke", "flash"] }, 500)).toEqual(["smoke", "flash"]);
    expect(utilityBundle("CT", { ...inventory, grenades: ["flash", "flash"] }, 1200).filter((item) => item === "flash")).toHaveLength(2);
  });

  it("keeps normal-round alternatives tied to complete inventory-aware bundles", () => {
    const rich = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    const poor = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    poor.player.money = observed(3000);
    expect(recommendPolicyV3(rich).options.map((option) => option.mode)).toEqual(["FULL", "FORCE"]);
    expect(recommendPolicyV3(poor).options.map((option) => option.mode)).toContain("FORCE");
    expect(recommendPolicyV3(poor).options.map((option) => option.mode)).not.toContain("FULL");
  });

  it("uses same-money inventory and loss FACTs in the normal option evidence", () => {
    const empty = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    empty.player.money = observed(3000);
    const retained = structuredClone(empty);
    retained.player.inventory = observed({ ...inventory, primary: "ak47", armor: 100, grenades: [] });
    expect(recommendPolicyV3(empty).options.map((option) => option.mode)).toContain("FORCE");
    expect(recommendPolicyV3(retained).options.map((option) => option.mode)).toContain("FULL");
    const higherLoss = structuredClone(empty);
    higherLoss.player.lossIndex = observed(3);
    const moneyAtT1 = (current: PolicyV3State) => recommendPolicyV3(current).options[0]?.trajectory.find((scenario) => scenario.id === "LOSS_NO_PLANT")?.nextMoney.min;
    expect(moneyAtT1(higherLoss)).not.toBe(moneyAtT1(empty));
  });

  it("keeps the approved $200/$300/$500 utility boundaries deterministic", () => {
    const empty = { ...inventory, grenades: [] };
    expect(utilityBundle("T", empty, 200)).toEqual(["flash"]);
    expect(utilityBundle("T", empty, 300)).toEqual(["smoke"]);
    expect(utilityBundle("T", empty, 500)).toEqual(["smoke", "flash"]);
  });

  it("only adds AWP path when the user explicitly declares it", () => {
    const defaultOut = recommendPolicyV3(state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } }));
    const preferred = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    preferred.preference = { source: "USER_DECLARED", awpPriority: "PREFER" };
    expect(defaultOut.options.some((option) => option.mode === "AWP_PATH")).toBe(false);
    expect(recommendPolicyV3(preferred).options[0]?.mode).toBe("AWP_PATH");
  });

  it("only adds SAVE_FOR_AWP preservation after a conservative next-horizon AWP check", () => {
    const current = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    current.player.money = observed(4000);
    current.player.lossIndex = observed(4);
    current.preference = { source: "USER_DECLARED", awpPriority: "SAVE_FOR_AWP" };
    const preserve = recommendPolicyV3(current).options.find((option) => option.mode === "PRESERVE");
    expect(preserve?.reasons.some((reason) => reason.code === "SAVE_FOR_AWP_HORIZON")).toBe(true);

    const prefer = structuredClone(current);
    prefer.preference = { source: "USER_DECLARED", awpPriority: "PREFER" };
    expect(recommendPolicyV3(prefer).options.some((option) => option.mode === "AWP_PATH")).toBe(false);
  });

  it("attaches assumptions to every numeric trajectory", () => {
    const out = recommendPolicyV3(state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } }));
    for (const option of out.options) for (const scenario of option.trajectory) expect(scenario.assumptions.length).toBeGreaterThan(0);
  });

  it("projects an explicit t+2 scenario without inventing future reachability", () => {
    const out = recommendPolicyV3(state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } }));
    const loss = out.options[0]?.trajectory.find((scenario) => scenario.id === "LOSS_NO_PLANT");
    expect(loss?.followingRound.action).toBe("PRESERVE");
    expect(loss?.followingRound.money.status).toBe("TRACKED");
    expect(loss?.followingRound.reachability.status).toBe("UNKNOWN");
  });

  it("returns unresolved evidence rather than a fake pistol PRESERVE", () => {
    const current = state();
    current.round.context = observed("PISTOL");
    expect(recommendPolicyV3(current)).toMatchObject({ status: "UNSUPPORTED_POLICY_EVIDENCE", futureAffordability: { status: "NOT_APPLICABLE", reason: "PISTOL_UNSUPPORTED" }, options: [] });
  });

  it("keeps overtime outside NORMAL future-affordability semantics", () => {
    const current = state();
    current.round.context = observed("OVERTIME");
    expect(recommendPolicyV3(current)).toMatchObject({ status: "READY", futureAffordability: { status: "NOT_APPLICABLE", reason: "OVERTIME_UNSUPPORTED" } });
  });

  it("keeps POST_PISTOL outside NORMAL future-affordability semantics", () => {
    const output = recommendPolicyV3(state());
    expect(output.futureAffordability).toEqual({ status: "NOT_APPLICABLE", boundaries: [], reason: "POST_PISTOL_STRATEGY" });
    expect(output.options.some((option) => option.mode === "LIGHT")).toBe(false);
  });

  it("keeps an affordable SMG conversion bundle under strategic FULL", () => {
    const current = state();
    current.round.side = observed("CT");
    current.player.money = observed(2600);
    current.history = { integrity: "COMPLETE", previousRounds: [{ roundNumber: 1, winner: observed("CT"), planted: observed(false) }] };
    const output = recommendPolicyV3(current);
    const conversion = output.options[0];
    expect(output.futureAffordability).toEqual({ status: "NOT_APPLICABLE", boundaries: [], reason: "POST_PISTOL_STRATEGY" });
    expect(conversion).toMatchObject({ mode: "FULL", spendingGuidance: { layer: "ADVICE", kind: "COMPLETE_CURRENT_BUY" } });
    expect(conversion?.purchases).toEqual(expect.arrayContaining([{ item: "mp9", quantity: 1 }, { item: "kevlar", quantity: 1 }]));
    expect(conversion?.resultingInventory.armor).toBeGreaterThan(0);
  });

  it("does not fabricate boundary values when NORMAL own money is UNKNOWN", () => {
    const current = state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } });
    current.player.money = { status: "UNKNOWN", source: "test", asOfSeq: 1, reason: "missing" };
    expect(recommendPolicyV3(current)).toMatchObject({
      status: "INSUFFICIENT_STATE",
      futureAffordability: { status: "UNKNOWN", boundaries: [] },
    });
  });
});
