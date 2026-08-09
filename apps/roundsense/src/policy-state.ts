import {
  inferOpponentEconomy,
  type Fact,
  type OpponentEconomyClass,
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
  return value === undefined
    ? { status: "UNKNOWN", source, asOfSeq: seq, reason: "missing from normal-player GSI" }
    : { status: "OBSERVED", value, source, asOfSeq: seq };
}

function unknown<T>(source: string, seq: number, reason: string): Fact<T> {
  return { status: "UNKNOWN", source, asOfSeq: seq, reason };
}

function side(value: string | undefined, seq: number): Fact<Side> {
  return value === "CT" || value === "T" ? observed(value, "player.team", seq) : unknown("player.team", seq, "missing or non-player team");
}

function roundContext(round: number | undefined, seq: number): Fact<RoundContext> {
  if (round === undefined) return unknown("map.round", seq, "round identity unavailable");
  if (round > 24) return observed("OVERTIME", "map.round", seq);
  const inHalf = round > 12 ? round - 12 : round;
  return observed(inHalf === 1 ? "PISTOL" : inHalf === 2 ? "POST_PISTOL" : "NORMAL", "map.round", seq);
}

/** Owns session history only. It never stores or synthesizes opponent private state. */
export class PolicyStateTracker {
  private lastSeq: number | null = null;
  private mapName: string | undefined;
  private roundNumber: number | undefined;
  private integrity: PolicyV3State["history"]["integrity"] = "COLD_START";
  private previousRounds: RoundHistoryFact[] = [];
  private lastRoundWinner: Fact<Side> | undefined;

  observe(payload: GsiPayload, seq: number, preference: UserPreference = DEFAULT_PREFERENCE): PolicyV3State {
    const map = payload.map;
    const round = payload.round;
    const playerSide = side(payload.player?.team, seq);
    const currentRound = map?.round;
    const mapChanged = this.mapName !== undefined && map?.name !== this.mapName;
    const sequenceGap = this.lastSeq !== null && seq !== this.lastSeq + 1;
    const restart = currentRound !== undefined && this.roundNumber !== undefined && currentRound < this.roundNumber;
    if (mapChanged || restart) {
      this.previousRounds = [];
      this.lastRoundWinner = undefined;
      this.integrity = "COLD_START";
    } else if (sequenceGap) {
      this.integrity = "PARTIAL";
    } else if (this.lastSeq !== null && this.integrity === "COLD_START") {
      this.integrity = "COMPLETE";
    }

    if (round?.phase === "over" && this.roundNumber !== undefined && currentRound !== undefined && currentRound !== this.roundNumber) {
      // `over` can already carry the next map.round; the terminal winner belongs
      // to the tracked round and only becomes history when directly observed.
      const winner = round.win_team === "CT" || round.win_team === "T"
        ? observed<Side>(round.win_team, "round.win_team", seq)
        : unknown<Side>("round.win_team", seq, "terminal winner missing");
      this.previousRounds = [...this.previousRounds.slice(-5), { roundNumber: this.roundNumber, winner, planted: observed(round.bomb === "exploded" || round.bomb === "defused", "round.bomb", seq) }];
      this.lastRoundWinner = winner;
    }

    const score = map?.team_ct?.score !== undefined && map.team_t?.score !== undefined
      ? observed({ ct: map.team_ct.score, t: map.team_t.score }, "map.team_*.score", seq)
      : unknown<{ ct: number; t: number }>("map.team_*.score", seq, "one or both scores missing");
    const ctLoss = observed(map?.team_ct?.consecutive_round_losses, "map.team_ct.consecutive_round_losses", seq);
    const tLoss = observed(map?.team_t?.consecutive_round_losses, "map.team_t.consecutive_round_losses", seq);
    const ownLoss = playerSide.value === "CT" ? ctLoss : playerSide.value === "T" ? tLoss : unknown<number>("own loss index", seq, "player side unknown");
    const opponentLoss = playerSide.value === "CT" ? tLoss : playerSide.value === "T" ? ctLoss : unknown<number>("opponent loss index", seq, "player side unknown");
    const context = roundContext(currentRound, seq);
    const inventory = payload.player?.state === undefined
      ? unknown<ReturnType<typeof inventoryFrom>>("player.state/player.weapons", seq, "player inventory missing")
      : observed(inventoryFrom(payload), "player.state/player.weapons", seq);
    const opponent = inferOpponentEconomy({ asOfSeq: seq, context, opponentLossIndex: opponentLoss, ownScore: score });

    this.lastSeq = seq;
    this.mapName = map?.name;
    if (currentRound !== undefined && round?.phase !== "over") this.roundNumber = currentRound;
    return {
      round: {
        number: observed(currentRound, "map.round", seq),
        phase: observed(round?.phase, "round.phase", seq),
        side: playerSide,
        score,
        context,
      },
      player: {
        money: observed(payload.player?.state?.money, "player.state.money", seq),
        lossIndex: ownLoss,
        inventory,
      },
      teamLoss: { ct: ctLoss, t: tLoss },
      history: { integrity: this.integrity, previousRounds: this.previousRounds },
      opponent,
      preference,
    };
  }
}

export type { OpponentEconomyClass };
