import type { ItemId, Side } from "@roundsense/shared-types";
import { planPurchases, resultingLoadout, rifleFor, smgFor, type PurchasePlan } from "./advisor.js";
import { projectNextRoundMoney } from "./projection.js";
import { DEFAULT_RULES, grenadeCarryCap, lossBonus, MAX_GRENADE_CARRY, price } from "./rules.js";
import { inferOpponentEconomy as inferFromCalibration, type OpponentFeatureInput } from "./opponent-economy.js";
import type { InventoryState, PurchaseItem } from "./types.js";

export type FactStatus = "OBSERVED" | "TRACKED" | "UNKNOWN";

export interface Fact<T> {
  status: FactStatus;
  value?: T;
  source: string;
  asOfSeq: number;
  reason?: string;
}

export interface Inference<T> {
  status: "INFERRED" | "UNKNOWN";
  value?: T;
  probability?: number;
  calibrationId?: string;
  inputsAsOfSeq: number;
  reason?: string;
}

export type PolicyMode = "PRESERVE" | "LIGHT" | "FORCE" | "FULL" | "AWP_PATH";
export type PlayerLockedMode = "PRESERVE" | "LIGHT" | "FORCE" | "FULL";
export type RoundContext = "PISTOL" | "POST_PISTOL" | "NORMAL" | "OVERTIME";
export type OpponentEconomyClass = "LIKELY_ESTABLISHED_RIFLE" | "LIKELY_NOT_ESTABLISHED_RIFLE" | "UNKNOWN";
export type ProtectedNextBuyCapability = "RIFLE_ARMOR" | "RIFLE_ARMOR_BASIC_UTILITY";

export interface FutureAffordabilityBoundary {
  layer: "SCENARIO";
  scenario: "LOSS_NO_PLANT";
  capability: ProtectedNextBuyCapability;
  targetCash: number;
  requiredReserveNow: number;
  reachableWithNoSpend: boolean;
  maxSpendNow: number;
  assumptions: readonly string[];
}

export type FutureAffordabilitySet =
  | { status: "PROJECTED"; context: "NORMAL"; boundaries: readonly FutureAffordabilityBoundary[] }
  | { status: "UNKNOWN"; boundaries: readonly []; reason: string }
  | {
      status: "NOT_APPLICABLE";
      boundaries: readonly [];
      reason: "POST_PISTOL_STRATEGY" | "PISTOL_UNSUPPORTED" | "OVERTIME_UNSUPPORTED";
    };

export type SpendingGuidance =
  | { layer: "ADVICE"; kind: "MINIMIZE"; protectedCapability?: ProtectedNextBuyCapability }
  | { layer: "ADVICE"; kind: "BOUNDED"; protectedCapability: ProtectedNextBuyCapability }
  | { layer: "ADVICE"; kind: "CURRENT_ROUND_PRIORITY" }
  | { layer: "ADVICE"; kind: "COMPLETE_CURRENT_BUY" };

export interface UserPreference {
  source: "DEFAULT" | "USER_DECLARED";
  awpPriority: "NEUTRAL" | "PREFER" | "SAVE_FOR_AWP";
  riskBias?: "NEUTRAL" | "PRESERVE" | "CONTEST";
  utilityBias?: "NEUTRAL" | "PREFER";
}

export interface PolicyV3State {
  round: {
    number: Fact<number>;
    phase: Fact<string>;
    side: Fact<Side>;
    score: Fact<{ ct: number; t: number }>;
    context: Fact<RoundContext>;
  };
  player: {
    money: Fact<number>;
    lossIndex: Fact<number>;
    inventory: Fact<InventoryState>;
  };
  teamLoss: { ct: Fact<number>; t: Fact<number> };
  history: { integrity: "COMPLETE" | "PARTIAL" | "COLD_START"; previousRounds: readonly RoundHistoryFact[] };
  opponent: Inference<OpponentEconomyClass>;
  preference: UserPreference;
}

export interface RoundHistoryFact {
  roundNumber: number;
  winner: Fact<Side>;
  planted: Fact<boolean>;
}

export interface TrajectoryScenario {
  id: "WIN" | "LOSS_NO_PLANT" | "LOSS_WITH_PLANT";
  assumptions: readonly string[];
  nextMoney: { min: number; max: number };
  nextLossIndex: Fact<number>;
  /** Explicit t+1 action and t+2 loss scenario; never a hidden save bank. */
  followingRound: {
    action: "PRESERVE";
    outcome: "LOSS_NO_PLANT";
    money: Fact<{ min: number; max: number }>;
    lossIndex: Fact<number>;
    reachability: Fact<"UNKNOWN">;
  };
}

export interface PolicyReason {
  code: string;
  detail: string;
}

export interface ConditionalAlternative {
  condition: string;
  purchases: readonly PurchaseItem[];
  reason: string;
}

