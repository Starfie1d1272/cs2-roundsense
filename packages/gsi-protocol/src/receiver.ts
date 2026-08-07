import { createServer, type Server } from "node:http";
import { captureTimestamps } from "./clock.js";
import { gsiPayloadSchema, type GsiPayload } from "./payload.js";
import { tokenMatches } from "./token.js";

/** One accepted GSI payload with dual-clock receive times. */
export interface GsiReceipt {
  /** 0-based, strictly increasing over accepted payloads (same order as onPayload calls). */
  seq: number;
  payload: GsiPayload;
  receivedAtWallClock: string;
  receivedAtMonotonicNs: bigint;
}

export interface GsiReceiverOptions {
  /** If set, the payload `auth.token` must match (constant-time compare). */
  token?: string;
  /** Body size limit in bytes (default 2 MiB). Over-limit requests get 413. */
  maxBodyBytes?: number;
  /** Called once per accepted payload, AFTER the 204 response was issued. */
  onPayload: (receipt: GsiReceipt) => void;
  onReject?: (code: number, reason: string) => void;
}

export interface GsiReceiverHandle {
  server: Server;
  /** Total payloads accepted (2xx). */
  accepted: () => number;
  /** Total rejected requests. */
  rejected: () => number;
  close: () => Promise<void>;
}

export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Generic GSI receiver shared by all live apps (recorder, roundsense).
 *
 * Responsibilities: HTTP POST accept, body limit, JSON parse, token
 * verification (auth.token), schema validation, dual-clock capture, 204/4xx
 * status, accepted/rejected counters, /health endpoint.
 *
 * The receiver does NOT bind a host/port itself — callers own
 * `handle.server.listen(host, port)` (loopback is the caller's decision).
 * Consumer concerns (NDJSON writer, sanitization, console output) stay with
 * the caller via onPayload.
 */
export function createGsiReceiver(options: GsiReceiverOptions): GsiReceiverHandle {
  let acceptedCount = 0;
  let rejectedCount = 0;
  const max = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

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
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > max) {
        aborted = true;
        rejectedCount++;
        options.onReject?.(413, "body too large");
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return; // oversized body was already rejected

      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        rejectedCount++;
        options.onReject?.(400, "invalid JSON");
        res.writeHead(400).end();
        return;
      }

      // token check — against payload auth.token, never the raw body
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

      const { receivedAtWallClock, receivedAtMonotonicNs } = captureTimestamps();
      const seq = acceptedCount;
      acceptedCount++;
      res.writeHead(204).end();
      // Consumer errors are deliberately NOT caught here: a failing onPayload
      // must not be misreported as a client 400 (the response was already 204).
      options.onPayload({ seq, payload: parsed.data, receivedAtWallClock, receivedAtMonotonicNs });
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
