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
        context: observed(fixture.input.round_number === 2 || fixture.input.round_number === 14 ? "POST_PISTOL" as const : "NORMAL" as const),
        history: {
          integrity: "COMPLETE" as const,
          previousWinner: observed(fixture.input.previous_opponent_win ? side : side === "CT" ? "T" as const : "CT" as const),
          previousPlant: observed(fixture.input.previous_plant),
          previousWinStreak: observed(fixture.input.previous_win_streak),
        },
      };
      expect(encodeOpponentFeatures(input)).toHaveLength(26);
      const output = inferOpponentEconomy(input);
      expect(output.probability).toBeCloseTo(fixture.probability, 12);
      expect(output.value ?? "UNKNOWN").toBe(fixture.classification);
    }
  });

  it("returns UNKNOWN if direct or tracked feature completeness is missing", () => {
    const out = inferOpponentEconomy({
      asOfSeq: 1, opponentSide: observed("CT"), roundNumber: observed(5), score: observed({ ct: 3, t: 2 }), opponentLossIndex: observed(1), context: observed("NORMAL"),
      history: { integrity: "PARTIAL" },
    });
    expect(out.status).toBe("UNKNOWN");
  });
});
