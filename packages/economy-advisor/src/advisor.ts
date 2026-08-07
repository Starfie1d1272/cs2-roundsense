import type { ItemId, NextRoundGoal, Side } from "@roundsense/shared-types";
import { DEFAULT_RULES, type EconomyRules, price } from "./rules.js";
import { goalTargetCost, projectNextRoundMoney, type ProjectionInput } from "./projection.js";
import { classifyPurchase } from "./round-type.js";
import type { AdvisorInput, AdvisorOutput, InventoryState, PurchaseItem, Scheme } from "./types.js";

export function rifleFor(side: Side): ItemId {
  return side === "T" ? "ak47" : "m4a4";
}

export function smgFor(side: Side): ItemId {
  return side === "T" ? "mac10" : "mp9";
}

/** Same rifle family definition as goal semantics (not re-invented here). */
const RIFLE_FAMILY = ["ak47", "m4a4", "m4a1s", "galil", "famas"];
const SMG_FAMILY = ["mac10", "mp9", "mp7", "mp5sd", "ump45", "p90", "bizon"];
const GRENADES = ["smoke", "flash", "he", "molotov", "incendiary"] as const;

function isRifle(item: ItemId): boolean {
  return RIFLE_FAMILY.includes(item);
}

function isSmg(item: ItemId): boolean {
  return SMG_FAMILY.includes(item);
}

function isGrenade(item: ItemId): boolean {
  return (GRENADES as readonly string[]).includes(item);
}

/** Post-purchase loadout = current inventory + planned purchases. */
export interface PostLoadout {
  primary: ItemId | null;
  secondary?: ItemId;
  armor: number;
  hasHelmet: boolean;
  grenades: ItemId[];
}

/**
 * Resulting loadout after applying the purchases to the current inventory.
 * Goal fulfillment is judged on THIS, never on the purchase list alone.
 */
export function resultingLoadout(inventory: InventoryState, purchases: PurchaseItem[]): PostLoadout {
  const loadout: PostLoadout = {
    primary: inventory.primary ?? null,
    secondary: inventory.secondary,
    armor: inventory.armor,
    hasHelmet: inventory.hasHelmet,
    grenades: [...inventory.grenades],
  };
  for (const p of purchases) {
    if (isRifle(p.item) || isSmg(p.item) || p.item === "awp") loadout.primary = p.item;
    else if (p.item === "deagle") loadout.secondary = "deagle";
    else if (p.item === "kevlar" || p.item === "kevlar_helmet") {
      loadout.armor = 100;
      if (p.item === "kevlar_helmet") loadout.hasHelmet = true;
    } else if (isGrenade(p.item)) {
      for (let i = 0; i < p.quantity; i++) loadout.grenades.push(p.item);
    }
  }
  return loadout;
}

/**
 * True when the POST-PURCHASE loadout fulfills the next-round goal
 * (existing inventory counts — e.g. already owning a rifle means buying
 * only armor still fulfills rifle_armor).
 */
export function fulfillsLoadoutGoal(goal: NextRoundGoal, loadout: PostLoadout): boolean {
  switch (goal) {
    case "awp":
      return loadout.primary === "awp";
    case "rifle_armor":
    case "rifle_util":
      return loadout.primary !== null && isRifle(loadout.primary) && loadout.armor > 0;
    case "max_combat_now":
      return false;
  }
}

/** Incremental unit cost of one purchased item given the current inventory.
 * kevlar_helmet upgrade from FULL armor (armor === 100, no helmet) costs
 * price(helmet) - price(vest) = $350 (Windows build 14174: armor=100,
 * helmet=false → vesthelm → money delta −350). Damaged/no armor pays the
 * full $1000 — the observed $350 case must NOT be extended to any armor. */
function armorIncrementalUnit(rules: EconomyRules, inventory: InventoryState, item: ItemId): number {
  if (item === "kevlar_helmet" && inventory.armor === 100 && !inventory.hasHelmet) {
    return price(rules, "kevlar_helmet") - price(rules, "kevlar");
  }
  return price(rules, item);
}

