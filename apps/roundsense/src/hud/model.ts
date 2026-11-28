import {
  DEFAULT_RULES,
  fullUtilityTargetCash,
  type PolicyMode,
  type PolicyV3Output,
  type PolicyV3State,
  price,
  type RecommendationOption,
  type RoundContext,
  recommendPolicyV3,
  type SpendingGuidance,
} from '@roundsense/economy-advisor';
import type { GsiReceipt } from '@roundsense/gsi-protocol';
import type { ItemId } from '@roundsense/shared-types';
import { inventoryFrom } from '../inventory.js';
import { PolicyStateTracker } from '../policy-state.js';

export interface HudSettings {
  awpPriority: 'NEUTRAL' | 'PREFER' | 'SAVE_FOR_AWP';
  position: 'below-radar' | 'lower-left' | 'lower-right';
  scale: number;
  opacity: number;
}

export const DEFAULT_HUD_SETTINGS: HudSettings = {
  awpPriority: 'NEUTRAL',
  position: 'below-radar',
  scale: 1,
  opacity: 0.84,
};

export const HUD_STALE_AFTER_MS = 5_000;

export type HudHiddenReason =
  'awaiting' | 'stale' | 'not-playing' | 'not-self' | 'not-competitive' | 'outside-freezetime';

export interface HudPurchaseItem {
  item: ItemId;
  quantity: number;
  /** True when upgrading 100-point kevlar to kevlar+helmet ($350) rather than buying full vesthelm. */
  helmetUpgradeOnly: boolean;
}

export interface HudConditionalAlternative {
  condition: string;
  purchases: HudPurchaseItem[];
  spendDelta: number;
  reason: string;
}

export type HudFutureCapability =
  | 'FULL_UTILITY'
  | 'RIFLE_ARMOR_BASIC_UTILITY'
  | 'RIFLE_ARMOR'
  | 'INSUFFICIENT'
  | 'HALF_END_RESET'
  | 'MATCH_POINT_AGAINST'
  | 'NOT_EVALUATED';

export interface HudOption {
  id: string;
  mode: PolicyMode;
  isDefault: boolean;
  adviceStrength: RecommendationOption['adviceStrength'];
  spendingGuidance: SpendingGuidance;
  spend: number;
  maxSpendNow: number | null;
  purchases: HudPurchaseItem[];
  lossNextMoney: number | null;
  lossWithPlantNextMoney: number | null;
  futureCapability: HudFutureCapability;
  awpNextReady: boolean;
  conditionalAlternatives: HudConditionalAlternative[];
}

export interface HudSnapshot {
  version: 2;
  revision: number;
  visible: boolean;
  hiddenReason: HudHiddenReason | null;
  side: 'CT' | 'T' | null;
  round: number | null;
  money: number | null;
  lossIndex: number | null;
  roundContext: RoundContext | null;
  policyStatus: PolicyV3Output['status'] | null;
  defaultOptionId: string | null;
  unresolved: string[];
  settings: HudSettings;
  options: HudOption[];
}

function mapPurchases(
  purchases: RecommendationOption['purchases'],
  armor: number,
  helmet: boolean,
): HudPurchaseItem[] {
  return purchases.map((p) => ({
    item: p.item,
    quantity: p.quantity,
    helmetUpgradeOnly: p.item === 'kevlar_helmet' && armor === 100 && !helmet,
  }));
}

const AWP_ARMOR_THRESHOLD = price(DEFAULT_RULES, 'awp') + price(DEFAULT_RULES, 'kevlar');

export function optionForRecommendation(
  policy: PolicyV3Output,
  option: RecommendationOption,
  armor: number,
  helmet: boolean,
  awpPriority: HudSettings['awpPriority'] = 'NEUTRAL',
  side?: 'CT' | 'T',
): HudOption {
  const capabilityToProtect =
    'protectedCapability' in option.spendingGuidance
      ? option.spendingGuidance.protectedCapability
      : undefined;
  const boundary = policy.futureAffordability.boundaries.find(
    (b) => b.capability === capabilityToProtect,
  );
  const lossNextMoney =
    option.trajectory.find((s) => s.id === 'LOSS_NO_PLANT')?.nextMoney.min ?? null;
  const lossWithPlantNextMoney =
    option.trajectory.find((s) => s.id === 'LOSS_WITH_PLANT')?.nextMoney.min ?? null;
  const affordable =
    lossNextMoney === null
      ? []
      : policy.futureAffordability.boundaries.filter(
          (b) => b.reachableWithNoSpend && lossNextMoney >= b.targetCash,
        );
  const fullUtilityThreshold = side ? fullUtilityTargetCash(side) : null;
  const hasBasicUtility = affordable.some((b) => b.capability === 'RIFLE_ARMOR_BASIC_UTILITY');
  const futureCapability: HudFutureCapability =
    hasBasicUtility &&
    fullUtilityThreshold !== null &&
    lossNextMoney !== null &&
    lossNextMoney >= fullUtilityThreshold
      ? 'FULL_UTILITY'
      : hasBasicUtility
        ? 'RIFLE_ARMOR_BASIC_UTILITY'
        : affordable.length > 0
          ? 'RIFLE_ARMOR'
          : policy.futureAffordability.status === 'PROJECTED'
            ? 'INSUFFICIENT'
            : policy.futureAffordability.status === 'NOT_APPLICABLE' &&
                (policy.futureAffordability.reason === 'HALF_END_RESET' ||
                  policy.futureAffordability.reason === 'MATCH_POINT_AGAINST')
              ? policy.futureAffordability.reason
              : 'NOT_EVALUATED';

  return {
    id: option.id,
    mode: option.mode,
    isDefault: policy.defaultOptionId === option.id,
    adviceStrength: option.adviceStrength,
    spendingGuidance: option.spendingGuidance,
    spend: option.bundleSpend,
    maxSpendNow: boundary?.maxSpendNow ?? null,
    purchases: mapPurchases(option.purchases, armor, helmet),
    lossNextMoney,
    lossWithPlantNextMoney,
    futureCapability,
    awpNextReady:
      awpPriority !== 'NEUTRAL' && lossNextMoney !== null && lossNextMoney >= AWP_ARMOR_THRESHOLD,
    conditionalAlternatives: option.conditionalAlternatives.map((alt) => ({
      condition: alt.condition,
      purchases: mapPurchases(alt.purchases, armor, helmet),
      spendDelta: alt.bundleSpend - option.bundleSpend,
      reason: alt.reason,
    })),
  };
}