export interface RecommendationOption {
  id: string;
  mode: PolicyMode;
  spendingGuidance: SpendingGuidance;
  purchases: readonly PurchaseItem[];
  bundleSpend: number;
  resultingInventory: ReturnType<typeof resultingLoadout>;
  trajectory: readonly TrajectoryScenario[];
  reasons: readonly PolicyReason[];
  assumptions: readonly string[];
  conditionalAlternatives: readonly ConditionalAlternative[];
  adviceStrength: "DOMINANT" | "SUPPORTED" | "ALTERNATIVE";
}

export interface PolicyV3Output {
  status: "READY" | "INSUFFICIENT_STATE" | "UNSUPPORTED_POLICY_EVIDENCE";
  futureAffordability: FutureAffordabilitySet;
  options: readonly RecommendationOption[];
  defaultOptionId?: string;
  unresolved: readonly string[];
  opponent: Inference<OpponentEconomyClass>;
}

const DEFAULT_PREFERENCE: UserPreference = { source: "DEFAULT", awpPriority: "NEUTRAL" };
function known<T>(fact: Fact<T>): fact is Fact<T> & { value: T } {
  return fact.status !== "UNKNOWN" && fact.value !== undefined;
}

function sideFire(side: Side): ItemId {
  return side === "T" ? "molotov" : "incendiary";
}

function add(items: ItemId[], item: ItemId, quantity = 1): void {
  for (let i = 0; i < quantity; i++) items.push(item);
}

function count(items: readonly ItemId[], item: ItemId): number {
  return items.filter((candidate) => candidate === item).length;
}

/** Resulting-bundle utility planning: it never claims to recreate click order. */
export function utilityBundle(side: Side, inventory: InventoryState, budget: number): ItemId[] {
  const initialBudget = budget;
  const desired = [...inventory.grenades];
  const canAdd = (item: ItemId) => desired.length < MAX_GRENADE_CARRY && count(desired, item) < (grenadeCarryCap(item) ?? 0);
  const buyOne = (item: ItemId) => {
    if (canAdd(item) && price(DEFAULT_RULES, item) <= budget) {
      desired.push(item);
      budget -= price(DEFAULT_RULES, item);
    }
  };
  const ensure = (item: ItemId) => {
    if (desired.includes(item)) return;
    buyOne(item);
  };

  // Existing utility is respected before any new slot is allocated.
  if (initialBudget >= 600) {
    ensure("smoke");
    ensure(sideFire(side));
    ensure("flash");
  } else if (initialBudget >= 500) {
    ensure("smoke");
    ensure("flash");
  } else if (budget >= 300) {
    ensure("smoke");
    ensure("flash");
  } else if (budget >= 200) {
    ensure("flash");
  }

  if (initialBudget >= 600) {
    if (side === "CT") {
      ensure("he"); // CT evidence supports HE over a second flash.
      buyOne("flash");
    } else {
      // The T fourth slot remains intentionally multimodal; the caller emits both alternatives.
      ensure("he");
    }
  }
  return desired;
}

function targets(side: Side, mode: PolicyMode, inventory: InventoryState, money: number): ItemId[][] {
  const items: ItemId[] = [];
  if (mode === "PRESERVE") return [items];
  if (mode === "AWP_PATH") {
    add(items, "awp");
    add(items, "kevlar");
  } else if (mode === "FORCE") {
    const paidPistol = side === "T" ? "tec9" : "fiveseven";
    // Bounded legal bundle fitting: preserve a retained dominant weapon, try
    // a primary upgrade first, then spend the remaining discrete budget on
    // armor and utility. It deliberately has no preservation bank.
    const bases: ItemId[][] = [
      [rifleFor(side), "kevlar"],
      [rifleFor(side)],
      [smgFor(side), "kevlar"],
      [smgFor(side)],
      [paidPistol, "kevlar"],
      [paidPistol],
    ];
    return bases.map((base) => {
      const primaryArmor = planPurchases(inventory, compact(base), DEFAULT_RULES, side);
      return [...base, ...utilityBundle(side, inventory, Math.max(0, money - primaryArmor.totalCost))];
    });
  } else {
    add(items, rifleFor(side));
    // CT defaults to vesthelm; Kevlar is not an opponent-derived decision.
    add(items, "kevlar_helmet");
  }

  const primaryArmor = planPurchases(inventory, compact(items), DEFAULT_RULES, side).totalCost;
  const utility = utilityBundle(side, inventory, Math.max(0, money - primaryArmor));
  items.push(...utility);
  return [items];
}

function forcePrimaryRank(side: Side, items: readonly ItemId[]): number {
  if (items.includes(rifleFor(side))) return 3;
  if (items.includes(smgFor(side))) return 2;
  return 1;
}

function forceArmorRank(inventory: InventoryState, plan: PurchasePlan): number {
  return resultingLoadout(inventory, plan.purchases).armor > 0 ? 1 : 0;
}

function compact(items: readonly ItemId[]): PurchaseItem[] {
  const result = new Map<ItemId, number>();
  for (const item of items) result.set(item, (result.get(item) ?? 0) + 1);
  return [...result].map(([item, quantity]) => ({ item, quantity }));
}

