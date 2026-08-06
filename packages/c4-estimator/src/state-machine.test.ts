import { describe, expect, it } from "vitest";
import { C4StateMachine, type C4Observation } from "./state-machine.js";
import { estimateRemaining, estimateRemainingDefault, C4_FUSE_RULES } from "./estimator.js";

let seq = 0;
function obs(partial: Partial<C4Observation> & { roundNumber: number }): C4Observation {
  return {
    seq: seq++,
    receivedAtMonotonicNs: BigInt(seq) * 1_000_000n, // 1ms steps
    receivedAtWallClock: `2026-08-06T00:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    ...partial,
  };
}

function run(observations: C4Observation[]): C4StateMachine {
  const m = new C4StateMachine();
  for (const o of observations) m.observe(o);
  return m;
}

describe("C4StateMachine", () => {
  it("emits exactly one planted event on repeated planted payloads (dedupe)", () => {
    const m = run([
      obs({ roundNumber: 1, roundPhase: "freezetime", bomb: null }),
      obs({ roundNumber: 1, roundPhase: "live", bomb: null }),
      obs({ roundNumber: 1, roundPhase: "live", bomb: "planted" }),
      obs({ roundNumber: 1, roundPhase: "live", bomb: "planted" }), // dup
      obs({ roundNumber: 1, roundPhase: "live", bomb: "planted" }), // dup
      obs({ roundNumber: 1, roundPhase: "over", bomb: "defused" }),
    ]);
    expect(m.events.filter((e) => e.type === "planted")).toHaveLength(1);
    expect(m.events.map((e) => e.type)).toEqual(["planted", "defused"]);
    expect(m.state.state).toBe("defused");
  });

  it("mid-round start: first planted observation is baseline only, no fake event", () => {
    const m = run([
      obs({ roundNumber: 3, roundPhase: "live", bomb: "planted" }), // receiver joins late
      obs({ roundNumber: 3, roundPhase: "live", bomb: "planted" }),
      obs({ roundNumber: 3, roundPhase: "over", bomb: "defused" }),
    ]);
    expect(m.events.filter((e) => e.type === "planted")).toHaveLength(0);
    expect(m.events.map((e) => e.type)).toEqual(["baseline_only", "defused"]);
    expect(m.state.state).toBe("defused");
    // The defused event must NOT carry a plantedAt (unknown start)
    const defused = m.events.find((e) => e.type === "defused");
    expect(defused?.plantedAtMonotonicNs).toBeUndefined();
  });

  it("missing intermediate states: round end without explosion is round_over, never exploded", () => {
    const m = run([
      obs({ roundNumber: 2, roundPhase: "freezetime", bomb: null }),
      obs({ roundNumber: 2, roundPhase: "live", bomb: "planted" }),
      obs({ roundNumber: 2, roundPhase: "over", bomb: null }), // no defused/exploded seen
    ]);
    expect(m.events.map((e) => e.type)).toEqual(["planted", "round_over"]);
    expect(m.state.state).toBe("round_over");
    expect(m.events[1]?.note).toContain("no explosion fabricated");
  });

  it("exploded only on explicit exploded signal; exploding alone is not fabrication", () => {
    const m = run([
      obs({ roundNumber: 4, roundPhase: "live", bomb: null }),
      obs({ roundNumber: 4, roundPhase: "live", bomb: "planted" }),
      obs({ roundNumber: 4, roundPhase: "live", bomb: "exploding" }),
      obs({ roundNumber: 4, roundPhase: "over", bomb: null }),
    ]);
    expect(m.events.map((e) => e.type)).toEqual(["planted", "round_over"]);
    expect(m.events[1]?.note).toContain("explosion signal observed");

    const m2 = run([
      obs({ roundNumber: 4, roundPhase: "live", bomb: null }),
      obs({ roundNumber: 4, roundPhase: "live", bomb: "planted" }),
      obs({ roundNumber: 4, roundPhase: "over", bomb: "exploded" }),
    ]);
    expect(m2.events.map((e) => e.type)).toEqual(["planted", "exploded"]);
    expect(m2.state.state).toBe("exploded");
  });

  it("round number change resets safely (new round)", () => {
    const m = run([
      obs({ roundNumber: 5, roundPhase: "freezetime", bomb: null }),
      obs({ roundNumber: 5, roundPhase: "live", bomb: "planted" }),
      obs({ roundNumber: 6, roundPhase: "freezetime", bomb: null }),
      obs({ roundNumber: 6, roundPhase: "live", bomb: null }),
      obs({ roundNumber: 6, roundPhase: "live", bomb: "planted" }),
    ]);
    expect(m.events.map((e) => e.type)).toEqual(["planted", "reset", "planted"]);
    expect(m.state.state).toBe("planted");
    expect(m.state.roundNumber).toBe(6);
    // second planted event carries round 6
    expect(m.events[2]?.roundNumber).toBe(6);
  });

  it("map gameover resets to idle", () => {
    const m = run([
      obs({ roundNumber: 24, roundPhase: "freezetime", bomb: null }),
      obs({ roundNumber: 24, roundPhase: "live", bomb: "planted" }),
      obs({ roundNumber: 24, roundPhase: "over", bomb: null }),
      obs({ roundNumber: 24, mapPhase: "gameover", roundPhase: "over", bomb: null }),
    ]);
    expect(m.events.map((e) => e.type)).toEqual(["planted", "round_over", "reset"]);
    expect(m.state.state).toBe("idle");
  });

  it("dropped bomb before plant does not block a later planted event", () => {
    const m = run([
      obs({ roundNumber: 8, roundPhase: "freezetime", bomb: null }),
      obs({ roundNumber: 8, roundPhase: "live", bomb: "dropped" }),
      obs({ roundNumber: 8, roundPhase: "live", bomb: "planted" }),
    ]);
    expect(m.events.map((e) => e.type)).toEqual(["planted"]);
    expect(m.state.state).toBe("planted");
  });

  it("pause (timeout) preserves planted state", () => {
    const m = run([
      obs({ roundNumber: 10, roundPhase: "freezetime", bomb: null }),
      obs({ roundNumber: 10, roundPhase: "live", bomb: "planted" }),
      obs({ roundNumber: 10, mapPhase: "paused", roundPhase: "live", bomb: "planted" }),
      obs({ roundNumber: 10, mapPhase: "live", roundPhase: "live", bomb: "planted" }),
      obs({ roundNumber: 10, roundPhase: "over", bomb: "defused" }),
    ]);
    expect(m.events.map((e) => e.type)).toEqual(["planted", "defused"]);
    expect(m.state.state).toBe("defused");
  });

  it("idle ignores explosion signals without a tracked plant (no fabrication)", () => {
    const m = run([
      obs({ roundNumber: 12, roundPhase: "live", bomb: "exploding" }), // joined very late
      obs({ roundNumber: 12, roundPhase: "over", bomb: null }),
    ]);
    expect(m.events).toHaveLength(0);
    expect(m.state.state).toBe("idle");
  });
});

describe("estimateRemaining", () => {
  const planted = 10_000_000_000n; // 10s in ns

  it("computes remaining and elapsed from monotonic clock", () => {
    const out = estimateRemaining({ plantedAtMonotonicNs: planted, nowMonotonicNs: planted + 5_000_000_000n, fuseMs: 40_000 });
    expect(out.elapsedMs).toBe(5000);
    expect(out.remainingMs).toBe(35_000);
    expect(out.exploded).toBe(false);
  });

  it("clamps at zero and flags exploded", () => {
    const out = estimateRemaining({ plantedAtMonotonicNs: planted, nowMonotonicNs: planted + 41_000_000_000n, fuseMs: 40_000 });
    expect(out.remainingMs).toBe(0);
    expect(out.exploded).toBe(true);
  });

  it("uses the versioned default fuse (B1/B2)", () => {
    const out = estimateRemainingDefault(planted, planted + 20_000_000_000n);
    expect(C4_FUSE_RULES.fuseMs).toBe(41_000); // corpus-verified: 2624 ticks @64
    expect(out.remainingMs).toBe(21_000);
    expect(C4_FUSE_RULES.status).toBe("corpus-preliminary"); // honesty: Windows check pending
  });
});
