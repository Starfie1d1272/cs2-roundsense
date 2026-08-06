import { describe, expect, it } from "vitest";
import { replayNdjsonFile, replayRecords, fixturePath } from "./harness.js";
import type { RecordEnvelope } from "@roundsense/gsi-protocol";

const FIXTURES = [
  "plant-explode.ndjson",
  "mid-round-start.ndjson",
  "plant-defuse.ndjson",
  "drop-before-plant.ndjson",
  "missing-middle.ndjson",
  "restart-map.ndjson",
  "pause.ndjson",
];

describe("replay harness — deterministic", () => {
  it("replays every committed fixture without throwing", async () => {
    for (const name of FIXTURES) {
      const result = await replayNdjsonFile(fixturePath(name));
      expect(result.recordCount).toBeGreaterThan(0);
      expect(result.events).toBeInstanceOf(Array);
    }
  });

  it("same fixture twice → identical results (determinism)", async () => {
    for (const name of FIXTURES) {
      const a = await replayNdjsonFile(fixturePath(name));
      const b = await replayNdjsonFile(fixturePath(name));
      const serialize = (_k: string, v: unknown): unknown => (typeof v === "bigint" ? v.toString() : v);
      expect(JSON.stringify(a, serialize)).toBe(JSON.stringify(b, serialize));
    }
  });

  it("plant-explode: exactly one planted event despite duplicates", async () => {
    const result = await replayNdjsonFile(fixturePath("plant-explode.ndjson"));
    expect(result.counts.planted).toBe(1);
    expect(result.counts.round_over).toBe(1);
    expect(result.counts.exploded).toBeUndefined(); // "exploding" ≠ fabrication
    expect(result.finalState.state).toBe("round_over");
  });

  it("mid-round-start: baseline only, no planted event (restart safety)", async () => {
    const result = await replayNdjsonFile(fixturePath("mid-round-start.ndjson"));
    expect(result.counts.planted).toBeUndefined();
    expect(result.counts.baseline_only).toBe(1);
    expect(result.counts.defused).toBe(1);
    expect(result.counts.reset).toBe(1);
    expect(result.finalState.state).toBe("idle");
  });

  it("missing-middle: round_over without fabricated explosion", async () => {
    const result = await replayNdjsonFile(fixturePath("missing-middle.ndjson"));
    expect(result.counts.planted).toBe(1);
    expect(result.counts.round_over).toBe(1);
    expect(result.counts.exploded).toBeUndefined();
    expect(result.counts.defused).toBeUndefined();
  });

  it("restart-map: gameover resets, new match starts clean", async () => {
    const result = await replayNdjsonFile(fixturePath("restart-map.ndjson"));
    expect(result.counts.planted).toBe(2);
    expect(result.counts.reset).toBe(1);
    expect(result.counts.defused).toBe(1);
    expect(result.finalState.state).toBe("defused");
  });

  it("pause: state preserved through paused map phase", async () => {
    const result = await replayNdjsonFile(fixturePath("pause.ndjson"));
    expect(result.counts.planted).toBe(1);
    expect(result.counts.defused).toBe(1);
    expect(result.finalState.state).toBe("defused");
  });

  it("handles empty lines gracefully", () => {
    const env = (): RecordEnvelope => ({
      seq: 0,
      receivedAtWallClock: "2026-08-06T12:00:00.000Z",
      receivedAtMonotonicNs: "1000000",
      gsi: { bufferMs: 100, throttleMs: 500, tokenConfigured: true },
      payload: {},
    });
    const result = replayRecords([env(), env(), env()]);
    expect(result.recordCount).toBe(3);
    expect(result.events).toHaveLength(0);
  });
});
