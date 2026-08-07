import { describe, expect, it } from "vitest";
import {
  simulateLossCounts,
  lossBonusPayout,
  nextLossCountAfterWin,
  nextLossCountAfterLoss,
  winTypeOf,
  isEconomyResetRound,
  LOSS_BONUS_CAP,
  payoutTierOf,
  candidateInternalWinDecrement,
} from "./loss-bonus-state.js";

const R = (
  roundNumber: number,
  winnerTeamKey: "teamA" | "teamB",
  endReason: string,
) => ({ roundNumber, winnerTeamKey, endReason });

describe("loss-bonus-state (single source of truth, C2)", () => {
  it("starts each half at count = 1 (mp_starting_losses=1), no pistol special branch", () => {
    // pistol loss r1 → payout 1900 = 1400 + 500×1 automatically
    const sim = simulateLossCounts([
      R(1, "teamA", "t_win"), // teamB loses pistol round
      R(2, "teamA", "target_bombed"), // teamB loses again
      R(3, "teamA", "t_win"),
    ]);
    expect(sim.get(1)!.teamB).toBe(1); // payout 1900
    expect(sim.get(2)!.teamB).toBe(2); // payout 2400
    expect(sim.get(3)!.teamB).toBe(3); // payout 2900
    expect(lossBonusPayout(sim.get(1)!.teamB)).toBe(1900);
    expect(lossBonusPayout(sim.get(2)!.teamB)).toBe(2400);
    expect(lossBonusPayout(sim.get(3)!.teamB)).toBe(2900);
  });

  it("win after capped count decrements by 1 (count-dep)", () => {
    // QF1-m1 r6: bomb_defused win, count 4→3 → next loss pays 2900
    const sim = simulateLossCounts(
      [
        R(1, "teamA", "t_win"),
        R(2, "teamA", "target_bombed"),
        R(3, "teamA", "target_bombed"),
        R(4, "teamA", "t_win"),
        R(5, "teamA", "target_bombed"), // teamB count: 1→2→3→4→4 (capped)
        R(6, "teamB", "bomb_defused"), // teamB wins: 4→3
        R(7, "teamA", "target_bombed"), // teamB loses: pays 2900 (count 3)
      ],
      { winDecrement: "count-dep" },
    );
    expect(sim.get(6)!.teamB).toBe(4); // before the win round
    expect(sim.get(7)!.teamB).toBe(3);
    expect(lossBonusPayout(sim.get(7)!.teamB)).toBe(2900);
  });

  it("win below cap decrements by 2 (count-dep) — qf4-m3 r6: 2→0", () => {
    const sim = simulateLossCounts(
      [
        R(1, "teamA", "t_win"), // teamB 1→2
        R(2, "teamB", "bomb_defused"), // teamB 2→0
        R(3, "teamB", "bomb_defused"), // 0→0
        R(4, "teamA", "target_bombed"), // teamB loses: 0→1
        R(5, "teamA", "target_bombed"), // 1→2
        R(6, "teamB", "bomb_defused"), // win: 2→0
        R(7, "teamA", "target_bombed"), // teamB loses: pays 1400 (count 0)
      ],
      { winDecrement: "count-dep" },
    );
    expect(sim.get(7)!.teamB).toBe(0);
    expect(lossBonusPayout(sim.get(7)!.teamB)).toBe(1400);
  });

  it("time_ran_out win decrements by 2 — QF1-m1 r16: 4→2", () => {
    const sim = simulateLossCounts(
      [
        R(13, "teamA", "t_win"), // teamB pistol loss: 1→2
        R(14, "teamA", "target_bombed"), // 2→3
        R(15, "teamA", "t_win"), // 3→4
        R(16, "teamB", "time_ran_out"), // timeout win: 4→2
        R(17, "teamA", "target_bombed"), // teamB loses: pays 2400 (count 2)
      ],
      { winDecrement: "count-dep" },
    );
    expect(sim.get(16)!.teamB).toBe(4);
    expect(sim.get(17)!.teamB).toBe(2);
    expect(lossBonusPayout(sim.get(17)!.teamB)).toBe(2400);
  });

  it("resets at r13 (second half) and at each OT half opener (r25, r28, …)", () => {
    const sim = simulateLossCounts([
      R(12, "teamB", "bomb_defused"), // teamA loses once before half: count 2
      R(13, "teamA", "t_win"), // half reset → teamB count 1 (pistol loss 1900)
      R(24, "teamB", "bomb_defused"), // teamA loses before OT: count 2
      R(25, "teamA", "t_win"), // OT half reset → teamB count 1
      R(28, "teamA", "t_win"), // second OT half reset → teamB count 1
    ]);
    expect(sim.get(12)!.teamA).toBe(1); // before r12 (half-start count)
    expect(sim.get(13)!.teamB).toBe(1); // half reset → pistol loss pays 1900
    expect(sim.get(24)!.teamA).toBe(0); // r13 win (teamA) dropped its count to 0
    expect(sim.get(25)!.teamB).toBe(1); // OT half reset
    expect(sim.get(28)!.teamB).toBe(1); // second OT half reset
    expect(isEconomyResetRound(13)).toBe(true);
    expect(isEconomyResetRound(25)).toBe(true);
    expect(isEconomyResetRound(28)).toBe(true);
    expect(isEconomyResetRound(27)).toBe(false);
  });

  it("cap is an interval: payout caps at 3400 but internal count keeps semantics", () => {
    expect(nextLossCountAfterLoss(4)).toBe(4);
    expect(lossBonusPayout(4)).toBe(LOSS_BONUS_CAP);
    expect(lossBonusPayout(9)).toBe(LOSS_BONUS_CAP); // [4, ∞) indistinguishable
    expect(nextLossCountAfterWin(4, "elim", { winDecrement: "count-dep" })).toBe(3);
    expect(nextLossCountAfterWin(2, "elim", { winDecrement: "count-dep" })).toBe(0);
  });

  it("winTypeOf maps end reasons", () => {
    expect(winTypeOf({ endReason: "time_ran_out" })).toBe("timeout");
    expect(winTypeOf({ endReason: "target_bombed" })).toBe("bomb");
    expect(winTypeOf({ endReason: "bomb_defused" })).toBe("bomb");
    expect(winTypeOf({ endReason: "t_win" })).toBe("elim");
    expect(winTypeOf({ endReason: "ct_win" })).toBe("elim");
  });
});