export interface PurchasePlan {
  /** What must actually be bought given the current inventory. */
  purchases: PurchaseItem[];
  /** Incremental spend (actual money needed now). */
  totalCost: number;
  /** Full target value with an empty inventory (combat value, ranking). */
  targetCost: number;
}

/**
 * Plan the purchases from the current inventory to the resolved target
 * loadout. Target items are the bundle template items AFTER side resolution.
 * Item-by-item satisfaction:
 * - rifle family: satisfied by ANY current rifle primary
 * - SMG family: satisfied by ANY current SMG primary
 * - awp: only exact current primary === "awp"
 * - deagle: exact secondary match
 * - kevlar/kevlar_helmet: armor/helmet state with incremental upgrade cost
 * - grenades: multiset subtraction (quantity matters, no set dedupe)
 */
export function planPurchases(inventory: InventoryState, targetItems: PurchaseItem[], rules: EconomyRules): PurchasePlan {
  const purchases = new Map<ItemId, number>();
  let targetCost = 0;
  const add = (item: ItemId, qty = 1) => purchases.set(item, (purchases.get(item) ?? 0) + qty);

  const hasArmor = inventory.armor > 0; // local derived value, not stored
  const hasRifle = inventory.primary !== null && inventory.primary !== undefined && isRifle(inventory.primary);
  const hasSmg = inventory.primary !== null && inventory.primary !== undefined && isSmg(inventory.primary);

  const ownedGrenades = new Map<ItemId, number>();
  for (const g of inventory.grenades) ownedGrenades.set(g, (ownedGrenades.get(g) ?? 0) + 1);

  const consume = (item: ItemId) => {
    if (isRifle(item)) {
      if (!hasRifle) add(item);
      targetCost += price(rules, item);
    } else if (isSmg(item)) {
      if (!hasSmg) add(item);
      targetCost += price(rules, item);
    } else if (item === "awp") {
      if (inventory.primary !== "awp") add("awp");
      targetCost += price(rules, "awp");
    } else if (item === "deagle") {
      if (inventory.secondary !== "deagle") add("deagle");
      targetCost += price(rules, "deagle");
    } else if (item === "kevlar") {
      // "具有护甲" — not a forced 100-armor refill; any armor satisfies it
      if (!hasArmor) add("kevlar");
      targetCost += price(rules, "kevlar");
    } else if (item === "kevlar_helmet") {
      if (!(inventory.armor > 0 && inventory.hasHelmet)) add("kevlar_helmet");
      targetCost += price(rules, "kevlar_helmet");
    } else if (isGrenade(item)) {
      const owned = ownedGrenades.get(item) ?? 0;
      if (owned > 0) ownedGrenades.set(item, owned - 1);
      else add(item);
      targetCost += price(rules, item);
    }
    // unknown target item → no guessing, buy nothing, count nothing
  };

  for (const t of targetItems) {
    for (let i = 0; i < t.quantity; i++) consume(t.item);
  }

  let totalCost = 0;
  for (const [item, qty] of purchases) {
    totalCost += armorIncrementalUnit(rules, inventory, item) * qty;
  }

  return {
    purchases: [...purchases.entries()].map(([item, quantity]) => ({ item, quantity })),
    totalCost,
    targetCost,
  };
}

interface BundleTemplate {
  id: string;
  label: string;
  items: ItemId[];
}

