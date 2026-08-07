import type { C4Observation } from "@roundsense/c4-estimator";
import type { GsiBombState } from "@roundsense/shared-types";
import type { GsiReceipt } from "@roundsense/gsi-protocol";

/**
 * Live GSI receipt → C4Observation. Pure mapping of exactly the fields the
 * C4 state machine consumes (round identity, bomb state, dual-clock times).
 */
export function toC4Observation(receipt: GsiReceipt): C4Observation {
  return {
    seq: receipt.seq,
    roundNumber: receipt.payload.map?.round,
    roundPhase: receipt.payload.round?.phase,
    mapPhase: receipt.payload.map?.phase,
    bomb: (receipt.payload.round?.bomb ?? null) as GsiBombState | null,
    receivedAtMonotonicNs: receipt.receivedAtMonotonicNs,
    receivedAtWallClock: receipt.receivedAtWallClock,
  };
}
