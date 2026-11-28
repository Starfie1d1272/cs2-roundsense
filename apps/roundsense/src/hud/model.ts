import {
  classifyNextBuyCapability,
  DEFAULT_RULES,
  type PolicyMode,
  type PolicyV3Output,
  type PolicyV3State,
  price,
  type RecommendationOption,
  type RoundContext,
  recommendPolicyV3,
  type SpendingGuidance,
} from '@roundsense/economy-advisor';
import type { GsiPayload, GsiReceipt } from '@roundsense/gsi-protocol';
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
const POST_FREEZETIME_NS = 5_000_000_000n;

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
  lossWithPlantCapability: HudFutureCapability | null;
  futureCapability: HudFutureCapability;
  awpNextReady: boolean;
  conditionalAlternatives: HudConditionalAlternative[];
}

export interface HudSnapshot {
  version: 2;
  revision: number;
  visible: boolean;
  hiddenReason: HudHiddenReason | null;
  displayPhase: 'freezetime' | 'post-freezetime' | null;
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
  const classifyCash = (cash: number | null): HudFutureCapability => {
    if (
      policy.futureAffordability.status === 'NOT_APPLICABLE' &&
      (policy.futureAffordability.reason === 'HALF_END_RESET' ||
        policy.futureAffordability.reason === 'MATCH_POINT_AGAINST')
    ) {
      return policy.futureAffordability.reason;
    }
    if (
      cash !== null &&
      side &&
      (policy.futureAffordability.status === 'PROJECTED' ||
        (policy.futureAffordability.status === 'NOT_APPLICABLE' &&
          policy.futureAffordability.reason === 'POST_PISTOL_STRATEGY'))
    ) {
      return classifyNextBuyCapability(side, cash);
    }
    return 'NOT_EVALUATED';
  };
  const futureCapability = classifyCash(lossNextMoney);
  const lossWithPlantCapability =
    lossWithPlantNextMoney === null ? null : classifyCash(lossWithPlantNextMoney);

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
    lossWithPlantCapability,
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

type RoundAdvice = Pick<
  HudSnapshot,
  | 'money'
  | 'lossIndex'
  | 'roundContext'
  | 'policyStatus'
  | 'defaultOptionId'
  | 'unresolved'
  | 'options'
>;

function gameHiddenReason(payload: GsiPayload): HudHiddenReason | null {
  if (
    payload.map?.phase !== 'live' ||
    payload.player?.activity !== 'playing' ||
    payload.provider?.appid !== 730
  )
    return 'not-playing';
  if (!payload.provider.steamid || payload.player.steamid !== payload.provider.steamid)
    return 'not-self';
  return payload.map.mode === 'competitive' ? null : 'not-competitive';
}

function playerSide(payload: GsiPayload | undefined): HudSnapshot['side'] {
  const team = payload?.player?.team;
  return team === 'CT' || team === 'T' ? team : null;
}

interface LockedOpening {
  key: string | null;
  receipt: GsiReceipt;
  observed: PolicyV3State;
  side: HudSnapshot['side'];
  content: RoundAdvice;
  holdUntilNs: bigint | null;
}

/** Owns GSI continuity and locks the first usable opening state for each round. */
export class HudRuntime {
  private tracker = new PolicyStateTracker();
  private receipt: GsiReceipt | null = null;
  private round: number | null = null;
  private advice: LockedOpening | null = null;
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
    if (gap || id !== this.identity || this.integrityLost) {
      this.tracker = new PolicyStateTracker();
      this.advice = null;
    }
    this.identity = id;
    this.integrityLost = false;
    this.receipt = receipt;
    const state = this.tracker.observe(receipt.payload, receipt.seq);
    this.round = state.round.number.value ?? null;
    this.observeRoundAdvice(receipt, state);
    this.revision++;
  }

  updateSettings(settings: HudSettings): void {
    const awpChanged = settings.awpPriority !== this.settings.awpPriority;
    this.settings = { ...settings };
    if (awpChanged && this.advice) {
      this.advice.content = this.buildAdvice(
        this.advice.receipt,
        this.advice.observed,
        this.advice.side,
      );
    }
    this.revision++;
  }

