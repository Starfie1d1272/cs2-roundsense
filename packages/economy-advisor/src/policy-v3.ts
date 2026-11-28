import type { ItemId, Side } from '@roundsense/shared-types';
import {
  type PostLoadout,
  type PurchasePlan,
  planPurchases,
  resultingLoadout,
  rifleFor,
  smgFor,
} from './advisor.js';
import {
  inferOpponentEconomy as inferFromCalibration,
  type OpponentFeatureInput,
} from './opponent-economy.js';
import { projectNextRoundMoney } from './projection.js';
import {
  DEFAULT_RULES,
  grenadeCarryCap,
  lossBonus,
  MAX_GRENADE_CARRY,
  price,
  weaponClassOf,
} from './rules.js';
import type { InventoryState, PurchaseItem } from './types.js';

export type FactStatus = 'OBSERVED' | 'TRACKED' | 'UNKNOWN';

export interface Fact<T> {
  status: FactStatus;
  value?: T;
  source: string;
  asOfSeq: number;
  reason?: string;
}

export interface Inference<T> {
  status: 'INFERRED' | 'UNKNOWN';
  value?: T;
  probability?: number;
  calibrationId?: string;
  inputsAsOfSeq: number;
  reason?: string;
}

export type PolicyMode = 'PRESERVE' | 'LIGHT' | 'FORCE' | 'FULL' | 'AWP_PATH';
export type RoundContext = 'PISTOL' | 'POST_PISTOL' | 'NORMAL' | 'OVERTIME';
export type OpponentEconomyClass =
  'LIKELY_ESTABLISHED_RIFLE' | 'LIKELY_NOT_ESTABLISHED_RIFLE' | 'UNKNOWN';
export type ProtectedNextBuyCapability = 'RIFLE_ARMOR' | 'RIFLE_ARMOR_BASIC_UTILITY';

export interface FutureAffordabilityBoundary {
  layer: 'SCENARIO';
  scenario: 'LOSS_NO_PLANT';
  capability: ProtectedNextBuyCapability;
  targetCash: number;
  requiredReserveNow: number;
  reachableWithNoSpend: boolean;
  maxSpendNow: number;
  assumptions: readonly string[];
}

export type FutureAffordabilitySet =
  | {
      status: 'PROJECTED';
      context: 'NORMAL';
      boundaries: readonly FutureAffordabilityBoundary[];
    }
  | { status: 'UNKNOWN'; boundaries: readonly []; reason: string }
  | {
      status: 'NOT_APPLICABLE';
      boundaries: readonly [];
      reason:
        | 'POST_PISTOL_STRATEGY'
        | 'PISTOL_UNSUPPORTED'
        | 'OVERTIME_UNSUPPORTED'
        | 'HALF_END_RESET'
        | 'MATCH_POINT_AGAINST';
    };

export type SpendingGuidance =
  | {
      layer: 'ADVICE';
      kind: 'MINIMIZE';
      protectedCapability?: ProtectedNextBuyCapability;
    }
  | {
      layer: 'ADVICE';
      kind: 'BOUNDED';
      protectedCapability: ProtectedNextBuyCapability;
    }
  | { layer: 'ADVICE'; kind: 'CURRENT_ROUND_PRIORITY' }
  | { layer: 'ADVICE'; kind: 'COMPLETE_CURRENT_BUY' };

export interface UserPreference {
  source: 'DEFAULT' | 'USER_DECLARED';
  awpPriority: 'NEUTRAL' | 'PREFER' | 'SAVE_FOR_AWP';
  riskBias?: 'NEUTRAL' | 'PRESERVE' | 'CONTEST';
  utilityBias?: 'NEUTRAL' | 'PREFER';
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
  history: {
    integrity: 'COMPLETE' | 'PARTIAL' | 'COLD_START';
    previousRounds: readonly RoundHistoryFact[];
  };
  opponent: Inference<OpponentEconomyClass>;
  preference: UserPreference;
}

export interface RoundHistoryFact {
  roundNumber: number;
  winner: Fact<Side>;
  planted: Fact<boolean>;
}

export interface TrajectoryScenario {
  id: 'WIN' | 'LOSS_NO_PLANT' | 'LOSS_WITH_PLANT';
  assumptions: readonly string[];
  nextMoney: { min: number; max: number };
  nextLossIndex: Fact<number>;
  /** Explicit t+1 action and t+2 loss scenario; never a hidden save bank. */
  followingRound: {
    action: 'PRESERVE';
    outcome: 'LOSS_NO_PLANT';
    money: Fact<{ min: number; max: number }>;
    lossIndex: Fact<number>;
    reachability: Fact<'UNKNOWN'>;
  };
}

export interface PolicyReason {
  code: string;
  detail: string;
}

export interface ConditionalAlternative {
  condition: string;
  purchases: readonly PurchaseItem[];
  bundleSpend: number;
  reason: string;
}

export interface RecommendationOption {
  id: string;
  mode: PolicyMode;
  spendingGuidance: SpendingGuidance;
  purchases: readonly PurchaseItem[];
  bundleSpend: number;
  resultingInventory: PostLoadout;
  trajectory: readonly TrajectoryScenario[];
  reasons: readonly PolicyReason[];
  assumptions: readonly string[];
  conditionalAlternatives: readonly ConditionalAlternative[];
  adviceStrength: 'DOMINANT' | 'SUPPORTED' | 'ALTERNATIVE';
}

export interface PolicyV3Output {
  status: 'READY' | 'INSUFFICIENT_STATE' | 'UNSUPPORTED_POLICY_EVIDENCE';
  futureAffordability: FutureAffordabilitySet;
  options: readonly RecommendationOption[];
  defaultOptionId?: string;
  unresolved: readonly string[];
  opponent: Inference<OpponentEconomyClass>;
}

