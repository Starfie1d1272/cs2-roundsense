import { createServer, type Server } from "node:http";
import { gsiPayloadSchema, tokenMatches, type GsiPayload } from "@roundsense/gsi-protocol";

export interface RecorderOptions {
  token?: string;
  writer: {
    write(record: {
      receivedAtWallClock: string;
      receivedAtMonotonicNs: string;
      providerTimestamp?: number;
      build?: { providerName?: string; appid?: number; version?: number };
      payload: GsiPayload;
    }): number;
  };
  onRecord?: (seq: number, payload: GsiPayload) => void;
  onReject?: (code: number, reason: string) => void;
  maxBodyBytes?: number;
}

export interface RecorderHandle {
  server: Server;
  /** Total payloads accepted (2xx). */
  accepted: () => number;
  /** Total rejected requests. */
  rejected: () => number;
  close: () => Promise<void>;
}

/**
 * Minimal GSI receiver (P0-A requirements):
 * - listens on 127.0.0.1 only (host is enforced by the caller passing the
 *   loopback address; the server itself binds the given host)
 * - verifies the payload `auth.token` against the configured token
 * - responds 204 as fast as possible on the critical path (record write is
 *   initiated, not awaited)
 * - never records the `auth` block (sanitized before write)
 */
export function createGsiReceiver(options: RecorderOptions): RecorderHandle {
  let acceptedCount = 0;
  let rejectedCount = 0;

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, accepted: acceptedCount, rejected: rejectedCount }));
      return;
    }
    if (req.method !== "POST") {
      rejectedCount++;
      options.onReject?.(405, `method ${req.method}`);
      res.writeHead(405).end();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    const max = options.maxBodyBytes ?? 2 * 1024 * 1024;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        rejectedCount++;
        options.onReject?.(413, "body too large");
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        rejectedCount++;
        options.onReject?.(400, "invalid JSON");
        res.writeHead(400).end();
        return;
      }

      // token check — reject BEFORE any recording (constant-time compare)
      const authToken = (raw as { auth?: { token?: unknown } })?.auth?.token;
      if (options.token && (typeof authToken !== "string" || !tokenMatches(authToken, options.token))) {
        rejectedCount++;
        options.onReject?.(401, "token mismatch");
        res.writeHead(401).end();
        return;
      }

      const parsed = gsiPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        rejectedCount++;
        options.onReject?.(400, "schema violation");
        res.writeHead(400).end();
        return;
      }

      const payload = parsed.data;
      const timestamps = {
        receivedAtWallClock: new Date().toISOString(),
        receivedAtMonotonicNs: process.hrtime.bigint().toString(),
      };

      // 204 FIRST (critical path), record write follows without blocking the response
      res.writeHead(204).end();
      const seq = options.writer.write({
        ...timestamps,
        providerTimestamp: payload.provider?.timestamp,
        build: payload.provider
          ? { providerName: payload.provider.name, appid: payload.provider.appid, version: payload.provider.version }
          : undefined,
        payload: sanitize(payload),
      });
      acceptedCount++;
      options.onRecord?.(seq, payload);
    });
  });

  return {
    server,
    accepted: () => acceptedCount,
    rejected: () => rejectedCount,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function sanitize(payload: GsiPayload): GsiPayload {
  const { auth, ...rest } = payload as GsiPayload & { auth?: unknown };
  void auth;
  return rest;
}
