import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createGsiReceiver, type GsiReceipt } from "./receiver.js";
import type { GsiPayload } from "./payload.js";

const TOKEN = "test-token-123";
let received: GsiReceipt[] = [];
let rejections: { code: number; reason: string }[] = [];

function payload(overrides: Record<string, unknown> = {}): GsiPayload {
  return {
    provider: { name: "Counter-Strike: Global Offensive", appid: 730, version: 14204, timestamp: 1754500000 },
    map: { phase: "live", round: 1 },
    round: { phase: "live", bomb: null },
    ...overrides,
  } as GsiPayload;
}

async function post(url: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

describe("gsi-protocol receiver", () => {
  let handle: ReturnType<typeof createGsiReceiver>;
  let url: string;

  beforeEach(async () => {
    received = [];
    rejections = [];
    handle = createGsiReceiver({
      token: TOKEN,
      onPayload: (r) => received.push(r),
      onReject: (code, reason) => rejections.push({ code, reason }),
    });
    await new Promise<void>((resolve) => handle.server.listen(0, "127.0.0.1", resolve));
    const { port } = handle.server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}/`;
  });

  afterEach(async () => {
    await handle.close();
  });

  it("accepts a valid payload with 204 and a dual-clock receipt", async () => {
    const res = await post(url, payload({ auth: { token: TOKEN } }));
    expect(res.status).toBe(204);
    expect(handle.accepted()).toBe(1);
    expect(handle.rejected()).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0]!.seq).toBe(0);
    expect(received[0]!.receivedAtWallClock).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(received[0]!.receivedAtMonotonicNs).toBeGreaterThan(0n);
    expect(received[0]!.payload.map?.phase).toBe("live");
  });

  it("assigns strictly increasing seq 0,1,2 for consecutive accepted payloads", async () => {
    await post(url, payload({ auth: { token: TOKEN } }));
    await post(url, payload({ auth: { token: TOKEN } }));
    await post(url, payload({ auth: { token: TOKEN } }));
    expect(received.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(handle.accepted()).toBe(3);
  });

  it("rejects a wrong token with 401 and does not call onPayload", async () => {
    const res = await post(url, payload({ auth: { token: "wrong" } }));
    expect(res.status).toBe(401);
    expect(handle.rejected()).toBe(1);
    expect(received).toHaveLength(0);
    expect(rejections).toEqual([{ code: 401, reason: "token mismatch" }]);
  });

  it("rejects a missing token with 401 when a token is configured", async () => {
    const res = await post(url, payload()); // no auth block at all
    expect(res.status).toBe(401);
    expect(handle.rejected()).toBe(1);
    expect(received).toHaveLength(0);
  });

  it("accepts payloads without auth when no token is configured", async () => {
    const open = createGsiReceiver({ onPayload: (r) => received.push(r) });
    await new Promise<void>((resolve) => open.server.listen(0, "127.0.0.1", resolve));
    const { port } = open.server.address() as AddressInfo;
    try {
      const res = await post(`http://127.0.0.1:${port}/`, payload());
      expect(res.status).toBe(204);
      expect(open.accepted()).toBe(1);
    } finally {
      await open.close();
    }
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await post(url, "{not json");
    expect(res.status).toBe(400);
    expect(handle.rejected()).toBe(1);
    expect(received).toHaveLength(0);
  });

  it("rejects valid JSON but schema-violating payload with 400", async () => {
    const res = await post(url, { auth: { token: TOKEN }, provider: { name: 123 } }); // name must be string
    expect(res.status).toBe(400);
    expect(handle.rejected()).toBe(1);
    expect(received).toHaveLength(0);
  });

  it("rejects an oversized body with 413 and never calls onPayload", async () => {
    const big = payload({ auth: { token: TOKEN }, bloat: "x".repeat(100) });
    const body = JSON.stringify(big);
    const res = await fetch(url, { method: "POST", body: body + "x".repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(handle.rejected()).toBe(1);
    expect(received).toHaveLength(0);
    expect(rejections.some((r) => r.code === 413)).toBe(true);
  });

  it("rejects GET on the receiver path with 405", async () => {
    const res = await fetch(url);
    expect(res.status).toBe(405);
    expect(handle.rejected()).toBe(1);
  });

  it("serves /health with counters", async () => {
    await post(url, payload({ auth: { token: TOKEN } }));
    await post(url, payload({ auth: { token: "bad" } }));
    const res = await fetch(url + "health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; accepted: number; rejected: number };
    expect(body).toEqual({ ok: true, accepted: 1, rejected: 1 });
  });
});
