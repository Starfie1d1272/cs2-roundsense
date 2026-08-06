import type { ItemId, NextRoundGoal, Side } from "@roundsense/shared-types";
import { DEFAULT_RULES, type EconomyRules, price } from "./rules.js";
import { goalTargetCost, projectNextRoundMoney, type ProjectionInput } from "./projection.js";
import { classifyPurchase } from "./round-type.js";
import type { AdvisorInput, AdvisorOutput, PurchaseItem, Scheme } from "./types.js";

export function rifleFor(side: Side): ItemId {
  return side === "T" ? "ak47" : "m4a4";
}

export function smgFor(side: Side): ItemId {
  return side === "T" ? "mac10" : "mp9";
}

/** True when the purchase list itself fulfills the next-round goal. */
function fulfillsGoalCheck(goal: NextRoundGoal, items: ItemId[]): boolean {
  const rifles = new Set(["ak47", "m4a4", "m4a1s", "galil", "famas"]);
  switch (goal) {
    case "awp":
      return items.includes("awp");
    case "rifle_armor":
    case "rifle_util":
      return items.some((i) => rifles.has(i)) && (items.includes("kevlar") || items.includes("kevlar_helmet"));
    case "max_combat_now":
      return false;
  }
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

function costOf(rules: EconomyRules, purchases: PurchaseItem[]): number {
  return purchases.reduce((sum, p) => sum + price(rules, p.item) * p.quantity, 0);
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
    const purchases = resolveItems(rules, input.side, template.items);
    const totalCost = costOf(rules, purchases);
    const affordable = totalCost <= input.money;
    const projectionInput: ProjectionInput = {
      money: input.money,
      spendNow: totalCost,
      side: input.side,
      lossStreak: input.lossStreak,
      kills: input.killsThisRound,
      bombPlantedThisRound: input.bombPlantedThisRound ?? false,
      pistolRound: input.roundNumber === 1 || input.roundNumber === 14, // C10
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
      const fulfillsGoal = fulfillsGoalCheck(goal, purchases.map((p) => p.item));
      if (!fulfillsGoal && projections.loss < target) {
        breaksGoal = true;
        breaksGoalReason = `失败分支下回合 ${projections.loss} < 目标成本 ${target}（${goal}）`;
      }
    }

    const goalTarget = input.nextRoundGoal === "max_combat_now"
      ? null
      : goalTargetCost(rules, input.nextRoundGoal, input.side);
    const basis = [
      `${template.label} 花费 $${totalCost}（当前 $${input.money}）`,
      `回合类型判定: ${roundType}`,
      breaksGoal
        ? `⚠ 破坏目标: ${breaksGoalReason}`
        : totalCost === 0 && goalTarget !== null && projections.loss < goalTarget
          ? `不破坏目标（节省方案本身不破坏目标）；注意失败分支下回合 $${projections.loss} < 目标成本，需胜利分支补足`
          : `不破坏目标（失败分支下回合 $${projections.loss} ≥ 目标成本）`,
    ];
    const assumptions = [
      "投影按 0 额外击杀；每步枪击杀 +$300、每 AWP 击杀 +$100（规则文件）",
      "未计下包/拆包个人 +$300 奖励、未计短员/惩罚",
      input.inventory.survivedLastRound
        ? "本回合存活：保留装备下回合无需重购（未折价）"
        : "若本回合阵亡，装备不保留",
      "奖金数值为 provisional（见规则文件 sources/notes）",
    ];

    return {
      id: template.id,
      label: template.label,
      character: "recommended", // reassigned below
      purchases,
      totalCost,
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
  const nonSave = affordableSchemes.filter((s) => s.totalCost > 0);

  // Goal-aware recommended selection:
  // - awp goal with unaffordable AWP → the SAVE bundle is the recommended plan
  //   (spending now would risk the AWP next round); most-expensive spend is
  //   the aggressive alternative.
  // - other goals → most combat-valuable affordable bundle (max cost),
  //   falling back to the cheapest (usually save) when nothing is affordable.
  let recommended: Scheme | null;
  const awpAffordable = affordableSchemes.some((s) => s.id.startsWith("awp-"));
  if (input.nextRoundGoal === "awp" && !awpAffordable) {
    recommended = affordableSchemes.find((s) => s.id === "save") ?? nonSave[0] ?? null;
  } else {
    recommended =
      nonSave.length > 0
        ? [...nonSave].sort((a, b) => b.totalCost - a.totalCost)[0]!
        : affordableSchemes[0] ?? null;
  }

  const rest = affordableSchemes.filter((s) => s !== recommended);
  const aggressive = [...rest].sort((a, b) => b.totalCost - a.totalCost)[0] ?? null;
  const conservative = [...rest].sort((a, b) => a.totalCost - b.totalCost)[0] ?? null;

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
