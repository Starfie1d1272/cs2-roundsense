import { describe, expect, it } from "vitest";
import { tick, inventoryFrom } from "./engine.js";
import type { GsiPayload } from "@roundsense/gsi-protocol";

const basePayload = (over: Partial<GsiPayload> = {}): GsiPayload => ({
  provider: { name: "csgo", appid: 730, version: 1, steamid: "1", timestamp: 100 },
  map: { name: "de_mirage", mode: "competitive", round: 5, team_ct: { score: 2, consecutive_round_losses: 2 }, team_t: { score: 3, consecutive_round_losses: 1 } },
  round: { phase: "freezetime", bomb: null, win_team: null },
  player: {
    steamid: "1",
    name: "p",
    team: "T",
    state: { health: 100, armor: 100, helmet: true, money: 4200, round_kills: 1, equip_value: 4000 },
    weapons: {
      weapon_0: { name: "weapon_ak47", type: "Rifle", state: "active", equipped: true },
      weapon_1: { name: "weapon_knife", type: "Knife", state: "holstered" },
      weapon_2: { name: "weapon_smokegrenade", type: "Grenade" },
    },
  },
  ...over,
});

describe("advice phase gating (C1)", () => {
  it("produces advice during freezetime", () => {
    const out = tick(basePayload(), { nextRoundGoal: "rifle_armor" });
    expect(out).not.toBeNull();
    expect(out!.side).toBe("T");
    expect(out!.money).toBe(4200);
  });

  it("returns null during live", () => {
    const out = tick(basePayload({ round: { phase: "live", bomb: null, win_team: null } }), { nextRoundGoal: "rifle_armor" });
    expect(out).toBeNull();
  });

  it("returns null during live with planted bomb", () => {
    const out = tick(basePayload({ round: { phase: "live", bomb: "planted", win_team: null } }), { nextRoundGoal: "rifle_armor" });
    expect(out).toBeNull();
  });

  it("returns null during over", () => {
    const out = tick(basePayload({ round: { phase: "over", bomb: "exploded", win_team: "T" } }), { nextRoundGoal: "rifle_armor" });
    expect(out).toBeNull();
  });

  it("returns null when round.phase is undefined", () => {
    const p = basePayload();
    p.round = undefined;
    const out = tick(p, { nextRoundGoal: "rifle_armor" });
    expect(out).toBeNull();
  });

  it("returns null when map.round is missing (no silent round-1 guess)", () => {
    const p = basePayload();
    p.map = { ...p.map!, round: undefined };
    const out = tick(p, { nextRoundGoal: "rifle_armor" });
    expect(out).toBeNull();
  });
});

describe("team gating (C2)", () => {
  it("accepts CT and T", () => {
    const ct = tick(basePayload({ player: { ...basePayload().player!, team: "CT" } }), { nextRoundGoal: "rifle_armor" });
    expect(ct!.side).toBe("CT");
    const t = tick(basePayload(), { nextRoundGoal: "rifle_armor" });
    expect(t!.side).toBe("T");
  });

  it("returns null for unknown team strings", () => {
    const out = tick(basePayload({ player: { ...basePayload().player!, team: "spectator" } }), { nextRoundGoal: "rifle_armor" });
    expect(out).toBeNull();
  });

  it("returns null when team is missing", () => {
    const p = basePayload();
    p.player = { ...p.player!, team: undefined };
    const out = tick(p, { nextRoundGoal: "rifle_armor" });
    expect(out).toBeNull();
  });
});

describe("loss streak input", () => {
  it("uses consecutive_round_losses of the player's team", () => {
    const out = tick(basePayload({ player: { ...basePayload().player!, team: "CT" } }), { nextRoundGoal: "rifle_armor" });
    expect(out!.lossStreak).toBe(2); // team_ct.consecutive_round_losses
  });

  it("falls back to assumed-1 when GSI omits consecutive_round_losses", () => {
    const p = basePayload();
    p.map = { ...p.map!, team_ct: { score: 2 }, team_t: { score: 3 } };
    const out = tick(p, { nextRoundGoal: "rifle_armor" });
    expect(out!.lossStreak).toBe(1);
    expect(out!.lossStreakSource).toBe("assumed-1");
  });

  it("returns null advice when player state is missing", () => {
    const p = basePayload();
    p.player = undefined;
    const out = tick(p, { nextRoundGoal: "rifle_armor" });
    expect(out).toBeNull();
  });
});

describe("kill reward input (C3)", () => {
  it("advice is identical regardless of round_kills — past kills are not re-added", () => {
    const noKills = tick(basePayload({ player: { ...basePayload().player!, state: { ...basePayload().player!.state!, round_kills: 0 } } }), { nextRoundGoal: "rifle_armor" });
    const manyKills = tick(basePayload({ player: { ...basePayload().player!, state: { ...basePayload().player!.state!, round_kills: 5 } } }), { nextRoundGoal: "rifle_armor" });
    expect(noKills!.recommended?.totalCost).toBe(manyKills!.recommended?.totalCost);
    expect(noKills!.recommended?.label).toBe(manyKills!.recommended?.label);
  });
});

