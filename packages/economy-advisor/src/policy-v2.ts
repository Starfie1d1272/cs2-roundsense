/**
 * Economy Policy V2 — human-designed round decision policy.
 *
 * Two strict layers:
 *   FACT    — objective, computable, explainable (projection engine)
 *   ADVICE  — human policy judgement (this module)
 *
 * Professional behavior evidence (research/economy-policy @ 0875db9) is used
 * ONLY for the strong-buy gate calibration below — professional behavior is
 * reference evidence, never "optimal truth", and this policy does NOT predict
 * professional eco/semi/force/full labels.
 *
 * Runtime uses small deterministic constants + canonical prices + code.
 * No research tables are loaded at runtime.
 */
import type { ItemId, NextRoundGoal, Side } from "@roundsense/shared-types";
import {
  DEFAULT_RULES,
  type EconomyRules,
  price,
  weaponClassOf,
} from "./rules.js";
import { projectNextRoundMoney, type ProjectionInput } from "./projection.js";
import {
  planPurchases,
  rifleFor,
  smgFor,
  budgetRifleFor,
  sidePistolFor,
} from "./advisor.js";
import type { InventoryState, PurchaseItem } from "./types.js";

export type DisplayTag = "SAVE" | "LIGHT" | "SMG" | "RIFLE" | "AWP";
export type PrimaryIntent =
  | "keep_current"
  | "none"
  | "paid_pistol"
  | "smg"
  | "budget_rifle"
  | "rifle"
  | "awp";
export type ArmorIntent = "none" | "kevlar" | "helmet";
export type Override = "auto" | "save" | "rifle" | "awp" | "max_combat";

export interface PolicyInput {
  side: Side;
  /** canonical loss reward (1400/1900/2400/2900/3400) */
  lossReward: number;
  /** freeze-time start money — provided externally (DecisionAnchor later) */
  roundStartMoney?: number;
  roundStartMoneyConfidence: "exact" | "estimated" | "unavailable";
  /** live cash (GSI player.state.money) */
  currentMoney: number;
  startInventory?: InventoryState;
  currentInventory: InventoryState;
  override?: Override;
  ctRiflePreference?: "m4a4" | "m4a1s";
}

export interface PolicyReason {
  code: string;
  detail: string;
}

export interface PolicyDecision {
  displayTag: DisplayTag;
  spendCeiling: number;
  primaryIntent: PrimaryIntent;
  armorIntent: ArmorIntent;
  utilityIntent: {
    smoke: boolean;
    flashes: 0 | 1 | 2;
    he: boolean;
    fire: boolean;
  };
  defuseKit: boolean;
  confidence: "high" | "medium" | "low";
  reasons: PolicyReason[];
  /** what must ACTUALLY be bought from the current inventory */
  purchases: PurchaseItem[];
  totalCost: number;
  projection: {
    lossNoMoreSpend: number;
    lossAfterRecommendation: number;
    lossWithPlantAfterRecommendation?: number;
  };
}

/**
 * Strong-buy gates — first $50 money where professional p_full >= 0.80
 * (OBSERVED/INTERPOLATED region, retained=none), extracted mechanically from
 * economy-reference-surface.csv.
 *   source commit: research/economy-policy @ 0875db9
 *   source artifact: experiments/economy-policy/results/cologne-2026/economy-reference-surface.csv
 * Values are HUMAN policy anchors (conservative vs the pro full50 crossing) —
 * not a claim that 80% full-buy rate is "correct".
 */
export const STRONG_BUY_GATES: Record<Side, Record<number, number>> = {
  T: { 1400: 3950, 1900: 4100, 2400: 4150, 2900: 4000, 3400: 4400 },
  CT: { 1400: 4050, 1900: 4100, 2400: 4250, 2900: 4100, 3400: 4450 },
};

/** Loss-reward → lossStreak index (same canonical table as the rules). */
const LOSS_REWARDS = [1400, 1900, 2400, 2900, 3400];
export function lossRewardToStreak(lossReward: number): number {
  const idx = LOSS_REWARDS.indexOf(lossReward);
  if (idx < 0) throw new Error(`invalid lossReward ${lossReward}`);
  return idx;
}

function clampMoney(v: number): number {
  return Math.max(0, Math.min(16000, Math.round(v)));
}

