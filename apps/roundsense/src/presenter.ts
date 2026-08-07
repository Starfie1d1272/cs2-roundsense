import { estimateRemainingDefault, type C4Event } from "@roundsense/c4-estimator";

/**
 * C4 presentation layer: turns state-machine events into console lines and
 * drives a LOCAL countdown timer (0.5 s tick) using the plantedAt monotonic
 * timestamp — GSI payload gaps (even 30 s) do not pause the countdown.
 *
 * Domain truth stays in C4StateMachine: this layer never fabricates an
 * outcome. When the local estimate reaches zero the interval stops (no
 * endless "0.0s" spam) and the real terminal event decides the outcome.
 *
 * The only mutable C4 state here is the timer handle; plantedAtMonotonicNs
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
    if (e.type === "planted" && e.plantedAtMonotonicNs !== undefined) {
      this.stopTimer(); // clear any previous timer
      const plantedAtNs = e.plantedAtMonotonicNs;
      this.render(plantedAtNs);
      const schedule = this.opts.schedule ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
      this.timer = schedule(() => this.tick(plantedAtNs), 500);
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

  /** Presentation-only state; the authoritative plantedAt lives in the machine. */
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

  private render(plantedAtNs: bigint): void {
    const out = estimateRemainingDefault(plantedAtNs, this.nowNs());
    this.opts.onOutput(`C4 PLANTED — ${(Math.max(0, out.remainingMs) / 1000).toFixed(1)}s remaining`);
  }

  private tick(plantedAtNs: bigint): void {
    const out = estimateRemainingDefault(plantedAtNs, this.nowNs());
    if (out.remainingMs <= 0) {
      // local estimate hit zero: stop refreshing; do NOT print "exploded" as
      // a domain fact — the real GSI terminal event decides the outcome.
      this.stopTimer();
      return;
    }
    this.opts.onOutput(`C4 PLANTED — ${(out.remainingMs / 1000).toFixed(1)}s remaining`);
  }
}
