import { describe, expect, it } from "vitest";
import type { GsiPayload } from "@roundsense/gsi-protocol";
import { PolicyStateTracker } from "./policy-state.js";

const payload = (round = 2, name = "de_mirage"): GsiPayload => ({
  map: { name, round, team_ct: { score: 1, consecutive_round_losses: 1 }, team_t: { score: 0, consecutive_round_losses: 0 } },
  round: { phase: "freezetime", bomb: null },
  player: { team: "T", state: { money: 3000, armor: 0, helmet: false }, weapons: {} },
});

describe("PolicyStateTracker", () => {
  it("marks a sequence gap PARTIAL without inventing tracked facts", () => {
    const tracker = new PolicyStateTracker();
    tracker.observe(payload(), 1);
    const state = tracker.observe(payload(), 3);
    expect(state.history.integrity).toBe("PARTIAL");
  });

  it("resets history on map change and restart", () => {
    const tracker = new PolicyStateTracker();
    tracker.observe(payload(5), 1);
    expect(tracker.observe(payload(1, "de_nuke"), 2).history.integrity).toBe("COLD_START");
  });

  it("keeps absent loss counters as UNKNOWN", () => {
    const tracker = new PolicyStateTracker();
    const incomplete = payload();
    incomplete.map = { name: "de_mirage", round: 2, team_ct: { score: 1 }, team_t: { score: 0 } };
    expect(tracker.observe(incomplete, 1).player.lossIndex.status).toBe("UNKNOWN");
  });

  it("does not consume spectator-only payload blocks", () => {
    const tracker = new PolicyStateTracker();
    const normal = tracker.observe(payload(), 1);
    const withOracle = payload() as GsiPayload & { allplayers: unknown; phase_countdowns: unknown };
    withOracle.allplayers = { enemy: { state: { money: 16000 } } };
    withOracle.phase_countdowns = { phase_ends_in: "99.9" };
    const observed = new PolicyStateTracker().observe(withOracle, 1);
    expect(observed.player).toEqual(normal.player);
    expect(observed.opponent).toEqual(normal.opponent);
  });
});
