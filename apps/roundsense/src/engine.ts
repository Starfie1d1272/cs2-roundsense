/**
 * RoundSense engine: GSI payload → economy advice.
 *
 * Pure-ish core (testable without network): when player/map/round fields are
 * present, turns a payload into an advice tick via economy-advisor.
 *
 * C4 lives in packages/c4-estimator (C4StateMachine) + apps/roundsense
 * presenter.ts — NOT here.
 *
 * Product rules:
 * - missing facts remain explicit UNKNOWN in PolicyStateTracker;
 * - OT start money is never inferred; live money comes straight from GSI.
 */
import { recommendPolicyV3, type PolicyV3Output, type UserPreference } from "@roundsense/economy-advisor";
import type { GsiPayload } from "@roundsense/gsi-protocol";
import { inventoryFrom } from "./inventory.js";
import { PolicyStateTracker } from "./policy-state.js";

export { inventoryFrom } from "./inventory.js";

export interface EngineOptions {
  preference?: UserPreference;
  tracker?: PolicyStateTracker;
  seq?: number;
}

export interface AdviceTick {
  side: "CT" | "T";
  roundNumber: number;
  money: number;
  policy: PolicyV3Output;
}

export function tick(payload: GsiPayload, opts: EngineOptions): AdviceTick | null {
  const player = payload.player;
  const map = payload.map;
  const state = player?.state;
  // C1: advice only during freezetime — the only verified buy window in
  // normal-player GSI (no buytime countdown contract observed yet). live /
  // planted / over / undefined phases get no purchase advice.
  if (payload.round?.phase !== "freezetime") return null;
  // C2: only explicit CT/T teams (observed as "CT"/"T" strings).
  if (!player?.team || (player.team !== "CT" && player.team !== "T")) return null;
  if (state?.money === undefined) return null;
  // map.round must be present — no silent round-1 guess.
  if (map?.round === undefined) return null;
  const tracker = opts.tracker ?? new PolicyStateTracker();
  const policy = recommendPolicyV3(tracker.observe(payload, opts.seq ?? 0, opts.preference));
  return {
    side: player.team,
    roundNumber: map.round,
    money: state.money,
    policy,
  };
}
