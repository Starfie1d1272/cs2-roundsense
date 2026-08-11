import type {
  PlayerLockedMode,
  PolicyMode,
  PolicyV3Output,
  ProtectedNextBuyCapability,
  RecommendationOption,
  SpendingGuidance,
} from "@roundsense/economy-advisor";
import type { AdviceTick } from "./engine.js";

export interface ProductPlan {
  optionId: string;
  mode: PolicyMode;
  adviceStrength: RecommendationOption["adviceStrength"];
  /** Items still required from the current observed inventory. */
  purchases: Array<{ item: string; quantity: number }>;
  /** Current observed inventory after applying `purchases`. */
  finalInventory: {
    primary: string | null;
    secondary: string | null;
    armor: number;
    hasHelmet: boolean;
    hasDefuseKit: boolean;
    grenades: string[];
  };
  /** Incremental cost of `purchases`; never actual historical spend. */
  bundleSpend: number;
  guardrail:
    | { kind: "BOUNDED"; protectedCapability: ProtectedNextBuyCapability; maxAdditionalSpend: number; scenario: "LOSS_NO_PLANT" }
    | { kind: "MINIMIZE"; protectedCapability: ProtectedNextBuyCapability | null }
    | { kind: "CURRENT_ROUND_PRIORITY" }
    | { kind: "COMPLETE_CURRENT_BUY" }
    | { kind: "UNKNOWN"; reason: "BOUNDARY_UNAVAILABLE" };
  lossNoPlant:
    | { status: "PROJECTED"; nextMoney: { min: number; max: number }; assumptions: string[] }
    | { status: "UNKNOWN"; reason: "SCENARIO_UNAVAILABLE" };
  boundaryConsequence?: {
    thresholdAdditionalSpend: number;
    before: ProtectedNextBuyCapability;
    after: ProtectedNextBuyCapability | null;
  };
}

/** A declared economic commitment with no canonical default bundle. */
export interface ProductIntent {
  guardrail: ProductPlan["guardrail"];
  boundaryConsequence?: ProductPlan["boundaryConsequence"];
}

export type ProductAutomaticSelection =
  | { status: "SELECTED"; plan: ProductPlan; alternatives: ProductPlan[] }
  | { status: "MULTIMODAL"; plans: ProductPlan[] }
  | { status: "UNAVAILABLE"; reason: string; plans: [] };

export type ProductActiveSelection =
  | { source: "AUTO"; selection: ProductAutomaticSelection }
  | { source: "PLAYER_LOCKED"; status: "SELECTED"; mode: PlayerLockedMode; plan: ProductPlan }
  | { source: "PLAYER_LOCKED"; status: "INTENT_ONLY"; mode: PlayerLockedMode; intent: ProductIntent; reason: "DEFAULT_PLAN_UNAVAILABLE" }
  | {
      source: "PLAYER_LOCKED";
      status: "UNAVAILABLE";
      mode: PlayerLockedMode;
      reason: "ROUND_SCOPE_MISMATCH" | "INSUFFICIENT_STATE" | "UNSUPPORTED_POLICY_EVIDENCE" | "MODE_UNAVAILABLE";
    };

export interface ProductView {
  contractVersion: 1;
  round: { mapName: string | null; number: number; side: "CT" | "T"; currentMoney: number };
  automatic: ProductAutomaticSelection;
  active: ProductActiveSelection;
  actualSpend: { status: "UNKNOWN"; reason: "ROUND_START_MONEY_UNVERIFIED" };
}

function guardrailForGuidance(guidance: SpendingGuidance, policy: PolicyV3Output): ProductPlan["guardrail"] {
  if (guidance.kind === "MINIMIZE") {
    return { kind: "MINIMIZE", protectedCapability: guidance.protectedCapability ?? null };
  }
  if (guidance.kind === "CURRENT_ROUND_PRIORITY" || guidance.kind === "COMPLETE_CURRENT_BUY") {
    return { kind: guidance.kind };
  }
  const boundary = policy.futureAffordability.status === "PROJECTED"
    ? policy.futureAffordability.boundaries.find((candidate) => candidate.capability === guidance.protectedCapability)
    : undefined;
  return boundary?.reachableWithNoSpend
    ? {
        kind: "BOUNDED",
        protectedCapability: guidance.protectedCapability,
        maxAdditionalSpend: boundary.maxSpendNow,
        scenario: boundary.scenario,
      }
    : { kind: "UNKNOWN", reason: "BOUNDARY_UNAVAILABLE" };
}

function guardrailFor(option: RecommendationOption, policy: PolicyV3Output): ProductPlan["guardrail"] {
  return guardrailForGuidance(option.spendingGuidance, policy);
}

