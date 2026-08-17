import { describe, expect, it } from "vitest";
import type { GsiPayload } from "@roundsense/gsi-protocol";
import { tick } from "./engine.js";
import { toProductView } from "./product-view.js";

function payload({ side = "T", round = 5, money = 6000, weapons = {} }: {
  side?: "CT" | "T";
  round?: number;
  money?: number;
  weapons?: NonNullable<GsiPayload["player"]>["weapons"];
} = {}): GsiPayload {
  return {
    map: { name: "de_mirage", mode: "competitive", round, team_ct: { score: 2, consecutive_round_losses: 2 }, team_t: { score: 3, consecutive_round_losses: 1 } },
    round: { phase: "freezetime", bomb: null, win_team: null },
    player: { team: side, state: { armor: 100, helmet: true, defusekit: false, money }, weapons },
  };
}

function view(input: GsiPayload, lockedMode?: "PRESERVE" | "LIGHT" | "FORCE" | "FULL") {
  const side = input.player!.team as "CT" | "T";
  const out = tick(input, {
    seq: 1,
    lockedMode: lockedMode ? { mapName: input.map!.name!, roundNumber: input.map!.round!, side, mode: lockedMode } : undefined,
  });
  if (!out) throw new Error("expected advice tick");
  return toProductView(out);
}

describe("product presentation contract", () => {
  it("keeps remaining purchases, final inventory, and bundle spend distinct and serializable", () => {
    const result = view(payload({ money: 3000, weapons: { rifle: { name: "weapon_ak47", type: "Rifle" } } }));
    expect(result.automatic.status).toBe("SELECTED");
    if (result.automatic.status !== "SELECTED") return;
    expect(result.automatic.plan.finalInventory.primary).toBe("ak47");
    expect(result.automatic.plan.purchases.some((purchase) => purchase.item === "ak47")).toBe(false);
    expect(result.automatic.plan.bundleSpend).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("uses default then unique SUPPORTED, while preserving true multimodality", () => {
    expect(view(payload()).automatic).toMatchObject({ status: "SELECTED", plan: { mode: "FULL" } });
    const postPistol = view(payload({ round: 2, money: 3000 }));
    expect(postPistol.automatic).toMatchObject({ status: "MULTIMODAL", plans: [{ mode: "PRESERVE" }, { mode: "FORCE" }] });
    const normal = view(payload({ side: "CT", money: 2600 }));
    expect(normal.automatic).toMatchObject({ status: "MULTIMODAL" });
    if (normal.automatic.status !== "MULTIMODAL") return;
    expect(normal.automatic.plans.map((plan) => plan.mode)).toEqual(["FORCE", "LIGHT"]);
  });

  it("keeps a player lock separate from automatic advice", () => {
    const result = view(payload(), "PRESERVE");
    expect(result.automatic).toMatchObject({ status: "SELECTED", plan: { mode: "FULL" } });
    expect(result.active).toMatchObject({ source: "PLAYER_LOCKED", status: "SELECTED", mode: "PRESERVE", plan: { mode: "PRESERVE" } });
  });

  it("does not fall back to automatic advice when the locked mode is unavailable", () => {
    const result = view(payload({ round: 2, money: 3000 }), "LIGHT");
    expect(result.automatic.status).toBe("MULTIMODAL");
    expect(result.active).toEqual({ source: "PLAYER_LOCKED", status: "UNAVAILABLE", mode: "LIGHT", reason: "MODE_UNAVAILABLE" });
  });

  it("keeps a player-declared half-buy active when its generic default cannot be built", () => {
    const result = view(payload({ money: 0 }), "LIGHT");
    expect(result.active).toMatchObject({
      source: "PLAYER_LOCKED",
      status: "INTENT_ONLY",
      mode: "LIGHT",
      intent: { guardrail: { kind: "UNKNOWN", reason: "BOUNDARY_UNAVAILABLE" } },
      reason: "DEFAULT_PLAN_UNAVAILABLE",
    });
  });

  it("preserves unsupported policy evidence instead of presenting it as mode unavailability", () => {
    const result = view(payload({ round: 1 }), "PRESERVE");
    expect(result.automatic).toEqual({ status: "UNAVAILABLE", reason: "UNSUPPORTED_POLICY_EVIDENCE", plans: [] });
    expect(result.active).toEqual({
      source: "PLAYER_LOCKED",
      status: "UNAVAILABLE",
      mode: "PRESERVE",
      reason: "UNSUPPORTED_POLICY_EVIDENCE",
    });
  });

  it("exposes only a current additional-spend boundary and keeps actual spend UNKNOWN", () => {
    const result = view(payload({ side: "CT", money: 2600 }), "LIGHT");
    expect(result.actualSpend).toEqual({ status: "UNKNOWN", reason: "ROUND_START_MONEY_UNVERIFIED" });
    expect("amount" in result.actualSpend).toBe(false);
    expect(result.active).toMatchObject({
      source: "PLAYER_LOCKED",
      status: "SELECTED",
      plan: { mode: "LIGHT", guardrail: { kind: "BOUNDED", scenario: "LOSS_NO_PLANT" }, lossNoPlant: { status: "PROJECTED" } },
    });
    if (result.active.source === "PLAYER_LOCKED" && result.active.status === "SELECTED" && result.active.plan.guardrail.kind === "BOUNDED") {
      expect(result.active.plan.bundleSpend).toBeLessThanOrEqual(result.active.plan.guardrail.maxAdditionalSpend);
      expect(result.active.plan.boundaryConsequence).toEqual({
        thresholdAdditionalSpend: result.active.plan.guardrail.maxAdditionalSpend,
        before: "RIFLE_ARMOR_BASIC_UTILITY",
        after: "RIFLE_ARMOR",
      });
    }
  });

  it("does not attach a NORMAL future boundary to FORCE or FULL plans", () => {
    const automatic = view(payload({ side: "CT", money: 6000 }));
    expect(automatic.automatic).toMatchObject({ status: "SELECTED", plan: { mode: "FULL" } });
    if (automatic.automatic.status !== "SELECTED") return;
    expect(automatic.automatic.plan.boundaryConsequence).toBeUndefined();
  });
});
