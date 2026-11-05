import {
  recommendPolicyV3,
  type PolicyMode,
  type PolicyV3Output,
  type PolicyV3State,
  type RecommendationOption,
} from "@roundsense/economy-advisor";
import type { GsiReceipt } from "@roundsense/gsi-protocol";
import { PolicyStateTracker } from "../policy-state.js";
import { inventoryFrom } from "../inventory.js";

export interface HudSettings {
  awpPriority: "NEUTRAL" | "PREFER" | "SAVE_FOR_AWP";
  position: "below-radar" | "lower-left" | "lower-right";
  scale: number;
  opacity: number;
}
export const DEFAULT_HUD_SETTINGS: HudSettings = {
  awpPriority: "NEUTRAL",
  position: "below-radar",
  scale: 1,
  opacity: 0.84,
};
export const HUD_STALE_AFTER_MS = 5_000;
export interface HudCard {
  title: string;
  qualifier: string;
  budgetLabel: string;
  budget: number | null;
  purchases: string;
  spend: number | null;
  nextMoney: number | null;
  capability: string;
  assumption: string;
}
export type HudHiddenReason =
  | "awaiting"
  | "stale"
  | "not-playing"
  | "not-self"
  | "not-competitive"
  | "outside-freezetime";
export interface HudSnapshot {
  version: 1;
  revision: number;
  visible: boolean;
  hiddenReason: HudHiddenReason | null;
  side: "CT" | "T" | null;
  round: number | null;
  settings: HudSettings;
  cards: HudCard[];
  options: { mode: PolicyMode; spend: number; selected: boolean }[];
}
const NAMES: Record<string, string> = {
  ak47: "AK",
  m4a4: "M4A4",
  m4a1s: "M4A1-S",
  galil: "Galil",
  famas: "FAMAS",
  aug: "AUG",
  sg553: "SG553",
  awp: "AWP",
  ssg08: "鸟狙",
  scar20: "SCAR",
  g3sg1: "G3SG1",
  mac10: "MAC-10",
  mp9: "MP9",
  mp7: "MP7",
  mp5sd: "MP5",
  ump45: "UMP",
  p90: "P90",
  bizon: "野牛",
  nova: "Nova",
  xm1014: "XM1014",
  mag7: "MAG7",
  sawedoff: "短喷",
  m249: "M249",
  negev: "Negev",
  glock: "Glock",
  usp: "USP",
  p2000: "P2000",
  p250: "P250",
  dual: "双枪",
  tec9: "Tec9",
  cz75: "CZ",
  fiveseven: "FN57",
  deagle: "沙鹰",
  r8: "R8",
  zeus: "电击枪",
  kevlar: "半甲",
  kevlar_helmet: "甲头",
  defuse_kit: "钳",
  smoke: "烟",
  flash: "闪",
  he: "雷",
  molotov: "火",
  incendiary: "火",
  decoy: "诱饵",
};
export const MODE_NAMES: Record<PolicyMode, string> = {
  FULL: "全起",
  FORCE: "强起",
  LIGHT: "半起",
  PRESERVE: "ECO",
  AWP_PATH: "起 AWP",
};

export function cardForOption(
  policy: PolicyV3Output,
  option: RecommendationOption,
  armor: number,
  helmet: boolean,
  side: "CT" | "T",
): HudCard {
  const capabilityToProtect =
    "protectedCapability" in option.spendingGuidance
      ? option.spendingGuidance.protectedCapability
      : undefined;
  const boundary = policy.futureAffordability.boundaries.find(
    (b) => b.capability === capabilityToProtect,
  );
  const next =
    option.trajectory.find((s) => s.id === "LOSS_NO_PLANT")?.nextMoney.min ??
    null;
  const affordable =
    next === null
      ? []
      : policy.futureAffordability.boundaries.filter(
          (b) => b.reachableWithNoSpend && next >= b.targetCash,
        );
  const capability = affordable.some(
    (b) => b.capability === "RIFLE_ARMOR_BASIC_UTILITY",
  )
    ? "长枪甲道具"
    : affordable.length
      ? "长枪甲"
      : policy.futureAffordability.status === "PROJECTED"
        ? "长枪钱不足"
        : "能力未评估";
  return {
    title: MODE_NAMES[option.mode],
    qualifier: policy.defaultOptionId === option.id ? "优先" : "可选",
    budgetLabel: boundary ? "投入 ≤" : "花费",
    budget: boundary?.maxSpendNow ?? option.bundleSpend,
    purchases:
      option.purchases
        .map((p) => {
          const name =
            p.item === "kevlar_helmet" && armor === 100 && !helmet
              ? "头盔"
              : (NAMES[p.item] ?? p.item);
          return name + (p.quantity > 1 ? `×${p.quantity}` : "");
        })
        .join(" · ") || "无需购买",
    spend: option.bundleSpend,
    nextMoney: next,
    capability,
    assumption: `${side === "T" ? "T 未下包；" : ""}无额外击杀收入、保枪或队友转移；败后购买能力按重新购买计算。`,
  };
}

