import { describe, expect, it } from "vitest";
import { tick } from "./engine.js";
import type { GsiPayload } from "@roundsense/gsi-protocol";

const basePayload = (over: Partial<GsiPayload> = {}): GsiPayload => ({
  provider: { name: "csgo", appid: 730, version: 1, steamid: "1", timestamp: 100 },
  map: { name: "de_mirage", mode: "competitive", round: 5, team_ct: { score: 2, consecutive_round_losses: 2 }, team_t: { score: 3, consecutive_round_losses: 1 } },
  round: { phase: "live", bomb: null, win_team: null },
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

describe("economy advice", () => {
  it("produces recommended + alternatives from GSI player state", () => {
    const out = tick(basePayload(), { nextRoundGoal: "rifle_armor" });
    expect(out).not.toBeNull();
    expect(out!.side).toBe("T");
    expect(out!.money).toBe(4200);
    expect(out!.lossStreak).toBe(1);
    expect(out!.lossStreakSource).toBe("gsi");
    expect(out!.recommended).not.toBeNull();
    expect(out!.alternatives.length).toBeGreaterThan(0);
  });

  it("uses consecutive_round_losses of the player's team", () => {
    const out = tick(basePayload({ player: { ...basePayload().player!, team: "CT" } }), { nextRoundGoal: "rifle_armor" });
    expect(out!.lossStreak).toBe(2); // team_ct.consecutive_round_losses
    expect(out!.side).toBe("CT");
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
