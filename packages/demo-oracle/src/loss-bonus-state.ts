/**
 * SINGLE SOURCE OF TRUTH for the competitive (MR12, bomb defusal) loss-bonus
 * state machine.
 *
 * Confirmed from `gamemode_competitive.cfg` (source_config, local install
 * D:\steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg):
 *
 *   mp_starting_losses 1                    → each half starts at count = 1
 *   cash_team_loser_bonus 1400              → payout base
 *   cash_team_loser_bonus_consecutive_rounds 500 → per-loss increment
 *
 * payout(lossCount) = min(3400, 1400 + 500 × lossCount)
 *
 * State representation:
 *   MODEL layer: scalar 0..4, saturated at 4 per mp_consecutive_loss_max=4
 *   (a MODEL assumption — the scalar is not an epistemic interval).
 *   OBSERVATION layer: payout 3400 is NOT uniquely identifiable to an
 *   internal count (≥4 collapses); payoutTierOf(3400) returns null.
 *   Payouts at 3400 must never be used to infer an exact internal count
 *   (see docs/experiments/loss-counter-runtime.md).
 *
 * Win decrement is UNRESOLVED at rule level (no convar exposes it; game code
 * not public). Final corpus audit (2026-08-06, 202 replay matches, 77 clean
 * L-W-L windows, see docs/experiments/loss-counter-runtime.md):
 *   - observed payout-tier drop across ANY single win (non-cap): 1, all win
 *     types identical (elimination / bomb_defused / target_bombed /
 *     time_ran_out)
 *   - Interpretation B (loss +1 before win): candidate internal decrement
 *     = 2 for all non-cap win types including time_ran_out
 *     (previousLossPayoutTier + 1 − nextLossPayoutTier)
 *   - capped state (count ≥ 4): NO window exists (3400 unidentifiable) —
 *     cap decrement remains runtime-unverified
 * The win decrement model is UNRESOLVED; every cross-win simulation must
 * select a candidate model EXPLICITLY (no hidden default).
 * None is certified without a direct GSI/netvar read (controlled test
 * planned).
 *
 * Half resets: MR12 second half at r13; each OT half every 3 rounds from
 * r25 (r25, r28, r31, …). The reset round's opener ALSO resets economy to
 * $800 — the income-difference ledger must skip those rounds.
 */
import type { ParsedDemoPackage, RoundRow } from "./adapter.js";

export const MP_STARTING_LOSSES = 1;
export const LOSS_BONUS_BASE = 1400;
export const LOSS_BONUS_INCREMENT = 500;
export const LOSS_BONUS_CAP = 3400;
/** MODEL saturation bound (mp_consecutive_loss_max=4). A model assumption:
 * the scalar 4 is NOT an epistemic interval [4,∞) — observationally the
 * 3400 payout only tells you the count is ≥ 4. */
export const CAP_COUNT = 4;

export type LossCount = number; // 0..3 exact under the model; 4 = model saturation

export type WinType = "elim" | "bomb" | "timeout";

export function winTypeOf(round: { endReason: string }): WinType {
  if (round.endReason === "time_ran_out") return "timeout";
  if (round.endReason === "target_bombed" || round.endReason === "bomb_defused") return "bomb";
  return "elim";
}

/** Payout for a loss with the given count (capped at 3400). */
export function lossBonusPayout(count: LossCount | number): number {
  return Math.min(LOSS_BONUS_CAP, LOSS_BONUS_BASE + LOSS_BONUS_INCREMENT * count);
}

export interface LossBonusOptions {
  /**
   * Win decrement model — REQUIRED. UNRESOLVED; corpus hypotheses only.
   *  - "standard-1": win −1 always
   *  - "timeout-2": time_ran_out win −2, others −1
   *  - "count-dep": timeout −2; normal −1 at cap (count ≥ 4), else −2
   *  - "all-2": every win −2
   * Callers must pass it explicitly; there is no default model.
   */
  winDecrement: "standard-1" | "timeout-2" | "count-dep" | "all-2";
  /** rounds at which counters reset to mp_starting_losses (default MR12+OT) */
  resetRounds?: (roundNumber: number) => boolean;
  initialCount?: number;
}

/** Defaults for the SOURCE-VERIFIED primitives only (no win model). */
export const DEFAULT_LOSS_OPTIONS: {
  initialCount: number;
  resetRounds: (halfRound: number) => boolean;
} = {
  initialCount: MP_STARTING_LOSSES,
  resetRounds: (r) => r === 13 || (r >= 25 && (r - 25) % 3 === 0),
};