/** Owns GSI continuity; never caches a rendered recommendation across a gap. */
export class HudRuntime {
  private tracker = new PolicyStateTracker();
  private receipt: GsiReceipt | null = null;
  private policy: PolicyV3Output | null = null;
  private state: PolicyV3State | null = null;
  private identity = "";
  private revision = 0;
  private settings: HudSettings = { ...DEFAULT_HUD_SETTINGS };
  private integrityLost = false;
  constructor(private readonly staleAfterMs = HUD_STALE_AFTER_MS) {}

  observe(receipt: GsiReceipt): void {
    const providerId =
      receipt.payload.provider?.steamid ?? this.identity.split("/")[0] ?? "";
    const id = `${providerId}/${receipt.payload.player?.steamid ?? providerId}`;
    const gap =
      this.receipt !== null &&
      (receipt.seq !== this.receipt.seq + 1 ||
        receipt.receivedAtMonotonicNs < this.receipt.receivedAtMonotonicNs ||
        receipt.receivedAtMonotonicNs - this.receipt.receivedAtMonotonicNs >
          BigInt(this.staleAfterMs) * 1_000_000n);
    if (gap || id !== this.identity || this.integrityLost)
      this.tracker = new PolicyStateTracker();
    this.identity = id;
    this.integrityLost = false;
    this.receipt = receipt;
    this.state = this.tracker.observe(receipt.payload, receipt.seq);
    this.recalculate();
    this.revision++;
  }
  updateSettings(settings: HudSettings): void {
    this.settings = { ...settings };
    this.recalculate();
    this.revision++;
  }
  private recalculate(): void {
    if (!this.receipt) return;
    if (!this.state) return;
    const state = {
      ...this.state,
      player: { ...this.state.player },
      preference: {
        source:
          this.settings.awpPriority === "NEUTRAL"
            ? ("DEFAULT" as const)
            : ("USER_DECLARED" as const),
        awpPriority: this.settings.awpPriority,
      },
    };
    // A complete current inventory is required for a live purchasing card.
    // Never retain last round's inventory when the current payload omits it.
    const current = inventoryFrom(this.receipt.payload);
    if (!current)
      state.player.inventory = {
        status: "UNKNOWN",
        source: "current inventory",
        asOfSeq: this.receipt.seq,
        reason: "incomplete current inventory",
      };
    this.policy = recommendPolicyV3(state);
  }
  snapshot(nowNs: bigint): HudSnapshot {
    const payload = this.receipt?.payload;
    let hiddenReason: HudHiddenReason | null = null;
    if (!this.receipt) hiddenReason = "awaiting";
    else if (
      nowNs < this.receipt.receivedAtMonotonicNs ||
      nowNs - this.receipt.receivedAtMonotonicNs >
        BigInt(this.staleAfterMs) * 1_000_000n
    ) {
      hiddenReason = "stale";
      this.integrityLost = true;
    } else if (
      payload?.map?.phase !== "live" ||
      payload.player?.activity !== "playing" ||
      payload.provider?.appid !== 730
    )
      hiddenReason = "not-playing";
    else if (
      !payload.provider.steamid ||
      payload.player.steamid !== payload.provider.steamid
    )
      hiddenReason = "not-self";
    else if (payload.map.mode !== "competitive")
      hiddenReason = "not-competitive";
    else if (payload.round?.phase !== "freezetime")
      hiddenReason = "outside-freezetime";
    const side =
      payload?.player?.team === "CT" || payload?.player?.team === "T"
        ? payload.player.team
        : null;
    let cards: HudCard[] = [];
    if (!hiddenReason) {
      const p = this.policy!;
      if (p.options.length && side)
        cards = p.options.map((option) =>
          cardForOption(
            p,
            option,
            payload?.player?.state?.armor ?? 0,
            payload?.player?.state?.helmet ?? false,
            side,
          ),
        );
      else
        cards = [
          {
            title:
              p.status === "UNSUPPORTED_POLICY_EVIDENCE"
                ? "手枪局"
                : "信息不足",
            qualifier: "暂无建议",
            budgetLabel: "",
            budget: null,
            purchases:
              p.status === "UNSUPPORTED_POLICY_EVIDENCE"
                ? "暂不提供购买建议"
                : "等待完整状态",
            spend: null,
            nextMoney: null,
            capability: "暂不预测",
            assumption: "缺失信息不补造数值。",
          },
        ];
    }
    return {
      version: 1,
      revision: this.revision,
      visible: hiddenReason === null && cards.length > 0,
      hiddenReason,
      side,
      round: payload?.map?.round ?? null,
      settings: { ...this.settings },
      cards,
      options: hiddenReason
        ? []
        : (this.policy?.options ?? []).map((o) => ({
            mode: o.mode,
            spend: o.bundleSpend,
            selected: o.id === this.policy?.defaultOptionId,
          })),
    };
  }
}
