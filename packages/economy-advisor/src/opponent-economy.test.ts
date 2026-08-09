import { describe, expect, it } from "vitest";
import { encodeOpponentFeatures, OPPONENT_PARITY_FIXTURES } from "./index.js";
import { inferOpponentEconomy, type Fact } from "./policy-v3.js";

const observed = <T>(value: T): Fact<T> => ({ status: "OBSERVED", value, source: "fixture", asOfSeq: 1 });

describe("frozen opponent calibration parity", () => {
  it("matches Python final-fit fixture probabilities and classifications", () => {
    for (const fixture of OPPONENT_PARITY_FIXTURES) {
      const side = fixture.input.opponent_side === "ct" ? "CT" as const : "T" as const;
      const ownScore = 10;
      const score = side === "CT" ? { ct: ownScore + fixture.input.score_diff, t: ownScore } : { ct: ownScore, t: ownScore + fixture.input.score_diff };
      const input = {
        asOfSeq: 1,
        opponentSide: observed(side),
        roundNumber: observed(fixture.input.round_number),
        score: observed(score),
        opponentLossIndex: observed(fixture.input.opponent_loss_index),
      };
      expect(encodeOpponentFeatures(input)).toHaveLength(18);
      const output = inferOpponentEconomy(input);
      expect(output.probability).toBeCloseTo(fixture.probability, 12);
      expect(output.value ?? "UNKNOWN").toBe(fixture.classification);
    }
  });

  it("returns UNKNOWN only when a direct feature is missing", () => {
    const out = inferOpponentEconomy({
      asOfSeq: 1, opponentSide: observed("CT"), roundNumber: observed(1), score: observed({ ct: 3, t: 2 }), opponentLossIndex: observed(1),
    });
    expect(out.status).toBe("UNKNOWN");
  });

  it("does not change classification when FACT history continuity changes", () => {
    const input = { asOfSeq: 1, opponentSide: observed("CT" as const), roundNumber: observed(5), score: observed({ ct: 3, t: 2 }), opponentLossIndex: observed(1) };
    expect(inferOpponentEconomy(input)).toEqual(inferOpponentEconomy({ ...input }));
  });
});
