import { unknownTiming, type C4Event } from "@roundsense/c4-estimator";

/**
 * C4 presentation layer: turns state-machine events into console lines and
 * presents the observed bomb state and elapsed time since local detection.
 *
 * Domain truth stays in C4StateMachine: this layer never fabricates a timing
 * estimate or outcome; the real terminal event decides the outcome.
 *
 * The only mutable C4 state here is the timer handle; the detection timestamp
 * is taken from the `planted` event and passed down as an immutable closure
 * argument (never copied into a field).
 */
export interface C4PresenterOptions {
  /** Injectable clock for countdown math (defaults to process.hrtime.bigint). */
  nowNs?: () => bigint;
  /** Injectable interval scheduler for tests (defaults to setInterval). */
  schedule?: (fn: () => void, ms: number) => unknown;
  /** Injectable interval canceller for tests (defaults to clearInterval). */
  cancel?: (handle: unknown) => void;
  onOutput: (line: string) => void;
}

export class C4Presenter {
  private timer: unknown = null;

  constructor(private readonly opts: C4PresenterOptions) {}

  handleEvent(e: C4Event): void {
    if (e.type === "planted" && e.detectedPlantedAtMonotonicNs !== undefined) {
      this.stopTimer(); // clear any previous timer
      const detectedAtNs = e.detectedPlantedAtMonotonicNs;
      this.render(detectedAtNs);
      const schedule = this.opts.schedule ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
      this.timer = schedule(() => this.tick(detectedAtNs), 500);
    } else if (e.type === "baseline_only") {
      this.stopTimer(); // defensive: never keep a timer while joined mid-round
      this.opts.onOutput("C4 PLANTED — remaining time unknown (joined mid-round)");
    } else if (e.type === "defused" || e.type === "exploded" || e.type === "round_over" || e.type === "reset") {
      this.stopTimer();
      if (e.type === "defused" || e.type === "exploded") {
        this.opts.onOutput(`C4 ${e.type.toUpperCase()}`);
      }
    }
  }

  /** Presentation-only state; the authoritative detection anchor lives in the machine. */
  get isCountingDown(): boolean {
    return this.timer !== null;
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      const cancel = this.opts.cancel ?? ((h: unknown) => clearInterval(h as NodeJS.Timeout));
      cancel(this.timer);
      this.timer = null;
    }
  }

  private nowNs(): bigint {
    return this.opts.nowNs ? this.opts.nowNs() : process.hrtime.bigint();
  }

  private render(detectedAtNs: bigint): void {
    const out = unknownTiming(detectedAtNs, this.nowNs());
    this.opts.onOutput(`C4 PLANTED — ${((out.elapsedSinceDetectionMs ?? 0) / 1000).toFixed(1)}s since detection; remaining time unknown`);
  }

  private tick(detectedAtNs: bigint): void {
    this.render(detectedAtNs);
  }
}
