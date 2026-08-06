import { C4_FUSE_RULES } from "./rules.js";

/**
 * Remaining C4 time estimate — pure function, monotonic clock only.
 *
 * The estimate is deliberately a linear model (B1/B4):
 *   remaining = fuseMs - (now - plantedAt)
 * It does NOT claim any precision: the research question is whether GSI
 * arrival latency + this model yields practically useful estimates. Precision
 * claims are deferred until the Windows experiments measure
 * plant_detection_delay_ms etc.
 */
export interface EstimateInput {
  plantedAtMonotonicNs: bigint;
  nowMonotonicNs: bigint;
  fuseMs: number;
}

export interface EstimateOutput {
  remainingMs: number;
  elapsedMs: number;
  /** true when remaining reached 0 (estimate says exploded). */
  exploded: boolean;
}

export function estimateRemaining(input: EstimateInput): EstimateOutput {
  const elapsedMs = Number(input.nowMonotonicNs - input.plantedAtMonotonicNs) / 1e6;
  const remainingMs = Math.max(0, input.fuseMs - elapsedMs);
  return { remainingMs, elapsedMs, exploded: remainingMs <= 0 };
}

/** Estimate using the versioned default fuse rules (B1). */
export function estimateRemainingDefault(plantedAtMonotonicNs: bigint, nowMonotonicNs: bigint): EstimateOutput {
  return estimateRemaining({
    plantedAtMonotonicNs,
    nowMonotonicNs,
    fuseMs: C4_FUSE_RULES.fuseMs,
  });
}

export { C4_FUSE_RULES } from "./rules.js";
export type { C4FuseRules } from "./rules.js";