function isRifleClass(item: ItemId): boolean {
  return weaponClassOf(item) === "rifle";
}

function isSmgClass(item: ItemId): boolean {
  return weaponClassOf(item) === "smg";
}

function isSniperClass(item: ItemId): boolean {
  return weaponClassOf(item) === "sniper";
}

/** Grenade slot / flash legality on a purchase plan. */
function grenadeLegality(
  inventory: InventoryState,
  purchases: PurchaseItem[],
): { flashCount: number; total: number } {
  let flashCount = 0;
  let total = 0;
  for (const g of inventory.grenades) {
    if (g === "flash") flashCount++;
    total++;
  }
  for (const p of purchases) {
    if (p.item !== "flash" && p.item !== "smoke" && p.item !== "he" && p.item !== "molotov" && p.item !== "incendiary") continue;
    for (let i = 0; i < p.quantity; i++) {
      if (p.item === "flash") flashCount++;
      total++;
    }
  }
  return { flashCount, total };
}

function flashCountOf(purchases: PurchaseItem[]): 0 | 1 | 2 {
  const n = purchases.filter((p) => p.item === "flash").reduce((s, p) => s + p.quantity, 0);
  return n > 2 ? 2 : (n as 0 | 1 | 2);
}

/** Keep `NextRoundGoal` → override mapping for backward compatibility. */
export function overrideFromGoal(goal: NextRoundGoal): Override {
  switch (goal) {
    case "rifle_armor":
    case "rifle_util":
      return "rifle";
    case "awp":
      return "awp";
    case "max_combat_now":
      return "max_combat";
  }
}

/** Next-round baseline target cost (canonical prices — never hard-coded). */
export function nextRoundBaselineCost(
  rules: EconomyRules,
  side: Side,
  ctRiflePreference: "m4a4" | "m4a1s",
): number {
  const rifle = side === "T" ? "ak47" : ctRiflePreference;
  return (
    price(rules, rifle) +
    price(rules, "kevlar") +
    price(rules, "smoke") +
    price(rules, "flash")
  );
}

const SIDE_T_ITEMS = new Set<ItemId>(["ak47", "galil", "mac10", "tec9", "molotov"]);
const SIDE_CT_ITEMS = new Set<ItemId>([
  "m4a4",
  "m4a1s",
  "famas",
  "mp9",
  "fiveseven",
  "incendiary",
  "defuse_kit",
]);

/** Side legality: T cannot buy CT-only items and vice versa. */
export function sideLegal(side: Side, item: ItemId): boolean {
  if (side === "T") return !SIDE_CT_ITEMS.has(item);
  return !SIDE_T_ITEMS.has(item);
}

function isDefaultPistol(item: ItemId): boolean {
  return item === "glock" || item === "usp" || item === "p2000";
}

/** Primary class of the current primary (canonical). */
function primaryKind(primary: ItemId | null | undefined): "rifle" | "smg" | "awp" | "sniper" | "other" | "none" {
  if (!primary) return "none";
  if (primary === "awp") return "awp";
  if (isRifleClass(primary)) return "rifle";
  if (isSmgClass(primary)) return "smg";
  if (isSniperClass(primary)) return "sniper";
  return "other";
}

interface PolicyState {
  gate: number;
  baselineCost: number;
  nextLossNoSpend: number;
  preservationBudget: number;
  spendCeiling: number;
  primaryKind: ReturnType<typeof primaryKind>;
  retainedWeapon: ItemId | null;
}

function computeState(input: PolicyInput, rules: EconomyRules): PolicyState {
  const side = input.side;
  const gate = STRONG_BUY_GATES[side][input.lossReward];
  const baselineCost = nextRoundBaselineCost(rules, side, input.ctRiflePreference ?? "m4a4");
  const anchor = input.roundStartMoney ?? input.currentMoney;
  const nextLossNoSpend = clampMoney(anchor + input.lossReward);
  const preservationBudget = Math.max(0, nextLossNoSpend - baselineCost);
  const current = input.currentInventory;
  const kind = primaryKind(current.primary);
  return {
    gate,
    baselineCost,
    nextLossNoSpend,
    preservationBudget,
    spendCeiling: 0, // filled by decide()
    primaryKind: kind,
    retainedWeapon: current.primary ?? null,
  };
}