describe("weapon mapping (C4)", () => {
  it("maps weapon_mp9 with real GSI type 'Submachine Gun' to primary mp9", () => {
    const p = basePayload({
      player: {
        ...basePayload().player!,
        weapons: {
          a: { name: "weapon_mp9", type: "Submachine Gun", state: "active" },
          b: { name: "weapon_hkp2000", type: "Pistol", state: "holstered" },
        },
      },
    });
    const inv = inventoryFrom(p);
    expect(inv.primary).toBe("mp9");
    expect(inv.secondary).toBe("p2000");
  });

  it("maps machine guns with real GSI type 'Machine Gun' (not 'Machinegun')", () => {
    const m249 = basePayload({
      player: {
        ...basePayload().player!,
        weapons: { a: { name: "weapon_m249", type: "Machine Gun", state: "active" } },
      },
    });
    expect(inventoryFrom(m249).primary).toBe("m249");
    const negev = basePayload({
      player: {
        ...basePayload().player!,
        weapons: { a: { name: "weapon_negev", type: "Machine Gun", state: "active" } },
      },
    });
    expect(inventoryFrom(negev).primary).toBe("negev");
  });

  it("keeps primary null for an unknown weapon with a primary-looking type", () => {
    const p = basePayload({
      player: {
        ...basePayload().player!,
        weapons: { a: { name: "weapon_future_rifle", type: "Rifle", state: "active" } },
      },
    });
    const inv = inventoryFrom(p);
    expect(inv.primary).toBeNull(); // unmapped name — no guessing
  });
});

describe("inventory quantities (runtime-observed, Windows build 14174)", () => {
  const withWeapons = (weapons: Record<string, Record<string, unknown>>, state: Record<string, unknown> = {}) =>
    basePayload({ player: { ...basePayload().player!, weapons: weapons as never, state: { ...basePayload().player!.state!, ...state } as never } });

  it("smoke ammo_reserve=1 → grenades ['smoke']", () => {
    const inv = inventoryFrom(withWeapons({ a: { name: "weapon_smokegrenade", type: "Grenade", ammo_reserve: 1 } }));
    expect(inv.grenades).toEqual(["smoke"]);
  });

  it("flash ammo_reserve=1 → grenades ['flash']", () => {
    const inv = inventoryFrom(withWeapons({ a: { name: "weapon_flashbang", type: "Grenade", ammo_reserve: 1 } }));
    expect(inv.grenades).toEqual(["flash"]);
  });

  it("flash ammo_reserve=2 → grenades ['flash','flash'] (single entry, multiset)", () => {
    const inv = inventoryFrom(withWeapons({ a: { name: "weapon_flashbang", type: "Grenade", ammo_reserve: 2 } }));
    expect(inv.grenades).toEqual(["flash", "flash"]);
  });

  it("smoke + flash×2 → ['smoke','flash','flash']", () => {
    const inv = inventoryFrom(
      withWeapons({
        a: { name: "weapon_smokegrenade", type: "Grenade", ammo_reserve: 1 },
        b: { name: "weapon_flashbang", type: "Grenade", ammo_reserve: 2 },
      }),
    );
    expect(inv.grenades).toEqual(["smoke", "flash", "flash"]);
  });

  it("grenade entry without ammo_reserve still counts as ≥1", () => {
    const inv = inventoryFrom(withWeapons({ a: { name: "weapon_hegrenade", type: "Grenade" } }));
    expect(inv.grenades).toEqual(["he"]);
  });

  it("kevlar: armor 0→100 via player.state, weapons unchanged (observed $650)", () => {
    const before = inventoryFrom(withWeapons({ a: { name: "weapon_hkp2000", type: "Pistol" } }, { armor: 0, helmet: false }));
    expect(before.armor).toBe(0);
    const after = inventoryFrom(withWeapons({ a: { name: "weapon_hkp2000", type: "Pistol" } }, { armor: 100, helmet: false }));
    expect(after.armor).toBe(100);
    expect(after.hasHelmet).toBe(false);
    // the $650 cost itself is exercised through the armor incremental logic
    // in economy-advisor (kevlar price), not duplicated here
  });

  it("preserves numeric armor values (0/50/99/100) without folding to boolean", () => {
    for (const armor of [0, 50, 99, 100]) {
      const inv = inventoryFrom(withWeapons({ a: { name: "weapon_hkp2000", type: "Pistol" } }, { armor, helmet: false }));
      expect(inv.armor).toBe(armor);
    }
  });

  it("vesthelm upgrade: helmet false→true with armor already 100, weapons unchanged (observed -$350)", () => {
    const after = inventoryFrom(withWeapons({ a: { name: "weapon_hkp2000", type: "Pistol" } }, { armor: 100, helmet: true }));
    expect(after.armor).toBe(100);
    expect(after.hasHelmet).toBe(true);
  });

  it("defuse kit: player.state.defusekit=true → hasDefuseKit (kit never in weapons)", () => {
    const withKit = inventoryFrom(withWeapons({ a: { name: "weapon_hkp2000", type: "Pistol" } }, { defusekit: true }));
    expect(withKit.hasDefuseKit).toBe(true);
    const withoutKit = inventoryFrom(withWeapons({ a: { name: "weapon_hkp2000", type: "Pistol" } }));
    expect(withoutKit.hasDefuseKit).toBe(false);
  });
});
