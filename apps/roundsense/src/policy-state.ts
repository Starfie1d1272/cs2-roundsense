import {
  inferOpponentEconomy,
  type Fact,
  type OpponentEconomyClass,
  type InventoryState,
  type PolicyV3State,
  type RoundContext,
  type RoundHistoryFact,
  type UserPreference,
} from "@roundsense/economy-advisor";
import type { GsiPayload } from "@roundsense/gsi-protocol";
import type { Side } from "@roundsense/shared-types";
import { inventoryFrom } from "./inventory.js";

const DEFAULT_PREFERENCE: UserPreference = { source: "DEFAULT", awpPriority: "NEUTRAL" };

function observed<T>(value: T | undefined, source: string, seq: number): Fact<T> {
  return value === undefined ? { status: "UNKNOWN", source, asOfSeq: seq, reason: "missing from normal-player GSI" } : { status: "OBSERVED", value, source, asOfSeq: seq };
}

function tracked<T>(value: T, source: string, seq: number): Fact<T> {
  return { status: "TRACKED", value, source, asOfSeq: seq };
}

function unknown<T>(source: string, seq: number, reason: string): Fact<T> {
  return { status: "UNKNOWN", source, asOfSeq: seq, reason };
}

function side(value: string | undefined, seq: number): Fact<Side> {
  return value === "CT" || value === "T" ? observed<Side>(value, "player.team", seq) : unknown("player.team", seq, "missing or non-player team");
}

function winner(value: string | null | undefined, seq: number): Fact<Side> {
  return value === "CT" || value === "T" ? observed<Side>(value, "round.win_team", seq) : unknown("round.win_team", seq, "terminal winner missing");
}

function roundContext(round: number | undefined, seq: number): Fact<RoundContext> {
  if (round === undefined) return unknown("map.round", seq, "round identity unavailable");
  if (round > 24) return observed("OVERTIME", "map.round", seq);
  const inHalf = round > 12 ? round - 12 : round;
  return observed(inHalf === 1 ? "PISTOL" : inHalf === 2 ? "POST_PISTOL" : "NORMAL", "map.round", seq);
}

/** Session owner for payload sequence, lifecycle, and fact integrity. */
export class PolicyStateTracker {
  private lastSeq: number | null = null;
  private mapName: string | undefined;
  private roundNumber: number | undefined;
  private integrity: PolicyV3State["history"]["integrity"] = "COLD_START";
  private previousRounds: RoundHistoryFact[] = [];
  private roundBaseline = false;
  private sawPlanted = false;
  private terminalRecordedFor: number | undefined;
  private lastCompleteInventory: Fact<InventoryState> | undefined;

  observe(payload: GsiPayload, seq: number, preference: UserPreference = DEFAULT_PREFERENCE): PolicyV3State {
    const map = payload.map;
    const round = payload.round;
    const currentRound = map?.round;
    const mapChanged = this.mapName !== undefined && map?.name !== this.mapName;
    const sequenceGap = this.lastSeq !== null && seq !== this.lastSeq + 1;
    const restart = currentRound !== undefined && this.roundNumber !== undefined && currentRound < this.roundNumber;
    if (mapChanged || restart || sequenceGap) {
      this.lastCompleteInventory = undefined;
      this.roundBaseline = false;
      this.sawPlanted = false;
      this.terminalRecordedFor = undefined;
      if (mapChanged || restart) {
        this.previousRounds = [];
        this.integrity = "COLD_START";
      } else {
        this.integrity = "PARTIAL";
      }
    }

    // Terminal `over` can carry the next map.round. Record only a round whose
    // freezetime baseline and continuous payload stream were actually seen.
    if (
      round?.phase === "over" && this.roundNumber !== undefined && currentRound !== undefined &&
      currentRound !== this.roundNumber && this.roundBaseline && this.terminalRecordedFor !== this.roundNumber && this.integrity !== "PARTIAL"
    ) {
      const terminalWinner = winner(round.win_team, seq);
      const planted = tracked(this.sawPlanted, "continuous normal-player GSI round.bomb", seq);
      this.previousRounds = [...this.previousRounds.slice(-5), { roundNumber: this.roundNumber, winner: terminalWinner, planted }];
      this.terminalRecordedFor = this.roundNumber;
      if (terminalWinner.status !== "UNKNOWN") this.integrity = "COMPLETE";
    }

    if (currentRound !== undefined && round?.phase !== "over") {
      if (this.roundNumber !== currentRound) {
        this.roundBaseline = false;
        this.sawPlanted = false;
        this.terminalRecordedFor = undefined;
      }
      this.roundNumber = currentRound;
      if (round?.phase === "freezetime") this.roundBaseline = true;
      if (round?.bomb === "planted") this.sawPlanted = true;
    }

    const playerSide = side(payload.player?.team, seq);
    const score = map?.team_ct?.score !== undefined && map.team_t?.score !== undefined
      ? observed({ ct: map.team_ct.score, t: map.team_t.score }, "map.team_*.score", seq)
      : unknown<{ ct: number; t: number }>("map.team_*.score", seq, "one or both scores missing");
    const ctLoss = observed(map?.team_ct?.consecutive_round_losses, "map.team_ct.consecutive_round_losses", seq);
    const tLoss = observed(map?.team_t?.consecutive_round_losses, "map.team_t.consecutive_round_losses", seq);
    const ownLoss = playerSide.value === "CT" ? ctLoss : playerSide.value === "T" ? tLoss : unknown<number>("own loss index", seq, "player side unknown");
    const opponentSide: Fact<Side> = playerSide.value === "CT" ? observed("T", "opponent side inferred from player.team", seq) : playerSide.value === "T" ? observed("CT", "opponent side inferred from player.team", seq) : unknown("opponent side", seq, "player side unknown");
    const opponentLoss = playerSide.value === "CT" ? tLoss : playerSide.value === "T" ? ctLoss : unknown<number>("opponent loss index", seq, "player side unknown");
    const context = roundContext(currentRound, seq);

    const directInventory = inventoryFrom(payload);
    const inventory = directInventory !== undefined
      ? (() => {
          const fact = observed(directInventory, "player.state + player.weapons", seq);
          this.lastCompleteInventory = fact;
          return fact;
        })()
      : this.lastCompleteInventory !== undefined && !sequenceGap && !mapChanged && !restart
        ? tracked(this.lastCompleteInventory.value!, "last complete normal-player inventory observation", this.lastCompleteInventory.asOfSeq)
        : unknown<NonNullable<ReturnType<typeof inventoryFrom>>>("player.state + player.weapons", seq, "partial inventory payload without a safe tracked observation");

    const opponent = inferOpponentEconomy({
      asOfSeq: seq,
      opponentSide,
      roundNumber: observed(currentRound, "map.round", seq),
      score,
      opponentLossIndex: opponentLoss,
    });

    this.lastSeq = seq;
    this.mapName = map?.name;
    return {
      round: { number: observed(currentRound, "map.round", seq), phase: observed(round?.phase, "round.phase", seq), side: playerSide, score, context },
      player: { money: observed(payload.player?.state?.money, "player.state.money", seq), lossIndex: ownLoss, inventory },
      teamLoss: { ct: ctLoss, t: tLoss },
      history: { integrity: this.integrity, previousRounds: this.previousRounds },
      opponent,
      preference,
    };
  }

}

export type { OpponentEconomyClass };