/**
 * Try to add each candidate item in order, keeping the whole plan within
 * spendCeiling. Grenade slots (≤4) and flash (≤2) are respected, and the
 * plan is inventory-aware (already-owned items cost nothing).
 */
function greedilyFit(
  rules: EconomyRules,
  inventory: InventoryState,
  candidates: ItemId[],
  spendCeiling: number,
): { purchases: PurchaseItem[]; totalCost: number } {
  let purchases: PurchaseItem[] = [];
  let totalCost = 0;
  for (const item of candidates) {
    const trial: PurchaseItem[] = [...purchases, { item, quantity: 1 }];
    const plan = planPurchases(inventory, trial, rules);
    if (plan.totalCost > spendCeiling) continue;
    // grenade legality on the resulting loadout
    const loadout = plan.purchases.reduce(
      (acc, p) => {
        for (let i = 0; i < p.quantity; i++) {
          if (p.item === "smoke" || p.item === "flash" || p.item === "he" || p.item === "molotov" || p.item === "incendiary") {
            acc.grenades.push(p.item);
          }
        }
        return acc;
      },
      { grenades: [...inventory.grenades] },
    );
    const flashCount = loadout.grenades.filter((g) => g === "flash").length;
    const totalGrenades = loadout.grenades.length;
    if (flashCount > 2 || totalGrenades > 4) continue;
    purchases = plan.purchases;
    totalCost = plan.totalCost;
  }
  return { purchases, totalCost };
}

/**
 * V2 human policy decision.
 *
 * roundStartMoneyConfidence=exact → full decision (high confidence).
 * estimated → full decision but medium confidence.
 * unavailable → affordability-only fallback (current inventory + current
 * money), confidence=low, reason=missing_round_start_anchor. Never masquerade
 * as a full V2 decision without a reliable round-start anchor.
 */
