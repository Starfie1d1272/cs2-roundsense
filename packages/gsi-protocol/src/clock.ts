/**
 * Dual-clock capture for every recorded payload (requirement: NDJSON records
 * both wall-clock and monotonic receive times).
 *
 * - `receivedAtWallClock`: ISO-8601 wall clock (human audit, cross-machine
 *   correlation).
 * - `receivedAtMonotonicNs`: process.hrtime.bigint() — monotonic, immune to
 *   NTP/clock jumps; ALL elapsed-time math in RoundSense uses this.
 */
export interface ReceiveTimestamps {
  receivedAtWallClock: string;
  receivedAtMonotonicNs: bigint;
}

export function captureTimestamps(now = new Date()): ReceiveTimestamps {
  return {
    receivedAtWallClock: now.toISOString(),
    receivedAtMonotonicNs: process.hrtime.bigint(),
  };
}

/** Seconds between two monotonic readings, as a number (for latency math). */
export function monotonicDeltaSec(a: bigint, b: bigint): number {
  return Number(b - a) / 1e9;
}
