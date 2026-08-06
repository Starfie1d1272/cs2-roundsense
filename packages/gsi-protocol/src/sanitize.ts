import type { GsiPayload } from "./payload.js";

/**
 * Sanitize a raw GSI payload for local NDJSON recording.
 * - `auth` block is STRIPPED (requirement: 不记录 auth).
 * - Everything else is preserved (local-first research data).
 * Returns a new object; the input is not mutated.
 */
export function sanitizePayload(payload: GsiPayload): GsiPayload {
  const { auth, ...rest } = payload as GsiPayload & { auth?: unknown };
  void auth;
  return rest;
}