const DEFAULT_PREFERENCE: UserPreference = {
  source: 'DEFAULT',
  awpPriority: 'NEUTRAL',
};
const MAIN_RIFLES = new Set<ItemId>(['ak47', 'm4a4', 'm4a1s', 'aug', 'sg553']);
const ECO_RIFLES = new Set<ItemId>(['galil', 'famas']);
const EFFECTIVE_GRENADES = new Set<ItemId>(['smoke', 'flash', 'he', 'molotov', 'incendiary']);

/** Ordered common utility combinations per side (Cologne Major 2026 slices). */
const UTILITY_COMBOS: Readonly<Record<Side, readonly (readonly ItemId[])[]>> = {
  CT: [
    ['smoke', 'incendiary', 'he', 'flash'],
    ['smoke', 'incendiary', 'he'],
    ['smoke', 'incendiary', 'flash'],
    ['smoke', 'he', 'flash'],
    ['smoke', 'incendiary'],
    ['smoke', 'he'],
    ['smoke', 'flash'],
    ['smoke'],
    ['flash'],
  ],
  T: [
    ['smoke', 'molotov', 'flash', 'he'],
    ['smoke', 'molotov', 'flash', 'flash'],
    ['smoke', 'molotov', 'flash'],
    ['smoke', 'flash', 'flash'],
    ['smoke', 'molotov'],
    ['smoke', 'flash'],
    ['smoke'],
    ['flash'],
  ],
};

function known<T>(fact: Fact<T>): fact is Fact<T> & { value: T } {
  return fact.status !== 'UNKNOWN' && fact.value !== undefined;
}

function count(items: readonly ItemId[], item: ItemId): number {
  return items.filter((candidate) => candidate === item).length;
}

function compact(items: readonly ItemId[]): PurchaseItem[] {
  const result = new Map<ItemId, number>();
  for (const item of items) result.set(item, (result.get(item) ?? 0) + 1);
  return [...result].map(([item, quantity]) => ({ item, quantity }));
}

function purchaseSignature(purchases: readonly PurchaseItem[]): string {
  return [...purchases]
    .sort((a, b) => a.item.localeCompare(b.item))
    .map((p) => `${p.item}:${p.quantity}`)
    .join(',');
}

function baseArmorFor(side: Side): 'kevlar' | 'kevlar_helmet' {
  return side === 'T' ? 'kevlar_helmet' : 'kevlar';
}

function paidPistolFor(side: Side): ItemId {
  return side === 'T' ? 'tec9' : 'fiveseven';
}

/**
 * Unified canonical full-utility target cash derived directly from the planner's
 * side rifle, base armor, and top 4-grenade combo (CT $4,850, T $4,900).
 */
export function fullUtilityTargetCash(side: Side): number {
  const items: ItemId[] = [rifleFor(side), baseArmorFor(side), ...UTILITY_COMBOS[side][0]!];
  return items.reduce((total, item) => total + price(DEFAULT_RULES, item), 0);
}

export function nextBuyTargetCash(side: Side, capability: ProtectedNextBuyCapability): number {
  const items: ItemId[] = [rifleFor(side), baseArmorFor(side)];
  if (capability === 'RIFLE_ARMOR_BASIC_UTILITY') items.push('smoke', 'flash');
  return items.reduce((total, item) => total + price(DEFAULT_RULES, item), 0);
}

export type NextBuyCapabilityTier =
  'FULL_UTILITY' | 'RIFLE_ARMOR_BASIC_UTILITY' | 'RIFLE_ARMOR' | 'INSUFFICIENT';

export function classifyNextBuyCapability(side: Side, cash: number): NextBuyCapabilityTier {
  if (cash >= fullUtilityTargetCash(side)) return 'FULL_UTILITY';
  if (cash >= nextBuyTargetCash(side, 'RIFLE_ARMOR_BASIC_UTILITY'))
    return 'RIFLE_ARMOR_BASIC_UTILITY';
  if (cash >= nextBuyTargetCash(side, 'RIFLE_ARMOR')) return 'RIFLE_ARMOR';
  return 'INSUFFICIENT';
}

function effectiveGrenadeCount(loadout: PostLoadout): number {
  return loadout.grenades.filter((g) => EFFECTIVE_GRENADES.has(g)).length;
}

function hasMainRifleOrAwp(primary: ItemId | null | undefined): boolean {
  return (
    primary !== null && primary !== undefined && (MAIN_RIFLES.has(primary) || primary === 'awp')
  );
}

function hasEcoRifle(primary: ItemId | null | undefined): boolean {
  return primary !== null && primary !== undefined && ECO_RIFLES.has(primary);
}

function hasBaseArmor(side: Side, loadout: PostLoadout): boolean {
  return side === 'T' ? loadout.armor > 0 && loadout.hasHelmet : loadout.armor > 0;
}

/**
 * Full-buy capability on the resulting loadout:
 * main rifle/AWP (or retained eco-rifle) + side base armor + >= 2 effective grenades.
 * Smoke is preferred by utility planning, not a hard requirement for already-full slots.
 */
function isCompleteLoadout(side: Side, loadout: PostLoadout, inventory: InventoryState): boolean {
  if (!hasBaseArmor(side, loadout) || effectiveGrenadeCount(loadout) < 2) return false;
  if (hasMainRifleOrAwp(loadout.primary)) return true;
  return hasEcoRifle(inventory.primary) && loadout.primary === inventory.primary;
}

/**
 * Unified utility planning from common side combos, respecting existing grenades
 * and real incremental cost within the remaining budget.
 */
