/**
 * Round-scoped automatic-decision snapshot.
 *
 * This is deliberately separate from PolicyStateTracker: the latter owns the
 * continually observed GSI facts used to execute a buy, while this class owns
 * the one state from which automatic economic intent is decided.  A normal
 * GSI first-freezetime receipt is only an unverified candidate; Windows
 * calibration is required before it can ever be treated as pre-decision fact.
 */
import type { PolicyV3State } from "@roundsense/economy-advisor";
import type { GsiPayload } from "@roundsense/gsi-protocol";

export interface DecisionRoundKey {
  mapName: string;
  roundNumber: number;
  side: "CT" | "T";
}

export type DecisionSnapshot =
  | {
      /** Reserved for a future Windows-validated source; no current code emits it. */
      status: "VERIFIED_PREDECISION";
      key: DecisionRoundKey;
      receiptSeq: number;
      state: PolicyV3State;
    }
  | {
      status: "UNVERIFIED_FIRST_FREEZE";
      key: DecisionRoundKey;
      receiptSeq: number;
      /** Never expose this as a verified round-start balance or spend ledger. */
      state: PolicyV3State;
    }
  | {
      status: "UNAVAILABLE";
      key: DecisionRoundKey | null;
      reason: "NOT_FREEZETIME" | "MISSING_DECISION_FACTS" | "SEQUENCE_GAP" | "ROUND_RESTART" | "MISSING_ROUND_IDENTITY";
    };

function keyFrom(payload: GsiPayload): DecisionRoundKey | null {
  const mapName = payload.map?.name;
  const roundNumber = payload.map?.round;
  const side = payload.player?.team;
  return mapName && roundNumber !== undefined && (side === "CT" || side === "T")
    ? { mapName, roundNumber, side }
    : null;
}

function sameRound(a: DecisionRoundKey, b: DecisionRoundKey): boolean {
  return a.mapName === b.mapName && a.roundNumber === b.roundNumber && a.side === b.side;
}

/**
 * Captures at most one automatic-decision input per observed round.  It never
 * reconstructs an unobserved round start: a same-round receipt gap, restart,
 * or missing identity invalidates the snapshot until a new round is observed.
 */
export class RoundDecisionState {
  private lastSeq: number | null = null;
  private currentRound: DecisionRoundKey | null = null;
  private snapshot: DecisionSnapshot = { status: "UNAVAILABLE", key: null, reason: "NOT_FREEZETIME" };

  observe(payload: GsiPayload, seq: number, liveState: PolicyV3State): DecisionSnapshot {
    const key = keyFrom(payload);
    const sequenceGap = this.lastSeq !== null && seq !== this.lastSeq + 1;
    const restart = key !== null && this.currentRound !== null && key.mapName === this.currentRound.mapName && key.roundNumber < this.currentRound.roundNumber;

    let canCapture = false;
    if (key === null) {
      this.snapshot = { status: "UNAVAILABLE", key: null, reason: "MISSING_ROUND_IDENTITY" };
      this.currentRound = null;
    } else if (restart) {
      this.currentRound = key;
      this.snapshot = { status: "UNAVAILABLE", key, reason: "ROUND_RESTART" };
    } else if (this.currentRound === null || !sameRound(this.currentRound, key)) {
      this.currentRound = key;
      this.snapshot = { status: "UNAVAILABLE", key, reason: "NOT_FREEZETIME" };
      canCapture = true;
    }

    if (sequenceGap && !canCapture && key !== null && this.currentRound !== null && sameRound(this.currentRound, key)) {
      this.snapshot = { status: "UNAVAILABLE", key, reason: "SEQUENCE_GAP" };
    }

    if (key !== null && canCapture && this.snapshot.status === "UNAVAILABLE" && this.snapshot.reason === "NOT_FREEZETIME") {
      if (payload.round?.phase !== "freezetime") {
        // A receiver joining mid-round cannot synthesize a pre-decision state.
      } else if (
        liveState.player.money.status !== "UNKNOWN" &&
        liveState.player.inventory.status !== "UNKNOWN" &&
        liveState.player.lossIndex.status !== "UNKNOWN" &&
        liveState.round.side.status !== "UNKNOWN"
      ) {
        this.snapshot = {
          status: "UNVERIFIED_FIRST_FREEZE",
          key,
          receiptSeq: seq,
          state: structuredClone(liveState),
        };
      } else {
        this.snapshot = { status: "UNAVAILABLE", key, reason: "MISSING_DECISION_FACTS" };
      }
    }

    this.lastSeq = seq;
    return this.snapshot;
  }
}
