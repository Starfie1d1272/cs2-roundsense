/**
 * Synthetic tests for the runtime-audit extractor.
 * GSI NDJSON is constructed inline; no Windows needed.
 */
import { describe, expect, it } from "vitest";
import { parseGsiNdjson, parseConvars, extract, type CellRow } from "./extract-runtime-audit.js";

const NDJSON = [
  '{"receivedAt":1000,"payload":{"map":{"round":1,"team_ct":{"consecutive_round_losses":1},"team_t":{"consecutive_round_losses":0}},"round":{"phase":"live"}}}',
  '{"receivedAt":2000,"payload":{"map":{"round":2,"team_ct":{"consecutive_round_losses":2},"team_t":{"consecutive_round_losses":1}},"round":{"phase":"live"}}}',
  '{"receivedAt":3000,"payload":{"map":{"round":3,"team_ct":{"consecutive_round_losses":3},"team_t":{"consecutive_round_losses":2}},"round":{"phase":"live"}}}',
].join("\n");

const ROUNDS = [
  { roundNumber: 1, endReason: "time_ran_out", winnerTeamKey: "teamA" }, // CT wins
  { roundNumber: 2, endReason: "target_bombed", winnerTeamKey: "teamB" }, // T wins
  { roundNumber: 3, endReason: "ct_win", winnerTeamKey: "teamA" }, // elimination (explicit side)
].map((r) => ({ ...r, winnerTeamKey: r.winnerTeamKey }));

describe("parseGsiNdjson", () => {
  it("reads consecutive_round_losses per round", () => {
    const samples = parseGsiNdjson(NDJSON);
    expect(samples).toHaveLength(3);
    expect(samples[0]!.payload.map!.team_ct!.consecutive_round_losses).toBe(1);
  });
});

describe("extract", () => {
  it("maps win reasons to target sides and reports direct states", () => {
    const cells: CellRow[] = extract(parseGsiNdjson(NDJSON), ROUNDS, null, "CT");
    expect(cells).toHaveLength(3);
    expect(cells[0]!.targetSide).toBe("CT"); // time_ran_out
    expect(cells[0]!.directStateBefore).toBe(1);
    expect(cells[0]!.directStateAfter).toBe(1);
    expect(cells[1]!.targetSide).toBe("T"); // target_bombed
    expect(cells[2]!.targetSide).toBe("CT"); // elimination with explicit side
  });

  it("reports directState null when GSI field absent (NOT direct)", () => {
    const noField = '{"payload":{"map":{"round":1},"round":{"phase":"live"}}}';
    const cells = extract(parseGsiNdjson(noField), ROUNDS.slice(0, 1), null, null);
    expect(cells[0]!.directStateBefore).toBeNull();
  });
});

describe("parseConvars", () => {
  it("parses `name value` dump lines", () => {
    const c = parseConvars("mp_starting_losses 1\nmp_buytime 20\nmp_maxmoney 65535\n");
    expect(c.mp_starting_losses).toBe("1");
    expect(c.mp_buytime).toBe("20");
  });
});