export function utilityBundle(side: Side, inventory: InventoryState, budget: number): ItemId[] {
  const existing = [...inventory.grenades];
  if (existing.length >= MAX_GRENADE_CARRY || budget < price(DEFAULT_RULES, 'flash')) {
    return existing;
  }

  let bestDesired = existing;
  let bestAddedCount = 0;

  for (const combo of UTILITY_COMBOS[side]) {
    const desired = [...existing];
    let cost = 0;
    let added = 0;
    const isFire = (g: ItemId) => g === 'molotov' || g === 'incendiary';
    const effectiveCount = (list: readonly ItemId[], g: ItemId) =>
      isFire(g) ? list.filter(isFire).length : count(list, g);
    for (const item of combo) {
      if (desired.length >= MAX_GRENADE_CARRY) break;
      const cap = grenadeCarryCap(item) ?? 0;
      const needed = count(combo, item) - effectiveCount(desired, item);
      if (needed <= 0) continue;
      for (let i = 0; i < needed; i++) {
        if (desired.length >= MAX_GRENADE_CARRY || effectiveCount(desired, item) >= cap) break;
        const unit = price(DEFAULT_RULES, item);
        if (cost + unit > budget) break;
        desired.push(item);
        cost += unit;
        added += 1;
      }
    }
    if (added === 0) continue;
    // Prefer the first combo that satisfies the full target combo within budget;
    // otherwise keep the partial fill that adds the most effective utility.
    const fullComboMet = combo.every(
      (item) =>
        effectiveCount(desired, item) >= Math.min(count(combo, item), grenadeCarryCap(item) ?? 0),
    );
    if (fullComboMet) return desired;
    if (added > bestAddedCount) {
      bestDesired = desired;
      bestAddedCount = added;
    }
  }
  return bestDesired;
}

interface LoadoutPlanOptions {
  /** Prefer vesthelm before utility (e.g. post-pistol winner conversion). */
  preferVesthelm?: boolean;
  /** Target an AWP loadout. */
  wantAwp?: boolean;
  /** Target a specific primary weapon (e.g. SMG conversion). */
  targetPrimary?: ItemId;
  /** Require armor in the resulting loadout (default true for combat buys). */
  requireArmor?: boolean;
}

/**
 * Fill armor, utility, and (for CT) leftover helmet upgrade on top of a core item list.
 */
function buildCandidatePlan(
  side: Side,
  inventory: InventoryState,
  budget: number,
  coreItems: readonly ItemId[],
  preferVesthelm: boolean,
): PurchasePlan | null {
  const core = planPurchases(inventory, compact(coreItems), DEFAULT_RULES, side);
  if (!core.isComplete || core.totalCost > budget) return null;

  const utility = utilityBundle(side, inventory, budget - core.totalCost);
  let desired: ItemId[] = [...coreItems, ...utility];
  let plan = planPurchases(inventory, compact(desired), DEFAULT_RULES, side);
  if (!plan.isComplete || plan.totalCost > budget) {
    desired = [...coreItems];
    plan = core;
  }

  // CT normal rounds prioritize utility over helmet; top up helmet if budget remains.
  if (side === 'CT' && !preferVesthelm) {
    const loadout = resultingLoadout(inventory, plan.purchases);
    if (loadout.armor > 0 && !loadout.hasHelmet) {
      const withHelmet = desired.filter((item) => item !== 'kevlar');
      withHelmet.push('kevlar_helmet');
      const upgraded = planPurchases(inventory, compact(withHelmet), DEFAULT_RULES, side);
      if (upgraded.isComplete && upgraded.totalCost <= budget) {
        plan = upgraded;
      }
    }
  }
  return plan;
}

/**
 * Single unified loadout planner for all non-PRESERVE modes (FULL, FORCE,
 * LIGHT, AWP_PATH, POST_PISTOL conversion).
 */
function planLoadout(
  side: Side,
  inventory: InventoryState,
  budget: number,
  options: LoadoutPlanOptions = {},
): PurchasePlan | null {
  const preferVesthelm = options.preferVesthelm ?? side === 'T';
  const requireArmor = options.requireArmor ?? true;
  const primaryArmor: 'kevlar' | 'kevlar_helmet' = preferVesthelm ? 'kevlar_helmet' : 'kevlar';
  const fallbackArmor: 'kevlar' | null = preferVesthelm ? 'kevlar' : null;

  const tryCore = (weapon?: ItemId): PurchasePlan | null => {
    const base = weapon ? [weapon, primaryArmor] : [primaryArmor];
    const first = buildCandidatePlan(side, inventory, budget, base, preferVesthelm);
    if (first) return first;
    if (fallbackArmor) {
      const second = buildCandidatePlan(
        side,
        inventory,
        budget,
        weapon ? [weapon, fallbackArmor] : [fallbackArmor],
        false,
      );
      if (second) return second;
    }
    return null;
  };

  // 1. Explicit AWP or explicit conversion primary.
  if (options.wantAwp) {
    return tryCore('awp');
  }
  if (options.targetPrimary) {
    return tryCore(options.targetPrimary);
  }

  const tryRetainedTopUp = (): PurchasePlan | null => {
    const withArmor = tryCore();
    if (withArmor) return withArmor;
    if (requireArmor) return null;
    const utilOnly = planPurchases(
      inventory,
      compact(utilityBundle(side, inventory, budget)),
      DEFAULT_RULES,
      side,
    );
    return utilOnly.isComplete && utilOnly.totalCost <= budget ? utilOnly : null;
  };

  const retained = inventory.primary;
  const hasRetainedRifleOrAwp = hasMainRifleOrAwp(retained) || hasEcoRifle(retained);
  const hasRetainedSmg =
    retained !== null && retained !== undefined && weaponClassOf(retained) === 'smg';

  // 2. Retained primary: keep rifle/AWP; upgrade SMG only when a full main-rifle loadout fits.
  if (hasRetainedRifleOrAwp) return tryRetainedTopUp();
  if (hasRetainedSmg) {
    const upgrade = tryCore(rifleFor(side));
    if (
      upgrade &&
      isCompleteLoadout(side, resultingLoadout(inventory, upgrade.purchases), inventory)
    ) {
      return upgrade;
    }
    return tryRetainedTopUp();
  }

  // 3. Empty primary: evaluate coherent loadout packages by side.
  const mainRifle = tryCore(rifleFor(side));
  if (
    mainRifle &&
    isCompleteLoadout(side, resultingLoadout(inventory, mainRifle.purchases), inventory)
  ) {
    return mainRifle;
  }

  const smg = tryCore(smgFor(side));
  if (side === 'T') {
    // Cologne Major 2026: T $3,700-$4,199 strongly favors Galil+VH+utility over bare AK+VH.
    const galil = tryCore('galil');
    if (galil && effectiveGrenadeCount(resultingLoadout(inventory, galil.purchases)) >= 2) {
      return galil;
    }
    if (mainRifle) return mainRifle;
    if (galil) return galil;
  } else {
    if (mainRifle && effectiveGrenadeCount(resultingLoadout(inventory, mainRifle.purchases)) >= 1) {
      return mainRifle;
    }
    if (smg && effectiveGrenadeCount(resultingLoadout(inventory, smg.purchases)) >= 2) {
      return smg;
    }
    if (mainRifle) return mainRifle;
  }
  if (smg) return smg;

  const pistol = tryCore(paidPistolFor(side));
  if (pistol) return pistol;

  if (!requireArmor) {
    // Bounded light-buy fallback when armor is unaffordable within the ceiling.
    const lightExtras: ItemId[][] = [
      [paidPistolFor(side), 'smoke'],
      [paidPistolFor(side)],
      ['smoke', 'flash'],
      ['smoke'],
      ['flash'],
    ];
    for (const candidate of lightExtras) {
      const plan = planPurchases(inventory, compact(candidate), DEFAULT_RULES, side);
      if (plan.isComplete && plan.totalCost > 0 && plan.totalCost <= budget) return plan;
    }
  }

  return null;
}

