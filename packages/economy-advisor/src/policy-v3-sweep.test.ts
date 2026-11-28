import type { ItemId, Side } from '@roundsense/shared-types';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  type InventoryState,
  isItemLegalForSide,
  lossBonus,
  type PolicyV3State,
  planPurchases,
  type RoundContext,
  recommendPolicyV3,
  resultingLoadout,
  type UserPreference,
  weaponClassOf,
} from './index.js';

function obs<T>(value: T, source = 'sweep') {
  return { status: 'OBSERVED' as const, value, source, asOfSeq: 1 };
}

function makeState(params: {
  side: Side;
  money: number;
  lossIndex: number | 'UNKNOWN';
  inventory: InventoryState;
  context: RoundContext;
  roundNumber: number;
  score?: { ct: number; t: number };
  awpPriority?: UserPreference['awpPriority'];
  previousWinner?: Side | 'UNKNOWN';
}): PolicyV3State {
  const score = params.score ?? { ct: 5, t: 5 };
  const ownLoss =
    params.lossIndex === 'UNKNOWN'
      ? {
          status: 'UNKNOWN' as const,
          source: 'sweep',
          asOfSeq: 1,
          reason: 'cold start',
        }
      : obs(params.lossIndex);
  const oppLoss = obs(1);
  return {
    round: {
      number: obs(params.roundNumber),
      phase: obs('freezetime'),
      side: obs(params.side),
      score: obs(score),
      context: obs(params.context),
    },
    player: {
      money: obs(params.money),
      lossIndex: ownLoss,
      inventory: obs(params.inventory),
    },
    teamLoss: params.side === 'CT' ? { ct: ownLoss, t: oppLoss } : { ct: oppLoss, t: ownLoss },
    history:
      params.context === 'POST_PISTOL' &&
      params.previousWinner &&
      params.previousWinner !== 'UNKNOWN'
        ? {
            integrity: 'COMPLETE',
            previousRounds: [
              {
                roundNumber: params.roundNumber - 1,
                winner: obs(params.previousWinner),
                planted: { status: 'UNKNOWN', source: 'sweep', asOfSeq: 1 },
              },
            ],
          }
        : { integrity: 'COMPLETE', previousRounds: [] },
    opponent: { status: 'UNKNOWN', inputsAsOfSeq: 1 },
    preference: {
      source: 'DEFAULT',
      awpPriority: params.awpPriority ?? 'NEUTRAL',
    },
  };
}

const EMPTY_INV: InventoryState = {
  primary: null,
  armor: 0,
  hasHelmet: false,
  hasDefuseKit: false,
  grenades: [],
};

const isFire = (item: ItemId) => item === 'molotov' || item === 'incendiary';

