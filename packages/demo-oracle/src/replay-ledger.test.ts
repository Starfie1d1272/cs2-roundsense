/**
 * L4 replay-native cash-transition ledger tests — STRICT attribution.
 * Includes adversarial negative tests: wrong actor, wrong side, wrong
 * window, unknown amounts must ALL fall to unexplained/ambiguous.
 */
import { describe, expect, it } from "vitest";
import { extractTransitions, classifyTransition, summarizeLedger, type RoundEventContext } from "./replay-ledger.js";

const baseCtx = (over: Partial<RoundEventContext> = {}): RoundEventContext => ({
  roundNumber: 5,
  endReason: "ct_win",
  winnerTeamKey: "teamA",
  playerTeamKey: "teamA",
  playerIndex: 2,
  freezeEndTick: 2000,
  endTick: 100000,
  isT: false,
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

describe("classifyTransition — exact events", () => {
  it("win settlement 3250 → round_win_reward (exact)", () => {
    const r = classifyTransition({ tickFrom: 99992, tickTo: 100000, delta: 3250 }, baseCtx());
    expect(r.category).toBe("round_win_reward");
    expect(r.confidence).toBe("exact-settlement");
  });

  it("loss 2400 → loss_bonus (amount = payout table, model-independent)", () => {
    const r = classifyTransition(
      { tickFrom: 99992, tickTo: 100000, delta: 2400 },
      baseCtx({ winnerTeamKey: "teamB" }),
    );
    expect(r.category).toBe("loss_bonus");
  });

  it("kill reward requires EXACT actor: this player's kill + tick + award", () => {
    const r = classifyTransition(
      { tickFrom: 50000, tickTo: 50008, delta: 100 },
      baseCtx({ kills: [{ tick: 50004, killer: 2, victim: 7, weapon: "awp" }] }),
    );
    expect(r.category).toBe("kill_reward");
    expect(r.confidence).toBe("exact-event-match");
  });

  it("TK penalty requires this player's own teamkill", () => {
    const r = classifyTransition(
      { tickFrom: 60000, tickTo: 60008, delta: -300 },
      baseCtx({ myTeamKills: [{ tick: 60004, weapon: "ak47" }] }),
    );
    expect(r.category).toBe("team_kill_penalty");
  });

  it("plant personal requires the planter actor", () => {
    const r = classifyTransition(
      { tickFrom: 50000, tickTo: 50008, delta: 300 },
      baseCtx({ planterIndex: 2 }),
    );
    expect(r.category).toBe("plant_personal");
  });
});

describe("classifyTransition — compounds (exact sums only)", () => {
  it("win + CT shared 3500 → compound_exact (CT side, exact tElim)", () => {
    const r = classifyTransition({ tickFrom: 99992, tickTo: 100000, delta: 3250 + 50 * 5 }, baseCtx());
    expect(r.category).toBe("compound_exact");
    expect(r.confidence).toBe("exact-settlement");
  });

  it("loss + CT shared (CT loses but still gets 50×tElim) → compound_exact", () => {
    const r = classifyTransition(
      { tickFrom: 99992, tickTo: 100000, delta: 1400 + 50 * 3 },
      baseCtx({ winnerTeamKey: "teamB", tEliminated: 3 }),
    );
    expect(r.category).toBe("compound_exact");
  });

  it("win + defuse personal 3800 → compound_exact", () => {
    const r = classifyTransition(
      { tickFrom: 99992, tickTo: 100000, delta: 3500 + 300 },
      baseCtx({ endReason: "bomb_defused" }),
    );
    expect(r.category).toBe("compound_exact");
  });

  it("CT shared as INDEPENDENT jump 250 → ct_shared_reward (CT side, exact)", () => {
    const r = classifyTransition({ tickFrom: 100200, tickTo: 100208, delta: 250 }, baseCtx());
    expect(r.category).toBe("ct_shared_reward");
    expect(r.confidence).toBe("exact-settlement");
  });
});

describe("classifyTransition — buy window", () => {
  it("negative inside buytime → buy_window_transaction", () => {
    const r = classifyTransition({ tickFrom: 3000, tickTo: 3008, delta: -2700 }, baseCtx());
    expect(r.category).toBe("buy_window_transaction");
  });

  it("positive inside buytime → buy_window_transaction (refund/sellback)", () => {
    const r = classifyTransition({ tickFrom: 3000, tickTo: 3008, delta: 200 }, baseCtx());
    expect(r.category).toBe("buy_window_transaction");
  });
});

describe("classifyTransition — adversarial negatives (must NOT be explained)", () => {
  it("WRONG-ACTOR kill: another player's kill → not kill_reward", () => {
    const r = classifyTransition(
      { tickFrom: 50000, tickTo: 50008, delta: 100 },
      baseCtx({ playerIndex: 5, kills: [{ tick: 50004, killer: 2, victim: 7, weapon: "awp" }] }),
    );
    expect(r.category).not.toBe("kill_reward");
    expect(r.category).toBe("unexplained");
  });

  it("T player +250 (CT-shared amount but T side) → NOT ct_shared (falls to ambiguous in settlement window)", () => {
    const r = classifyTransition(
      { tickFrom: 100200, tickTo: 100208, delta: 250 },
      baseCtx({ isT: true, playerTeamKey: "teamB", winnerTeamKey: "teamA" }),
    );
    expect(r.category).not.toBe("ct_shared_reward");
    expect(["sampling_ambiguous", "unexplained"]).toContain(r.category);
  });

  it("CT +50 with tEliminated=5 (amount ≠ 50×5) → NOT ct_shared", () => {
    const r = classifyTransition({ tickFrom: 100200, tickTo: 100208, delta: 50 }, baseCtx({ tEliminated: 5 }));
    expect(r.category).not.toBe("ct_shared_reward");
    expect(["sampling_ambiguous", "unexplained"]).toContain(r.category);
  });

  it("negative OUTSIDE buytime (mid-round) → unexplained", () => {
    const r = classifyTransition({ tickFrom: 60000, tickTo: 60008, delta: -500 }, baseCtx());
    expect(r.category).toBe("unexplained");
  });

  it("positive OUTSIDE settlement/buytime (+777) → unexplained", () => {
    const r = classifyTransition({ tickFrom: 60000, tickTo: 60008, delta: 777 }, baseCtx());
    expect(r.category).toBe("unexplained");
  });

  it("kill with UNKNOWN remainder (awp +987) → NOT compound (no event for rest)", () => {
    const r = classifyTransition(
      { tickFrom: 50000, tickTo: 50008, delta: 1087 },
      baseCtx({ kills: [{ tick: 50004, killer: 2, victim: 7, weapon: "awp" }] }),
    );
    expect(r.category).not.toBe("compound_exact");
    expect(r.category).toBe("unexplained");
  });

  it("plant bonus +300 for a NON-planter → unexplained", () => {
    const r = classifyTransition(
      { tickFrom: 50000, tickTo: 50008, delta: 300 },
      baseCtx({ planterIndex: 7 }), // playerIndex is 2, planter is 7
    );
    expect(r.category).toBe("unexplained");
  });

  it("multi-kill in one sample window sums exactly (300+300=600) → compound_exact", () => {
    const r = classifyTransition(
      { tickFrom: 44080, tickTo: 44088, delta: 600 },
      baseCtx({ kills: [
        { tick: 44086, killer: 2, victim: 3, weapon: "m4a1_silencer" },
        { tick: 44090, killer: 2, victim: 4, weapon: "hegrenade" },
      ] }),
    );
    expect(r.category).toBe("compound_exact");
  });

  it("win + 2 own kills in settlement (3250+300+300=3850) → compound_exact", () => {
    const r = classifyTransition(
      { tickFrom: 99992, tickTo: 100000, delta: 3850 },
      baseCtx({ kills: [
        { tick: 100000, killer: 2, victim: 4, weapon: "m4a1" },
        { tick: 100000, killer: 2, victim: 1, weapon: "m4a1" },
      ] }),
    );
    expect(r.category).toBe("compound_exact");
  });

  it("loss + own kill (1900+300=2200) → compound_exact", () => {
    const r = classifyTransition(
      { tickFrom: 99992, tickTo: 100000, delta: 2200 },
      baseCtx({ winnerTeamKey: "teamB", kills: [{ tick: 100000, killer: 2, victim: 6, weapon: "ak47" }] }),
    );
    expect(r.category).toBe("compound_exact");
  });

  it("CT shared delayed beyond +400 ticks (half-end) still recognized", () => {
    const r = classifyTransition({ tickFrom: 101160, tickTo: 101168, delta: 250 }, baseCtx());
    expect(r.category).toBe("ct_shared_reward");
  });

  it("tail-of-segment (next round's freeze) negative → buy_window_transaction", () => {
    // segmentEndTick = 101670; tail buy zone covers [101670-960-1280, 101670)
    const r = classifyTransition(
      { tickFrom: 101650, tickTo: 101658, delta: -200 },
      baseCtx({ segmentEndTick: 101670 }),
    );
    expect(r.category).toBe("buy_window_transaction");
  });

  it("unknown settlement amount 1375 → sampling_ambiguous (not guessed)", () => {
    const r = classifyTransition(
      { tickFrom: 99992, tickTo: 100000, delta: 1375 },
      baseCtx({ winnerTeamKey: "teamB" }),
    );
    expect(r.category).toBe("sampling_ambiguous");
  });
});

describe("summarizeLedger (strict counting)", () => {
  it("buy-window transactions are NOT exact; only exact/compound count as explained", () => {
    const rows = [
      { category: "round_win_reward" as const, delta: 3250, round: 1, playerIndex: 0 },
      { category: "compound_exact" as const, delta: 3500, round: 1, playerIndex: 0 },
      { category: "buy_window_transaction" as const, delta: -200, round: 1, playerIndex: 0 },
      { category: "sampling_ambiguous" as const, delta: 1375, round: 1, playerIndex: 0 },
      { category: "unexplained" as const, delta: 500, round: 1, playerIndex: 1 },
      { category: "unexplained" as const, delta: 300, round: 2, playerIndex: 1 },
    ];
    const s = summarizeLedger(rows);
    expect(s.transitions).toBe(6);
    expect(s.explainedExact).toBe(1);
    expect(s.compoundExact).toBe(1);
    expect(s.buyWindowTransactions).toBe(1);
    expect(s.samplingAmbiguous).toBe(1);
    expect(s.unexplained).toBe(2);
    expect(s.dollarUnexplained).toBe(800);
    expect(s.playerRoundsWithUnexplained).toBe(2);
  });
});