export function isResetRound(roundNumber: number, resetRounds: (r: number) => boolean): boolean {
  return resetRounds(roundNumber);
}

/**
 * Map a loss payout to its observable ladder tier (1400→0, 1900→1, …).
 * 3400 (the cap) → null: the internal counter is the interval [4, ∞) and is
 * NOT identifiable from payouts. Non-table payouts throw.
 *
 * A tier is the payout ladder index, NOT the internal counter: under the
 * documented update order (loss → counter+1, win → counter−d, half start 1)
 * the internal state at the start of a win round equals the previous loss
 * payout tier + 1 (see candidateInternalWinDecrement).
 */
export function payoutTierOf(payout: number): number | null {
  if (payout === LOSS_BONUS_CAP) return null; // observationally unidentifiable
  const tier = (payout - LOSS_BONUS_BASE) / LOSS_BONUS_INCREMENT;
  if (!Number.isInteger(tier) || tier < 0) throw new Error(`non-table loss payout: ${payout}`);
  return tier;
}

/**
 * Interpretation B (corpus audit 2026-08-06): under the documented update
 * order, the internal win decrement candidate implied by two observed
 * payout tiers is prevTier + 1 − nextTier. DERIVED — only a direct
 * GSI/netvar counter read can confirm the actual internal state.
 */
export function candidateInternalWinDecrement(prevTier: number, nextTier: number): number {
  return prevTier + 1 - nextTier;
}

/** Advance the counter after one round for the winning team. */
export function nextLossCountAfterWin(prev: LossCount, winType: WinType, opts: LossBonusOptions): LossCount {
  const model = opts.winDecrement;
  let dec: number;
  switch (model) {
    case "standard-1":
      dec = 1;
      break;
    case "timeout-2":
      dec = winType === "timeout" ? 2 : 1;
      break;
    case "count-dep":
      dec = winType === "timeout" ? 2 : prev >= CAP_COUNT ? 1 : 2;
      break;
    case "all-2":
      dec = 2;
      break;
  }
  return Math.max(0, prev - dec);
}

/** Advance the counter after one round for the losing team. */
export function nextLossCountAfterLoss(prev: LossCount): LossCount {
  return Math.min(CAP_COUNT, prev + 1);
}

export interface LossCountsAtRound {
  teamA: LossCount;
  teamB: LossCount;
}

/**
 * Simulate the loss counter across a round sequence (rounds must be sorted).
 * Returns the counter state AT THE START of each round (i.e. the value used
 * for that round's payout when the team loses).
 */
export function simulateLossCounts(
  rounds: readonly { roundNumber: number; winnerTeamKey: string; endReason: string }[],
  opts: LossBonusOptions,
): Map<number, LossCountsAtRound> {
  const resetRounds = opts.resetRounds ?? DEFAULT_LOSS_OPTIONS.resetRounds;
  const initial = opts.initialCount ?? DEFAULT_LOSS_OPTIONS.initialCount;
  const out = new Map<number, LossCountsAtRound>();
  let state = { teamA: initial, teamB: initial };
  for (const round of rounds) {
    if (resetRounds(round.roundNumber)) state = { teamA: initial, teamB: initial };
    out.set(round.roundNumber, { ...state });
    const wt = winTypeOf(round);
    if (round.winnerTeamKey === "teamA") {
      state.teamA = nextLossCountAfterWin(state.teamA, wt, opts);
      state.teamB = nextLossCountAfterLoss(state.teamB);
    } else {
      state.teamB = nextLossCountAfterWin(state.teamB, wt, opts);
      state.teamA = nextLossCountAfterLoss(state.teamA);
    }
  }
  return out;
}

/** Demo-package convenience wrapper. The win-decrement model is REQUIRED. */
export function lossCountsForPackage(pkg: ParsedDemoPackage, opts: LossBonusOptions): Map<number, LossCountsAtRound> {
  const rounds = [...pkg.files.rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  return simulateLossCounts(rounds, opts);
}

/** Round opener whose startMoney is a reset (economy back to $800) — the
 * income-difference ledger must skip these rounds. */
export function isEconomyResetRound(roundNumber: number): boolean {
  return roundNumber === 13 || (roundNumber >= 25 && (roundNumber - 25) % 3 === 0);
}

export type { RoundRow };