export function decidePolicy(input: PolicyInput, rules: EconomyRules = DEFAULT_RULES): PolicyDecision {
  const side = input.side;
  const override = input.override ?? "auto";
  const current = input.currentInventory;
  const anchorMissing = input.roundStartMoneyConfidence === "unavailable";
  // retained primary may be replaced only on explicit rifle/max_combat override
  const replaceAllowed = override === "rifle" || override === "max_combat";

  const reasons: PolicyReason[] = [];
  if (anchorMissing) {
    reasons.push({
      code: "missing_round_start_anchor",
      detail: "roundStartMoney unavailable — affordability-only fallback on current money",
    });
  }
  const st = computeState(input, rules);

  // ---- save override: strict zero-spend ----
  if (override === "save") {
    return finish(
      input,
      rules,
      {
        displayTag: "SAVE",
        spendCeiling: 0,
        primaryIntent: "keep_current",
        armorIntent: "none",
        utilityIntent: { smoke: false, flashes: 0, he: false, fire: false },
        defuseKit: false,
        confidence: anchorMissing ? "low" : "high",
        reasons: [...reasons, { code: "override_save", detail: "save override: spendCeiling = 0" }],
      },
      [],
    );
  }

  const atOrAboveGate = st.primaryKind !== "none"
    ? true // retained primary: not a fresh-buy decision
    : input.currentMoney >= st.gate;

  // ---- AWP override ----
  if (override === "awp") {
    const awpKevlar = price(rules, "awp") + price(rules, "kevlar");
    const canAfford = input.currentMoney >= awpKevlar;
    if (canAfford) {
      const spendCeiling = input.currentMoney;
      const candidates: ItemId[] = ["awp", "kevlar"];
      const { purchases, totalCost } = greedilyFit(rules, current, candidates, spendCeiling);
      return finish(
        input,
        rules,
        {
          displayTag: "AWP",
          spendCeiling,
          primaryIntent: "awp",
          armorIntent: "kevlar",
          utilityIntent: { smoke: false, flashes: 0, he: false, fire: false },
          defuseKit: false,
          confidence: anchorMissing ? "low" : "high",
          reasons: [...reasons, { code: "override_awp", detail: "AWP + kevlar affordable" }],
        },
        purchases,
      );
    }
    // preserve for AWP: keep next-round AWP+kevlar reachable (plain loss)
    const target = awpKevlar;
    const spendCeiling = Math.max(0, clampMoney(input.currentMoney + input.lossReward) - target);
    const candidates: ItemId[] = [];
    const { purchases, totalCost } = greedilyFit(rules, current, candidates, spendCeiling);
    return finish(
      input,
      rules,
      {
        displayTag: "SAVE",
        spendCeiling,
        primaryIntent: "keep_current",
        armorIntent: "none",
        utilityIntent: { smoke: false, flashes: 0, he: false, fire: false },
        defuseKit: false,
        confidence: anchorMissing ? "low" : "high",
        reasons: [
          ...reasons,
          { code: "override_awp_preserve", detail: `AWP+kevlar not affordable now; preserving (plain loss → $${clampMoney(input.currentMoney + input.lossReward)})` },
        ],
      },
      purchases,
    );
  }

  // ---- retained primary handling (auto) ----
  const kind = st.primaryKind;
  if (kind !== "none") {
    // keep_current semantics; replace only on explicit override
    if (!replaceAllowed) {
      const isStrong = kind === "rifle" || kind === "awp";
      // retained strong primary: armor exception — kevlar core allowed even
      // above preservationBudget (protecting owned gear); utility within budget
      const kevlarCost = price(rules, "kevlar");
      const ceiling = isStrong
        ? Math.max(st.preservationBudget, kevlarCost)
        : st.preservationBudget;
      const capped = Math.min(input.currentMoney, ceiling);
      const candidates: ItemId[] = ["kevlar"];
      if (isStrong) {
        candidates.push("smoke", "flash", "kevlar_helmet");
        if (side === "CT") candidates.push("defuse_kit");
      } else {
        candidates.push("smoke", "flash");
      }
      if (side === "T") candidates.push("molotov");
      else candidates.push("incendiary", "he");
      candidates.push("he");
      const { purchases, totalCost } = greedilyFit(rules, current, candidates, capped);
      const helmet = purchases.some((p) => p.item === "kevlar_helmet");
      const smoke = purchases.some((p) => p.item === "smoke");
      const flashes = flashCountOf(purchases);
      const he = purchases.some((p) => p.item === "he");
      const fire = purchases.some((p) => p.item === "molotov" || p.item === "incendiary");
      const kit = purchases.some((p) => p.item === "defuse_kit");
      return finish(
        input,
        rules,
        {
          displayTag: kind === "awp" ? "AWP" : "RIFLE",
          spendCeiling: capped,
          primaryIntent: "keep_current",
          armorIntent: helmet ? "helmet" : purchases.some((p) => p.item === "kevlar") ? "kevlar" : "none",
          utilityIntent: { smoke, flashes, he, fire },
          defuseKit: kit,
          confidence: anchorMissing ? "low" : input.roundStartMoneyConfidence === "exact" ? "high" : "medium",
          reasons: [
            ...reasons,
            { code: "retained_keep", detail: `retained ${kind}: keep_current, no automatic replacement` },
          ],
        },
        purchases,
      );
    }
    // replace allowed (override rifle / max_combat) → fall through to fresh buy
  }

  // ---- no usable retained primary (or explicit replacement override) ----
  const freshBuy = kind === "none" || replaceAllowed;
  void freshBuy;

  if (override === "max_combat") {
    // no next-round preservation; maximize current-round combat within cash
    const spendCeiling = input.currentMoney;
    const mainRifle = side === "T" ? "ak47" : input.ctRiflePreference ?? "m4a4";
    const candidates: ItemId[] = [mainRifle, "kevlar", "kevlar_helmet", "smoke", "flash", "he"];
    if (side === "CT") candidates.push("defuse_kit", "incendiary");
    else candidates.push("molotov");
    const { purchases, totalCost } = greedilyFit(rules, current, candidates, spendCeiling);
    const hasRifle = purchases.some((p) => isRifleClass(p.item));
    const smoke = purchases.some((p) => p.item === "smoke");
    const flashes = flashCountOf(purchases);
    const he = purchases.some((p) => p.item === "he");
    const fire = purchases.some((p) => p.item === "molotov" || p.item === "incendiary");
    const kit = purchases.some((p) => p.item === "defuse_kit");
    return finish(
      input,
      rules,
      {
        displayTag: "RIFLE",
        spendCeiling,
        primaryIntent: "rifle",
        armorIntent: purchases.some((p) => p.item === "kevlar_helmet") ? "helmet" : "kevlar",
        utilityIntent: { smoke, flashes, he, fire },
        defuseKit: kit,
        confidence: anchorMissing ? "low" : "high",
        reasons: [...reasons, { code: "override_max_combat", detail: "maximize current-round combat within cash" }],
      },
      purchases,
    );
  }

  if (override === "rifle") {
    // explicit rifle intent: use full cash, main rifle → budget rifle fallback
    const spendCeiling = input.currentMoney;
    const mainRifle = side === "T" ? "ak47" : input.ctRiflePreference ?? "m4a4";
    const budgetRifle = budgetRifleFor(side);
    const candidates: ItemId[] = [mainRifle, budgetRifle, "kevlar", "smoke", "flash"];
    if (side === "T") candidates.push("kevlar_helmet", "molotov");
    else candidates.push("kevlar_helmet", "defuse_kit", "incendiary");
    candidates.push("he");
    const { purchases, totalCost } = greedilyFit(rules, current, candidates, spendCeiling);
    const prim = purchases.find((p) => isRifleClass(p.item) || isSmgClass(p.item));
    const smoke = purchases.some((p) => p.item === "smoke");
    const flashes = flashCountOf(purchases);
    const he = purchases.some((p) => p.item === "he");
    const fire = purchases.some((p) => p.item === "molotov" || p.item === "incendiary");
    const kit = purchases.some((p) => p.item === "defuse_kit");
    return finish(
      input,
      rules,
      {
        displayTag: "RIFLE",
        spendCeiling,
        primaryIntent: prim && isSmgClass(prim.item) ? "smg" : prim ? "rifle" : "none",
        armorIntent: purchases.some((p) => p.item === "kevlar_helmet") ? "helmet" : "kevlar",
        utilityIntent: { smoke, flashes, he, fire },
        defuseKit: kit,
        confidence: anchorMissing ? "low" : "high",
        reasons: [...reasons, { code: "override_rifle", detail: "explicit rifle intent (main → budget fallback)" }],
      },
      purchases,
    );
  }

  // ---- auto: fresh buy decision ----
  if (atOrAboveGate) {
    // strong-buy gate reached → full rifle bundle with current cash
    const spendCeiling = input.currentMoney;
    const mainRifle = side === "T" ? "ak47" : input.ctRiflePreference ?? "m4a4";
    const candidates: ItemId[] = [mainRifle, "kevlar", "smoke"];
    if (side === "T") {
      candidates.push("kevlar_helmet", "flash", "molotov");
    } else {
      candidates.push("defuse_kit", "flash", "incendiary");
    }
    candidates.push("he", "flash");
    const { purchases, totalCost } = greedilyFit(rules, current, candidates, spendCeiling);
    const smoke = purchases.some((p) => p.item === "smoke");
    const flashes = flashCountOf(purchases);
    const he = purchases.some((p) => p.item === "he");
    const fire = purchases.some((p) => p.item === "molotov" || p.item === "incendiary");
    const kit = purchases.some((p) => p.item === "defuse_kit");
    const helmet = purchases.some((p) => p.item === "kevlar_helmet");
    const nearGate = Math.abs(input.currentMoney - st.gate) <= 200;
    return finish(
      input,
      rules,
      {
        displayTag: "RIFLE",
        spendCeiling,
        primaryIntent: "rifle",
        armorIntent: helmet ? "helmet" : "kevlar",
        utilityIntent: { smoke, flashes, he, fire },
        defuseKit: kit,
        confidence: anchorMissing ? "low" : nearGate ? "medium" : input.roundStartMoneyConfidence === "exact" ? "high" : "medium",
        reasons: [
          ...reasons,
          { code: "strong_buy_gate", detail: `current $${input.currentMoney} ≥ strong gate $${st.gate} (pro p_full≥80% @ ${st.gate})` },
        ],
      },
      purchases,
    );
  }

  // ---- below gate: tier within spendCeiling = min(currentMoney, preservationBudget) ----
  const spendCeiling = Math.min(input.currentMoney, st.preservationBudget);
  const budgetRifle = budgetRifleFor(side);
  const sideSmg = smgFor(side);
  const sidePistol = sidePistolFor(side);
  // fixed combat tiers (mandatory core must be fully affordable)
  const tiers: Array<{ tag: DisplayTag; intent: PrimaryIntent; core: ItemId[]; ext: ItemId[] }> = [
    { tag: "RIFLE", intent: "budget_rifle", core: [budgetRifle, "kevlar"], ext: ["smoke", "flash", "kevlar_helmet"] },
    { tag: "SMG", intent: "smg", core: [sideSmg, "kevlar"], ext: ["smoke", "flash"] },
    { tag: "LIGHT", intent: "paid_pistol", core: [sidePistol, "kevlar"], ext: ["smoke", "flash"] },
    { tag: "LIGHT", intent: "paid_pistol", core: ["p250", "kevlar"], ext: ["smoke"] },
    { tag: "SAVE", intent: "none", core: [], ext: [] },
  ];
  for (const tier of tiers) {
    const corePlan = planPurchases(current, tier.core.map((c) => ({ item: c, quantity: 1 })), rules);
    if (corePlan.totalCost > spendCeiling) continue;
    const candidates = [...tier.core];
    for (const e of tier.ext) candidates.push(e);
    if (side === "T") candidates.push("molotov", "he");
    else candidates.push("incendiary", "he");
    const { purchases, totalCost } = greedilyFit(rules, current, candidates, spendCeiling);
    const smoke = purchases.some((p) => p.item === "smoke");
    const flashes = flashCountOf(purchases);
    const he = purchases.some((p) => p.item === "he");
    const fire = purchases.some((p) => p.item === "molotov" || p.item === "incendiary");
    const helmet = purchases.some((p) => p.item === "kevlar_helmet");
    const pistol = purchases.find((p) => p.item === sidePistol || p.item === "p250");
    return finish(
      input,
      rules,
      {
        displayTag: tier.tag,
        spendCeiling,
        primaryIntent: tier.intent,
        armorIntent: helmet ? "helmet" : purchases.some((p) => p.item === "kevlar") ? "kevlar" : "none",
        utilityIntent: { smoke, flashes, he, fire },
        defuseKit: false,
        confidence: anchorMissing ? "low" : input.roundStartMoneyConfidence === "exact" ? "medium" : "medium",
        reasons: [
          ...reasons,
          { code: "below_gate_tier", detail: `below strong gate; tier=${tier.intent} within spendCeiling $${spendCeiling} (preservation $${st.preservationBudget})` },
        ],
      },
      purchases,
    );
  }
  // unreachable: SAVE tier always fits
  return finish(
    input,
    rules,
    {
      displayTag: "SAVE",
      spendCeiling,
      primaryIntent: "none",
      armorIntent: "none",
      utilityIntent: { smoke: false, flashes: 0, he: false, fire: false },
      defuseKit: false,
      confidence: anchorMissing ? "low" : "medium",
      reasons: [...reasons, { code: "below_gate_save", detail: "below gate with no affordable tier core" }],
    },
    [],
  );
}

/** Shared finish: attach projections via the deterministic projection engine. */
function finish(
  input: PolicyInput,
  rules: EconomyRules,
  decision: Omit<PolicyDecision, "purchases" | "totalCost" | "projection">,
  purchases: PurchaseItem[],
): PolicyDecision {
  // incremental cost from the CURRENT inventory (armor=100 + no helmet →
  // kevlar_helmet costs $350, not $1000) — must match planPurchases
  const totalCost = planPurchases(input.currentInventory, purchases, rules).totalCost;
  const projectionInput: ProjectionInput = {
    money: input.currentMoney,
    spendNow: totalCost,
    side: input.side,
    lossStreak: lossRewardToStreak(input.lossReward),
    kills: [],
    rules,
  };
  const proj = projectNextRoundMoney(projectionInput);
  const noSpend = projectNextRoundMoney({ ...projectionInput, spendNow: 0 });
  return {
    ...decision,
    purchases,
    totalCost,
    projection: {
      lossNoMoreSpend: noSpend.loss,
      lossAfterRecommendation: proj.loss,
      lossWithPlantAfterRecommendation: proj.lossWithPlant,
    },
  };
}