/**
 * Unified conditional alternatives derived from actual purchase diff and bounded by budget:
 * - CT: add defuse kit when teammates may lack one
 * - T: swap a newly purchased HE grenade for a second flash (-$100)
 */
function buildConditionalAlternatives(
  side: Side,
  inventory: InventoryState,
  plan: PurchasePlan,
  budget: number,
): ConditionalAlternative[] {
  const alternatives: ConditionalAlternative[] = [];
  const boughtItems = plan.purchases.flatMap((p) =>
    Array.from({ length: p.quantity }, () => p.item),
  );

  if (side === 'CT' && !inventory.hasDefuseKit && !boughtItems.includes('defuse_kit')) {
    const kitSpend = plan.totalCost + price(DEFAULT_RULES, 'defuse_kit');
    if (kitSpend <= budget) {
      alternatives.push({
        condition: '若队友无钳',
        purchases: compact([...boughtItems, 'defuse_kit']),
        bundleSpend: kitSpend,
        reason: '钳子不占道具槽，队友持钳情况不可见',
      });
    }
  }

  if (side === 'T' && boughtItems.includes('he')) {
    const loadout = resultingLoadout(inventory, plan.purchases);
    if (count(loadout.grenades, 'flash') < 2) {
      let replaced = false;
      const swappedPurchases = compact(
        boughtItems.map((item) => {
          if (!replaced && item === 'he') {
            replaced = true;
            return 'flash' as ItemId;
          }
          return item;
        }),
      );
      const swapSpend = plan.totalCost - price(DEFAULT_RULES, 'he') + price(DEFAULT_RULES, 'flash');
      const swapLoadout = resultingLoadout(inventory, swappedPurchases);
      if (
        swapSpend >= 0 &&
        swapSpend <= budget &&
        swapLoadout.grenades.length <= MAX_GRENADE_CARRY &&
        count(swapLoadout.grenades, 'flash') <= 2
      ) {
        alternatives.push({
          condition: '手雷换闪',
          purchases: swappedPurchases,
          bundleSpend: swapSpend,
          reason: '手雷与双闪均为职业主流第 4 颗道具',
        });
      }
    }
  }

  return alternatives;
}

/**
 * Detect rounds where current-round money will NOT carry over into a normal next round:
 * - Round 12 (end of 1st half -> side swap & $800 pistol reset)
 * - Round 24 (end of regulation -> match end or OT reset)
 * - Regulation match point against us (opponent score >= 12 -> a loss ends the match)
 */
function economyResetReason(state: PolicyV3State): 'HALF_END_RESET' | 'MATCH_POINT_AGAINST' | null {
  if (known(state.round.number)) {
    const r = state.round.number.value;
    // Regulation half-end (r12), regulation end (r24), and MR3 OT half-ends (r27, r30, r33, ...)
    if (r === 12 || r === 24 || (r > 24 && (r - 24) % 3 === 0)) return 'HALF_END_RESET';
  }
  if (known(state.round.context) && known(state.round.score) && known(state.round.side)) {
    const ctx = state.round.context.value;
    const oppScore =
      state.round.side.value === 'CT' ? state.round.score.value.t : state.round.score.value.ct;
    if (ctx === 'NORMAL' && oppScore >= 12) return 'MATCH_POINT_AGAINST';
    if (ctx === 'OVERTIME' && known(state.round.number) && state.round.number.value > 24) {
      const otBlock = Math.floor((state.round.number.value - 25) / 6) + 1;
      const otMatchPoint = 12 + 3 * otBlock; // OT1: 15 (to 16), OT2: 18 (to 19), ...
      if (oppScore >= otMatchPoint) return 'MATCH_POINT_AGAINST';
    }
  }
  return null;
}

