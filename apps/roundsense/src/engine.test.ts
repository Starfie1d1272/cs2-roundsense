import { describe, expect, it } from "vitest";
import { tick, type BombTracker } from "./engine.js";
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

describe("bomb tracking", () => {
  it("starts countdown on planted and counts down with receivedAt", () => {
    const t: BombTracker = { plantedAtMs: null };
    const p1 = tick(basePayload({ round: { phase: "live", bomb: "planted", win_team: null } }), t, { nextRoundGoal: "rifle_armor" }, 1_000);
    expect(p1.bomb.planted).toBe(true);
    expect(p1.bomb.remainingMs).toBe(41000);
    const p2 = tick(basePayload({ round: { phase: "live", bomb: "planted", win_team: null } }), t, { nextRoundGoal: "rifle_armor" }, 11_000);
    expect(p2.bomb.remainingMs).toBe(31000); // 41000 - (11000-1000)
    const p3 = tick(basePayload({ round: { phase: "live", bomb: null, win_team: null } }), t, { nextRoundGoal: "rifle_armor" }, 20_000);
    expect(p3.bomb.planted).toBe(false);
  });
});

describe("economy advice", () => {
  it("produces recommended + alternatives from GSI player state", () => {
    const t: BombTracker = { plantedAtMs: null };
    const out = tick(basePayload(), t, { nextRoundGoal: "rifle_armor" }, 1_000);
    expect(out.advice).not.toBeNull();
    expect(out.advice!.side).toBe("T");
    expect(out.advice!.money).toBe(4200);
    expect(out.advice!.lossStreak).toBe(1);
    expect(out.advice!.lossStreakSource).toBe("gsi");
    expect(out.advice!.recommended).not.toBeNull();
    expect(out.advice!.alternatives.length).toBeGreaterThan(0);
  });

  it("uses consecutive_round_losses of the player's team", () => {
    const t: BombTracker = { plantedAtMs: null };
    const out = tick(basePayload({ player: { ...basePayload().player!, team: "CT" } }), t, { nextRoundGoal: "rifle_armor" }, 1_000);
    expect(out.advice!.lossStreak).toBe(2); // team_ct.consecutive_round_losses
    expect(out.advice!.side).toBe("CT");
  });

  it("falls back to assumed-1 when GSI omits consecutive_round_losses", () => {
    const t: BombTracker = { plantedAtMs: null };
    const p = basePayload();
    p.map = { ...p.map!, team_ct: { score: 2 }, team_t: { score: 3 } };
    const out = tick(p, t, { nextRoundGoal: "rifle_armor" }, 1_000);
    expect(out.advice!.lossStreak).toBe(1);
    expect(out.advice!.lossStreakSource).toBe("assumed-1");
  });

  it("returns null advice when player state is missing", () => {
    const t: BombTracker = { plantedAtMs: null };
    const p = basePayload();
    p.player = undefined;
    const out = tick(p, t, { nextRoundGoal: "rifle_armor" }, 1_000);
    expect(out.advice).toBeNull();
  });
});