function trajectory(state: PolicyV3State, spend: number): TrajectoryScenario[] {
  if (!known(state.player.money) || !known(state.player.lossIndex) || !known(state.round.side)) return [];
  const side = state.round.side.value;
  const projected = projectNextRoundMoney({
    money: state.player.money.value,
    spendNow: spend,
    side,
    lossStreak: state.player.lossIndex.value,
    kills: [],
    rules: DEFAULT_RULES,
  });
  const assumptions = [
    "0 additional personal kill rewards",
    "no hidden drops, teammate transfers, or private opponent state",
    "current GSI inventory only; projection is a scenario, not a future fact",
  ];
  const lossIndex: Fact<number> = { status: "TRACKED", value: Math.min(4, state.player.lossIndex.value + 1), source: "CS2 loss-bonus rule", asOfSeq: state.player.lossIndex.asOfSeq };
  const winIndex: Fact<number> = state.player.lossIndex.value === 1
    ? { status: "TRACKED", value: 0, source: "Windows runtime-observed win transition 1→0", asOfSeq: state.player.lossIndex.asOfSeq }
    : { status: "UNKNOWN", source: "win loss-index transition", asOfSeq: state.player.lossIndex.asOfSeq, reason: "full win-decrement semantics not calibrated" };
  const followingRound = (nextMoney: { min: number; max: number }, nextLoss: Fact<number>): TrajectoryScenario["followingRound"] => {
    const reachability: Fact<"UNKNOWN"> = {
      status: "UNKNOWN", source: "future inventory", asOfSeq: state.player.inventory.asOfSeq,
      reason: "t+1 inventory, drops, and armor retention are not observable facts",
    };
    if (!known(nextLoss)) {
      const unavailable: Fact<{ min: number; max: number }> = { status: "UNKNOWN", source: "t+2 projection", asOfSeq: nextLoss.asOfSeq, reason: "t+1 win loss-index transition is uncalibrated" };
      return { action: "PRESERVE", outcome: "LOSS_NO_PLANT", money: unavailable, lossIndex: nextLoss, reachability };
    }
    const secondMin = projectNextRoundMoney({ money: nextMoney.min, spendNow: 0, side, lossStreak: nextLoss.value, kills: [], rules: DEFAULT_RULES });
    const secondMax = projectNextRoundMoney({ money: nextMoney.max, spendNow: 0, side, lossStreak: nextLoss.value, kills: [], rules: DEFAULT_RULES });
    return {
      action: "PRESERVE", outcome: "LOSS_NO_PLANT",
      money: { status: "TRACKED", value: { min: secondMin.loss, max: secondMax.loss }, source: "economy rule projection", asOfSeq: nextLoss.asOfSeq },
      lossIndex: { status: "TRACKED", value: Math.min(4, nextLoss.value + 1), source: "CS2 loss-bonus rule", asOfSeq: nextLoss.asOfSeq },
      reachability,
    };
  };
  const scenarios: TrajectoryScenario[] = [
    { id: "WIN", assumptions: [...assumptions, "WIN range spans elimination/timeout and bomb win rewards", "t+2 assumes a no-purchase loss; future buy reachability stays UNKNOWN without future inventory"], nextMoney: { min: projected.win, max: projected.winBomb }, nextLossIndex: winIndex, followingRound: followingRound({ min: projected.win, max: projected.winBomb }, winIndex) },
    { id: "LOSS_NO_PLANT", assumptions: [...assumptions, "t+2 assumes a no-purchase loss; future buy reachability stays UNKNOWN without future inventory"], nextMoney: { min: projected.loss, max: projected.loss }, nextLossIndex: lossIndex, followingRound: followingRound({ min: projected.loss, max: projected.loss }, lossIndex) },
  ];
  if (side === "T") {
    scenarios.push({ id: "LOSS_WITH_PLANT", assumptions: [...assumptions, "T plant reward only in this hypothetical branch", "t+2 assumes a no-purchase loss; future buy reachability stays UNKNOWN without future inventory"], nextMoney: { min: projected.lossWithPlant, max: projected.lossWithPlant }, nextLossIndex: lossIndex, followingRound: followingRound({ min: projected.lossWithPlant, max: projected.lossWithPlant }, lossIndex) });
  }
  return scenarios;
}

