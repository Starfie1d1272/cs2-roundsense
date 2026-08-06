/**
 * Guards for the payout-tier interpretation contract.
 *
 * The loss-bonus payout ladder index (tier) must NOT be treated as the
 * internal loss counter: the documented update order (loss → counter+1,
 * win → counter−d, half start 1) shifts the internal state relative to
 * observed payout tiers. These tests pin the naming semantics so future
 * edits cannot silently reintroduce "tier == internal state".
 */
import { describe, expect, it } from "vitest";
import { payoutTierOf, candidateInternalWinDecrement } from "./loss-window-candidates.js";

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
    expect(() => payoutTierOf(1000)).toThrow();
    expect(() => payoutTierOf(0)).toThrow();
  });
});

describe("candidateInternalWinDecrement (interpretation B)", () => {
  it("derives prevTier + 1 − nextTier under the documented update order", () => {
    expect(candidateInternalWinDecrement(1, 0)).toBe(2);
    expect(candidateInternalWinDecrement(2, 1)).toBe(2);
    expect(candidateInternalWinDecrement(3, 2)).toBe(2);
    // tier 0 → internal 1 → any decrement lands at 0 → 1 is the floor case
    expect(candidateInternalWinDecrement(0, 0)).toBe(1);
  });

  it("is DERIVED, not direct observation: a tier drop of 1 does NOT imply an internal decrement of 1", () => {
    // the exact mistake the previous naming invited: 3 → 2 tiers is a drop of
    // 1, but the candidate internal decrement is 3 + 1 − 2 = 2
    const tierDrop = 3 - 2;
    expect(tierDrop).toBe(1);
    expect(candidateInternalWinDecrement(3, 2)).toBe(2);
    expect(tierDrop).not.toBe(candidateInternalWinDecrement(3, 2));
  });
});