function trajectory(state: PolicyV3State, spend: number): TrajectoryScenario[] {
  if (economyResetReason(state) !== null) return [];
  if (!known(state.player.money) || !known(state.player.lossIndex) || !known(state.round.side))
    return [];
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
    '0 additional personal kill rewards',
    'no hidden drops, teammate transfers, or private opponent state',
    'current GSI inventory only; projection is a scenario, not a future fact',
  ];
  const lossIndex: Fact<number> = {
    status: 'TRACKED',
    value: Math.min(4, state.player.lossIndex.value + 1),
    source: 'CS2 loss-bonus rule',
    asOfSeq: state.player.lossIndex.asOfSeq,
  };
  const winIndex: Fact<number> =
    state.player.lossIndex.value === 1
      ? {
          status: 'TRACKED',
          value: 0,
          source: 'Windows runtime-observed win transition 1→0',
          asOfSeq: state.player.lossIndex.asOfSeq,
        }
      : {
          status: 'UNKNOWN',
          source: 'win loss-index transition',
          asOfSeq: state.player.lossIndex.asOfSeq,
          reason: 'full win-decrement semantics not calibrated',
        };
  const nextRoundResets =
    known(state.round.number) &&
    (() => {
      const nextR = state.round.number.value + 1;
      return nextR === 12 || nextR === 24 || (nextR > 24 && (nextR - 24) % 3 === 0);
    })();
  const followingRound = (
    nextMoney: { min: number; max: number },
    nextLoss: Fact<number>,
  ): TrajectoryScenario['followingRound'] => {
    const reachability: Fact<'UNKNOWN'> = {
      status: 'UNKNOWN',
      source: 'future inventory',
      asOfSeq: state.player.inventory.asOfSeq,
      reason: 't+1 inventory, drops, and armor retention are not observable facts',
    };
    if (!known(nextLoss) || nextRoundResets) {
      return {
        action: 'PRESERVE',
        outcome: 'LOSS_NO_PLANT',
        money: {
          status: 'UNKNOWN',
          source: 't+2 projection',
          asOfSeq: nextLoss.asOfSeq,
          reason: 't+1 win loss-index transition is uncalibrated',
        },
        lossIndex: nextLoss,
        reachability,
      };
    }
    const secondMin = projectNextRoundMoney({
      money: nextMoney.min,
      spendNow: 0,
      side,
      lossStreak: nextLoss.value,
      kills: [],
      rules: DEFAULT_RULES,
    });
    const secondMax = projectNextRoundMoney({
      money: nextMoney.max,
      spendNow: 0,
      side,
      lossStreak: nextLoss.value,
      kills: [],
      rules: DEFAULT_RULES,
    });
    return {
      action: 'PRESERVE',
      outcome: 'LOSS_NO_PLANT',
      money: {
        status: 'TRACKED',
        value: { min: secondMin.loss, max: secondMax.loss },
        source: 'economy rule projection',
        asOfSeq: nextLoss.asOfSeq,
      },
      lossIndex: {
        status: 'TRACKED',
        value: Math.min(4, nextLoss.value + 1),
        source: 'CS2 loss-bonus rule',
        asOfSeq: nextLoss.asOfSeq,
      },
      reachability,
    };
  };
  const scenarios: TrajectoryScenario[] = [
    {
      id: 'WIN',
      assumptions: [
        ...assumptions,
        'WIN range spans elimination/timeout and bomb win rewards',
        't+2 assumes a no-purchase loss; future buy reachability stays UNKNOWN without future inventory',
      ],
      nextMoney: { min: projected.win, max: projected.winBomb },
      nextLossIndex: winIndex,
      followingRound: followingRound({ min: projected.win, max: projected.winBomb }, winIndex),
    },
    {
      id: 'LOSS_NO_PLANT',
      assumptions: [
        ...assumptions,
        't+2 assumes a no-purchase loss; future buy reachability stays UNKNOWN without future inventory',
      ],
      nextMoney: { min: projected.loss, max: projected.loss },
      nextLossIndex: lossIndex,
      followingRound: followingRound({ min: projected.loss, max: projected.loss }, lossIndex),
    },
  ];
  if (side === 'T') {
    scenarios.push({
      id: 'LOSS_WITH_PLANT',
      assumptions: [
        ...assumptions,
        'T plant reward only in this hypothetical branch',
        't+2 assumes a no-purchase loss; future buy reachability stays UNKNOWN without future inventory',
      ],
      nextMoney: { min: projected.lossWithPlant, max: projected.lossWithPlant },
      nextLossIndex: lossIndex,
      followingRound: followingRound(
        { min: projected.lossWithPlant, max: projected.lossWithPlant },
        lossIndex,
      ),
    });
  }
  return scenarios;
}

/**
 * Unified canonical next-round cash thresholds:
 * - CT: M4 + Kevlar ($3,550) / + Smoke + Flash ($4,050)
 * - T:  AK + Vesthelm ($3,700) / + Smoke + Flash ($4,200)
 */
function futureAffordability(state: PolicyV3State): FutureAffordabilitySet {
  if (!known(state.round.context)) {
    return {
      status: 'UNKNOWN',
      boundaries: [],
      reason: 'round context is UNKNOWN',
    };
  }
  const context = state.round.context.value;
  if (context === 'POST_PISTOL')
    return {
      status: 'NOT_APPLICABLE',
      boundaries: [],
      reason: 'POST_PISTOL_STRATEGY',
    };
  if (context === 'PISTOL')
    return {
      status: 'NOT_APPLICABLE',
      boundaries: [],
      reason: 'PISTOL_UNSUPPORTED',
    };
  const resetReason = economyResetReason(state);
  if (resetReason !== null) {
    return { status: 'NOT_APPLICABLE', boundaries: [], reason: resetReason };
  }
  if (context === 'OVERTIME')
    return {
      status: 'NOT_APPLICABLE',
      boundaries: [],
      reason: 'OVERTIME_UNSUPPORTED',
    };
  if (!known(state.player.money) || !known(state.player.lossIndex) || !known(state.round.side)) {
    return {
      status: 'UNKNOWN',
      boundaries: [],
      reason: 'own money, loss index, or side is UNKNOWN',
    };
  }

  const { value: money } = state.player.money;
  const { value: lossIndex } = state.player.lossIndex;
  const { value: side } = state.round.side;
  const lossReward = lossBonus(DEFAULT_RULES, lossIndex);
  const assumptions = [
    'LOSS_NO_PLANT scenario',
    '0 additional personal kill rewards',
    'no retained weapon, drop, armor retention, or teammate transfer is asserted',
    'canonical fresh-buy cash boundary; not a future inventory fact',
  ];
  const boundary = (capability: ProtectedNextBuyCapability): FutureAffordabilityBoundary => {
    const targetCash = nextBuyTargetCash(side, capability);
    const requiredReserveNow = Math.max(0, targetCash - lossReward);
    const reachableWithNoSpend = money >= requiredReserveNow;
    return {
      layer: 'SCENARIO',
      scenario: 'LOSS_NO_PLANT',
      capability,
      targetCash,
      requiredReserveNow,
      reachableWithNoSpend,
      maxSpendNow: reachableWithNoSpend ? money - requiredReserveNow : 0,
      assumptions,
    };
  };
  return {
    status: 'PROJECTED',
    context: 'NORMAL',
    boundaries: [boundary('RIFLE_ARMOR'), boundary('RIFLE_ARMOR_BASIC_UTILITY')],
  };
}

