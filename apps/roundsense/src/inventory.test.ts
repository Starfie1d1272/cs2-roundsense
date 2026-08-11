import { describe, expect, it } from "vitest";
import type { GsiPayload } from "@roundsense/gsi-protocol";
import { tick } from "./engine.js";
import { inventoryFrom } from "./inventory.js";

const payload = (over: Partial<GsiPayload> = {}): GsiPayload => ({
  map: { name: "de_mirage", round: 5, team_ct: { score: 2, consecutive_round_losses: 2 }, team_t: { score: 3, consecutive_round_losses: 1 } },
  round: { phase: "freezetime", bomb: null, win_team: null },
  player: { team: "T", state: { money: 4200, armor: 100, helmet: true, defusekit: false }, weapons: {} },
  ...over,
});

function withWeapons(weapons: Record<string, Record<string, unknown>>, state: Record<string, unknown> = {}) {
  return payload({ player: { ...payload().player!, weapons: weapons as never, state: { ...payload().player!.state!, ...state } as never } });
}

describe("complete normal-player inventory observations", () => {
  it("maps canonical firearms and degrades an unknown primary id", () => {
    expect(inventoryFrom(withWeapons({ a: { name: "weapon_mp9", type: "Submachine Gun" } }))?.primary).toBe("mp9");
    expect(inventoryFrom(withWeapons({ a: { name: "weapon_m249", type: "Machine Gun" } }))?.primary).toBe("m249");
    expect(inventoryFrom(withWeapons({ a: { name: "weapon_negev", type: "Machine Gun" } }))?.primary).toBe("negev");
    expect(inventoryFrom(withWeapons({ a: { name: "weapon_future_rifle", type: "Rifle" } }))).toBeUndefined();
  });

  it("preserves grenade multiset quantities and missing reserve as one observed grenade", () => {
    expect(inventoryFrom(withWeapons({ a: { name: "weapon_smokegrenade", type: "Grenade", ammo_reserve: 1 } }))?.grenades).toEqual(["smoke"]);
    expect(inventoryFrom(withWeapons({ a: { name: "weapon_flashbang", type: "Grenade", ammo_reserve: 2 } }))?.grenades).toEqual(["flash", "flash"]);
    expect(inventoryFrom(withWeapons({ a: { name: "weapon_smokegrenade", type: "Grenade", ammo_reserve: 1 }, b: { name: "weapon_flashbang", type: "Grenade", ammo_reserve: 2 } }))?.grenades).toEqual(["smoke", "flash", "flash"]);
    expect(inventoryFrom(withWeapons({ a: { name: "weapon_hegrenade", type: "Grenade" } }))?.grenades).toEqual(["he"]);
  });

  it("preserves numeric armor, helmet upgrades, and the direct kit field", () => {
    for (const armor of [0, 50, 99, 100]) expect(inventoryFrom(withWeapons({}, { armor }))?.armor).toBe(armor);
    expect(inventoryFrom(withWeapons({}, { armor: 100, helmet: true }))?.hasHelmet).toBe(true);
    expect(inventoryFrom(withWeapons({}, { defusekit: true }))?.hasDefuseKit).toBe(true);
  });

  it("rejects incomplete observations rather than using empty defaults", () => {
    const missingWeapons = payload();
    missingWeapons.player!.weapons = undefined;
    expect(inventoryFrom(missingWeapons)).toBeUndefined();
    const missingState = payload();
    missingState.player!.state = undefined;
    expect(inventoryFrom(missingState)).toBeUndefined();
  });
});

describe("engine runtime gates", () => {
  it("only produces a tick in freezetime with complete player/map identity", () => {
    expect(tick(payload(), { seq: 1 })).not.toBeNull();
    expect(tick(payload({ round: { phase: "live", bomb: null, win_team: null } }), { seq: 1 })).toBeNull();
    expect(tick(payload({ round: { phase: "over", bomb: null, win_team: null } }), { seq: 1 })).toBeNull();
    const noTeam = payload(); noTeam.player!.team = undefined;
    expect(tick(noTeam, { seq: 1 })).toBeNull();
    const noPlayer = payload(); noPlayer.player = undefined;
    expect(tick(noPlayer, { seq: 1 })).toBeNull();
    const noRound = payload(); noRound.map!.round = undefined;
    expect(tick(noRound, { seq: 1 })).toBeNull();
  });

  it("exposes a missing loss counter as insufficient state, never assumed-1", () => {
    const missing = payload();
    missing.map!.team_ct = { score: 2 };
    missing.map!.team_t = { score: 3 };
    expect(tick(missing, { seq: 1 })?.policy.status).toBe("INSUFFICIENT_STATE");
  });
});
