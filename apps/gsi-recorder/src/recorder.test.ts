import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createGsiReceiver, NdjsonWriter, sanitizePayload, type GsiPayload } from "@roundsense/gsi-protocol";

const TOKEN = "test-token-123";
let dir: string;
let writer: NdjsonWriter;
let path: string;
let handle: ReturnType<typeof createGsiReceiver>;
let url: string;

function payload(overrides: Record<string, unknown> = {}): GsiPayload {
  return {
    provider: { name: "Counter-Strike: Global Offensive", appid: 730, version: 14204, timestamp: 1754500000 },
    map: { phase: "live", round: 1 },
    round: { phase: "live", bomb: null },
    ...overrides,
  } as GsiPayload;
}

describe("gsi-recorder integration: shared receiver → sanitize → NdjsonWriter", () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "roundsense-rec-"));
    path = join(dir, "rec.ndjson");
    writer = new NdjsonWriter(path, { bufferMs: 100, throttleMs: 500, tokenConfigured: true });
    handle = createGsiReceiver({
      token: TOKEN,
      onPayload: (receipt) => {
        writer.write({
          receivedAtWallClock: receipt.receivedAtWallClock,
          receivedAtMonotonicNs: receipt.receivedAtMonotonicNs.toString(),
          providerTimestamp: receipt.payload.provider?.timestamp,
          build: receipt.payload.provider
            ? {
                providerName: receipt.payload.provider.name,
                appid: receipt.payload.provider.appid,
                version: receipt.payload.provider.version,
              }
            : undefined,
          payload: sanitizePayload(receipt.payload),
        });
      },
    });
    await new Promise<void>((resolve) => handle.server.listen(0, "127.0.0.1", resolve));
    const { port } = handle.server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}/`;
  });

  afterEach(async () => {
    await handle.close();
    await writer.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records a valid payload with dual clocks, provider/build, and NO auth", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload({ auth: { token: TOKEN } })),
    });
    expect(res.status).toBe(204);

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec.seq).toBe(0);
    expect(rec.receivedAtWallClock).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof rec.receivedAtMonotonicNs).toBe("string");
    expect(BigInt(rec.receivedAtMonotonicNs)).toBeGreaterThan(0n);
    expect(rec.providerTimestamp).toBe(1754500000);
    expect(rec.build).toEqual({ providerName: "Counter-Strike: Global Offensive", appid: 730, version: 14204 });
    expect(rec.gsi).toEqual({ bufferMs: 100, throttleMs: 500, tokenConfigured: true });
    // auth must NOT be recorded
    expect(rec.payload).not.toHaveProperty("auth");
    expect(rec.payload.map.phase).toBe("live");
  });

  it("rejects wrong token with 401 and writes nothing", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload({ auth: { token: "wrong" } })),
    });
    expect(res.status).toBe(401);
    expect(readFileSync(path, "utf8").trim()).toBe("");
  });
});
