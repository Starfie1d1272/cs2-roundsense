/**
 * L4 replay-native cash-transition ledger tests.
 * Constructed transitions + synthetic round contexts (no corpus needed).
 */
import { describe, expect, it } from "vitest";
import { extractTransitions, classifyTransition, summarizeLedger, type RoundEventContext } from "./replay-ledger.js";

const baseCtx = (over: Partial<RoundEventContext> = {}): RoundEventContext => ({
  roundNumber: 5,
  endReason: "ct_win",
  winnerTeamKey: "teamA",
  playerTeamKey: "teamA",
  endTick: 100000,
  isT: false,
  isOvertimeOpener: false,
  deadAtEnd: true,
  tEliminated: 5,
  plantHappened: false,
  planterIndex: null,
  defuserIndex: null,
  kills: [],
  myTeamKills: [],
  ...over,
});

describe("extractTransitions", () => {
  it("extracts only non-zero frame-to-frame changes", () => {
    const t = extractTransitions([4100, 4100, 3900, 4200, 7450, 7450], 1000, 8);
    expect(t).toEqual([
      { tickFrom: 1008, tickTo: 1016, cashBefore: 4100, cashAfter: 3900, delta: -200 },
      { tickFrom: 1016, tickTo: 1024, cashBefore: 3900, cashAfter: 4200, delta: 300 },
      { tickFrom: 1024, tickTo: 1032, cashBefore: 4200, cashAfter: 7450, delta: 3250 },
    ]);
  });
});

describe("classifyTransition", () => {
  it("win settlement 3250 → round_win_reward (exact)", () => {
    const r = classifyTransition({ tickFrom: 99992, tickTo: 100000, delta: 3250 }, baseCtx());
    expect(r.category).toBe("round_win_reward");
    expect(r.confidence).toBe("exact-settlement");
  });

  it("win + CT shared 3500 → compound (exact composition)", () => {
    const r = classifyTransition({ tickFrom: 99992, tickTo: 100000, delta: 3250 + 50 * 5 }, baseCtx());
    expect(r.category).toBe("compound_transition");
    expect(r.confidence).toBe("exact-settlement");
    expect(r.matchedEvents.join(" ")).toContain("ct-shared");
  });

  it("loss 2400 → loss_bonus (amount = payout table, model-independent)", () => {
    const r = classifyTransition(
      { tickFrom: 99992, tickTo: 100000, delta: 2400 },
      baseCtx({ winnerTeamKey: "teamB" }),
    );
    expect(r.category).toBe("loss_bonus");
  });

  it("T survivor 0 at settlement (no transition — L3) is not misclassified", () => {
    const r = classifyTransition(
      { tickFrom: 99992, tickTo: 100000, delta: 1400 },
      baseCtx({ isT: true, winnerTeamKey: "teamA", playerTeamKey: "teamB", deadAtEnd: false, endReason: "time_ran_out" }),
    );
    // deadAtEnd=false → a 1400 jump would be a violation; classifier still
    // labels the amount per the table but the L3 layer counts violations
    expect(r.category).toBe("loss_bonus");
  });

  it("kill reward: tick match + weapon award (awp 100)", () => {
    const r = classifyTransition(
      { tickFrom: 50000, tickTo: 50008, delta: 100 },
      baseCtx({ kills: [{ tick: 50004, killer: 2, victim: 7, weapon: "awp" }] }),
    );
    expect(r.category).toBe("kill_reward");
    expect(r.confidence).toBe("exact-event-match");
  });

  it("purchase −2700 in buy window → purchase", () => {
    const r = classifyTransition({ tickFrom: 9000, tickTo: 9008, delta: -2700 }, baseCtx());
    expect(r.category).toBe("purchase");
  });

  it("TK penalty −300 at teamkill tick → team_kill_penalty", () => {
    const r = classifyTransition(
      { tickFrom: 60000, tickTo: 60008, delta: -300 },
      baseCtx({ myTeamKills: [{ tick: 60004, weapon: "ak47" }] }),
    );
    expect(r.category).toBe("team_kill_penalty");
  });

  it("OT opener positive jump → economy_reset (server profile)", () => {
    const r = classifyTransition({ tickFrom: 99992, tickTo: 100000, delta: 10000 }, baseCtx({ isOvertimeOpener: true }));
    expect(r.category).toBe("economy_reset");
  });

  it("unexplained settlement amount → sampling_ambiguous, not guessed", () => {
    const r = classifyTransition(
      { tickFrom: 99992, tickTo: 100000, delta: 1375 },
      baseCtx({ winnerTeamKey: "teamB" }),
    );
    expect(r.category).toBe("sampling_ambiguous");
  });

  it("CT shared award as an INDEPENDENT jump (250 = 50×5) → ct_shared_reward", () => {
    const r = classifyTransition({ tickFrom: 100200, tickTo: 100208, delta: 250 }, baseCtx());
    expect(r.category).toBe("ct_shared_reward");
    expect(r.confidence).toBe("exact-settlement");
  });

  it("loss + CT shared (CT loses but still gets 50×tElim) → compound", () => {
    const r = classifyTransition(
      { tickFrom: 99992, tickTo: 100000, delta: 1400 + 50 * 3 },
      baseCtx({ winnerTeamKey: "teamB", playerTeamKey: "teamA", tEliminated: 3 }),
    );
    expect(r.category).toBe("compound_transition");
    expect(r.confidence).toBe("exact-settlement");
  });

  it("win + defuse personal 3800 (3500+300) → compound", () => {
    const r = classifyTransition(
      { tickFrom: 99992, tickTo: 100000, delta: 3500 + 300 },
      baseCtx({ endReason: "bomb_defused" }),
    );
    expect(r.category).toBe("compound_transition");
  });
});

describe("summarizeLedger", () => {
  it("tallies exact / compound / ambiguous / unexplained with dollars", () => {
    const rows = [
      { category: "round_win_reward" as const, delta: 3250, round: 1, playerIndex: 0 },
      { category: "compound_transition" as const, delta: 3500, round: 1, playerIndex: 0 },
      { category: "sampling_ambiguous" as const, delta: 1375, round: 1, playerIndex: 0 },
      { category: "unexplained" as const, delta: 500, round: 1, playerIndex: 1 },
      { category: "unexplained" as const, delta: 300, round: 2, playerIndex: 1 },
    ];
    const s = summarizeLedger(rows);
    expect(s.transitions).toBe(5);
    expect(s.explainedExact).toBe(1);
    expect(s.compoundExplained).toBe(1);
    expect(s.samplingAmbiguous).toBe(1);
    expect(s.unexplained).toBe(2);
    expect(s.dollarUnexplained).toBe(800);
    expect(s.playerRoundsWithUnexplained).toBe(2);
  });
});
