import { describe, expect, it } from "vitest";
import { C4Presenter } from "./presenter.js";
import type { C4Event } from "@roundsense/c4-estimator";

const event = (type: C4Event["type"], plantedAt?: bigint): C4Event => ({
  type,
  roundNumber: 3,
  atMonotonicNs: 1_000_000_000n,
  atWallClock: "2026-08-07T00:00:00.000Z",
  ...(plantedAt !== undefined ? { plantedAtMonotonicNs: plantedAt } : {}),
});

describe("C4Presenter (injectable clock + scheduler)", () => {
  it("starts a 500ms countdown on planted and keeps updating without new GSI payloads", () => {
    const lines: string[] = [];
    const ticks: (() => void)[] = [];
    let nowNs = 10_000_000_000n; // planted at t=10s
    const p = new C4Presenter({
      nowNs: () => nowNs,
      schedule: (fn) => {
        ticks.push(fn);
        return ticks.length - 1;
      },
      cancel: () => {
        ticks.length = 0;
      },
      onOutput: (l) => lines.push(l),
    });

    p.handleEvent(event("planted", 10_000_000_000n));
    expect(lines[0]).toContain("41.0s remaining");
    expect(ticks).toHaveLength(1);

    // no GSI payload arrives; the local timer keeps counting down
    nowNs = 12_000_000_000n;
    ticks[0]!();
    nowNs = 15_000_000_000n;
    ticks[0]!();
    expect(lines[1]).toContain("39.0s remaining");
    expect(lines[2]).toContain("36.0s remaining");
  });

  it("stops the interval on terminal events", () => {
    const lines: string[] = [];
    const ticks: (() => void)[] = [];
    let cancelled = 0;
    const p = new C4Presenter({
      nowNs: () => 10_000_000_000n,
      schedule: (fn) => {
        ticks.push(fn);
        return ticks.length - 1;
      },
      cancel: () => {
        cancelled++;
        ticks.length = 0;
      },
      onOutput: (l) => lines.push(l),
    });

    p.handleEvent(event("planted", 10_000_000_000n));
    expect(p.isCountingDown).toBe(true);
    p.handleEvent(event("exploded"));
    expect(p.isCountingDown).toBe(false);
    expect(cancelled).toBe(1);
    expect(lines[lines.length - 1]).toBe("C4 EXPLODED");
    // interval was cleared: no further ticks
    expect(ticks).toHaveLength(0);
  });

  it("reset also clears the interval", () => {
    const ticks: (() => void)[] = [];
    let cancelled = 0;
    const p = new C4Presenter({
      nowNs: () => 10_000_000_000n,
      schedule: (fn) => {
        ticks.push(fn);
        return 0;
      },
      cancel: () => {
        cancelled++;
        ticks.length = 0;
      },
      onOutput: () => {},
    });
    p.handleEvent(event("planted", 10_000_000_000n));
    p.handleEvent(event("reset"));
    expect(p.isCountingDown).toBe(false);
    expect(cancelled).toBe(1);
  });

  it("baseline_only never starts a timer (joined mid-round)", () => {
    const lines: string[] = [];
    const ticks: (() => void)[] = [];
    const p = new C4Presenter({
      nowNs: () => 10_000_000_000n,
      schedule: (fn) => {
        ticks.push(fn);
        return 0;
      },
      cancel: () => {
        ticks.length = 0;
      },
      onOutput: (l) => lines.push(l),
    });
    p.handleEvent(event("baseline_only"));
    expect(lines).toEqual(["C4 PLANTED — remaining time unknown (joined mid-round)"]);
    expect(p.isCountingDown).toBe(false);
    expect(ticks).toHaveLength(0);
  });

  it("stops silently when the local estimate reaches zero (no fabricated outcome)", () => {
    const lines: string[] = [];
    const ticks: (() => void)[] = [];
    let cancelled = 0;
    let nowNs = 10_000_000_000n;
    const p = new C4Presenter({
      nowNs: () => nowNs,
      schedule: (fn) => {
        ticks.push(fn);
        return 0;
      },
      cancel: () => {
        cancelled++;
        ticks.length = 0;
      },
      onOutput: (l) => lines.push(l),
    });
    p.handleEvent(event("planted", 10_000_000_000n));
    nowNs = 10_000_000_000n + 42_000_000_000n; // past the 41s fuse
    ticks[0]!();
    expect(p.isCountingDown).toBe(false);
    expect(cancelled).toBe(1);
    // no "0.0s" spam, no "exploded" domain claim
    expect(lines.every((l) => !l.includes("0.0s") && !l.includes("EXPLODED"))).toBe(true);
  });
});
