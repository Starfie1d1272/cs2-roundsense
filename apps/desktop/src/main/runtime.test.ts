import { describe, expect, it } from "vitest";
import type { GsiPayload, GsiReceipt } from "@roundsense/gsi-protocol";
import { RoundSenseRuntime, toDesktopProduct, type RuntimeUpdate } from "./runtime.js";
import { tick } from "@roundsense/roundsense/engine";
import { toProductView } from "@roundsense/roundsense/product-view";

function payload(round = 5, phase: "freezetime" | "live" | "over" = "freezetime", money = 2600): GsiPayload {
  return {
    provider: { version: 14174 },
    map: {
      name: "de_mirage",
      mode: "competitive",
      round,
      team_ct: { score: 2, consecutive_round_losses: 2 },
      team_t: { score: 3, consecutive_round_losses: 1 },
    },
    round: { phase, bomb: null, win_team: null },
    player: {
      team: "CT",
      state: { armor: 100, helmet: true, defusekit: false, money },
      weapons: { rifle: { name: "weapon_m4a1", type: "Rifle" } },
    },
  };
}

function receipt(seq: number, input: GsiPayload): GsiReceipt {
  return {
    seq,
    payload: input,
    receivedAtWallClock: `2026-08-11T00:00:0${seq}.000Z`,
    receivedAtMonotonicNs: BigInt(seq) * 1_000_000_000n,
  };
}

describe("desktop product adapter", () => {
  it("keeps a retained rifle in final configuration but out of purchases", () => {
    const advice = tick(payload(), { seq: 1 });
    if (!advice) throw new Error("expected advice");
    const view = toDesktopProduct(toProductView(advice), "2026-08-11T00:00:01.000Z");
    expect(view.loadout.finalConfiguration).toContainEqual({ item: "m4a4", quantity: 1 });
    expect(view.loadout.purchases.some((item) => item.item === "m4a4")).toBe(false);
    expect(view.spending.spentThisRound.status).toBe("unknown");
    expect(view.spending.nextSpendConsequence).toEqual({
      thresholdAdditionalSpend: 950,
      before: "rifleArmorUtility",
      after: "rifleArmor",
    });
  });

  it("does not collapse multimodal automatic advice to a unique mode", () => {
    const advice = tick(payload(2), { seq: 1 });
    if (!advice) throw new Error("expected advice");
    const view = toDesktopProduct(toProductView(advice), "2026-08-11T00:00:01.000Z");
    expect(view.automaticIsMultimodal).toBe(true);
    expect(view.automaticMode).toBeUndefined();
    expect(view.automaticModes).toEqual(["eco", "force"]);
    expect(view.loadout.primaryDisposition).toBe("unknown");
  });
});

describe("RoundSense runtime lifecycle", () => {
  it("keeps a player intent for the round, hides live, and clears it next round", () => {
    const updates: RuntimeUpdate[] = [];
    const runtime = new RoundSenseRuntime({ token: "test", onUpdate: (update) => updates.push(update) });
    expect(runtime.setIntentLock("semi")).toBe(false);
    runtime.observe(receipt(1, payload()));
    expect(runtime.setIntentLock("semi")).toBe(true);
    runtime.observe(receipt(2, payload()));
    expect(updates.at(-1)?.product).toMatchObject({ visible: true, phase: "freezetime", lockedMode: "semi" });
    runtime.observe(receipt(3, payload(5, "live")));
    expect(updates.at(-1)?.product.visible).toBe(false);
    expect(runtime.lock?.mode).toBe("LIGHT");
    runtime.observe(receipt(4, payload(6, "over")));
    expect(runtime.lock).toBeNull();
  });
});
