import { describe, expect, it } from "vitest";
import type { GsiPayload } from "@roundsense/gsi-protocol";
import { PolicyStateTracker } from "./policy-state.js";

const payload = (round = 2, phase = "freezetime", name = "de_mirage"): GsiPayload => ({
  map: { name, round, team_ct: { score: 1, consecutive_round_losses: 1 }, team_t: { score: 0, consecutive_round_losses: 0 } },
  round: { phase, bomb: null, win_team: null },
  player: { team: "T", state: { money: 3000, armor: 0, helmet: false, defusekit: false }, weapons: {} },
});

describe("PolicyStateTracker integrity", () => {
  it("does not promote a cold-start mid-round stream to COMPLETE by payload count", () => {
    const tracker = new PolicyStateTracker();
    tracker.observe(payload(5, "live"), 1);
    tracker.observe(payload(5, "live"), 2);
    const state = tracker.observe(payload(5, "live"), 3);
    expect(state.history.integrity).toBe("COLD_START");
    expect(state.opponent.probability).toBeUndefined();
  });

  it("becomes COMPLETE only after a witnessed round lifecycle transition", () => {
    const tracker = new PolicyStateTracker();
    tracker.observe(payload(5), 1);
    tracker.observe(payload(5, "live"), 2);
    const terminal = payload(6, "over");
    terminal.round = { phase: "over", bomb: "defused", win_team: "CT" };
    tracker.observe(terminal, 3);
    const next = tracker.observe(payload(6), 4);
    expect(next.history.integrity).toBe("COMPLETE");
    expect(next.history.previousRounds).toHaveLength(1);
    expect(next.opponent.probability).toBeTypeOf("number");
  });

  it("marks sequence gaps PARTIAL and resets history on map/restart", () => {
    const tracker = new PolicyStateTracker();
    tracker.observe(payload(5), 1);
    expect(tracker.observe(payload(5), 3).history.integrity).toBe("PARTIAL");
    expect(tracker.observe(payload(1, "freezetime", "de_nuke"), 4).history.integrity).toBe("COLD_START");
  });
});

describe("inventory FACT boundary", () => {
  it("keeps cold-start partial inventory UNKNOWN", () => {
    const tracker = new PolicyStateTracker();
    const partial = payload();
    partial.player = { team: "T", state: { money: 3000, armor: 0, helmet: false, defusekit: false } };
    expect(tracker.observe(partial, 1).player.inventory.status).toBe("UNKNOWN");
  });

  it("tracks a complete inventory through a partial receipt without emptying it", () => {
    const tracker = new PolicyStateTracker();
    const full = payload();
    full.player!.weapons = { rifle: { name: "weapon_ak47", type: "Rifle" } };
    expect(tracker.observe(full, 1).player.inventory.status).toBe("OBSERVED");
    const partial = payload();
    partial.player!.weapons = undefined;
    const state = tracker.observe(partial, 2);
    expect(state.player.inventory.status).toBe("TRACKED");
    expect(state.player.inventory.value?.primary).toBe("ak47");
  });

  it.each(["armor", "helmet", "defusekit"])("does not default a missing %s field", (field) => {
    const tracker = new PolicyStateTracker();
    const partial = payload();
    delete (partial.player!.state as Record<string, unknown>)[field];
    expect(tracker.observe(partial, 1).player.inventory.status).toBe("UNKNOWN");
  });

  it("never retains inventory across a sequence gap or map reset", () => {
    const tracker = new PolicyStateTracker();
    tracker.observe(payload(), 1);
    const afterGap = payload();
    afterGap.player!.weapons = undefined;
    expect(tracker.observe(afterGap, 3).player.inventory.status).toBe("UNKNOWN");
    expect(tracker.observe({ ...afterGap, map: { ...afterGap.map!, name: "de_nuke", round: 1 } }, 4).player.inventory.status).toBe("UNKNOWN");
  });
});

describe("normal-player-only state", () => {
  it("keeps absent loss counters UNKNOWN", () => {
    const tracker = new PolicyStateTracker();
    const incomplete = payload();
    incomplete.map = { name: "de_mirage", round: 2, team_ct: { score: 1 }, team_t: { score: 0 } };
    expect(tracker.observe(incomplete, 1).player.lossIndex.status).toBe("UNKNOWN");
  });

  it("does not consume spectator-only payload blocks", () => {
    const normal = new PolicyStateTracker().observe(payload(), 1);
    const withOracle = payload() as GsiPayload & { allplayers: unknown; phase_countdowns: unknown };
    withOracle.allplayers = { enemy: { state: { money: 16000 } } };
    withOracle.phase_countdowns = { phase_ends_in: "99.9" };
    const observed = new PolicyStateTracker().observe(withOracle, 1);
    expect(observed.player).toEqual(normal.player);
    expect(observed.opponent).toEqual(normal.opponent);
  });
});