const BUNDLES: Record<NextRoundGoal, BundleTemplate[]> = {
  rifle_armor: [
    { id: "rifle-helmet", label: "长枪 + 全甲", items: ["ak47", "kevlar_helmet"] },
    { id: "rifle-kevlar", label: "长枪 + 半甲", items: ["ak47", "kevlar"] },
    { id: "rifle-helmet-util", label: "长枪 + 全甲 + 基础道具", items: ["ak47", "kevlar_helmet", "smoke", "flash"] },
    { id: "force-deagle", label: "强起（沙鹰 + 甲 + 闪）", items: ["deagle", "kevlar", "flash"] },
    { id: "half-smg", label: "半起（冲锋枪 + 甲）", items: ["mac10", "kevlar"] },
    { id: "save", label: "全保存（只买手枪/不买）", items: [] },
  ],
  awp: [
    { id: "awp-helmet", label: "AWP + 全甲（目标提前达成）", items: ["awp", "kevlar_helmet"] },
    { id: "awp-kevlar", label: "AWP + 半甲", items: ["awp", "kevlar"] },
    { id: "force-deagle", label: "强起（沙鹰 + 甲 + 闪）", items: ["deagle", "kevlar", "flash"] },
    { id: "rifle-bridge", label: "过渡步枪 + 甲（推迟 AWP）", items: ["ak47", "kevlar"] },
    { id: "save", label: "节省（保证下回合 AWP）", items: [] },
  ],
  rifle_util: [
    { id: "rifle-util-basic", label: "长枪 + 甲 + 烟 + 闪", items: ["ak47", "kevlar", "smoke", "flash"] },
    { id: "rifle-util-full", label: "长枪 + 全甲 + 烟闪雷", items: ["ak47", "kevlar_helmet", "smoke", "flash", "he"] },
    { id: "rifle-kevlar", label: "长枪 + 甲（无道具）", items: ["ak47", "kevlar"] },
    { id: "force-deagle", label: "强起（沙鹰 + 甲 + 闪）", items: ["deagle", "kevlar", "flash"] },
    { id: "save", label: "全保存", items: [] },
  ],
  max_combat_now: [
    { id: "max-full", label: "满配长枪 + 全道具", items: ["ak47", "kevlar_helmet", "smoke", "flash", "he"] },
    { id: "max-util", label: "长枪 + 甲 + 烟 + 闪", items: ["ak47", "kevlar", "smoke", "flash"] },
    { id: "force-deagle", label: "强起（沙鹰 + 甲 + 闪 + 烟）", items: ["deagle", "kevlar", "flash", "smoke"] },
    { id: "save", label: "全保存", items: [] },
  ],
};

/** Resolve side-agnostic template items to side-specific purchases. */
function resolveItems(rules: EconomyRules, side: Side, items: ItemId[]): PurchaseItem[] {
  const count = new Map<ItemId, number>();
  for (const item of items) {
    const resolved = item === "ak47" ? rifleFor(side) : item === "mac10" ? smgFor(side) : item;
    count.set(resolved, (count.get(resolved) ?? 0) + 1);
  }
  return [...count.entries()].map(([item, quantity]) => ({ item, quantity }));
}

/**
 * Goal-constrained purchase advisor (P0-B).
 *
 * Pure function: same input → same output. Produces at most 3 schemes with
 * clearly different characters (recommended / aggressive / conservative),
 * each with projections across key outcome branches and an explicit
 * breaksGoal verdict.
 */