  private observeRoundAdvice(receipt: GsiReceipt, state: PolicyV3State): void {
    const { payload } = receipt;
    const side = playerSide(payload);
    const key = this.round === null ? null : JSON.stringify([payload.map?.name, this.round, side]);
    const phase = payload.round?.phase;
    if (
      key === null ||
      this.advice?.key !== key ||
      payload.map?.phase !== 'live' ||
      payload.map.mode !== 'competitive' ||
      phase === 'over'
    )
      this.advice = null;

    if (phase === 'live') {
      if (this.advice && this.advice.content.policyStatus !== 'INSUFFICIENT_STATE') {
        this.advice.holdUntilNs ??= receipt.receivedAtMonotonicNs + POST_FREEZETIME_NS;
      }
    } else if (phase === 'freezetime' && gameHiddenReason(payload) === null) {
      if (!this.advice || this.advice.content.policyStatus === 'INSUFFICIENT_STATE') {
        this.advice = {
          key,
          receipt,
          observed: state,
          side,
          content: this.buildAdvice(receipt, state, side),
          holdUntilNs: null,
        };
      } else this.advice.holdUntilNs = null;
    }
  }

  private buildAdvice(
    receipt: GsiReceipt,
    observed: PolicyV3State,
    side: HudSnapshot['side'],
  ): RoundAdvice {
    const state = {
      ...observed,
      player: { ...observed.player },
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
    const current = inventoryFrom(receipt.payload);
    if (!current)
      state.player.inventory = {
        status: 'UNKNOWN',
        source: 'current inventory',
        asOfSeq: receipt.seq,
        reason: 'incomplete current inventory',
      };
    const policy = recommendPolicyV3(state);
    const armor = current?.armor ?? 0;
    const helmet = current?.hasHelmet ?? false;
    const { money, lossIndex } = state.player;
    const { context } = state.round;
    return {
      money: money.status === 'UNKNOWN' ? null : (money.value ?? null),
      lossIndex: lossIndex.status === 'UNKNOWN' ? null : (lossIndex.value ?? null),
      roundContext: context.status === 'UNKNOWN' ? null : (context.value ?? null),
      policyStatus: policy.status,
      defaultOptionId: policy.defaultOptionId ?? null,
      unresolved: [...policy.unresolved],
      options: side
        ? policy.options.map((option) =>
            optionForRecommendation(policy, option, armor, helmet, this.settings.awpPriority, side),
          )
        : [],
    };
  }

  snapshot(nowNs: bigint): HudSnapshot {
    const payload = this.receipt?.payload;
    let hiddenReason: HudHiddenReason | null = payload ? gameHiddenReason(payload) : 'awaiting';
    let displayPhase: HudSnapshot['displayPhase'] = null;
    if (
      this.receipt &&
      (nowNs < this.receipt.receivedAtMonotonicNs ||
        nowNs - this.receipt.receivedAtMonotonicNs > BigInt(this.staleAfterMs) * 1_000_000n)
    ) {
      hiddenReason = 'stale';
      this.integrityLost = true;
    } else if (hiddenReason === null) {
      if (payload?.round?.phase === 'freezetime') displayPhase = 'freezetime';
      else if (
        payload?.round?.phase === 'live' &&
        this.advice?.holdUntilNs != null &&
        nowNs < this.advice.holdUntilNs
      )
        displayPhase = 'post-freezetime';
      else hiddenReason = 'outside-freezetime';
    }
    const visible = hiddenReason === null;
    const content = visible ? this.advice?.content : null;

    return {
      version: 2,
      revision: this.revision,
      visible,
      hiddenReason,
      displayPhase,
      side: playerSide(payload),
      round: this.round,
      money: content?.money ?? null,
      lossIndex: content?.lossIndex ?? null,
      roundContext: content?.roundContext ?? null,
      policyStatus: content?.policyStatus ?? null,
      defaultOptionId: content?.defaultOptionId ?? null,
      unresolved: content?.unresolved ?? [],
      settings: { ...this.settings },
      options: content?.options ?? [],
    };
  }
}
