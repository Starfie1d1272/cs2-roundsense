import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Constant-time token comparison for GSI auth verification.
 * Both sides are hashed first so timing does not leak token length.
 */
export function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Generate a random 24-char hex token for the GSI cfg `auth` block. */
export function generateToken(bytes = 12): string {
  return randomBytes(bytes).toString("hex");
}