function futureAffordability(state: PolicyV3State): FutureAffordabilitySet {
  if (!known(state.round.context)) {
    return { status: "UNKNOWN", boundaries: [], reason: "round context is UNKNOWN" };
  }
  const context = state.round.context.value;
  if (context === "POST_PISTOL") return { status: "NOT_APPLICABLE", boundaries: [], reason: "POST_PISTOL_STRATEGY" };
  if (context === "PISTOL") return { status: "NOT_APPLICABLE", boundaries: [], reason: "PISTOL_UNSUPPORTED" };
  if (context === "OVERTIME") return { status: "NOT_APPLICABLE", boundaries: [], reason: "OVERTIME_UNSUPPORTED" };
  if (!known(state.player.money) || !known(state.player.lossIndex) || !known(state.round.side)) {
    return { status: "UNKNOWN", boundaries: [], reason: "own money, loss index, or side is UNKNOWN" };
  }

  const { value: money } = state.player.money;
  const { value: lossIndex } = state.player.lossIndex;
  const { value: side } = state.round.side;
  const lossReward = lossBonus(DEFAULT_RULES, lossIndex);
  const assumptions = [
    "LOSS_NO_PLANT scenario",
    "0 additional personal kill rewards",
    "no retained weapon, drop, armor retention, or teammate transfer is asserted",
    "canonical fresh-buy cash boundary; not a future inventory fact",
  ];
  const capabilityTarget = (capability: ProtectedNextBuyCapability): number => {
    const items: ItemId[] = [rifleFor(side), "kevlar"];
    if (capability === "RIFLE_ARMOR_BASIC_UTILITY") items.push("smoke", "flash");
    return items.reduce((total, item) => total + price(DEFAULT_RULES, item), 0);
  };
  const boundary = (capability: ProtectedNextBuyCapability): FutureAffordabilityBoundary => {
    const targetCash = capabilityTarget(capability);
    const requiredReserveNow = Math.max(0, targetCash - lossReward);
    const reachableWithNoSpend = money >= requiredReserveNow;
    return {
      layer: "SCENARIO",
      scenario: "LOSS_NO_PLANT",
      capability,
      targetCash,
      requiredReserveNow,
      reachableWithNoSpend,
      maxSpendNow: reachableWithNoSpend ? money - requiredReserveNow : 0,
      assumptions,
    };
  };
  return {
    status: "PROJECTED",
    context: "NORMAL",
    boundaries: [boundary("RIFLE_ARMOR"), boundary("RIFLE_ARMOR_BASIC_UTILITY")],
  };
}

function preserveGuidance(boundaries: FutureAffordabilitySet): SpendingGuidance {
  if (boundaries.status !== "PROJECTED") return { layer: "ADVICE", kind: "MINIMIZE" };
  const strongest = boundaries.boundaries.find((boundary) => boundary.capability === "RIFLE_ARMOR_BASIC_UTILITY" && boundary.reachableWithNoSpend)
    ?? boundaries.boundaries.find((boundary) => boundary.capability === "RIFLE_ARMOR" && boundary.reachableWithNoSpend);
  return strongest
    ? { layer: "ADVICE", kind: "MINIMIZE", protectedCapability: strongest.capability }
    : { layer: "ADVICE", kind: "MINIMIZE" };
}

function guidanceFor(mode: Exclude<PolicyMode, "LIGHT">, boundaries: FutureAffordabilitySet): SpendingGuidance {
  if (mode === "PRESERVE") return preserveGuidance(boundaries);
  if (mode === "FULL") return { layer: "ADVICE", kind: "COMPLETE_CURRENT_BUY" };
  return { layer: "ADVICE", kind: "CURRENT_ROUND_PRIORITY" };
}

function lightTargets(side: Side, inventory: InventoryState): ItemId[][] {
  if (inventory.primary === null || inventory.primary === undefined) {
    const paidPistol = side === "T" ? "tec9" : "fiveseven";
    return [
      [paidPistol, "kevlar"], ["kevlar", "smoke"], [paidPistol, "smoke"],
      ["kevlar"], [paidPistol], ["smoke", "flash"], ["smoke"], ["flash"],
    ];
  }
  const targets: ItemId[][] = [];
  if (inventory.armor === 0) targets.push(["kevlar", "smoke"], ["kevlar"]);
  if (side === "CT" && inventory.armor > 0 && !inventory.hasHelmet) targets.push(["kevlar_helmet"]);
  targets.push(["smoke", "flash"], ["smoke"], ["flash"]);
  if (side === "CT" && !inventory.hasDefuseKit) targets.push(["defuse_kit"]);
  return targets;
}

function planLightOption(
  state: PolicyV3State,
  boundary: FutureAffordabilityBoundary,
  strength: RecommendationOption["adviceStrength"],
): RecommendationOption | null {
  if (!known(state.player.inventory) || !known(state.player.money) || !known(state.round.side) || !boundary.reachableWithNoSpend) return null;
  const inventory = state.player.inventory.value;
  const side = state.round.side.value;
  for (const desired of lightTargets(side, inventory)) {
    const plan = planPurchases(inventory, compact(desired), DEFAULT_RULES, side);
    if (!plan.isComplete || plan.totalCost <= 0 || plan.totalCost > boundary.maxSpendNow) continue;
    const resultingInventory = resultingLoadout(inventory, plan.purchases);
    return {
      id: `light-${boundary.capability.toLowerCase()}-${plan.purchases.map((purchase) => `${purchase.item}${purchase.quantity}`).join("-")}`,
      mode: "LIGHT",
      spendingGuidance: { layer: "ADVICE", kind: "BOUNDED", protectedCapability: boundary.capability },
      purchases: plan.purchases,
      bundleSpend: plan.totalCost,
      resultingInventory,
      trajectory: trajectory(state, plan.totalCost),
      reasons: [
        { code: "MODE_LIGHT", detail: "limited, inventory-aware spend within a canonical future-affordability boundary" },
        { code: "LIGHT_PROTECTS_NEXT_BUY", detail: `LOSS_NO_PLANT preserves ${boundary.capability} canonical fresh-buy cash capability` },
      ],
      assumptions: ["normal-player GSI only", "bundleSpend may remain below the protected boundary; the ceiling is not a spend target"],
      conditionalAlternatives: [],
      adviceStrength: strength,
    };
  }
  return null;
}