function preserveGuidance(boundaries: FutureAffordabilitySet): SpendingGuidance {
  if (boundaries.status !== 'PROJECTED') return { layer: 'ADVICE', kind: 'MINIMIZE' };
  const strongest =
    boundaries.boundaries.find(
      (b) => b.capability === 'RIFLE_ARMOR_BASIC_UTILITY' && b.reachableWithNoSpend,
    ) ??
    boundaries.boundaries.find((b) => b.capability === 'RIFLE_ARMOR' && b.reachableWithNoSpend);
  return strongest
    ? {
        layer: 'ADVICE',
        kind: 'MINIMIZE',
        protectedCapability: strongest.capability,
      }
    : { layer: 'ADVICE', kind: 'MINIMIZE' };
}

function buildOption(
  state: PolicyV3State,
  mode: PolicyMode,
  plan: PurchasePlan,
  spendingGuidance: SpendingGuidance,
  strength: RecommendationOption['adviceStrength'],
  budget: number,
  extraReasons: readonly PolicyReason[] = [],
  idPrefix?: string,
): RecommendationOption {
  const side = state.round.side.value!;
  const inventory = state.player.inventory.value!;
  const reasons: PolicyReason[] = [
    {
      code: `MODE_${mode}`,
      detail: 'unified inventory-aware legal loadout plan',
    },
    ...extraReasons,
  ];
  if (state.opponent.status === 'INFERRED') {
    reasons.push({
      code: 'OPPONENT_CONTEXT',
      detail: 'coarse opponent context affects explanation only',
    });
  }
  const slug = plan.purchases.map((p) => `${p.item}${p.quantity}`).join('-') || 'hold';
  return {
    id: `${idPrefix ?? mode.toLowerCase()}-${slug}`,
    mode,
    spendingGuidance,
    purchases: plan.purchases,
    bundleSpend: plan.totalCost,
    resultingInventory: resultingLoadout(inventory, plan.purchases),
    trajectory: trajectory(state, plan.totalCost),
    reasons,
    assumptions: ['normal-player GSI only'],
    conditionalAlternatives:
      mode === 'PRESERVE' ? [] : buildConditionalAlternatives(side, inventory, plan, budget),
    adviceStrength: strength,
  };
}

function preserveOption(
  state: PolicyV3State,
  boundaries: FutureAffordabilitySet,
  strength: RecommendationOption['adviceStrength'],
  extraReasons: readonly PolicyReason[] = [],
): RecommendationOption {
  const emptyPlan: PurchasePlan = {
    purchases: [],
    totalCost: 0,
    targetCost: 0,
    isComplete: true,
    rejectedItems: [],
  };
  return buildOption(
    state,
    'PRESERVE',
    emptyPlan,
    preserveGuidance(boundaries),
    strength,
    0,
    extraReasons,
  );
}

function previousPistolOutcome(state: PolicyV3State, side: Side): 'WIN' | 'LOSS' | 'UNKNOWN' {
  if (state.history.integrity !== 'COMPLETE') return 'UNKNOWN';
  const previous = state.history.previousRounds.at(-1);
  if (
    !previous ||
    previous.roundNumber !== state.round.number.value! - 1 ||
    !known(previous.winner)
  )
    return 'UNKNOWN';
  return previous.winner.value === side ? 'WIN' : 'LOSS';
}

function postPistolWinOptions(
  state: PolicyV3State,
  strength: RecommendationOption['adviceStrength'],
): RecommendationOption[] {
  const side = state.round.side.value!;
  const inventory = state.player.inventory.value!;
  const money = state.player.money.value!;
  const retained = inventory.primary !== null && inventory.primary !== undefined;
  const reason: PolicyReason = {
    code: 'POST_PISTOL_CONVERSION',
    detail: 'pistol winner conversion is team-level FULL with vesthelm priority',
  };
  const guidance: SpendingGuidance = {
    layer: 'ADVICE',
    kind: 'COMPLETE_CURRENT_BUY',
  };
  const emptyHold: PurchasePlan = {
    purchases: [],
    totalCost: 0,
    targetCost: 0,
    isComplete: true,
    rejectedItems: [],
  };
  const make = (plan: PurchasePlan, prefix: string, s: RecommendationOption['adviceStrength']) =>
    buildOption(state, 'FULL', plan, guidance, s, money, [reason], prefix);

  if (retained) {
    const plan = planLoadout(side, inventory, money, {
      preferVesthelm: true,
      requireArmor: false,
    });
    return [make(plan ?? emptyHold, plan ? 'post-pistol-retained' : 'post-pistol-hold', strength)];
  }

  const results: RecommendationOption[] = [];
  for (const [primary, prefix] of [
    [rifleFor(side), 'post-pistol-rifle'],
    [smgFor(side), 'post-pistol-smg'],
  ] as const) {
    const plan = planLoadout(side, inventory, money, {
      preferVesthelm: true,
      targetPrimary: primary,
    });
    if (plan) results.push(make(plan, prefix, results.length === 0 ? strength : 'ALTERNATIVE'));
  }
  return results.length > 0 ? results : [make(emptyHold, 'post-pistol-hold', strength)];
}

