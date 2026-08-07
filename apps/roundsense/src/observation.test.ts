import { describe, expect, it } from "vitest";
import { C4StateMachine, type C4Event } from "@roundsense/c4-estimator";
import type { GsiReceipt } from "@roundsense/gsi-protocol";
import { toC4Observation } from "./observation.js";

function receipt(seq: number, over: { round?: number; phase?: string; bomb?: string | null }, ns: bigint): GsiReceipt {
  return {
    seq,
    payload: {
      map: { round: over.round, phase: "live" },
      round: { phase: over.phase, bomb: over.bomb ?? null },
    } as GsiReceipt["payload"],
    receivedAtWallClock: "2026-08-07T00:00:00.000Z",
    receivedAtMonotonicNs: ns,
  };
}

describe("live observation adapter → C4StateMachine", () => {
  it("r3 planted → r4 over exploded → r4 freezetime integrates with the state machine", () => {
    const events: C4Event[] = [];
    const m = new C4StateMachine((e) => events.push(e));
    m.observe(toC4Observation(receipt(0, { round: 3, phase: "freezetime" }, 1_000_000_000n)));
    m.observe(toC4Observation(receipt(1, { round: 3, phase: "live" }, 2_000_000_000n)));
    m.observe(toC4Observation(receipt(2, { round: 3, phase: "live", bomb: "planted" }, 3_000_000_000n)));
    m.observe(toC4Observation(receipt(3, { round: 4, phase: "over", bomb: "exploded" }, 4_000_000_000n)));
    m.observe(toC4Observation(receipt(4, { round: 4, phase: "freezetime" }, 5_000_000_000n)));

    expect(events.map((e) => e.type)).toEqual(["planted", "exploded", "reset"]);
    expect(events[0]?.roundNumber).toBe(3);
    expect(events[0]?.plantedAtMonotonicNs).toBe(3_000_000_000n);
    expect(events[1]?.roundNumber).toBe(3);
    expect(m.state.state).toBe("idle");
    expect(m.state.roundNumber).toBe(4);
  });

  it("mid-round start (first useful state = planted) yields baseline_only, no planted event", () => {
    const events: C4Event[] = [];
    const m = new C4StateMachine((e) => events.push(e));
    m.observe(toC4Observation(receipt(0, { round: 3, phase: "live", bomb: "planted" }, 1_000_000_000n)));
    m.observe(toC4Observation(receipt(1, { round: 3, phase: "live", bomb: "planted" }, 2_000_000_000n)));
    expect(events.map((e) => e.type)).toEqual(["baseline_only"]);
    expect(events[0]?.plantedAtMonotonicNs).toBeUndefined();
  });
});
