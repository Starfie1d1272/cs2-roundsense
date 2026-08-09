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
