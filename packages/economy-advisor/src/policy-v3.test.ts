import { describe, expect, it } from "vitest";
import { recommendPolicyV3, utilityBundle, type PolicyV3State } from "./policy-v3.js";

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
    expect(force?.spend).toBeGreaterThanOrEqual(2800);
    expect(force?.assumptions.join(" ")).toContain("no V2 preservation budget");
  });

  it("uses a CT FORCE-dominant post-pistol recommendation while retaining fallback", () => {
    const current = state();
    current.round.side = observed("CT");
    const out = recommendPolicyV3(current);
    expect(out.options.map((option) => [option.mode, option.adviceStrength])).toEqual([["FORCE", "DOMINANT"], ["PRESERVE", "ALTERNATIVE"]]);
    expect(out.defaultOptionId).toBe(out.options[0]?.id);
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
    expect(full?.spend).toBeLessThan(6000);
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
    expect(full?.conditionalAlternatives.some((alternative) => alternative.condition.includes("队友暂无钳子"))).toBe(true);
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

  it("attaches assumptions to every numeric trajectory", () => {
    const out = recommendPolicyV3(state({ round: { ...state().round, number: observed(5), context: observed("NORMAL") } }));
    for (const option of out.options) for (const scenario of option.trajectory) expect(scenario.assumptions.length).toBeGreaterThan(0);
  });
});