type ConversionPrimary = "RETAINED" | "SMG" | "RIFLE";

interface ConversionPlan {
  primary: ConversionPrimary;
  plan: PurchasePlan;
}

/**
 * Plans a post-pistol conversion bundle independently of ordinary FORCE
 * selection. Conversion prioritizes an own-state vesthelm configuration,
 * then spends the remaining canonical budget on legal utility.
 */
function conversionPlan(
  side: Side,
  inventory: InventoryState,
  money: number,
  primary: ConversionPrimary,
  armor: "kevlar_helmet" | "kevlar",
): PurchasePlan | null {
  const base: ItemId[] = [armor];
  if (primary === "SMG") base.unshift(smgFor(side));
  if (primary === "RIFLE") base.unshift(rifleFor(side));
  const core = planPurchases(inventory, compact(base), DEFAULT_RULES, side);
  if (!core.isComplete || core.totalCost > money) return null;
  const desired = [...base, ...utilityBundle(side, inventory, money - core.totalCost)];
  const complete = planPurchases(inventory, compact(desired), DEFAULT_RULES, side);
  return complete.isComplete && complete.totalCost <= money ? complete : core;
}

function conversionOption(
  state: PolicyV3State,
  conversion: ConversionPlan,
  strength: RecommendationOption["adviceStrength"],
): RecommendationOption {
  const inventory = state.player.inventory.value!;
  const side = state.round.side.value!;
  const { plan } = conversion;
  const desired = plan.purchases.flatMap((purchase) => Array.from({ length: purchase.quantity }, () => purchase.item));
  const conditionalAlternatives: ConditionalAlternative[] = [];
  if (side === "CT" && !inventory.hasDefuseKit) {
    const kitPlan = planPurchases(inventory, compact([...desired, "defuse_kit"]), DEFAULT_RULES, side);
    if (kitPlan.isComplete && kitPlan.totalCost <= state.player.money.value!) {
      conditionalAlternatives.push({ condition: "若队友暂无钳子", purchases: kitPlan.purchases, reason: "钳子不占 grenade slot；队友覆盖不可见" });
    }
  }
  const primaryDetail = conversion.primary === "RETAINED"
    ? "retained primary is preserved; only armor and utility are topped up"
    : conversion.primary === "RIFLE"
      ? "canonical rifle plus vesthelm is affordable for higher current-round firepower"
      : "canonical SMG plus vesthelm is the efficient anti-eco conversion configuration";
  return {
    id: `post-pistol-conversion-${conversion.primary.toLowerCase()}-${plan.purchases.map((purchase) => `${purchase.item}${purchase.quantity}`).join("-") || "hold"}`,
    mode: "FULL",
    spendingGuidance: { layer: "ADVICE", kind: "COMPLETE_CURRENT_BUY" },
    purchases: plan.purchases,
    bundleSpend: plan.totalCost,
    resultingInventory: resultingLoadout(inventory, plan.purchases),
    trajectory: trajectory(state, plan.totalCost),
    reasons: [{ code: "POST_PISTOL_CONVERSION", detail: `pistol winner conversion is team-level FULL; ${primaryDetail}` }],
    assumptions: ["normal-player GSI only", "POST_PISTOL conversion is independent from NORMAL future-affordability guidance", "canonical affordability and current inventory determine conversion options"],
    conditionalAlternatives,
    adviceStrength: strength,
  };
}

/** A pistol winner is strategic FULL, while its individual bundle can be a
 * retained-primary top-up, an efficient SMG conversion, or an affordable rifle
 * conversion. These are not ordinary FORCE or NORMAL LIGHT strategies. */
function planPostPistolConversionOptions(state: PolicyV3State, strength: RecommendationOption["adviceStrength"]): RecommendationOption[] {
  if (!known(state.player.inventory) || !known(state.player.money) || !known(state.round.side)) return [];
  const inventory = state.player.inventory.value;
  const money = state.player.money.value;
  const side = state.round.side.value;
  const retained = inventory.primary !== null && inventory.primary !== undefined;
  const candidates: ConversionPlan[] = [];
  if (retained) {
    const topUp = conversionPlan(side, inventory, money, "RETAINED", "kevlar_helmet")
      ?? conversionPlan(side, inventory, money, "RETAINED", "kevlar");
    if (topUp) candidates.push({ primary: "RETAINED", plan: topUp });
  } else {
    const rifle = conversionPlan(side, inventory, money, "RIFLE", "kevlar_helmet");
    const smg = conversionPlan(side, inventory, money, "SMG", "kevlar_helmet")
      ?? conversionPlan(side, inventory, money, "SMG", "kevlar");
    if (rifle) candidates.push({ primary: "RIFLE", plan: rifle });
    if (smg) candidates.push({ primary: "SMG", plan: smg });
  }
  if (candidates.length === 0) {
    return [{
      id: "post-pistol-conversion-hold",
      mode: "FULL",
      spendingGuidance: { layer: "ADVICE", kind: "COMPLETE_CURRENT_BUY" },
      purchases: [],
      bundleSpend: 0,
      resultingInventory: resultingLoadout(inventory, []),
      trajectory: trajectory(state, 0),
      reasons: [{ code: "POST_PISTOL_CONVERSION", detail: "pistol winner conversion is team-level FULL; no legal own-state armor top-up fits the observable money" }],
      assumptions: ["normal-player GSI only", "POST_PISTOL conversion is independent from NORMAL future-affordability guidance"],
      conditionalAlternatives: [],
      adviceStrength: strength,
    }];
  }
  return candidates.map((candidate, index) => conversionOption(state, candidate, index === 0 ? strength : "ALTERNATIVE"));
}

