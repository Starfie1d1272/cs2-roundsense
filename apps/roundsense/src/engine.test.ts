import { describe, expect, it } from "vitest";
import { inventoryFrom, tick } from "./engine.js";
import { PolicyStateTracker } from "./policy-state.js";
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
    expect(inventory?.primary).toBeNull();
  });
});
