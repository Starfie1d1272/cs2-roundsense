import type { ItemId, Side } from "@roundsense/shared-types";
import { planPurchases, resultingLoadout, rifleFor, smgFor, type PurchasePlan } from "./advisor.js";
import { projectNextRoundMoney } from "./projection.js";
import { DEFAULT_RULES, price } from "./rules.js";
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
  reachableModes: readonly PolicyMode[];
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
  status: "READY" | "INSUFFICIENT_STATE";
  options: readonly RecommendationOption[];
  defaultOptionId?: string;
  unresolved: readonly string[];
  opponent: Inference<OpponentEconomyClass>;
}

const DEFAULT_PREFERENCE: UserPreference = { source: "DEFAULT", awpPriority: "NEUTRAL" };
const MAX_GRENADE_SLOTS = 4;

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
  const canAdd = (item: ItemId) => desired.length < MAX_GRENADE_SLOTS && (item !== "flash" || count(desired, "flash") < 2);
  const tryAdd = (item: ItemId) => {
    if (canAdd(item) && price(DEFAULT_RULES, item) <= budget) {
      desired.push(item);
      budget -= price(DEFAULT_RULES, item);
    }
  };

  // Existing utility is respected before any new slot is allocated.
  if (budget >= 500) {
    tryAdd("smoke");
    tryAdd(sideFire(side));
    tryAdd("flash");
  } else if (budget >= 300) {
    tryAdd("smoke");
    tryAdd("flash");
  } else if (budget >= 200) {
    tryAdd("flash");
  }

  if (initialBudget >= 600) {
    if (side === "CT") {
      tryAdd("he"); // CT evidence supports HE over a second flash.
      tryAdd("flash");
    } else {
      // The T fourth slot remains intentionally multimodal; the caller emits both alternatives.
      tryAdd("he");
    }
  }
  return desired;
}

function targets(side: Side, mode: PolicyMode, inventory: InventoryState, money: number): ItemId[] {
  const items: ItemId[] = [];
  if (mode === "PRESERVE") return items;
  if (mode === "AWP_PATH") {
    add(items, "awp");
  } else if (mode === "LIGHT") {
    add(items, smgFor(side));
    add(items, "kevlar");
  } else if (mode === "FORCE") {
    add(items, smgFor(side));
    add(items, "kevlar");
    add(items, "flash");
  } else {
    add(items, rifleFor(side));
    // CT defaults to vesthelm; Kevlar is not an opponent-derived decision.
    add(items, "kevlar_helmet");
  }

  const primaryArmor = planPurchases(inventory, compact(items), DEFAULT_RULES).totalCost;
  const utility = utilityBundle(side, inventory, Math.max(0, money - primaryArmor));
  for (const grenade of utility) {
    if (!inventory.grenades.includes(grenade)) add(items, grenade);
    else if (grenade === "flash" && count(inventory.grenades, "flash") < count(utility, "flash")) add(items, grenade);
  }
  return items;
}

function compact(items: readonly ItemId[]): PurchaseItem[] {
  const result = new Map<ItemId, number>();
  for (const item of items) result.set(item, (result.get(item) ?? 0) + 1);
  return [...result].map(([item, quantity]) => ({ item, quantity }));
}