export function recommend(input: AdvisorInput, rules: EconomyRules = DEFAULT_RULES): AdvisorOutput {
  const templates = BUNDLES[input.nextRoundGoal];

  const schemes: Scheme[] = templates.map((template) => {
    const targetItems = resolveItems(rules, input.side, template.items);
    const plan = planPurchases(input.inventory, targetItems, rules);
    const { purchases, totalCost, targetCost } = plan;
    const affordable = totalCost <= input.money;
    const projectionInput: ProjectionInput = {
      money: input.money,
      spendNow: totalCost,
      side: input.side,
      lossStreak: input.lossStreak,
      kills: input.killsThisRound,
      bombPlantedThisRound: input.bombPlantedThisRound ?? false,
      ctTeamKillsOnTs: input.ctTeamKillsOnTs, // C5: CT shared team award
      rules,
    };
    const projections = projectNextRoundMoney(projectionInput);
    const roundType = classifyPurchase(rules, purchases.map((p) => p.item), totalCost);
    const goal = input.nextRoundGoal;

    let breaksGoal = false;
    let breaksGoalReason: string | undefined;
    if (goal !== "max_combat_now" && totalCost > 0) {
      const target = goalTargetCost(rules, goal, input.side);
      // goal fulfillment is judged on the POST-PURCHASE loadout (existing
      // inventory counts), never on the purchase list alone
      const fulfills = fulfillsLoadoutGoal(goal, resultingLoadout(input.inventory, purchases));
      if (!fulfills && projections.loss < target) {
        breaksGoal = true;
        breaksGoalReason = `失败分支下回合 ${projections.loss} < 目标成本 ${target}（${goal}）`;
      }
    }

    const goalTarget = input.nextRoundGoal === "max_combat_now"
      ? null
      : goalTargetCost(rules, input.nextRoundGoal, input.side);
    const basis = [
      `${template.label} 目标价值 $${targetCost}（本次需买 $${totalCost}，当前 $${input.money}）`,
      `本次购买类型: ${roundType}`,
      breaksGoal
        ? `⚠ 破坏目标: ${breaksGoalReason}`
        : totalCost === 0 && goalTarget !== null && projections.loss < goalTarget
          ? `不破坏目标（节省方案本身不破坏目标）；注意失败分支下回合 $${projections.loss} < 目标成本，需胜利分支补足`
          : `不破坏目标（失败分支下回合 $${projections.loss} ≥ 目标成本）`,
    ];
    const assumptions = [
      "投影按 0 额外击杀；每步枪击杀 +$300、每 AWP 击杀 +$100（规则文件）",
      "未计下包/拆包个人 +$300 奖励、未计短员/惩罚",
      "当前已持有装备按 inventory 快照参与本次购买差额计算",
      "数值规则（回合奖励/连败奖金/价格）已通过语料整数账本验证（rules.status=verified, statusScope=numeric-rules）；lossStreak 实时来源（GSI consecutive_round_losses）Windows build 14174 runtime-observed（index 1→$1900、index 2→$2400，win transitions 3→1/1→0 已观测）；index 0/3/4 未在受控 runtime 直接验证 payout；win transition 未决不影响本投影",
    ];

    return {
      id: template.id,
      label: template.label,
      character: "recommended", // reassigned below
      purchases,
      totalCost,
      targetCost,
      roundType,
      affordable,
      projections,
      breaksGoal,
      breaksGoalReason,
      basis,
      assumptions,
    };
  });

  const affordableSchemes = schemes.filter((s) => s.affordable);
  // A plan has combat value when its TARGET loadout is worth something —
  // incremental spend may be $0 because the player already owns the gear,
  // which must not demote the plan.
  const nonSave = affordableSchemes.filter((s) => s.targetCost > 0);

  // Goal-aware recommended selection:
  // - awp goal with unaffordable AWP → the SAVE bundle is the recommended plan
  //   (spending now would risk the AWP next round); most valuable target is
  //   the aggressive alternative.
  // - other goals → most combat-valuable affordable bundle (max targetCost),
  //   falling back to the cheapest (usually save) when nothing is affordable.
  let recommended: Scheme | null;
  const awpAffordable = affordableSchemes.some((s) => s.id.startsWith("awp-"));
  if (input.nextRoundGoal === "awp" && !awpAffordable) {
    recommended = affordableSchemes.find((s) => s.id === "save") ?? nonSave[0] ?? null;
  } else {
    recommended =
      nonSave.length > 0
        ? [...nonSave].sort((a, b) => b.targetCost - a.targetCost)[0]!
        : affordableSchemes[0] ?? null;
  }

  const rest = affordableSchemes.filter((s) => s !== recommended);
  const aggressive = [...rest].sort((a, b) => b.targetCost - a.targetCost)[0] ?? null;
  const conservative = [...rest].sort((a, b) => a.targetCost - b.targetCost)[0] ?? null;

  if (recommended) recommended.character = "recommended";
  if (aggressive) aggressive.character = "aggressive";
  if (conservative) conservative.character = "conservative";

  const alternatives = [aggressive, conservative].filter((s): s is Scheme => s !== null && s !== recommended);
  // de-duplicate (aggressive may equal conservative when only one alternative)
  const seen = new Set<string>();
  const uniqueAlternatives: Scheme[] = [];
  for (const s of alternatives) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      uniqueAlternatives.push(s);
    }
  }

  return {
    goal: input.nextRoundGoal,
    recommended,
    alternatives: uniqueAlternatives.slice(0, 2),
    rules: {
      ruleSetId: rules.ruleSetId,
      status: rules.status,
      verifiedAt: rules.verifiedAt,
      sources: rules.sources.map((s) => ({ name: s.name, url: s.url, revision: s.revision, accessed: s.accessed })),
    },
  };
}
