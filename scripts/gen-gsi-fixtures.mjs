#!/usr/bin/env node
/**
 * Deterministic generator for fixtures/gsi/*.ndjson.
 * Run: node scripts/gen-gsi-fixtures.mjs
 * Fixtures are committed so the suite runs offline; regenerate after
 * changing the envelope shape.
 *
 * Each record advances the synthetic monotonic clock by the given delta,
 * so replay exercises real time semantics (dedupe, estimates, resets).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "fixtures", "gsi");
const BASE_MS = Date.parse("2026-08-06T12:00:00.000Z");
const STEAMID = "76561198000000000";

let seq = 0;
let clockMs = 0;

/** Advance the synthetic clock by `deltaMs` and return the new time in ms. */
function advance(deltaMs) {
  clockMs += deltaMs;
  return clockMs;
}

function payload(round, phase, bomb, { mapPhase = "live", money = 3400, roundKills = 0 } = {}) {
  return {
    provider: {
      name: "Counter-Strike: Global Offensive",
      appid: 730,
      version: 14204,
      steamid: STEAMID,
      timestamp: 1754500000 + Math.floor(clockMs / 1000),
    },
    map: { name: "de_mirage", mode: "competitive", phase: mapPhase, round },
    round: { phase, bomb, win_team: null },
    player: {
      steamid: STEAMID,
      name: "research-player",
      team: "T",
      activity: "playing",
      state: {
        health: 100, armor: 100, helmet: true, flashed: 0, smoked: 0, burning: 0,
        money, round_kills: roundKills, round_killhs: 0, equip_value: 4700,
      },
    },
  };
}

/** Append a record after advancing the clock by `deltaMs`. */
function record(deltaMs, round, phase, bomb, opts) {
  advance(deltaMs);
  const env = {
    seq: seq++,
    receivedAtWallClock: new Date(BASE_MS + clockMs).toISOString(),
    receivedAtMonotonicNs: String(clockMs * 1_000_000),
    providerTimestamp: 1754500000 + Math.floor(clockMs / 1000),
    build: { providerName: "Counter-Strike: Global Offensive", appid: 730, version: 14204 },
    gsi: { bufferMs: 100, throttleMs: 500, tokenConfigured: true },
    payload: payload(round, phase, bomb, opts),
  };
  return JSON.stringify(env);
}

function fixture(name, lines) {
  writeFileSync(join(OUT, name), lines.join("\n") + "\n");
  console.log(`✓ ${name} (${lines.length} records)`);
}

mkdirSync(OUT, { recursive: true });

// 1. plant @4s → dups → exploding @44.984s (fuse 41s → end @45s) → round over
seq = 0; clockMs = 0;
fixture("plant-explode.ndjson", [
  record(0, 3, "freezetime", null),
  record(100, 3, "live", null),
  record(3900, 3, "live", "planted", { roundKills: 1 }), // t=4000
  record(16, 3, "live", "planted"),                       // dup
  record(16, 3, "live", "planted"),                       // dup
  record(40952, 3, "live", "exploding"),                  // t=44984 (16ms before 45s fuse end)
  record(66, 3, "over", null),                            // t=45050
]);

// 2. receiver joins mid-round: planted already visible at t=20s
seq = 0; clockMs = 0;
fixture("mid-round-start.ndjson", [
  record(20000, 5, "live", "planted"), // joined late
  record(16, 5, "live", "planted"),    // dup
  record(27984, 5, "over", "defused"), // t=48000
  record(4000, 6, "freezetime", null), // t=52000
]);

// 3. plant @6s → defuse @30s → over
seq = 0; clockMs = 0;
fixture("plant-defuse.ndjson", [
  record(0, 2, "freezetime", null),
  record(100, 2, "live", null),
  record(5900, 2, "live", "planted"), // t=6000
  record(24000, 2, "live", "defused"), // t=30000
  record(100, 2, "over", null),       // t=30100
]);

// 4. dropped @2s → plant @8s → round ends without observed end state
seq = 0; clockMs = 0;
fixture("drop-before-plant.ndjson", [
  record(0, 7, "freezetime", null),
  record(2000, 7, "live", "dropped"),  // t=2000
  record(6000, 7, "live", "planted"),  // t=8000
  record(16, 7, "live", "planted"),    // dup
  record(39984, 7, "over", null),      // t=48000
]);

// 5. missing middle states: defused/exploded payloads never arrived
seq = 0; clockMs = 0;
fixture("missing-middle.ndjson", [
  record(0, 9, "freezetime", null),
  record(100, 9, "live", null),
  record(4900, 9, "live", "planted"), // t=5000
  record(10000, 9, "over", null),     // t=15000 — no bomb state in between
]);

// 6. map change / restart: gameover → warmup → new match
seq = 0; clockMs = 0;
fixture("restart-map.ndjson", [
  record(0, 1, "freezetime", null),
  record(100, 1, "live", null),
  record(4900, 1, "live", "planted"), // t=5000
  record(10000, 1, "over", null),     // t=15000
  record(1000, 1, "over", null, { mapPhase: "gameover" }), // t=16000
  record(4000, 1, "freezetime", null, { mapPhase: "warmup" }), // t=20000
  record(1000, 1, "live", null, { mapPhase: "live" }),     // t=21000
  record(5000, 1, "live", "planted"), // t=26000
  record(14000, 1, "live", "defused"), // t=40000
]);

// 7. pause (timeout) mid-plant preserves state
seq = 0; clockMs = 0;
fixture("pause.ndjson", [
  record(0, 11, "freezetime", null),
  record(100, 11, "live", null),
  record(4900, 11, "live", "planted"), // t=5000
  record(1000, 11, "live", "planted", { mapPhase: "paused" }), // t=6000
  record(1000, 11, "live", "planted", { mapPhase: "live" }),   // t=7000
  record(25000, 11, "over", "defused"), // t=32000
  record(100, 11, "over", null),       // t=32100
]);