function planOption(
  state: PolicyV3State,
  mode: Exclude<PolicyMode, "LIGHT">,
  strength: RecommendationOption["adviceStrength"],
  boundaries: FutureAffordabilitySet,
): RecommendationOption | null {
  if (!known(state.player.inventory) || !known(state.player.money) || !known(state.round.side)) return null;
  const inventory = state.player.inventory.value;
  let desired = targets(state.round.side.value, mode, inventory, state.player.money.value)[0] ?? [];
  let plan: PurchasePlan | undefined;
  for (const candidate of targets(state.round.side.value, mode, inventory, state.player.money.value)) {
    const next = planPurchases(inventory, compact(candidate), DEFAULT_RULES, state.round.side.value);
    if (mode === "FORCE" && resultingLoadout(inventory, next.purchases).armor === 0) continue;
    const candidateRank = mode === "FORCE" ? forcePrimaryRank(state.round.side.value, candidate) : 0;
    const selectedRank = mode === "FORCE" ? forcePrimaryRank(state.round.side.value, desired) : 0;
    const candidateArmor = mode === "FORCE" ? forceArmorRank(inventory, next) : 0;
    const selectedArmor = mode === "FORCE" && plan !== undefined ? forceArmorRank(inventory, plan) : 0;
    if (next.isComplete && (
      plan === undefined ||
      (next.totalCost <= state.player.money.value && (
        plan.totalCost > state.player.money.value ||
        candidateRank > selectedRank ||
        (candidateRank === selectedRank && (
          candidateArmor > selectedArmor ||
          (candidateArmor === selectedArmor && next.totalCost > plan.totalCost)
        ))
      ))
    )) {
      desired = candidate;
      plan = next;
    }
  }
  if (plan === undefined) return null;
  let helmetAlternative = false;
  if (plan.totalCost > state.player.money.value && mode === "FULL" && state.round.side.value === "CT") {
    const kevlarDesired = desired.map((item) => item === "kevlar_helmet" ? "kevlar" : item);
    const kevlarPlan = planPurchases(inventory, compact(kevlarDesired), DEFAULT_RULES, state.round.side.value);
    if (kevlarPlan.isComplete && kevlarPlan.totalCost <= state.player.money.value) {
      desired = kevlarDesired;
      plan = kevlarPlan;
      helmetAlternative = true;
    }
  }
  if (!plan.isComplete || plan.totalCost > state.player.money.value) return null;
  if (mode === "FORCE" && resultingLoadout(inventory, plan.purchases).armor === 0) return null;
  if (mode === "FORCE" && state.round.side.value === "CT") {
    const loadout = resultingLoadout(inventory, plan.purchases);
    if (loadout.armor > 0 && !loadout.hasHelmet) {
      const completedDesired: ItemId[] = [...desired, "kevlar_helmet"];
      const completedPlan = planPurchases(inventory, compact(completedDesired), DEFAULT_RULES, "CT");
      if (completedPlan.isComplete && completedPlan.totalCost <= state.player.money.value) {
        desired = completedDesired;
        plan = completedPlan;
      }
    }
  }
  const reasons: PolicyReason[] = [{ code: `MODE_${mode}`, detail: "deterministic, inventory-aware legal purchase bundle" }];
  if (mode === "FULL" && state.round.side.value === "CT") reasons.push({ code: "CT_DEFAULT_VESTHELM", detail: "fresh CT armor defaults to vesthelm; opponent inference does not remove it" });
  if (helmetAlternative) reasons.push({ code: "CT_KEVLAR_OWN_STATE", detail: "vesthelm incremental $350 blocks the otherwise affordable own-state full bundle" });
  if (mode === "FORCE" && state.round.side.value === "CT" && plan.purchases.some((purchase) => purchase.item === "kevlar_helmet")) {
    reasons.push({ code: "CT_FORCE_HELMET_COMPLETION", detail: "after primary and utility fitting, an affordable own-state $350 helmet upgrade completes the FORCE bundle" });
  }
  if (state.opponent.status === "INFERRED") reasons.push({ code: "OPPONENT_CONTEXT", detail: "coarse opponent context affects explanation only" });
  const conditionalAlternatives: ConditionalAlternative[] = [];
  if (state.round.side.value === "CT" && mode === "FULL" && !inventory.hasDefuseKit) {
    const kitPlan = planPurchases(inventory, compact([...desired, "defuse_kit"]), DEFAULT_RULES, state.round.side.value);
    if (kitPlan.isComplete && kitPlan.totalCost <= state.player.money.value) conditionalAlternatives.push({ condition: "若队友暂无钳子", purchases: kitPlan.purchases, reason: "钳子不占 grenade slot；队友覆盖不可见" });
  }
  if (state.round.side.value === "T" && mode === "FULL") {
    const alternate = planPurchases(inventory, compact([...desired.filter((item) => item !== "he"), "flash"]), DEFAULT_RULES, state.round.side.value);
    const alternateLoadout = resultingLoadout(inventory, alternate.purchases);
    if (alternate.isComplete && alternate.totalCost <= state.player.money.value && alternateLoadout.grenades.length <= MAX_GRENADE_CARRY && count(alternateLoadout.grenades, "flash") <= 2) conditionalAlternatives.push({ condition: "T fourth utility slot", purchases: alternate.purchases, reason: "HE 与 second flash 均保留为合法 alternative" });
  }
  return {
    id: `${mode.toLowerCase()}-${plan.purchases.map((purchase) => `${purchase.item}${purchase.quantity}`).join("-") || "hold"}`,
    mode,
    spendingGuidance: guidanceFor(mode, boundaries),
    purchases: plan.purchases,
    bundleSpend: plan.totalCost,
    resultingInventory: resultingLoadout(inventory, plan.purchases),
    trajectory: trajectory(state, plan.totalCost),
    reasons,
    assumptions: ["normal-player GSI only", "no V2 preservation budget or fixed buy tier"],
    conditionalAlternatives,
    adviceStrength: strength,
  };
}

