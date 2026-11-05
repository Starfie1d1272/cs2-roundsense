import { afterEach, describe, expect, it } from "vitest";
import { request } from "node:http";
import { startHudService } from "./server.js";
import { DEFAULT_HUD_SETTINGS } from "./model.js";
import { parseHudSettings } from "./settings.js";

const SELF = "76561198000000001";
const data = {
  auth: { token: "test-only" },
  provider: { appid: 730, steamid: SELF },
  map: {
    name: "de_mirage",
    phase: "live",
    mode: "competitive",
    round: 8,
    team_ct: { score: 4, consecutive_round_losses: 1 },
    team_t: { score: 3, consecutive_round_losses: 1 },
  },
  round: { phase: "freezetime" },
  player: {
    steamid: SELF,
    activity: "playing",
    team: "CT",
    state: { money: 3450, armor: 0, helmet: false, defusekit: false },
    weapons: {},
  },
};
const services: Awaited<ReturnType<typeof startHudService>>[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.close()));
});
async function service() {
  const out = await startHudService({
    token: "test-only",
    gsiPort: 0,
    webPort: 0,
  });
  services.push(out);
  return out;
}

describe("HUD real HTTP pipeline", () => {
  it("authenticates GSI and streams derived cards, not the raw token or identity", async () => {
    const s = await service();
    const base = `http://127.0.0.1:${s.webPort}`;
    const rejected = await fetch(`http://127.0.0.1:${s.gsiPort}`, {
      method: "POST",
      body: JSON.stringify({ ...data, auth: { token: "wrong" } }),
    });
    expect(rejected.status).toBe(401);
    expect(s.snapshot().visible).toBe(false);
    const accepted = await fetch(`http://127.0.0.1:${s.gsiPort}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    expect(accepted.status).toBe(204);
    const response = await fetch(base + "/snapshot");
    const text = await response.text();
    expect(text).not.toContain("test-only");
    expect(text).not.toContain(SELF);
    expect(JSON.parse(text).cards).toHaveLength(3);
    const controller = new AbortController();
    const events = await fetch(base + "/events", { signal: controller.signal });
    const reader = events.body!.getReader();
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toContain("data:");
    controller.abort();
    const live = await fetch(`http://127.0.0.1:${s.gsiPort}`, {
      method: "POST",
      body: JSON.stringify({ ...data, round: { phase: "live" } }),
    });
    expect(live.status).toBe(204);
    expect(s.snapshot()).toMatchObject({ visible: false, cards: [] });
  });
  it("allows same-origin settings and rejects external origins and malformed values", async () => {
    const s = await service();
    const base = `http://127.0.0.1:${s.webPort}`;
    const send = (origin: string, body: unknown) =>
      fetch(base + "/settings", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect(
      (await send("https://example.com", DEFAULT_HUD_SETTINGS)).status,
    ).toBe(403);
    expect(
      (await send(base, { ...DEFAULT_HUD_SETTINGS, scale: 100 })).status,
    ).toBe(400);
    expect(
      (await send(base, { ...DEFAULT_HUD_SETTINGS, scale: 1.25 })).status,
    ).toBe(200);
    expect(s.snapshot().settings.scale).toBe(1.25);
  });
  it("rejects DNS-rebinding hostnames and unbounded settings input", async () => {
    const s = await service();
    const code = await new Promise<number>((resolve) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: s.webPort,
          path: "/snapshot",
          headers: { Host: "evil.example" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.end();
    });
    expect(code).toBe(403);
    const base = `http://127.0.0.1:${s.webPort}`;
    const huge = await fetch(base + "/settings", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: " ".repeat(4096),
    });
    expect(huge.status).toBe(413);
  });
  it("rejects missing/extra/nonfinite settings rather than coercing them", () => {
    expect(parseHudSettings(DEFAULT_HUD_SETTINGS)).toEqual(
      DEFAULT_HUD_SETTINGS,
    );
    for (const x of [
      {},
      { ...DEFAULT_HUD_SETTINGS, scale: Infinity },
      { ...DEFAULT_HUD_SETTINGS, scale: "1" },
      { ...DEFAULT_HUD_SETTINGS, mode: "FORCE" },
      { ...DEFAULT_HUD_SETTINGS, position: "center" },
    ])
      expect(parseHudSettings(x)).toBeNull();
  });
});