/** Deduplicate identical purchase lists, preferring LIGHT over FORCE when both buy the exact same items. */
function deduplicateOptions(options: readonly RecommendationOption[]): RecommendationOption[] {
  const result: RecommendationOption[] = [];
  for (const option of options) {
    const sig = purchaseSignature(option.purchases);
    const existingIndex = result.findIndex((other) => {
      if (purchaseSignature(other.purchases) !== sig) return false;
      // Never merge a 0-spend FULL hold (retained complete loadout) with PRESERVE.
      if (
        (other.mode === 'FULL' && option.mode === 'PRESERVE') ||
        (other.mode === 'PRESERVE' && option.mode === 'FULL')
      ) {
        return false;
      }
      return true;
    });
    if (existingIndex < 0) {
      result.push(option);
      continue;
    }
    const existing = result[existingIndex]!;
    // If FORCE and LIGHT produce the exact same purchases, keep LIGHT (preserves next-round semantics).
    if (existing.mode === 'FORCE' && option.mode === 'LIGHT') {
      result[existingIndex] = option;
    }
  }
  return result;
}

function normalRoundOptions(
  state: PolicyV3State,
  affordability: FutureAffordabilitySet,
): RecommendationOption[] {
  const side = state.round.side.value!;
  const inventory = state.player.inventory.value!;
  const money = state.player.money.value!;

  // Intent 1: Current-round priority via the single unified loadout planner.
  const currentPlan = planLoadout(side, inventory, money);
  if (currentPlan) {
    const loadout = resultingLoadout(inventory, currentPlan.purchases);
    if (isCompleteLoadout(side, loadout, inventory)) {
      return [
        buildOption(
          state,
          'FULL',
          currentPlan,
          { layer: 'ADVICE', kind: 'COMPLETE_CURRENT_BUY' },
          'SUPPORTED',
          money,
        ),
      ];
    }
  }

  // Current round cannot form a complete loadout: assemble real tradeoffs (FORCE / LIGHT / PRESERVE).
  // A $0 non-complete hold is not a FORCE buy; let PRESERVE carry the hold semantics.
  const forceOpt =
    currentPlan && currentPlan.totalCost > 0
      ? buildOption(
          state,
          'FORCE',
          currentPlan,
          { layer: 'ADVICE', kind: 'CURRENT_ROUND_PRIORITY' },
          'SUPPORTED',
          money,
        )
      : null;

  const lightOptions: RecommendationOption[] = [];
  let nextFullReachable = false;
  if (affordability.status === 'PROJECTED') {
    const fullBoundary = affordability.boundaries.find(
      (b) => b.capability === 'RIFLE_ARMOR_BASIC_UTILITY',
    );
    nextFullReachable = Boolean(fullBoundary?.reachableWithNoSpend);

    const reachable = [...affordability.boundaries]
      .filter((b) => b.reachableWithNoSpend && b.maxSpendNow > 0)
      .sort((a, b) => b.targetCash - a.targetCash);

    for (const boundary of reachable) {
      const lightPlan = planLoadout(side, inventory, boundary.maxSpendNow, {
        requireArmor: false,
      });
      if (!lightPlan || lightPlan.totalCost <= 0 || lightPlan.totalCost > boundary.maxSpendNow) {
        continue;
      }
      lightOptions.push(
        buildOption(
          state,
          'LIGHT',
          lightPlan,
          {
            layer: 'ADVICE',
            kind: 'BOUNDED',
            protectedCapability: boundary.capability,
          },
          'SUPPORTED',
          boundary.maxSpendNow,
          [
            {
              code: 'LIGHT_PROTECTS_NEXT_BUY',
              detail: `LOSS_NO_PLANT preserves ${boundary.capability} canonical fresh-buy cash capability`,
            },
          ],
          `light-${boundary.capability.toLowerCase()}`,
        ),
      );
      break;
    }
  }

  const hasRifleForce =
    forceOpt !== null &&
    (hasMainRifleOrAwp(forceOpt.resultingInventory.primary) ||
      hasEcoRifle(forceOpt.resultingInventory.primary));

  // 2D economic decision matrix (Cologne Major 2026):
  // - If ECO still leaves next round poor: lead with FORCE, PRESERVE as alternative.
  // - If ECO reaches full next round and current round is only pistol/SMG: lead with LIGHT/PRESERVE, FORCE as alternative.
  // - If ECO reaches full next round and current round has eco/bare rifle: present FORCE alongside LIGHT & PRESERVE.
  const preserveOpt = preserveOption(
    state,
    affordability,
    nextFullReachable && !hasRifleForce ? 'SUPPORTED' : 'ALTERNATIVE',
  );

  // Preserve higher next-round capability: if PRESERVE secures RIFLE_ARMOR_BASIC_UTILITY
  // while LIGHT downgrades next round to bare RIFLE_ARMOR, rank PRESERVE ahead of LIGHT.
  const lightProtectsFull =
    lightOptions.length > 0 &&
    lightOptions[0]!.spendingGuidance.kind === 'BOUNDED' &&
    lightOptions[0]!.spendingGuidance.protectedCapability === 'RIFLE_ARMOR_BASIC_UTILITY';

  const rankedSaveOptions: RecommendationOption[] =
    nextFullReachable && !lightProtectsFull
      ? [
          preserveOpt,
          ...lightOptions.map((opt) => ({
            ...opt,
            adviceStrength: 'ALTERNATIVE' as const,
          })),
        ]
      : [...lightOptions, preserveOpt];

  const isResetRound = economyResetReason(state) !== null;
  let ordered: RecommendationOption[];
  if (!forceOpt) {
    ordered = rankedSaveOptions;
  } else if (isResetRound) {
    // No carryover economy after this round: omit pointless $0 save-for-next PRESERVE.
    ordered = [forceOpt];
  } else if (nextFullReachable && !hasRifleForce) {
    ordered = [...rankedSaveOptions, { ...forceOpt, adviceStrength: 'ALTERNATIVE' }];
  } else {
    ordered = [
      forceOpt,
      ...lightOptions.map((opt) => ({
        ...opt,
        adviceStrength: 'ALTERNATIVE' as const,
      })),
      preserveOpt,
    ];
  }

  return deduplicateOptions(ordered);
}

