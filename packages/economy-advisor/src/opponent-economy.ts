import calibrationJson from "../rules/opponent-economy-direct.v2026-08.json" with { type: "json" };
import type { Side } from "@roundsense/shared-types";
import type { Fact, Inference, OpponentEconomyClass } from "./policy-v3.js";

interface CalibrationFixture {
  input: { opponent_side: "ct" | "t"; round_number: number; score_diff: number; opponent_loss_index: number };
  probability: number;
  classification: OpponentEconomyClass;
}

interface CalibrationArtifact {
  calibration_id: string;
  feature_order: string[];
  intercept: number;
  coefficients: number[];
  thresholds: { likely_not_established_max: number; likely_established_min: number };
  fixtures: CalibrationFixture[];
}

const CALIBRATION = calibrationJson as CalibrationArtifact;
export const OPPONENT_CALIBRATION_ID = CALIBRATION.calibration_id;
export const OPPONENT_PARITY_FIXTURES = CALIBRATION.fixtures;

export interface OpponentFeatureInput {
  asOfSeq: number;
  opponentSide: Fact<Side>;
  roundNumber: Fact<number>;
  score: Fact<{ ct: number; t: number }>;
  opponentLossIndex: Fact<number>;
}

function known<T>(fact: Fact<T> | undefined): fact is Fact<T> & { value: T } {
  return fact?.status !== "UNKNOWN" && fact?.value !== undefined;
}

/** Frozen Python `direct_features()` order. It uses only the current normal
 * player GSI snapshot; tracked history remains a FACT, never classifier input. */
export function encodeOpponentFeatures(input: OpponentFeatureInput): number[] | undefined {
  if (
    !known(input.opponentSide) || !known(input.roundNumber) || !known(input.score) || !known(input.opponentLossIndex)
  ) return undefined;
  const round = input.roundNumber.value;
  if (round <= 0 || round > 24) return undefined;
  const roundInHalf = round > 12 ? round - 12 : round;
  if (roundInHalf < 2 || roundInHalf > 12) return undefined;
  const side = input.opponentSide.value;
  const loss = Math.max(0, Math.min(4, Math.floor(input.opponentLossIndex.value)));
  const scoreDiff = side === "CT"
    ? input.score.value.ct - input.score.value.t
    : input.score.value.t - input.score.value.ct;
  return [
    side === "CT" ? 1 : 0,
    ...Array.from({ length: 11 }, (_, index) => roundInHalf === index + 2 ? 1 : 0),
    ...Array.from({ length: 5 }, (_, index) => loss === index ? 1 : 0),
    Math.max(-10, Math.min(10, scoreDiff)) / 10,
  ];
}

export function inferOpponentEconomy(input: OpponentFeatureInput): Inference<OpponentEconomyClass> {
  const features = encodeOpponentFeatures(input);
  if (!features) {
    return { status: "UNKNOWN", calibrationId: OPPONENT_CALIBRATION_ID, inputsAsOfSeq: input.asOfSeq, reason: "required direct current-GSI feature unavailable" };
  }
  const logit = CALIBRATION.intercept + features.reduce((sum, value, index) => sum + value * CALIBRATION.coefficients[index]!, 0);
  const probability = 1 / (1 + Math.exp(-logit));
  const value: OpponentEconomyClass = probability <= CALIBRATION.thresholds.likely_not_established_max
    ? "LIKELY_NOT_ESTABLISHED_RIFLE"
    : probability >= CALIBRATION.thresholds.likely_established_min
      ? "LIKELY_ESTABLISHED_RIFLE"
      : "UNKNOWN";
  return value === "UNKNOWN"
    ? { status: "UNKNOWN", probability, calibrationId: OPPONENT_CALIBRATION_ID, inputsAsOfSeq: input.asOfSeq, reason: "inside calibrated domain but between selective thresholds" }
    : { status: "INFERRED", value, probability, calibrationId: OPPONENT_CALIBRATION_ID, inputsAsOfSeq: input.asOfSeq, reason: "frozen direct-only GSI calibration" };
}