function trajectory(state: PolicyV3State, spend: number): TrajectoryScenario[] {
  if (!known(state.player.money) || !known(state.player.lossIndex) || !known(state.round.side)) return [];
  const projected = projectNextRoundMoney({
    money: state.player.money.value,
    spendNow: spend,
    side: state.round.side.value,
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
  const winIndex: Fact<number> = { status: "TRACKED", value: 0, source: "CS2 loss-bonus rule", asOfSeq: state.player.lossIndex.asOfSeq };
  const reach = (money: number): PolicyMode[] => {
    const modes: PolicyMode[] = ["PRESERVE"];
    if (money >= 1200) modes.push("LIGHT");
    if (money >= 2000) modes.push("FORCE");
    if (money >= 3700) modes.push("FULL");
    if (money >= 5750) modes.push("AWP_PATH");
    return modes;
  };
  const scenarios: TrajectoryScenario[] = [
    { id: "WIN", assumptions, nextMoney: { min: projected.win, max: projected.win }, nextLossIndex: winIndex, reachableModes: reach(projected.win) },
    { id: "LOSS_NO_PLANT", assumptions, nextMoney: { min: projected.loss, max: projected.loss }, nextLossIndex: lossIndex, reachableModes: reach(projected.loss) },
  ];
  if (state.round.side.value === "T") {
    scenarios.push({ id: "LOSS_WITH_PLANT", assumptions: [...assumptions, "T plant reward only in this hypothetical branch"], nextMoney: { min: projected.lossWithPlant, max: projected.lossWithPlant }, nextLossIndex: lossIndex, reachableModes: reach(projected.lossWithPlant) });
  }
  return scenarios;
}

function planOption(state: PolicyV3State, mode: PolicyMode, strength: RecommendationOption["adviceStrength"]): RecommendationOption | null {
  if (!known(state.player.inventory) || !known(state.player.money) || !known(state.round.side)) return null;
  const inventory = state.player.inventory.value;
  const desired = targets(state.round.side.value, mode, inventory, state.player.money.value);
  const plan: PurchasePlan = planPurchases(inventory, compact(desired), DEFAULT_RULES);
  if (plan.totalCost > state.player.money.value) return null;
  const reasons: PolicyReason[] = [{ code: `MODE_${mode}`, detail: "deterministic, inventory-aware legal purchase bundle" }];
  if (mode === "FULL" && state.round.side.value === "CT") reasons.push({ code: "CT_DEFAULT_VESTHELM", detail: "fresh CT armor defaults to vesthelm; opponent inference does not remove it" });
  if (state.opponent.status === "INFERRED") reasons.push({ code: "OPPONENT_CONTEXT", detail: "coarse opponent context affects explanation only" });
  const conditionalAlternatives: ConditionalAlternative[] = [];
  if (state.round.side.value === "CT" && mode === "FULL" && !inventory.hasDefuseKit) {
    const kitPlan = planPurchases(inventory, compact([...desired, "defuse_kit"]), DEFAULT_RULES);
    if (kitPlan.totalCost <= state.player.money.value) conditionalAlternatives.push({ condition: "若队友暂无钳子", purchases: kitPlan.purchases, reason: "钳子不占 grenade slot；队友覆盖不可见" });
  }
  if (state.round.side.value === "T" && mode === "FULL") {
    const alternate = planPurchases(inventory, compact([...desired.filter((item) => item !== "he"), "flash"]), DEFAULT_RULES);
    if (alternate.totalCost <= state.player.money.value && count(resultingLoadout(inventory, alternate.purchases).grenades, "flash") <= 2) conditionalAlternatives.push({ condition: "T fourth utility slot", purchases: alternate.purchases, reason: "HE 与 second flash 均保留为合法 alternative" });
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

/** Deterministic Policy V3 core. It never reads an opponent economy value. */
export function recommendPolicyV3(state: PolicyV3State): PolicyV3Output {
  const required = [state.round.side, state.player.money, state.player.inventory, state.player.lossIndex, state.round.context];
  const unresolved = required.filter((fact) => fact.status === "UNKNOWN" || fact.value === undefined).map((fact) => `${fact.source}: ${fact.reason ?? "UNKNOWN"}`);
  if (unresolved.length > 0) return { status: "INSUFFICIENT_STATE", options: [], unresolved, opponent: state.opponent };
  const context = state.round.context.value;
  const preference = state.preference ?? DEFAULT_PREFERENCE;
  const modes: Array<[PolicyMode, RecommendationOption["adviceStrength"]]> = context === "POST_PISTOL"
    ? state.round.side.value === "T"
      ? [["PRESERVE", "SUPPORTED"], ["FORCE", "SUPPORTED"]]
      : [["FORCE", "DOMINANT"], ["PRESERVE", "ALTERNATIVE"]]
    : [["FULL", "SUPPORTED"], ["FORCE", "ALTERNATIVE"], ["LIGHT", "ALTERNATIVE"], ["PRESERVE", "ALTERNATIVE"]];
  if (preference.source === "USER_DECLARED" && preference.awpPriority !== "NEUTRAL") modes.unshift(["AWP_PATH", preference.awpPriority === "PREFER" ? "SUPPORTED" : "DOMINANT"]);
  const options = modes.map(([mode, strength]) => planOption(state, mode, strength)).filter((option): option is RecommendationOption => option !== null);
  return {
    status: "READY",
    options,
    defaultOptionId: context === "POST_PISTOL" && state.round.side.value === "T" ? undefined : options.find((option) => option.adviceStrength === "DOMINANT")?.id,
    unresolved: state.opponent.status === "UNKNOWN" ? ["opponent economy: UNKNOWN; base recommendations unchanged"] : [],
    opponent: state.opponent,
  };
}

/** Runtime adapter for the held-out opponent contract. The research result
 * records metrics but no fitted coefficients or compact calibrated table;
 * inventing either would turn an evidence gate into a false live capability.
 * The core therefore preserves the explicit UNKNOWN fallback until that
 * already-specified artifact is supplied. */
export function inferOpponentEconomy(input: {
  asOfSeq: number;
  context: Fact<RoundContext>;
  opponentLossIndex: Fact<number>;
  ownScore: Fact<{ ct: number; t: number }>;
}): Inference<OpponentEconomyClass> {
  const calibrationId = "policy-v3-opponent-direct-gsi-2026-08";
  return {
    status: "UNKNOWN",
    calibrationId,
    inputsAsOfSeq: input.asOfSeq,
    reason: !known(input.context) || !known(input.opponentLossIndex) || !known(input.ownScore)
      ? "required direct-GSI fact missing"
      : "held-out metrics exist, but deployable model coefficients/constants are not in the authoritative evidence parent",
  };
}
