import type { ItemId, Side } from "@roundsense/shared-types";
import { planPurchases, resultingLoadout, rifleFor, smgFor, type PurchasePlan } from "./advisor.js";
import { projectNextRoundMoney } from "./projection.js";
import { DEFAULT_RULES, grenadeCarryCap, MAX_GRENADE_CARRY, price } from "./rules.js";
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
export type RoundContext = "PISTOL" | "POST_PISTOL" | "NORMAL" | "OVERTIME";
export type OpponentEconomyClass = "LIKELY_ESTABLISHED_RIFLE" | "LIKELY_NOT_ESTABLISHED_RIFLE" | "UNKNOWN";

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
  purchases: readonly PurchaseItem[];
  spend: number;
  resultingInventory: ReturnType<typeof resultingLoadout>;
  trajectory: readonly TrajectoryScenario[];
  reasons: readonly PolicyReason[];
  assumptions: readonly string[];
  conditionalAlternatives: readonly ConditionalAlternative[];
  adviceStrength: "DOMINANT" | "SUPPORTED" | "ALTERNATIVE";
}

export interface PolicyV3Output {
  status: "READY" | "INSUFFICIENT_STATE" | "UNSUPPORTED_POLICY_EVIDENCE";
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
  } else if (mode === "LIGHT") {
    add(items, smgFor(side));
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

  // LIGHT is deliberately a controlled partial investment: establish the
  // affordable SMG + armor bundle, but do not turn every remaining dollar
  // into the FORCE utility fit. Retained utility remains untouched.
  if (mode !== "LIGHT") {
    const primaryArmor = planPurchases(inventory, compact(items), DEFAULT_RULES, side).totalCost;
    const utility = utilityBundle(side, inventory, Math.max(0, money - primaryArmor));
    items.push(...utility);
  }
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

function planOption(state: PolicyV3State, mode: PolicyMode, strength: RecommendationOption["adviceStrength"]): RecommendationOption | null {
  if (!known(state.player.inventory) || !known(state.player.money) || !known(state.round.side)) return null;
  const inventory = state.player.inventory.value;
  let desired = targets(state.round.side.value, mode, inventory, state.player.money.value)[0] ?? [];
  let plan: PurchasePlan | undefined;
  for (const candidate of targets(state.round.side.value, mode, inventory, state.player.money.value)) {
    const next = planPurchases(inventory, compact(candidate), DEFAULT_RULES, state.round.side.value);
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
    purchases: plan.purchases,
    spend: plan.totalCost,
    resultingInventory: resultingLoadout(inventory, plan.purchases),
    trajectory: trajectory(state, plan.totalCost),
    reasons,
    assumptions: ["normal-player GSI only", "no V2 preservation budget or fixed buy tier"],
    conditionalAlternatives,
    adviceStrength: strength,
  };
}

function genericModes(state: PolicyV3State): Array<[PolicyMode, RecommendationOption["adviceStrength"]]> {
  const full = planOption(state, "FULL", "SUPPORTED");
  const force = planOption(state, "FORCE", "SUPPORTED");
  const light = planOption(state, "LIGHT", "SUPPORTED");
  const controlledLight = light !== null && force !== null && light.spend > 0 && light.spend < force.spend;
  if (full) {
    return [["FULL", "SUPPORTED"], ...(force ? [["FORCE", "ALTERNATIVE"] as [PolicyMode, RecommendationOption["adviceStrength"]]] : [])];
  }
  if (force) {
    return [
      ["FORCE", "SUPPORTED"],
      ...(controlledLight ? [["LIGHT", "ALTERNATIVE"] as [PolicyMode, RecommendationOption["adviceStrength"]]] : []),
      ["PRESERVE", "ALTERNATIVE"],
    ];
  }
  if (light) return [["LIGHT", "SUPPORTED"], ["PRESERVE", "ALTERNATIVE"]];
  return [["PRESERVE", "SUPPORTED"]];
}

function previousPistolOutcome(state: PolicyV3State, side: Side): "WIN" | "LOSS" | "UNKNOWN" {
  if (state.history.integrity !== "COMPLETE") return "UNKNOWN";
  const previous = state.history.previousRounds.at(-1);
  if (!previous || previous.roundNumber !== state.round.number.value! - 1 || !known(previous.winner)) return "UNKNOWN";
  return previous.winner.value === side ? "WIN" : "LOSS";
}

/** Deterministic Policy V3 core. It never reads an opponent economy value. */
export function recommendPolicyV3(state: PolicyV3State): PolicyV3Output {
  const required = [state.round.side, state.player.money, state.player.inventory, state.player.lossIndex, state.round.context];
  const unresolved = required.filter((fact) => fact.status === "UNKNOWN" || fact.value === undefined).map((fact) => `${fact.source}: ${fact.reason ?? "UNKNOWN"}`);
  if (unresolved.length > 0) return { status: "INSUFFICIENT_STATE", options: [], unresolved, opponent: state.opponent };
  const context = state.round.context.value!;
  const side = state.round.side.value!;
  const inventory = state.player.inventory.value!;
  const money = state.player.money.value!;
  const lossIndex = state.player.lossIndex.value!;
  const preference = state.preference ?? DEFAULT_PREFERENCE;
  if (context === "PISTOL") {
    return {
      status: "UNSUPPORTED_POLICY_EVIDENCE", options: [], unresolved: ["pistol-round purchase policy is outside the frozen Policy V3 evidence scope"], opponent: state.opponent,
    };
  }
  let modes: Array<[PolicyMode, RecommendationOption["adviceStrength"]]>;
  if (context === "POST_PISTOL") {
    const pistolOutcome = previousPistolOutcome(state, side);
    if (pistolOutcome === "WIN") {
      modes = genericModes(state);
    } else if (pistolOutcome === "LOSS") {
      modes = side === "T"
        ? [["PRESERVE", "SUPPORTED"], ["FORCE", "SUPPORTED"]]
        : [["FORCE", "DOMINANT"], ["PRESERVE", "ALTERNATIVE"]];
    } else {
      // Missing history must not be silently treated as either a pistol win or
      // loss. Keep the conservative supported set and suppress a default.
      modes = [["PRESERVE", "SUPPORTED"], ["FORCE", "SUPPORTED"]];
    }
  } else {
    // Normal and OT use the same generic non-pistol policy.  We compare only
    // complete, inventory-aware legal bundles; without a calibrated utility
    // value model competing affordable options remain explicitly non-dominant.
    modes = genericModes(state);
  }
  const awp = preference.source === "USER_DECLARED" ? planOption(state, "AWP_PATH", "SUPPORTED") : null;
  let saveForAwp = false;
  if (preference.source === "USER_DECLARED" && preference.awpPriority === "PREFER" && awp) {
    modes = [["AWP_PATH", "DOMINANT"], ...modes.filter(([mode]) => mode !== "AWP_PATH")];
  } else if (preference.source === "USER_DECLARED" && preference.awpPriority === "SAVE_FOR_AWP" && !awp) {
    const awpWithArmor = planPurchases({ ...inventory, primary: null, armor: 0, hasHelmet: false, hasDefuseKit: inventory.hasDefuseKit, grenades: inventory.grenades }, compact(["awp", "kevlar"]), DEFAULT_RULES, side);
    const noSpend = projectNextRoundMoney({ money, spendNow: 0, side, lossStreak: lossIndex, kills: [], rules: DEFAULT_RULES });
    // The preserved current inventory is not asserted as a future fact. This
    // uses the conservative empty-inventory AWP+armor cash requirement.
    saveForAwp = awpWithArmor.isComplete && noSpend.loss >= awpWithArmor.totalCost;
    if (saveForAwp && !modes.some(([mode]) => mode === "PRESERVE")) modes.push(["PRESERVE", "ALTERNATIVE"]);
  } else if (preference.source === "USER_DECLARED" && preference.awpPriority === "SAVE_FOR_AWP" && awp) {
    modes = [["AWP_PATH", "DOMINANT"], ...modes.filter(([mode]) => mode !== "AWP_PATH")];
  }
  const options = modes.map(([mode, strength]) => planOption(state, mode, strength)).filter((option): option is RecommendationOption => option !== null).map((option) => {
    if (!saveForAwp || option.mode !== "PRESERVE") return option;
    return { ...option, reasons: [...option.reasons, { code: "SAVE_FOR_AWP_HORIZON", detail: "no-purchase t+1 loss scenario reaches conservative AWP + armor cash requirement" }] };
  });
  return {
    status: "READY",
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
