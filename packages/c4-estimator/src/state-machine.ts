import type { C4EventType, C4State, GsiBombState } from "@roundsense/shared-types";

/**
 * Normalized observation extracted from a GSI payload (by replay-harness).
 * All timestamps come from the receiver's dual-clock capture.
 */
export interface C4Observation {
  seq: number;
  roundNumber?: number;
  roundPhase?: string;
  mapPhase?: string;
  bomb?: GsiBombState;
  receivedAtMonotonicNs: bigint;
  receivedAtWallClock: string;
}

export interface C4Event {
  type: C4EventType;
  roundNumber: number | null;
  atMonotonicNs: bigint;
  atWallClock: string;
  plantedAtMonotonicNs?: bigint;
  note?: string;
}

export interface C4MachineState {
  state: C4State;
  roundNumber: number | null;
  plantedAtMonotonicNs?: bigint;
  plantedAtWallClock?: string;
  /** True when we have seen enough of this round to trust a planted signal. */
  hasRoundBaseline: boolean;
  /** True when an explosion signal ("exploding"/"exploded") was observed. */
  observedExplosionSignal: boolean;
  /** Observations processed for the current round (baseline witness count). */
  observationsInRound: number;
}

/**
 * C4 fuse state machine.
 *
 * Safety properties (P0-A requirements):
 * 1. Repeated `planted` payloads → exactly ONE planted event (state-driven
 *    dedupe).
 * 2. Receiver started mid-round → first planted observation establishes a
 *    baseline only (PLANTED_UNKNOWN), emits `baseline_only`, never a fake
 *    planted event.
 * 3. Missing intermediate states → no fabrication: round end without an
 *    observed explosion/defuse yields `round_over`, never `exploded`.
 * 4. Restart/pause/map change → safe reset to `idle` on round number change,
 *    `freezetime`, or `map.phase === "gameover"`.
 */
export class C4StateMachine {
  private st: C4MachineState = {
    state: "idle",
    roundNumber: null,
    hasRoundBaseline: false,
    observedExplosionSignal: false,
    observationsInRound: 0,
  };

  /** Events are retained in-process for tests/harness; also passed to listener. */
  readonly events: C4Event[] = [];

  constructor(private readonly onEvent?: (e: C4Event) => void) {}

  get state(): Readonly<C4MachineState> {
    return this.st;
  }

