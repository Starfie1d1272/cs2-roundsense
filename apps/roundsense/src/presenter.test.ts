import { describe, expect, it } from "vitest";
import { C4Presenter } from "./presenter.js";
import type { C4Event } from "@roundsense/c4-estimator";

const event = (type: C4Event["type"], detectedAt?: bigint): C4Event => ({
  type,
  roundNumber: 3,
  atMonotonicNs: 1_000_000_000n,
  atWallClock: "2026-08-07T00:00:00.000Z",
  ...(detectedAt !== undefined ? { detectedPlantedAtMonotonicNs: detectedAt } : {}),
});

describe("C4Presenter (injectable clock + scheduler)", () => {
  it("reports elapsed time since detection without claiming remaining seconds", () => {
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
    expect(lines[0]).toContain("0.0s since detection; remaining time unknown");
    expect(ticks).toHaveLength(1);

    // no GSI payload arrives; elapsed time remains display-only context
    nowNs = 12_000_000_000n;
    ticks[0]!();
    nowNs = 15_000_000_000n;
    ticks[0]!();
    expect(lines[1]).toContain("2.0s since detection; remaining time unknown");
    expect(lines[2]).toContain("5.0s since detection; remaining time unknown");
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

  it("does not fabricate an outcome after any local elapsed duration", () => {
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
    nowNs = 10_000_000_000n + 42_000_000_000n;
    ticks[0]!();
    expect(p.isCountingDown).toBe(true);
    expect(cancelled).toBe(0);
    expect(lines[lines.length - 1]).toContain("42.0s since detection; remaining time unknown");
    expect(lines.every((l) => !l.includes("EXPLODED"))).toBe(true);
  });
});