function genericOptions(
  state: PolicyV3State,
  boundaries: FutureAffordabilitySet,
): RecommendationOption[] {
  const full = planOption(state, "FULL", "SUPPORTED", boundaries);
  const force = planOption(state, "FORCE", "SUPPORTED", boundaries);
  if (full) {
    return [full, ...(force ? [{ ...force, adviceStrength: "ALTERNATIVE" as const }] : [])];
  }
  if (force) {
    const preserve = planOption(state, "PRESERVE", "ALTERNATIVE", boundaries);
    return [force, ...(preserve ? [preserve] : [])];
  }
  const preserve = planOption(state, "PRESERVE", "SUPPORTED", boundaries);
  return preserve ? [preserve] : [];
}

function previousPistolOutcome(state: PolicyV3State, side: Side): "WIN" | "LOSS" | "UNKNOWN" {
  if (state.history.integrity !== "COMPLETE") return "UNKNOWN";
  const previous = state.history.previousRounds.at(-1);
  if (!previous || previous.roundNumber !== state.round.number.value! - 1 || !known(previous.winner)) return "UNKNOWN";
  return previous.winner.value === side ? "WIN" : "LOSS";
}

/** Resolve a player-declared buy mode without changing the automatic policy
 * recommendation set. The result is mechanics-backed player intent, not a
 * replacement for `defaultOptionId` or automatic advice. */
export function resolveLockedPolicyMode(state: PolicyV3State, mode: PlayerLockedMode): RecommendationOption | null {
  const required = [state.round.side, state.round.context, state.player.money, state.player.inventory, state.player.lossIndex];
  if (required.some((fact) => fact.status === "UNKNOWN" || fact.value === undefined)) return null;
  if (state.round.context.value === "PISTOL") return null;
  const affordability = futureAffordability(state);
  if (mode !== "LIGHT") return planOption(state, mode, "SUPPORTED", affordability);
  if (state.round.context.value !== "NORMAL" || affordability.status !== "PROJECTED") return null;
  for (const boundary of [...affordability.boundaries].sort((a, b) => b.targetCash - a.targetCash)) {
    const option = planLightOption(state, boundary, "SUPPORTED");
    if (option) return option;
  }
  return null;
}