function boundaryConsequenceFor(
  guardrail: ProductPlan["guardrail"],
  policy: PolicyV3Output,
): ProductPlan["boundaryConsequence"] {
  // Projected NORMAL boundaries are not FORCE/FULL advice. They belong only
  // to the selected bounded LIGHT guardrail.
  if (guardrail.kind !== "BOUNDED" || policy.futureAffordability.status !== "PROJECTED") return undefined;
  const before = policy.futureAffordability.boundaries.find((boundary) => boundary.capability === guardrail.protectedCapability);
  if (!before?.reachableWithNoSpend) return undefined;
  const after = policy.futureAffordability.boundaries
    .filter((boundary) => boundary.reachableWithNoSpend && boundary.maxSpendNow > before.maxSpendNow)
    .sort((left, right) => left.maxSpendNow - right.maxSpendNow)[0];
  return {
    thresholdAdditionalSpend: before.maxSpendNow,
    before: before.capability,
    after: after?.capability ?? null,
  };
}

function planFor(option: RecommendationOption, policy: PolicyV3Output): ProductPlan {
  const lossNoPlant = option.trajectory.find((scenario) => scenario.id === "LOSS_NO_PLANT");
  const guardrail = guardrailFor(option, policy);
  return {
    optionId: option.id,
    mode: option.mode,
    adviceStrength: option.adviceStrength,
    purchases: option.purchases.map((purchase) => ({ item: purchase.item, quantity: purchase.quantity })),
    finalInventory: {
      primary: option.resultingInventory.primary ?? null,
      secondary: option.resultingInventory.secondary ?? null,
      armor: option.resultingInventory.armor,
      hasHelmet: option.resultingInventory.hasHelmet,
      hasDefuseKit: option.resultingInventory.hasDefuseKit,
      grenades: [...option.resultingInventory.grenades],
    },
    bundleSpend: option.bundleSpend,
    guardrail,
    lossNoPlant: lossNoPlant
      ? { status: "PROJECTED", nextMoney: { ...lossNoPlant.nextMoney }, assumptions: [...lossNoPlant.assumptions] }
      : { status: "UNKNOWN", reason: "SCENARIO_UNAVAILABLE" },
    boundaryConsequence: boundaryConsequenceFor(guardrail, policy),
  };
}

function automaticSelection(policy: PolicyV3Output): ProductAutomaticSelection {
  if (policy.status !== "READY") return { status: "UNAVAILABLE", reason: policy.status, plans: [] };
  if (policy.options.length === 0) return { status: "UNAVAILABLE", reason: "NO_OPTIONS", plans: [] };
  if (policy.defaultOptionId !== undefined) {
    const selected = policy.options.find((option) => option.id === policy.defaultOptionId);
    if (!selected) return { status: "UNAVAILABLE", reason: "DEFAULT_OPTION_MISSING", plans: [] };
    return {
      status: "SELECTED",
      plan: planFor(selected, policy),
      alternatives: policy.options.filter((option) => option.id !== selected.id).map((option) => planFor(option, policy)),
    };
  }
  const supported = policy.options.filter((option) => option.adviceStrength === "SUPPORTED");
  if (supported.length === 1) {
    const selected = supported[0]!;
    return {
      status: "SELECTED",
      plan: planFor(selected, policy),
      alternatives: policy.options.filter((option) => option.id !== selected.id).map((option) => planFor(option, policy)),
    };
  }
  return { status: "MULTIMODAL", plans: supported.map((option) => planFor(option, policy)) };
}

/** Build the IPC/UI contract. Automatic advice remains available for context,
 * while an unavailable player lock remains active and never falls back. */
export function toProductView(tick: AdviceTick): ProductView {
  const automatic = automaticSelection(tick.policy);
  const active: ProductActiveSelection = tick.locked === null
    ? { source: "AUTO", selection: automatic }
    : tick.locked.status === "RESOLVED"
      ? { source: "PLAYER_LOCKED", status: "SELECTED", mode: tick.locked.mode, plan: planFor(tick.locked.option, tick.policy) }
      : tick.locked.status === "INTENT_ONLY"
        ? {
            source: "PLAYER_LOCKED",
            status: "INTENT_ONLY",
            mode: tick.locked.mode,
            intent: (() => {
              const guardrail = guardrailForGuidance(tick.locked.spendingGuidance, tick.policy);
              return { guardrail, boundaryConsequence: boundaryConsequenceFor(guardrail, tick.policy) };
            })(),
            reason: tick.locked.reason,
          }
      : { source: "PLAYER_LOCKED", status: "UNAVAILABLE", mode: tick.locked.mode, reason: tick.locked.reason };
  return {
    contractVersion: 1,
    round: { mapName: tick.mapName, number: tick.roundNumber, side: tick.side, currentMoney: tick.money },
    automatic,
    active,
    actualSpend: { status: "UNKNOWN", reason: "ROUND_START_MONEY_UNVERIFIED" },
  };
}