  observe(obs: C4Observation): void {
    // ── 1. Round lifecycle / reset detection ────────────────────────────────
    if (obs.mapPhase === "gameover") {
      this.reset("map gameover", obs);
      return;
    }
    if (
      obs.roundNumber !== undefined &&
      this.st.roundNumber !== null &&
      obs.roundNumber !== this.st.roundNumber
    ) {
      this.reset(`round ${this.st.roundNumber} -> ${obs.roundNumber}`, obs);
      this.st.roundNumber = obs.roundNumber;
      return;
    }
    if (obs.roundNumber !== undefined) this.st.roundNumber = obs.roundNumber;

    // ── 2. Baseline establishment ───────────────────────────────────────────
    // A planted signal is only trusted if we have independent proof the round
    // started before it: freezetime phase, a non-planted bomb state, or any
    // PRIOR observation of the same round (the plant was then witnessed as a
    // transition). Seeing "live" as the very first observation of a round is
    // NOT enough — a receiver joining mid-round sees live + planted with no
    // way to know when the plant happened (requirement: 接收器中途启动不得
    // 生成伪事件).
    if (
      obs.roundNumber !== undefined &&
      this.st.roundNumber === obs.roundNumber &&
      this.st.observationsInRound > 0
    ) {
      this.st.hasRoundBaseline = true;
    }
    if (obs.roundPhase === "freezetime") {
      this.st.hasRoundBaseline = true;
    }
    if (obs.bomb && obs.bomb !== "planted") {
      this.st.hasRoundBaseline = true;
    }
    if (obs.roundNumber !== undefined && this.st.roundNumber === obs.roundNumber) {
      this.st.observationsInRound++;
    }

    // ── 3. Terminal-state no-ops ────────────────────────────────────────────
    if (this.st.state === "defused" || this.st.state === "exploded" || this.st.state === "round_over") {
      if (obs.roundPhase === "freezetime") {
        this.reset("freezetime after terminal state", obs);
      }
      return;
    }

    const bomb = obs.bomb;

    // ── 4. Bomb-state transitions ───────────────────────────────────────────
    if (this.st.state === "idle") {
      if (bomb === "planted") {
        if (this.st.hasRoundBaseline) {
          this.enterPlanted(obs);
        } else {
          // Receiver started mid-round: baseline only, no synthetic event.
          this.st.state = "planted_unknown";
          this.emit({ type: "baseline_only", note: "planted observed without round baseline — suppressed", ...at(obs) }, obs);
        }
      } else if (bomb === "exploding" || bomb === "exploded") {
        // Explosion signal without a tracked plant: cannot reconstruct a
        // planted time; stay idle and record the observation only.
        this.st.observedExplosionSignal = true;
      }
      return;
    }

    if (this.st.state === "planted" || this.st.state === "planted_unknown") {
      if (bomb === "planted") return; // dedupe
      if (bomb === "defused") {
        this.st.state = "defused";
        this.emit(
          { type: "defused", plantedAtMonotonicNs: this.st.plantedAtMonotonicNs, ...at(obs) },
          obs,
        );
        return;
      }
      if (bomb === "exploding" || bomb === "exploded") {
        this.st.observedExplosionSignal = true;
        if (bomb === "exploded") {
          this.st.state = "exploded";
          this.emit(
            { type: "exploded", plantedAtMonotonicNs: this.st.plantedAtMonotonicNs, ...at(obs) },
            obs,
          );
          return;
        }
        return; // "exploding" = imminent, keep waiting for round end
      }
      if (obs.roundPhase === "over") {
        this.st.state = "round_over";
        this.emit(
          {
            type: "round_over",
            plantedAtMonotonicNs: this.st.plantedAtMonotonicNs,
            note: this.st.observedExplosionSignal
              ? "round ended; explosion signal observed earlier"
              : "round ended without observed explosion/defuse — no explosion fabricated",
            ...at(obs),
          },
          obs,
        );
        return;
      }
      if (obs.roundPhase === "freezetime") {
        this.reset("freezetime during planted state", obs);
      }
    }
  }

  private enterPlanted(obs: C4Observation): void {
    this.st.state = "planted";
    this.st.plantedAtMonotonicNs = obs.receivedAtMonotonicNs;
    this.st.plantedAtWallClock = obs.receivedAtWallClock;
    this.emit(
      {
        type: "planted",
        plantedAtMonotonicNs: obs.receivedAtMonotonicNs,
        ...at(obs),
      },
      obs,
    );
  }

  private reset(reason: string, obs: C4Observation): void {
    const wasActive = this.st.state !== "idle";
    this.st = {
      state: "idle",
      roundNumber: obs.roundNumber ?? this.st.roundNumber,
      hasRoundBaseline: false,
      observedExplosionSignal: false,
      observationsInRound: 0,
    };
    if (wasActive) {
      this.emit({ type: "reset", note: reason, ...at(obs) }, obs);
    }
  }

  private emit(e: Omit<C4Event, "roundNumber">, obs: C4Observation): void {
    const event: C4Event = {
      ...e,
      roundNumber: obs.roundNumber ?? this.st.roundNumber,
      atMonotonicNs: obs.receivedAtMonotonicNs,
      atWallClock: obs.receivedAtWallClock,
    };
    this.events.push(event);
    this.onEvent?.(event);
  }
}

function at(obs: C4Observation): Pick<C4Event, "atMonotonicNs" | "atWallClock"> {
  return { atMonotonicNs: obs.receivedAtMonotonicNs, atWallClock: obs.receivedAtWallClock };
}
