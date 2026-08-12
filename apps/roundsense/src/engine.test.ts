import { describe, expect, it } from "vitest";
import { inventoryFrom, tick } from "./engine.js";
import { RoundDecisionState } from "./decision-state.js";
import { PolicyStateTracker } from "./policy-state.js";
import { toProductView } from "./product-view.js";
import type { GsiPayload } from "@roundsense/gsi-protocol";

const basePayload = (over: Partial<GsiPayload> = {}): GsiPayload => ({
  map: { name: "de_mirage", mode: "competitive", round: 2, team_ct: { score: 1, consecutive_round_losses: 1 }, team_t: { score: 0, consecutive_round_losses: 0 } },
  round: { phase: "freezetime", bomb: null, win_team: null },
  player: { team: "T", state: { armor: 0, helmet: false, defusekit: false, money: 3000 }, weapons: {} },
  ...over,
});

function lifecyclePayload({
  side,
  roundNumber,
  phase,
  winner = null,
  money = 4000,
  includePlayer = true,
}: {
  side: "CT" | "T";
  roundNumber: number;
  phase: "freezetime" | "live" | "over";
  winner?: "CT" | "T" | null;
  money?: number;
  includePlayer?: boolean;
}): GsiPayload {
  const ctWon = winner === "CT";
  const tWon = winner === "T";
  return basePayload({
    map: {
      name: "de_mirage",
      mode: "competitive",
      round: roundNumber,
      team_ct: { score: ctWon ? 1 : 0, consecutive_round_losses: tWon ? 0 : 1 },
      team_t: { score: tWon ? 1 : 0, consecutive_round_losses: ctWon ? 0 : 1 },
    },
    round: { phase, bomb: null, win_team: winner },
    player: includePlayer
      ? { team: side, state: { armor: 0, helmet: false, defusekit: false, money }, weapons: {} }
      : undefined,
  });
}

function runPistolLifecycle(side: "CT" | "T", winner: "CT" | "T") {
  const tracker = new PolicyStateTracker();
  expect(tick(lifecyclePayload({ side, roundNumber: 1, phase: "freezetime", money: 800 }), { tracker, seq: 1 })).not.toBeNull();
  expect(tick(lifecyclePayload({ side, roundNumber: 1, phase: "live", money: 800 }), { tracker, seq: 2 })).toBeNull();
  // Terminal receipts may already carry the next map.round and do not need
  // the fields required to produce current-round purchase advice.
  expect(tick(lifecyclePayload({ side, roundNumber: 2, phase: "over", winner, includePlayer: false }), { tracker, seq: 3 })).toBeNull();
  return tick(lifecyclePayload({ side, roundNumber: 2, phase: "freezetime" }), { tracker, seq: 4 });
}

