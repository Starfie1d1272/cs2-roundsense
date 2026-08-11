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
import {
  recommendPolicyV3,
  resolveLockedPolicyMode,
  type PlayerLockedMode,
  type PolicyV3Output,
  type RecommendationOption,
  type UserPreference,
} from "@roundsense/economy-advisor";
import type { GsiPayload } from "@roundsense/gsi-protocol";
import { hasUnknownPrimaryWeapon, inventoryFrom } from "./inventory.js";
import { PolicyStateTracker } from "./policy-state.js";

export { inventoryFrom } from "./inventory.js";

export interface EngineOptions {
  preference?: UserPreference;
  tracker?: PolicyStateTracker;
  seq?: number;
  lockedMode?: RoundScopedLockedMode;
}

export interface RoundScopedLockedMode {
  mapName: string;
  roundNumber: number;
  side: "CT" | "T";
  mode: PlayerLockedMode;
}

export type LockedAdviceResult =
  | { status: "RESOLVED"; mode: PlayerLockedMode; option: RecommendationOption }
  | {
      status: "UNAVAILABLE";
      mode: PlayerLockedMode;
      option: null;
      reason: "ROUND_SCOPE_MISMATCH" | "INSUFFICIENT_STATE" | "UNSUPPORTED_POLICY_EVIDENCE" | "MODE_UNAVAILABLE";
    };

const trackersWithUnknownPrimary = new WeakSet<PolicyStateTracker>();

function lockedAdvice(
  lock: RoundScopedLockedMode | undefined,
  current: { mapName: string | undefined; roundNumber: number; side: "CT" | "T" },
  policyState: Parameters<typeof resolveLockedPolicyMode>[0],
  policy: PolicyV3Output,
): LockedAdviceResult | null {
  if (!lock) return null;
  if (lock.mapName !== current.mapName || lock.roundNumber !== current.roundNumber || lock.side !== current.side) {
    return { status: "UNAVAILABLE", mode: lock.mode, option: null, reason: "ROUND_SCOPE_MISMATCH" };
  }
  const option = resolveLockedPolicyMode(policyState, lock.mode);
  if (option) return { status: "RESOLVED", mode: lock.mode, option };
  const reason = policy.status === "INSUFFICIENT_STATE" || policy.status === "UNSUPPORTED_POLICY_EVIDENCE"
    ? policy.status
    : "MODE_UNAVAILABLE";
  return { status: "UNAVAILABLE", mode: lock.mode, option: null, reason };
}

export interface AdviceTick {
  mapName: string | null;
  side: "CT" | "T";
  roundNumber: number;
  money: number;
  policy: PolicyV3Output;
  locked: LockedAdviceResult | null;
}

export function tick(payload: GsiPayload, opts: EngineOptions): AdviceTick | null {
  // The CLI owns one persistent tracker. Observe every normal-player receipt
  // before deciding whether it is eligible to emit purchase advice, so live
  // and terminal payloads can maintain lifecycle FACTs.
  const tracker = opts.tracker ?? new PolicyStateTracker();
  const seq = opts.seq ?? 0;
  const directInventory = inventoryFrom(payload);
  if (hasUnknownPrimaryWeapon(payload)) trackersWithUnknownPrimary.add(tracker);
  else if (directInventory !== undefined) trackersWithUnknownPrimary.delete(tracker);
  const policyState = tracker.observe(payload, seq, opts.preference);
  if (trackersWithUnknownPrimary.has(tracker)) {
    policyState.player.inventory = {
      status: "UNKNOWN",
      source: "player.weapons",
      asOfSeq: seq,
      reason: "unrecognized primary weapon id in the current inventory stream",
    };
  }
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
  const policy = recommendPolicyV3(policyState);
  return {
    mapName: map.name ?? null,
    side: player.team,
    roundNumber: map.round,
    money: state.money,
    policy,
    locked: lockedAdvice(opts.lockedMode, { mapName: map.name, roundNumber: map.round, side: player.team }, policyState, policy),
  };
}