/** Owns GSI continuity; never caches a rendered recommendation across a gap. */
export class HudRuntime {
  private tracker = new PolicyStateTracker();
  private receipt: GsiReceipt | null = null;
  private policy: PolicyV3Output | null = null;
  private state: PolicyV3State | null = null;
  private identity = '';
  private revision = 0;
  private settings: HudSettings = { ...DEFAULT_HUD_SETTINGS };
  private integrityLost = false;
  constructor(private readonly staleAfterMs = HUD_STALE_AFTER_MS) {}

  observe(receipt: GsiReceipt): void {
    const providerId = receipt.payload.provider?.steamid ?? this.identity.split('/')[0] ?? '';
    const id = `${providerId}/${receipt.payload.player?.steamid ?? providerId}`;
    const gap =
      this.receipt !== null &&
      (receipt.seq !== this.receipt.seq + 1 ||
        receipt.receivedAtMonotonicNs < this.receipt.receivedAtMonotonicNs ||
        receipt.receivedAtMonotonicNs - this.receipt.receivedAtMonotonicNs >
          BigInt(this.staleAfterMs) * 1_000_000n);
    if (gap || id !== this.identity || this.integrityLost) this.tracker = new PolicyStateTracker();
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
    this.policy = null;
    if (!this.receipt) return;
    if (!this.state) return;
    const state = {
      ...this.state,
      player: { ...this.state.player },
      preference: {
        source:
          this.settings.awpPriority === 'NEUTRAL'
            ? ('DEFAULT' as const)
            : ('USER_DECLARED' as const),
        awpPriority: this.settings.awpPriority,
      },
    };
    // A complete current inventory is required for a live purchasing card.
    // Never retain last round's inventory when the current payload omits it.
    const current = inventoryFrom(this.receipt.payload);
    if (!current)
      state.player.inventory = {
        status: 'UNKNOWN',
        source: 'current inventory',
        asOfSeq: this.receipt.seq,
        reason: 'incomplete current inventory',
      };
    this.policy = recommendPolicyV3(state);
  }

  snapshot(nowNs: bigint): HudSnapshot {
    const payload = this.receipt?.payload;
    let hiddenReason: HudHiddenReason | null = null;
    if (!this.receipt) hiddenReason = 'awaiting';
    else if (
      nowNs < this.receipt.receivedAtMonotonicNs ||
      nowNs - this.receipt.receivedAtMonotonicNs > BigInt(this.staleAfterMs) * 1_000_000n
    ) {
      hiddenReason = 'stale';
      this.integrityLost = true;
    } else if (
      payload?.map?.phase !== 'live' ||
      payload.player?.activity !== 'playing' ||
      payload.provider?.appid !== 730
    )
      hiddenReason = 'not-playing';
    else if (!payload.provider.steamid || payload.player.steamid !== payload.provider.steamid)
      hiddenReason = 'not-self';
    else if (payload.map.mode !== 'competitive') hiddenReason = 'not-competitive';
    else if (payload.round?.phase !== 'freezetime') hiddenReason = 'outside-freezetime';

    const side =
      payload?.player?.team === 'CT' || payload?.player?.team === 'T' ? payload.player.team : null;
    const visible = hiddenReason === null;
    const p = visible ? this.policy : null;
    const armor = payload?.player?.state?.armor ?? 0;
    const helmet = payload?.player?.state?.helmet ?? false;

    const options =
      visible && p && side
        ? p.options.map((option) =>
            optionForRecommendation(p, option, armor, helmet, this.settings.awpPriority, side),
          )
        : [];

    const moneyFact = this.state?.player.money;
    const lossFact = this.state?.player.lossIndex;
    const contextFact = this.state?.round.context;

    return {
      version: 2,
      revision: this.revision,
      visible,
      hiddenReason,
      side,
      round: payload?.map?.round ?? null,
      money:
        visible && moneyFact?.status !== 'UNKNOWN' && moneyFact?.value !== undefined
          ? moneyFact.value
          : null,
      lossIndex:
        visible && lossFact?.status !== 'UNKNOWN' && lossFact?.value !== undefined
          ? lossFact.value
          : null,
      roundContext:
        visible && contextFact?.status !== 'UNKNOWN' && contextFact?.value !== undefined
          ? contextFact.value
          : null,
      policyStatus: p?.status ?? null,
      defaultOptionId: p?.defaultOptionId ?? null,
      unresolved: p ? [...p.unresolved] : [],
      settings: { ...this.settings },
      options,
    };
  }
}