/** Deterministic Policy V3 core. It never reads an opponent economy value. */
export function recommendPolicyV3(state: PolicyV3State): PolicyV3Output {
  const affordability = futureAffordability(state);
  // lossIndex is intentionally NOT a blocker for current-round buy recommendations.
  const required = [
    state.round.side,
    state.player.money,
    state.player.inventory,
    state.round.context,
  ];
  const unresolved = required
    .filter((fact) => fact.status === 'UNKNOWN' || fact.value === undefined)
    .map((fact) => `${fact.source}: ${fact.reason ?? 'UNKNOWN'}`);
  if (unresolved.length > 0) {
    return {
      status: 'INSUFFICIENT_STATE',
      futureAffordability: affordability,
      options: [],
      unresolved,
      opponent: state.opponent,
    };
  }

  const context = state.round.context.value!;
  const side = state.round.side.value!;
  const inventory = state.player.inventory.value!;
  const money = state.player.money.value!;
  const preference = state.preference ?? DEFAULT_PREFERENCE;

  if (context === 'PISTOL') {
    return {
      status: 'UNSUPPORTED_POLICY_EVIDENCE',
      futureAffordability: affordability,
      options: [],
      unresolved: ['pistol-round purchase policy is outside the Policy V3 evidence scope'],
      opponent: state.opponent,
    };
  }

  const extraUnresolved: string[] = [];
  if (!known(state.player.lossIndex)) {
    extraUnresolved.push(
      `${state.player.lossIndex.source}: ${state.player.lossIndex.reason ?? 'UNKNOWN'}; next-round projection unavailable`,
    );
  }
  if (state.opponent.status === 'UNKNOWN') {
    extraUnresolved.push('opponent economy: UNKNOWN; base recommendations unchanged');
  }

  let options: RecommendationOption[];
  if (context === 'POST_PISTOL') {
    const pistolOutcome = previousPistolOutcome(state, side);
    if (pistolOutcome === 'WIN') {
      options = postPistolWinOptions(state, 'SUPPORTED');
    } else {
      const isCtLoss = pistolOutcome === 'LOSS' && side === 'CT';
      const forcePlan = planLoadout(side, inventory, money);
      const forceOpt =
        forcePlan && forcePlan.totalCost > 0
          ? buildOption(
              state,
              'FORCE',
              forcePlan,
              { layer: 'ADVICE', kind: 'CURRENT_ROUND_PRIORITY' },
              isCtLoss ? 'DOMINANT' : 'SUPPORTED',
              money,
            )
          : null;
      const ecoOpt = preserveOption(state, affordability, isCtLoss ? 'ALTERNATIVE' : 'SUPPORTED');
      options = isCtLoss
        ? [...(forceOpt ? [forceOpt] : []), ecoOpt]
        : [ecoOpt, ...(forceOpt ? [forceOpt] : [])];
    }
  } else {
    options = normalRoundOptions(state, affordability);
  }

  // AWP preference reuses the exact same unified loadout planner.
  const awpPlan =
    preference.source === 'USER_DECLARED' && preference.awpPriority !== 'NEUTRAL'
      ? planLoadout(side, inventory, money, { wantAwp: true })
      : null;

  if (awpPlan) {
    const awpOpt = buildOption(
      state,
      'AWP_PATH',
      awpPlan,
      { layer: 'ADVICE', kind: 'CURRENT_ROUND_PRIORITY' },
      'DOMINANT',
      money,
    );
    options = deduplicateOptions([awpOpt, ...options.filter((opt) => opt.mode !== 'AWP_PATH')]);
  } else if (
    preference.source === 'USER_DECLARED' &&
    preference.awpPriority === 'SAVE_FOR_AWP' &&
    economyResetReason(state) === null &&
    known(state.player.lossIndex)
  ) {
    const awpWithArmorCost = price(DEFAULT_RULES, 'awp') + price(DEFAULT_RULES, 'kevlar');
    const noSpend = projectNextRoundMoney({
      money,
      spendNow: 0,
      side,
      lossStreak: state.player.lossIndex.value,
      kills: [],
      rules: DEFAULT_RULES,
    });
    if (noSpend.loss >= awpWithArmorCost) {
      const awpReason: PolicyReason = {
        code: 'SAVE_FOR_AWP_HORIZON',
        detail: 'no-purchase t+1 loss scenario reaches conservative AWP + armor cash requirement',
      };
      const hasPreserve = options.some((opt) => opt.mode === 'PRESERVE');
      if (hasPreserve) {
        options = options.map((opt) =>
          opt.mode === 'PRESERVE' ? { ...opt, reasons: [...opt.reasons, awpReason] } : opt,
        );
      } else {
        options = [...options, preserveOption(state, affordability, 'ALTERNATIVE', [awpReason])];
      }
    }
  }

  return {
    status: 'READY',
    futureAffordability: affordability,
    options,
    defaultOptionId:
      context === 'POST_PISTOL' && previousPistolOutcome(state, side) !== 'LOSS'
        ? undefined
        : options.find((option) => option.adviceStrength === 'DOMINANT')?.id,
    unresolved: extraUnresolved,
    opponent: state.opponent,
  };
}

/** Runtime adapter for the held-out opponent contract. */
export function inferOpponentEconomy(input: OpponentFeatureInput): Inference<OpponentEconomyClass> {
  return inferFromCalibration(input);
}
