export type C4Timing = {
  status: "UNKNOWN";
  detectedPlantedAtNs?: bigint;
  elapsedSinceDetectionMs?: number;
  reason: "COLD_START" | "UNCALIBRATED" | "PROFILE_MISMATCH" | "GAP";
};

/** The only production timing calculation before Windows calibration. */
export function unknownTiming(detectedPlantedAtNs: bigint | undefined, nowMonotonicNs: bigint): C4Timing {
  return {
    status: "UNKNOWN",
    ...(detectedPlantedAtNs === undefined
      ? { reason: "COLD_START" }
      : { detectedPlantedAtNs, elapsedSinceDetectionMs: Number(nowMonotonicNs - detectedPlantedAtNs) / 1e6, reason: "UNCALIBRATED" }),
  };
}

export { C4_TIMING_CALIBRATION } from "./rules.js";
export type { C4TimingCalibration } from "./rules.js";