describe('Policy V3 rule-correctness & exhaustive state-space sweep', () => {
  it('treats Round 12 (halftime) and Round 24 (regulation end) as economy resets with no save-for-next LIGHT', () => {
    for (const roundNumber of [12, 24]) {
      const out = recommendPolicyV3(
        makeState({
          side: 'CT',
          money: 3000,
          lossIndex: 2,
          inventory: EMPTY_INV,
          context: 'NORMAL',
          roundNumber,
        }),
      );
      expect(out.status).toBe('READY');
      expect(out.futureAffordability).toEqual({
        status: 'NOT_APPLICABLE',
        boundaries: [],
        reason: 'HALF_END_RESET',
      });
      expect(out.options.some((o) => o.mode === 'LIGHT')).toBe(false);
      expect(out.options[0]?.mode).toBe('FORCE');
      expect(out.options[0]?.trajectory).toEqual([]);
    }
  });

  it('treats opponent regulation match point (oppScore >= 12) as non-carryover and contests current round', () => {
    const out = recommendPolicyV3(
      makeState({
        side: 'CT',
        money: 2800,
        lossIndex: 2,
        inventory: EMPTY_INV,
        context: 'NORMAL',
        roundNumber: 20,
        score: { ct: 7, t: 12 },
      }),
    );
    expect(out.futureAffordability).toEqual({
      status: 'NOT_APPLICABLE',
      boundaries: [],
      reason: 'MATCH_POINT_AGAINST',
    });
    expect(out.options.some((o) => o.mode === 'LIGHT')).toBe(false);
    expect(out.options[0]?.mode).toBe('FORCE');
    expect(out.options[0]?.trajectory).toEqual([]);
  });

  it('handles MR3 overtime half-end (r27/r30) and overtime match point (oppScore >= 15) cleanly', () => {
    const otHalfEnd = recommendPolicyV3(
      makeState({
        side: 'CT',
        money: 3200,
        lossIndex: 1,
        inventory: EMPTY_INV,
        context: 'OVERTIME',
        roundNumber: 27,
        score: { ct: 13, t: 13 },
      }),
    );
    expect(otHalfEnd.futureAffordability).toEqual({
      status: 'NOT_APPLICABLE',
      boundaries: [],
      reason: 'HALF_END_RESET',
    });
    expect(otHalfEnd.options.some((o) => o.mode === 'LIGHT')).toBe(false);
    expect(otHalfEnd.options[0]?.trajectory).toEqual([]);

    const otMatchPoint = recommendPolicyV3(
      makeState({
        side: 'T',
        money: 3100,
        lossIndex: 1,
        inventory: EMPTY_INV,
        context: 'OVERTIME',
        roundNumber: 29,
        score: { ct: 15, t: 13 },
      }),
    );
    expect(otMatchPoint.futureAffordability).toEqual({
      status: 'NOT_APPLICABLE',
      boundaries: [],
      reason: 'MATCH_POINT_AGAINST',
    });
    expect(otMatchPoint.options.some((o) => o.mode === 'LIGHT')).toBe(false);
    expect(otMatchPoint.options[0]?.trajectory).toEqual([]);
  });

  it('ranks PRESERVE ahead of LIGHT when PRESERVE secures full basic utility but LIGHT downgrades to bare rifle', () => {
    // CT $1,650 + $2,400 loss bonus (lossIndex=2) = $4,050 -> PRESERVE reaches RIFLE_ARMOR_BASIC_UTILITY;
    // LIGHT can only spend up to $500 under RIFLE_ARMOR ($3,550), downgrading next round.
    const out = recommendPolicyV3(
      makeState({
        side: 'CT',
        money: 1650,
        lossIndex: 2,
        inventory: EMPTY_INV,
        context: 'NORMAL',
        roundNumber: 6,
      }),
    );
    expect(out.options[0]?.mode).toBe('PRESERVE');
    expect(out.options[0]?.adviceStrength).toBe('SUPPORTED');
    const light = out.options.find((o) => o.mode === 'LIGHT');
    if (light) {
      expect(light.adviceStrength).toBe('ALTERNATIVE');
      expect(out.options.indexOf(light)).toBeGreaterThan(0);
    }
  });

  it('handles already-owned cross-side fire grenade (CT holding picked-up molotov) without failing utility planning', () => {
    const ctWithMolotov: InventoryState = {
      primary: 'ak47',
      armor: 100,
      hasHelmet: true,
      hasDefuseKit: false,
      grenades: ['molotov'],
    };
    const plan = planPurchases(
      ctWithMolotov,
      [
        { item: 'molotov', quantity: 1 },
        { item: 'smoke', quantity: 1 },
        { item: 'he', quantity: 1 },
      ],
      DEFAULT_RULES,
      'CT',
    );
    expect(plan.isComplete).toBe(true);
    expect(plan.purchases).toEqual([
      { item: 'smoke', quantity: 1 },
      { item: 'he', quantity: 1 },
    ]);

    const out = recommendPolicyV3(
      makeState({
        side: 'CT',
        money: 4000,
        lossIndex: 1,
        inventory: ctWithMolotov,
        context: 'NORMAL',
        roundNumber: 8,
      }),
    );
    expect(out.status).toBe('READY');
    const lead = out.options[0]!;
    expect(lead.mode).toBe('FULL');
    expect(lead.purchases.every((p) => isItemLegalForSide(p.item, 'CT'))).toBe(true);
    // Must NOT buy incendiary when already carrying a molotov
    expect(lead.resultingInventory.grenades.filter(isFire).length).toBeLessThanOrEqual(1);
    expect(lead.resultingInventory.grenades).toContain('smoke');
  });

  it('passes all 8 hard mechanical and semantic invariants across exhaustive state-space sweep', () => {
    const sides: Side[] = ['CT', 'T'];
    const lossIndices: Array<number | 'UNKNOWN'> = [0, 1, 2, 3, 4, 'UNKNOWN'];
    const awpPrefs: Array<UserPreference['awpPriority']> = ['NEUTRAL', 'PREFER', 'SAVE_FOR_AWP'];
    const inventoriesFor = (side: Side): InventoryState[] => [
      EMPTY_INV,
      {
        primary: side === 'CT' ? 'm4a1s' : 'ak47',
        armor: 100,
        hasHelmet: side === 'T',
        hasDefuseKit: false,
        grenades: ['smoke', 'flash'],
      },
      {
        primary: side === 'CT' ? 'mp9' : 'mac10',
        armor: 55,
        hasHelmet: true,
        hasDefuseKit: false,
        grenades: [],
      },
      {
        primary: null,
        armor: 100,
        hasHelmet: false,
        hasDefuseKit: false,
        grenades: ['flash'],
      },
      {
        primary: side === 'CT' ? 'ak47' : 'm4a1s',
        armor: 100,
        hasHelmet: true,
        hasDefuseKit: false,
        grenades: [side === 'CT' ? 'molotov' : 'incendiary'],
      },
    ];
    const contexts: Array<{
      context: RoundContext;
      roundNumber: number;
      score?: { ct: number; t: number };
      prevWinner?: Side;
    }> = [
      { context: 'NORMAL', roundNumber: 7 },
      { context: 'NORMAL', roundNumber: 12 },
      { context: 'NORMAL', roundNumber: 24 },
      { context: 'NORMAL', roundNumber: 20, score: { ct: 12, t: 7 } },
      { context: 'POST_PISTOL', roundNumber: 2, prevWinner: 'CT' },
      { context: 'POST_PISTOL', roundNumber: 2, prevWinner: 'T' },
      { context: 'OVERTIME', roundNumber: 25 },
    ];

    let checkedStates = 0;

    // 1. Monotonicity of empty-inventory FULL across $0..$16,000 ($50 step)
    for (const side of sides) {
      for (const lossIndex of lossIndices) {
        let sawFull = false;
        for (let money = 0; money <= 16_000; money += 50) {
          const out = recommendPolicyV3(
            makeState({
              side,
              money,
              lossIndex,
              inventory: EMPTY_INV,
              context: 'NORMAL',
              roundNumber: 7,
            }),
          );
          expect(out.status).toBe('READY');
          const hasFull = out.options.some((o) => o.mode === 'FULL');
          if (sawFull) expect(hasFull).toBe(true);
          if (hasFull) sawFull = true;
        }
      }
    }

    // 2. Full invariant sweep across representative cash ladder, inventories, prefs, contexts
    const cashPoints: number[] = [];
    for (let m = 0; m <= 6000; m += 250) cashPoints.push(m);
    cashPoints.push(1650, 3450, 3550, 3700, 3850, 4050, 4200, 4850, 4900, 8000, 10000, 16000);

    for (const side of sides) {
      const inventories = inventoriesFor(side);
      for (const ctx of contexts) {
        for (const lossIndex of [0, 2, 4, 'UNKNOWN'] as const) {
          for (const awpPriority of awpPrefs) {
            for (const inventory of inventories) {
              for (const money of cashPoints) {
                const state = makeState({
                  side,
                  money,
                  lossIndex,
                  inventory,
                  context: ctx.context,
                  roundNumber: ctx.roundNumber,
                  score: ctx.score,
                  awpPriority,
                  previousWinner: ctx.prevWinner,
                });
                const out = recommendPolicyV3(state);
                checkedStates++;
                expect(out.status).toBe('READY');
                expect(out.options.length).toBeGreaterThan(0);

                const seenPurchases = new Set<string>();
                const retainedCls = inventory.primary
                  ? weaponClassOf(inventory.primary)
                  : undefined;

                for (const opt of out.options) {
                  // (1) Budget & non-negative
                  expect(opt.bundleSpend).toBeGreaterThanOrEqual(0);
                  expect(opt.bundleSpend).toBeLessThanOrEqual(money);
                  // (2) Side buy legality
                  for (const p of opt.purchases) {
                    expect(isItemLegalForSide(p.item, side)).toBe(true);
                  }
                  // (3) Grenade caps (<=4 total, <=2 flash, <=1 fire)
                  expect(opt.resultingInventory.grenades.length).toBeLessThanOrEqual(4);
                  expect(
                    opt.resultingInventory.grenades.filter((g) => g === 'flash').length,
                  ).toBeLessThanOrEqual(2);
                  expect(opt.resultingInventory.grenades.filter(isFire).length).toBeLessThanOrEqual(
                    1,
                  );
                  // (4) Never downgrade retained rifle or AWP
                  if (retainedCls === 'rifle' || inventory.primary === 'awp') {
                    expect(opt.resultingInventory.primary).toBe(inventory.primary);
                  }
                  // (5) No duplicate purchase sets
                  const sig = JSON.stringify(
                    opt.purchases.map((p) => `${p.item}:${p.quantity}`).sort(),
                  );
                  expect(seenPurchases.has(sig)).toBe(false);
                  seenPurchases.add(sig);
                  // (6) LIGHT never exceeds protected next-round boundary
                  if (
                    opt.mode === 'LIGHT' &&
                    opt.spendingGuidance.kind === 'BOUNDED' &&
                    lossIndex !== 'UNKNOWN'
                  ) {
                    const reward = lossBonus(DEFAULT_RULES, lossIndex);
                    const floor =
                      opt.spendingGuidance.protectedCapability === 'RIFLE_ARMOR_BASIC_UTILITY'
                        ? side === 'CT'
                          ? 4050
                          : 4200
                        : side === 'CT'
                          ? 3550
                          : 3700;
                    expect(money - opt.bundleSpend + reward).toBeGreaterThanOrEqual(floor);
                  }
                  // (7) Conditional alternatives obey budget, legality, and grenade caps
                  for (const alt of opt.conditionalAlternatives) {
                    expect(alt.bundleSpend).toBeGreaterThanOrEqual(0);
                    expect(alt.bundleSpend).toBeLessThanOrEqual(money);
                    for (const p of alt.purchases) {
                      expect(isItemLegalForSide(p.item, side)).toBe(true);
                    }
                    const altRes = resultingLoadout(inventory, [...alt.purchases]);
                    expect(altRes.grenades.length).toBeLessThanOrEqual(4);
                    expect(altRes.grenades.filter((g) => g === 'flash').length).toBeLessThanOrEqual(
                      2,
                    );
                    expect(altRes.grenades.filter(isFire).length).toBeLessThanOrEqual(1);
                  }
                }

                // (8) Halftime / regulation end / opponent match point never emits LIGHT
                if (out.futureAffordability.status === 'NOT_APPLICABLE') {
                  expect(out.options.some((o) => o.mode === 'LIGHT')).toBe(false);
                }
              }
            }
          }
        }
      }
    }

    expect(checkedStates).toBeGreaterThan(25_000);
  }, 30_000);
});
