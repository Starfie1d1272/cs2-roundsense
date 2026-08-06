import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gsiPayloadSchema,
  isBombPlanted,
  renderGsiCfg,
  NORMAL_PLAYER_COMPONENTS,
  gsiCfgFileName,
  tokenMatches,
  generateToken,
  captureTimestamps,
  monotonicDeltaSec,
  sanitizePayload,
  NdjsonWriter,
} from "./index.js";

describe("payload schema", () => {
  it("accepts a realistic CS2 GSI payload (normal player)", () => {
    const raw = {
      provider: { name: "Counter-Strike: Global Offensive", appid: 730, version: 14204, steamid: "76561198000000000", timestamp: 1754500000 },
      map: { name: "de_mirage", mode: "competitive", phase: "live", round: 7, team_ct: { score: 3, consecutive_round_losses: 0 }, team_t: { score: 3, consecutive_round_losses: 2 } },
      round: { phase: "live", bomb: "planted", win_team: null },
      player: {
        steamid: "76561198000000000", name: "test", team: "T", activity: "playing",
        state: { health: 100, armor: 100, helmet: true, flashed: 0, smoked: 0, burning: 0, money: 4250, round_kills: 2, round_killhs: 1, equip_value: 4700 },
        weapons: { weapon_0: { name: "weapon_ak47", type: "Rifle", ammo_clip: 30, ammo_reserve: 90, state: "active", equipped: true } },
        match_stats: { kills: 14, assists: 3, deaths: 9, mvps: 2, score: 40 },
      },
      auth: { token: "secret-token" },
    };
    const parsed = gsiPayloadSchema.parse(raw);
    expect(parsed.map?.mode).toBe("competitive");
    expect(parsed.player?.state?.money).toBe(4250);
    expect(parsed.player?.weapons?.weapon_0?.name).toBe("weapon_ak47");
    expect(isBombPlanted(parsed)).toBe(true);
  });

  it("rejects non-object payloads", () => {
    expect(() => gsiPayloadSchema.parse("garbage")).toThrow();
  });

  it("accepts empty/partial payloads (degrade gracefully)", () => {
    const parsed = gsiPayloadSchema.parse({});
    expect(parsed.round).toBeUndefined();
    expect(isBombPlanted(parsed)).toBe(false);
  });
});

describe("cfg generation", () => {
  it("renders a BOM-free cfg with all normal-player components", () => {
    const cfg = renderGsiCfg({ uri: "http://127.0.0.1:3000/", buffer: 0.1, throttle: 0.5, token: "abc123" });
    expect(cfg.charCodeAt(0)).not.toBe(0xfeff); // no BOM (A8)
    expect(cfg).toContain('"uri" "http://127.0.0.1:3000/"');
    expect(cfg).toContain('"buffer" "0.1"');
    expect(cfg).toContain('"throttle" "0.5"');
    expect(cfg).toContain('"token" "abc123"');
    for (const c of NORMAL_PLAYER_COMPONENTS) expect(cfg).toContain(`"${c}"`);
    // spectator-only components must NOT be requested (A2)
    for (const c of ["phase_countdowns", "allplayers_id", '"bomb"']) {
      expect(cfg).not.toContain(c);
    }
  });

  it("applies defaults when options are omitted", () => {
    const cfg = renderGsiCfg({ uri: "http://127.0.0.1:3000/" });
    expect(cfg).toContain('"buffer" "0.1"');
    expect(cfg).toContain('"throttle" "1.0"');
    expect(cfg).toContain('"timeout" "1.1"');
    expect(cfg).toContain('"heartbeat" "60.0"');
    expect(gsiCfgFileName()).toBe("gamestate_integration_roundsense.cfg");
  });
});

describe("token", () => {
  it("matches equal tokens and rejects different ones", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", "abd")).toBe(false);
    expect(tokenMatches("abc", "abcd")).toBe(false);
  });
  it("generates a hex token of expected length", () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("clock", () => {
  it("captures wall + monotonic timestamps, monotonic increases", () => {
    const a = captureTimestamps();
    const b = captureTimestamps();
    expect(a.receivedAtWallClock).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(a.receivedAtMonotonicNs).toBeTypeOf("bigint");
    expect(Number(b.receivedAtMonotonicNs)).toBeGreaterThanOrEqual(Number(a.receivedAtMonotonicNs));
    expect(monotonicDeltaSec(a.receivedAtMonotonicNs, b.receivedAtMonotonicNs)).toBeGreaterThanOrEqual(0);
  });
});

describe("sanitize", () => {
  it("strips the auth block, preserves the rest", () => {
    const raw = { provider: { name: "x" }, auth: { token: "secret" }, map: { phase: "live" } } as never;
    const out = sanitizePayload(raw);
    expect(out).not.toHaveProperty("auth");
    expect((out as Record<string, unknown>).provider).toBeDefined();
  });
});

describe("ndjson writer", () => {
  it("appends envelope lines with seq and gsi params", async () => {
    const dir = mkdtempSync(join(tmpdir(), "roundsense-"));
    const path = join(dir, "rec.ndjson");
    const w = new NdjsonWriter(path, { bufferMs: 100, throttleMs: 500, tokenConfigured: true });
    const s1 = w.write({ receivedAtWallClock: "2026-08-06T00:00:00.000Z", receivedAtMonotonicNs: "1000", payload: { map: { phase: "live" } } });
    const s2 = w.write({ receivedAtWallClock: "2026-08-06T00:00:01.000Z", receivedAtMonotonicNs: "2000", payload: {} });
    await w.close();
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!);
    expect(first.seq).toBe(0);
    expect(first.gsi).toEqual({ bufferMs: 100, throttleMs: 500, tokenConfigured: true });
    expect(first.payload.map.phase).toBe("live");
    expect(s1).toBe(0);
    expect(s2).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