describe("payoutTierOf", () => {
  it("maps table payouts to their observable tier", () => {
    expect(payoutTierOf(1400)).toBe(0);
    expect(payoutTierOf(1900)).toBe(1);
    expect(payoutTierOf(2400)).toBe(2);
    expect(payoutTierOf(2900)).toBe(3);
  });

  it("returns null for the capped payout (3400) — NOT a unique tier", () => {
    expect(payoutTierOf(3400)).toBeNull();
  });

  it("throws for non-table payouts", () => {
    expect(() => payoutTierOf(1600)).toThrow();
    expect(() => payoutTierOf(0)).toThrow();
  });
});

describe("candidateInternalWinDecrement (interpretation B)", () => {
  it("derives prevTier + 1 − nextTier under the documented update order", () => {
    expect(candidateInternalWinDecrement(1, 0)).toBe(2);
    expect(candidateInternalWinDecrement(2, 1)).toBe(2);
    expect(candidateInternalWinDecrement(3, 2)).toBe(2);
    expect(candidateInternalWinDecrement(0, 0)).toBe(1); // floor case
  });

  it("is DERIVED, not direct observation: tier drop 1 ≠ internal decrement 1", () => {
    expect(3 - 2).toBe(1); // observed tier drop
    expect(candidateInternalWinDecrement(3, 2)).toBe(2); // internal candidate
  });
});
