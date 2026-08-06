import type { GsiBombState } from "@roundsense/shared-types";
import type { C4Observation } from "@roundsense/c4-estimator";
import type { RecordEnvelope } from "@roundsense/gsi-protocol";

/**
 * Normalize one recorded NDJSON envelope into the observation shape consumed
 * by the C4 state machine. Pure mapping — no clocks, no randomness.
 */
export function normalizeRecord(env: RecordEnvelope): C4Observation {
  const p = env.payload;
  return {
    seq: env.seq,
    roundNumber: p.map?.round,
    roundPhase: p.round?.phase,
    mapPhase: p.map?.phase,
    bomb: (p.round?.bomb ?? null) as GsiBombState | null,
    receivedAtMonotonicNs: BigInt(env.receivedAtMonotonicNs),
    receivedAtWallClock: env.receivedAtWallClock,
  };
}