describe("V3 engine integration", () => {
  it("freezes automatic intent while live freezetime state continues to execute purchases", () => {
    const tracker = new PolicyStateTracker();
    const decisionState = new RoundDecisionState();
    const receipt = (money: number, weapons: NonNullable<GsiPayload["player"]>["weapons"], armor = 0) => basePayload({
      map: { name: "de_mirage", round: 5, team_ct: { score: 2, consecutive_round_losses: 2 }, team_t: { score: 3, consecutive_round_losses: 1 } },
      player: { team: "CT", state: { armor, helmet: armor === 100, defusekit: false, money }, weapons },
    });
    const first = tick(receipt(3300, {}), { tracker, decisionState, seq: 1 });
    const afterArmor = tick(receipt(2650, {}, 100), { tracker, decisionState, seq: 2 });
    const afterPrimary = tick(receipt(1450, { primary: { name: "weapon_mp9", type: "Submachine Gun" } }, 100), { tracker, decisionState, seq: 3 });
    if (!first || !afterArmor || !afterPrimary) throw new Error("expected freezetime advice");
    expect(first.automaticDecision).toMatchObject({ status: "FROZEN", snapshot: { status: "UNVERIFIED_FIRST_FREEZE", receiptSeq: 1 } });
    expect(afterArmor.automaticDecision).toMatchObject({ status: "FROZEN", snapshot: { status: "UNVERIFIED_FIRST_FREEZE", receiptSeq: 1 } });
    expect(afterPrimary.automaticDecision).toMatchObject({ status: "FROZEN", snapshot: { status: "UNVERIFIED_FIRST_FREEZE", receiptSeq: 1 } });
    expect(afterPrimary.automaticDecision.status === "FROZEN" && first.automaticDecision.status === "FROZEN"
      ? afterPrimary.automaticDecision.policy.options.map((option) => option.mode)
      : []).toEqual(first.automaticDecision.status === "FROZEN" ? first.automaticDecision.policy.options.map((option) => option.mode) : []);
    expect(afterPrimary.money).toBe(1450);
    expect(afterPrimary.policy.options.map((option) => option.resultingInventory.primary)).toContain("mp9");
    const view = toProductView(afterPrimary);
    expect(view.round.currentMoney).toBe(1450);
    expect(view.automaticDecision).toBe("UNVERIFIED_FIRST_FREEZE");
  });

  it("abandons automatic lead after a same-round receipt gap but keeps mechanics available", () => {
    const tracker = new PolicyStateTracker();
    const decisionState = new RoundDecisionState();
    const first = tick(basePayload({ map: { name: "de_mirage", round: 5, team_ct: { score: 2, consecutive_round_losses: 2 }, team_t: { score: 3, consecutive_round_losses: 1 } } }), { tracker, decisionState, seq: 1 });
    const gap = tick(basePayload({ map: { name: "de_mirage", round: 5, team_ct: { score: 2, consecutive_round_losses: 2 }, team_t: { score: 3, consecutive_round_losses: 1 } } }), { tracker, decisionState, seq: 3 });
    if (!first || !gap) throw new Error("expected freezetime advice");
    expect(first.automaticDecision.status).toBe("FROZEN");
    expect(gap.automaticDecision).toEqual({ status: "ABSTAINED", snapshot: { status: "UNAVAILABLE", key: { mapName: "de_mirage", roundNumber: 5, side: "T" }, reason: "SEQUENCE_GAP" } });
    expect(toProductView(gap).automatic).toMatchObject({ status: "MULTIMODAL" });
  });

  it("does not synthesize a decision snapshot from a mid-round cold start and re-establishes on the next round", () => {
    const tracker = new PolicyStateTracker();
    const decisionState = new RoundDecisionState();
    const live = tick(lifecyclePayload({ side: "CT", roundNumber: 5, phase: "live" }), { tracker, decisionState, seq: 1 });
    const nextFreeze = tick(lifecyclePayload({ side: "CT", roundNumber: 6, phase: "freezetime" }), { tracker, decisionState, seq: 2 });
    expect(live).toBeNull();
    expect(nextFreeze?.automaticDecision).toMatchObject({ status: "FROZEN", snapshot: { status: "UNVERIFIED_FIRST_FREEZE", key: { roundNumber: 6 } } });
  });

  it("invalidates automatic decision state on a round restart", () => {
    const tracker = new PolicyStateTracker();
    const decisionState = new RoundDecisionState();
    const beforeRestart = tick(lifecyclePayload({ side: "CT", roundNumber: 6, phase: "freezetime" }), { tracker, decisionState, seq: 1 });
    const restarted = tick(lifecyclePayload({ side: "CT", roundNumber: 5, phase: "freezetime" }), { tracker, decisionState, seq: 2 });
    expect(beforeRestart?.automaticDecision.status).toBe("FROZEN");
    expect(restarted?.automaticDecision).toEqual({ status: "ABSTAINED", snapshot: { status: "UNAVAILABLE", key: { mapName: "de_mirage", roundNumber: 5, side: "CT" }, reason: "ROUND_RESTART" } });
    expect(toProductView(restarted!).automatic).toMatchObject({ status: "MULTIMODAL" });
  });

  it("only advises during verified buy phase", () => {
    expect(tick(basePayload(), { seq: 1 })).not.toBeNull();
    expect(tick(basePayload({ round: { phase: "live", bomb: null, win_team: null } }), { seq: 1 })).toBeNull();
  });

  it("keeps missing loss counter UNKNOWN instead of assumed-1", () => {
    const payload = basePayload({ map: { name: "de_mirage", round: 2, team_ct: { score: 1 }, team_t: { score: 0 } } });
    const out = tick(payload, { seq: 1 });
    expect(out?.policy.status).toBe("INSUFFICIENT_STATE");
    expect(out?.policy.unresolved.join(" ")).toContain("consecutive_round_losses");
  });

  it("passes post-pistol multimodal T recommendations through to the app", () => {
    const tracker = new PolicyStateTracker();
    const out = tick(basePayload(), { seq: 1, tracker });
    expect(out?.policy.status).toBe("READY");
    expect(out?.policy.options.map((option) => option.mode)).toEqual(["PRESERVE", "FORCE"]);
    expect(out?.policy.defaultOptionId).toBeUndefined();
  });

  it("tracks the complete pistol lifecycle before producing winner-side post-pistol advice", () => {
    const out = runPistolLifecycle("T", "T");
    expect(out?.policy.status).toBe("READY");
    expect(out?.policy.options.map((option) => option.mode)).toContain("FULL");
    expect(out?.policy.defaultOptionId).toBeUndefined();
  });

  it.each([
    ["T", "CT", ["PRESERVE", "FORCE"]],
    ["CT", "T", ["FORCE", "PRESERVE"]],
  ] as const)("preserves %s pistol-loser recommendations through the runtime lifecycle", (side, winner, modes) => {
    const out = runPistolLifecycle(side, winner);
    expect(out?.policy.options.map((option) => option.mode)).toEqual(modes);
    expect(out?.policy.defaultOptionId).toBe(side === "CT" ? out?.policy.options[0]?.id : undefined);
  });

  it.each([
    ["a mid-round cold start", [
      { side: "CT" as const, roundNumber: 1, phase: "live" as const },
      { side: "CT" as const, roundNumber: 2, phase: "over" as const, winner: "T" as const, includePlayer: false },
      { side: "CT" as const, roundNumber: 2, phase: "freezetime" as const },
    ], [1, 2, 3]],
    ["a missing terminal receipt", [
      { side: "CT" as const, roundNumber: 1, phase: "freezetime" as const },
      { side: "CT" as const, roundNumber: 1, phase: "live" as const },
      { side: "CT" as const, roundNumber: 2, phase: "freezetime" as const },
    ], [1, 2, 3]],
    ["a sequence gap", [
      { side: "CT" as const, roundNumber: 1, phase: "freezetime" as const },
      { side: "CT" as const, roundNumber: 1, phase: "live" as const },
      { side: "CT" as const, roundNumber: 2, phase: "over" as const, winner: "T" as const, includePlayer: false },
      { side: "CT" as const, roundNumber: 2, phase: "freezetime" as const },
    ], [1, 2, 4, 5]],
  ] as const)("does not guess a previous pistol winner after %s", (_caseName, payloads, seqs) => {
    const tracker = new PolicyStateTracker();
    const outputs = payloads.map((payload, index) => tick(lifecyclePayload(payload), { tracker, seq: seqs[index]! }));
    expect(outputs.slice(0, -1).every((out) => out === null || out.policy.status === "UNSUPPORTED_POLICY_EVIDENCE")).toBe(true);
    const out = outputs.at(-1);
    expect(out?.policy.options.map((option) => option.mode)).toEqual(["PRESERVE", "FORCE"]);
    expect(out?.policy.defaultOptionId).toBeUndefined();
  });

  it("accepts an explicit AWP preference without inferring a player role", () => {
    const out = tick(basePayload({ map: { name: "de_mirage", round: 5, team_ct: { score: 2, consecutive_round_losses: 2 }, team_t: { score: 3, consecutive_round_losses: 1 } }, player: { team: "T", state: { armor: 0, helmet: false, defusekit: false, money: 6000 }, weapons: {} } }), {
      seq: 1,
      preference: { source: "USER_DECLARED", awpPriority: "PREFER" },
    });
    expect(out?.policy.options[0]?.mode).toBe("AWP_PATH");
  });

  it("keeps automatic advice frozen while resolving a round-scoped player lock separately", () => {
    const payload = basePayload({
      map: { name: "de_mirage", round: 5, team_ct: { score: 2, consecutive_round_losses: 2 }, team_t: { score: 3, consecutive_round_losses: 1 } },
      player: { team: "T", state: { armor: 0, helmet: false, defusekit: false, money: 6000 }, weapons: {} },
    });
    const automatic = tick(payload, { seq: 1 });
    const locked = tick(payload, {
      seq: 1,
      lockedMode: { mapName: "de_mirage", roundNumber: 5, side: "T", mode: "PRESERVE" },
    });
    expect(locked?.policy).toEqual(automatic?.policy);
    expect(locked?.locked).toMatchObject({ status: "RESOLVED", mode: "PRESERVE", option: { mode: "PRESERVE" } });
    expect(locked?.policy.options.some((option) => option.mode === "PRESERVE")).toBe(false);
  });

  it("does not apply a stale round lock or fall back when the locked mode is unavailable", () => {
    const stale = tick(basePayload(), {
      seq: 1,
      lockedMode: { mapName: "de_mirage", roundNumber: 1, side: "T", mode: "PRESERVE" },
    });
    expect(stale?.locked).toEqual({ status: "UNAVAILABLE", mode: "PRESERVE", option: null, reason: "ROUND_SCOPE_MISMATCH" });

    const unavailable = tick(basePayload(), {
      seq: 1,
      lockedMode: { mapName: "de_mirage", roundNumber: 2, side: "T", mode: "LIGHT" },
    });
    expect(unavailable?.policy.status).toBe("READY");
    expect(unavailable?.locked).toEqual({ status: "UNAVAILABLE", mode: "LIGHT", option: null, reason: "MODE_UNAVAILABLE" });
  });

  it("keeps unsupported and insufficient evidence distinct from an unavailable locked mode", () => {
    const pistol = tick(basePayload({
      map: {
        name: "de_mirage",
        round: 1,
        team_ct: { score: 0, consecutive_round_losses: 0 },
        team_t: { score: 0, consecutive_round_losses: 0 },
      },
    }), {
      seq: 1,
      lockedMode: { mapName: "de_mirage", roundNumber: 1, side: "T", mode: "PRESERVE" },
    });
    expect(pistol?.locked).toEqual({
      status: "UNAVAILABLE",
      mode: "PRESERVE",
      option: null,
      reason: "UNSUPPORTED_POLICY_EVIDENCE",
    });

    const unknownPrimary = tick(basePayload({
      map: { name: "de_mirage", round: 5, team_ct: { score: 2, consecutive_round_losses: 2 }, team_t: { score: 3, consecutive_round_losses: 1 } },
      player: {
        team: "T",
        state: { armor: 0, helmet: false, defusekit: false, money: 3000 },
        weapons: { rifle: { name: "weapon_future_rifle", type: "Rifle" } },
      },
    }), {
      seq: 1,
      lockedMode: { mapName: "de_mirage", roundNumber: 5, side: "T", mode: "PRESERVE" },
    });
    expect(unknownPrimary?.locked).toEqual({
      status: "UNAVAILABLE",
      mode: "PRESERVE",
      option: null,
      reason: "INSUFFICIENT_STATE",
    });
  });

  it("keeps an unknown primary UNKNOWN until a complete recognized inventory arrives", () => {
    const tracker = new PolicyStateTracker();
    const normal = (weapons: NonNullable<GsiPayload["player"]>["weapons"]) => basePayload({
      map: { name: "de_mirage", round: 5, team_ct: { score: 2, consecutive_round_losses: 2 }, team_t: { score: 3, consecutive_round_losses: 1 } },
      player: { team: "T", state: { armor: 0, helmet: false, defusekit: false, money: 3000 }, weapons },
    });
    expect(tick(normal({ rifle: { name: "weapon_ak47", type: "Rifle" } }), { tracker, seq: 1 })?.policy.status).toBe("READY");
    expect(tick(normal({ rifle: { name: "weapon_future_rifle", type: "Rifle" } }), { tracker, seq: 2 })?.policy.status).toBe("INSUFFICIENT_STATE");
    expect(tick(normal(undefined), { tracker, seq: 3 })?.policy.status).toBe("INSUFFICIENT_STATE");
    expect(tick(normal({ rifle: { name: "weapon_ak47", type: "Rifle" } }), { tracker, seq: 4 })?.policy.status).toBe("READY");
  });
});

describe("normal-player inventory mapping", () => {
  it("maps known primaries and preserves grenade quantities", () => {
    const inventory = inventoryFrom(basePayload({ player: {
      team: "T", state: { armor: 100, helmet: true, defusekit: false, money: 3000 },
      weapons: { rifle: { name: "weapon_ak47", type: "Rifle" }, flash: { name: "weapon_flashbang", type: "Grenade", ammo_reserve: 2 } },
    } }));
    expect(inventory?.primary).toBe("ak47");
    expect(inventory?.grenades).toEqual(["flash", "flash"]);
  });

  it("never guesses an unmapped primary", () => {
    const inventory = inventoryFrom(basePayload({ player: { team: "T", state: { armor: 0, helmet: false, defusekit: false, money: 3000 }, weapons: { x: { name: "weapon_future_rifle", type: "Rifle" } } } }));
    expect(inventory).toBeUndefined();
  });
});
