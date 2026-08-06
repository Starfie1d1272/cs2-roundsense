import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { NdjsonWriter, type GsiPayload } from "@roundsense/gsi-protocol";
import { createGsiReceiver } from "./server.js";

const TOKEN = "test-token-123";
let dir: string;
let writer: NdjsonWriter;
let path: string;

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

describe("gsi-recorder server", () => {
  let server: ReturnType<typeof createGsiReceiver>;
  let url: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "roundsense-rec-"));
    path = join(dir, "rec.ndjson");
    writer = new NdjsonWriter(path, { bufferMs: 100, throttleMs: 500, tokenConfigured: true });
    server = createGsiReceiver({ token: TOKEN, writer });
    await new Promise<void>((resolve) => server.server.listen(0, "127.0.0.1", resolve));
    const { port } = server.server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}/`;
  });

  afterEach(async () => {
    await server.close();
    await writer.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records a valid payload with dual clock times and returns 204", async () => {
    const res = await post(url, payload({ auth: { token: TOKEN } }));
    expect(res.status).toBe(204);
    expect(server.accepted()).toBe(1);
    expect(server.rejected()).toBe(0);

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec.receivedAtWallClock).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof rec.receivedAtMonotonicNs).toBe("string");
    expect(BigInt(rec.receivedAtMonotonicNs)).toBeGreaterThan(0n);
    expect(rec.providerTimestamp).toBe(1754500000);
    expect(rec.gsi).toEqual({ bufferMs: 100, throttleMs: 500, tokenConfigured: true });
    // auth must NOT be recorded
    expect(rec.payload).not.toHaveProperty("auth");
    expect(rec.payload.map.phase).toBe("live");
  });

  it("rejects wrong token with 401 and records nothing", async () => {
    const res = await post(url, payload({ auth: { token: "wrong" } }));
    expect(res.status).toBe(401);
    expect(server.rejected()).toBe(1);
    expect(readFileSync(path, "utf8").trim()).toBe("");
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await post(url, "{not json");
    expect(res.status).toBe(400);
    expect(server.rejected()).toBe(1);
  });

  it("rejects GET on the receiver path with 405", async () => {
    const res = await fetch(url);
    expect(res.status).toBe(405);
  });

  it("serves /health with counters", async () => {
    await post(url, payload({ auth: { token: TOKEN } }));
    const res = await fetch(url + "health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; accepted: number };
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(1);
  });
});