/** Deterministic Policy V3 core. It never reads an opponent economy value. */
export function recommendPolicyV3(state: PolicyV3State): PolicyV3Output {
  const affordability = futureAffordability(state);
  const required = [state.round.side, state.player.money, state.player.inventory, state.player.lossIndex, state.round.context];
  const unresolved = required.filter((fact) => fact.status === "UNKNOWN" || fact.value === undefined).map((fact) => `${fact.source}: ${fact.reason ?? "UNKNOWN"}`);
  if (unresolved.length > 0) return { status: "INSUFFICIENT_STATE", futureAffordability: affordability, options: [], unresolved, opponent: state.opponent };
  const context = state.round.context.value!;
  const side = state.round.side.value!;
  const inventory = state.player.inventory.value!;
  const money = state.player.money.value!;
  const lossIndex = state.player.lossIndex.value!;
  const preference = state.preference ?? DEFAULT_PREFERENCE;
  if (context === "PISTOL") {
    return {
      status: "UNSUPPORTED_POLICY_EVIDENCE", futureAffordability: affordability, options: [], unresolved: ["pistol-round purchase policy is outside the frozen Policy V3 evidence scope"], opponent: state.opponent,
    };
  }
  let options: RecommendationOption[];
  if (context === "POST_PISTOL") {
    const pistolOutcome = previousPistolOutcome(state, side);
    if (pistolOutcome === "WIN") {
      options = planPostPistolConversionOptions(state, "SUPPORTED");
    } else if (pistolOutcome === "LOSS") {
      const modes: Array<[Exclude<PolicyMode, "LIGHT">, RecommendationOption["adviceStrength"]]> = side === "T"
        ? [["PRESERVE", "SUPPORTED"], ["FORCE", "SUPPORTED"]]
        : [["FORCE", "DOMINANT"], ["PRESERVE", "ALTERNATIVE"]];
      options = modes.flatMap(([mode, strength]) => {
        const option = planOption(state, mode, strength, affordability);
        return option ? [option] : [];
      });
    } else {
      // Missing history must not be silently treated as either a pistol win or
      // loss. Keep the conservative supported set and suppress a default.
      options = [
        planOption(state, "PRESERVE", "SUPPORTED", affordability),
        planOption(state, "FORCE", "SUPPORTED", affordability),
      ].filter((option): option is RecommendationOption => option !== null);
    }
  } else {
    options = genericOptions(state, affordability);
  }
  const awp = preference.source === "USER_DECLARED" ? planOption(state, "AWP_PATH", "SUPPORTED", affordability) : null;
  let saveForAwp = false;
  if (preference.source === "USER_DECLARED" && preference.awpPriority === "PREFER" && awp) {
    options = [{ ...awp, adviceStrength: "DOMINANT" }, ...options.filter((option) => option.mode !== "AWP_PATH")];
  } else if (preference.source === "USER_DECLARED" && preference.awpPriority === "SAVE_FOR_AWP" && !awp) {
    const awpWithArmor = planPurchases({ ...inventory, primary: null, armor: 0, hasHelmet: false, hasDefuseKit: inventory.hasDefuseKit, grenades: inventory.grenades }, compact(["awp", "kevlar"]), DEFAULT_RULES, side);
    const noSpend = projectNextRoundMoney({ money, spendNow: 0, side, lossStreak: lossIndex, kills: [], rules: DEFAULT_RULES });
    // The preserved current inventory is not asserted as a future fact. This
    // uses the conservative empty-inventory AWP+armor cash requirement.
    saveForAwp = awpWithArmor.isComplete && noSpend.loss >= awpWithArmor.totalCost;
    if (saveForAwp && !options.some((option) => option.mode === "PRESERVE")) {
      const preserve = planOption(state, "PRESERVE", "ALTERNATIVE", affordability);
      if (preserve) options.push(preserve);
    }
  } else if (preference.source === "USER_DECLARED" && preference.awpPriority === "SAVE_FOR_AWP" && awp) {
    options = [{ ...awp, adviceStrength: "DOMINANT" }, ...options.filter((option) => option.mode !== "AWP_PATH")];
  }
  if (context === "NORMAL" && affordability.status === "PROJECTED" && !options.some((option) => option.mode === "FULL")) {
    const lightStrength: RecommendationOption["adviceStrength"] = options.some((option) => option.mode === "FORCE") ? "ALTERNATIVE" : "SUPPORTED";
    const lightOptions = affordability.boundaries
      .filter((boundary) => boundary.reachableWithNoSpend)
      .sort((a, b) => b.targetCash - a.targetCash)
      .map((boundary) => planLightOption(state, boundary, lightStrength))
      .filter((option): option is RecommendationOption => option !== null)
      .filter((option, index, all) => all.findIndex((candidate) => JSON.stringify(candidate.purchases) === JSON.stringify(option.purchases)) === index);
    if (lightOptions.length > 0) {
      const preserveIndex = options.findIndex((option) => option.mode === "PRESERVE");
      if (preserveIndex >= 0) options = [...options.slice(0, preserveIndex), ...lightOptions, ...options.slice(preserveIndex)];
      else options = [...options, ...lightOptions];
    }
  }
  options = options.map((option) => {
    if (!saveForAwp || option.mode !== "PRESERVE") return option;
    return { ...option, reasons: [...option.reasons, { code: "SAVE_FOR_AWP_HORIZON", detail: "no-purchase t+1 loss scenario reaches conservative AWP + armor cash requirement" }] };
  });
  return {
    status: "READY",
    futureAffordability: affordability,
    options,
    defaultOptionId: context === "POST_PISTOL" && previousPistolOutcome(state, side) !== "LOSS" ? undefined : options.find((option) => option.adviceStrength === "DOMINANT")?.id,
    unresolved: state.opponent.status === "UNKNOWN" ? ["opponent economy: UNKNOWN; base recommendations unchanged"] : [],
    opponent: state.opponent,
  };
}

/** Runtime adapter for the held-out opponent contract. The research result
 * records metrics but no fitted coefficients or compact calibrated table;
 * inventing either would turn an evidence gate into a false live capability.
 * The core therefore preserves the explicit UNKNOWN fallback until that
 * already-specified artifact is supplied. */
export function inferOpponentEconomy(input: OpponentFeatureInput): Inference<OpponentEconomyClass> {
  return inferFromCalibration(input);
}
