import { describe, expect, it } from 'vitest';
import type { GsiPayload, GsiReceipt } from '@roundsense/gsi-protocol';
import { DEFAULT_HUD_SETTINGS, HudRuntime } from './model.js';

const SELF = '76561198000000001';
function payload(over: Partial<GsiPayload> = {}): GsiPayload {
  return {
    provider: { appid: 730, steamid: SELF },
    map: {
      name: 'de_mirage',
      mode: 'competitive',
      phase: 'live',
      round: 8,
      team_ct: { score: 4, consecutive_round_losses: 1 },
      team_t: { score: 3, consecutive_round_losses: 1 },
    },
    round: { phase: 'freezetime' },
    player: {
      steamid: SELF,
      activity: 'playing',
      team: 'CT',
      state: { money: 3450, armor: 0, helmet: false, defusekit: false },
      weapons: {},
    },
    ...over,
  };
}
function receipt(data: GsiPayload = payload(), seq = 0, timeMs = 0): GsiReceipt {
  return {
    payload: data,
    seq,
    receivedAtWallClock: '2026-10-07T00:00:00.000Z',
    receivedAtMonotonicNs: BigInt(timeMs) * 1_000_000n,
  };
}
function lifecycle(runtime: HudRuntime, skip = false) {
  const pistol = payload();
  pistol.map!.round = 1;
  runtime.observe(receipt(pistol, 0));
  runtime.observe(receipt({ ...pistol, round: { phase: 'live' } }, 1, 100));
  runtime.observe(
    receipt(
      {
        ...pistol,
        map: { ...pistol.map, round: 2 },
        player: undefined,
        round: { phase: 'over', win_team: 'CT' },
      },
      skip ? 3 : 2,
      200,
    ),
  );
  const after = payload();
  after.map!.round = 2;
  runtime.observe(receipt(after, skip ? 4 : 3, 300));
}

describe('live HUD semantics', () => {
  it('exposes structured options with id, money, purchases, spending bounds, and future capability', () => {
    const runtime = new HudRuntime();
    runtime.observe(receipt());
    const out = runtime.snapshot(0n);
    expect(out.version).toBe(2);
    expect(out.visible).toBe(true);
    expect(out.money).toBe(3450);
    expect(out.lossIndex).toBe(1);
    expect(out.roundContext).toBe('NORMAL');
    expect(out.policyStatus).toBe('READY');
    expect(out.defaultOptionId).toBeNull();
    expect(out.options.map((o) => o.mode)).toEqual(['FORCE', 'LIGHT', 'PRESERVE']);

    const light = out.options.find((o) => o.mode === 'LIGHT')!;
    expect(light.id).toBeTruthy();
    expect(light).toMatchObject({
      mode: 'LIGHT',
      isDefault: false,
      maxSpendNow: 1300,
      spend: 1150,
      lossNextMoney: 4200,
      futureCapability: 'RIFLE_ARMOR_BASIC_UTILITY',
    });
    expect(light.purchases.length).toBeGreaterThan(0);
    expect(light.purchases[0]).toMatchObject({
      item: expect.any(String),
      quantity: expect.any(Number),
      helmetUpgradeOnly: false,
    });

    const preserve = out.options.find((o) => o.mode === 'PRESERVE')!;
    expect(preserve).toMatchObject({
      spend: 0,
      lossNextMoney: 5350,
      purchases: [],
    });
  });

  it('marks helmetUpgradeOnly when already holding 100 kevlar without helmet', () => {
    const runtime = new HudRuntime();
    runtime.observe(
      receipt(
        payload({
          player: {
            ...payload().player,
            team: 'T',
            state: { money: 4500, armor: 100, helmet: false, defusekit: false },
            weapons: {},
          },
        }),
      ),
    );
    const out = runtime.snapshot(0n);
    const full = out.options.find((o) => o.mode === 'FULL')!;
    const helmetPurchase = full.purchases.find((p) => p.item === 'kevlar_helmet');
    expect(helmetPurchase).toMatchObject({
      item: 'kevlar_helmet',
      quantity: 1,
      helmetUpgradeOnly: true,
    });
  });

  it('preserves conditionalAlternatives in structured form', () => {
    const runtime = new HudRuntime();
    runtime.observe(
      receipt(
        payload({
          player: {
            ...payload().player,
            team: 'CT',
            state: { money: 5200, armor: 0, helmet: false, defusekit: false },
            weapons: {},
          },
        }),
      ),
    );
    const out = runtime.snapshot(0n);
    const full = out.options.find((o) => o.mode === 'FULL')!;
    expect(Array.isArray(full.conditionalAlternatives)).toBe(true);
    expect(full.conditionalAlternatives.length).toBeGreaterThan(0);
    for (const alt of full.conditionalAlternatives) {
      expect(typeof alt.condition).toBe('string');
      expect(typeof alt.reason).toBe('string');
      expect(typeof alt.spendDelta).toBe('number');
      expect(Number.isFinite(alt.spendDelta)).toBe(true);
      expect(Array.isArray(alt.purchases)).toBe(true);
    }
  });

  it.each(['live', 'over', undefined])('hides outside explicit freezetime: %s', (phase) => {
    const runtime = new HudRuntime();
    runtime.observe(receipt(payload({ round: { phase } })));
    expect(runtime.snapshot(0n)).toMatchObject({
      visible: false,
      options: [],
      money: null,
      hiddenReason: 'outside-freezetime',
    });
  });

  it('expires without a new packet and never returns stale options', () => {
    const runtime = new HudRuntime();
    runtime.observe(receipt());
    expect(runtime.snapshot(5_001_000_000n)).toMatchObject({
      visible: false,
      options: [],
      money: null,
      hiddenReason: 'stale',
    });
  });

  it('hides warmup, foreign player, menu and noncompetitive source', () => {
    const examples = [
      payload({ map: { ...payload().map, phase: 'warmup' } }),
      payload({
        player: { ...payload().player, steamid: '76561198000000002' },
      }),
      payload({ player: undefined }),
      payload({ map: { ...payload().map, mode: 'deathmatch' } }),
    ];
    for (const data of examples) {
      const runtime = new HudRuntime();
      runtime.observe(receipt(data));
      expect(runtime.snapshot(0n).visible).toBe(false);
    }
  });

  it("does not reuse last round's inventory from a partial current frame", () => {
    const runtime = new HudRuntime();
    runtime.observe(receipt());
    runtime.observe(
      receipt(payload({ player: { ...payload().player, weapons: undefined } }), 1, 50),
    );
    expect(runtime.snapshot(50_000_000n)).toMatchObject({
      visible: true,
      policyStatus: 'INSUFFICIENT_STATE',
      options: [],
    });
  });

  it('reports missing loss state and pistol unsupported without made-up options', () => {
    const missingLoss = new HudRuntime();
    missingLoss.observe(receipt(payload({ map: { ...payload().map, team_ct: { score: 4 } } })));
    expect(missingLoss.snapshot(0n)).toMatchObject({
      visible: true,
      policyStatus: 'INSUFFICIENT_STATE',
      options: [],
    });

    const pistol = new HudRuntime();
    pistol.observe(receipt(payload({ map: { ...payload().map, round: 1 } })));
    expect(pistol.snapshot(0n)).toMatchObject({
      visible: true,
      roundContext: 'PISTOL',
      policyStatus: 'UNSUPPORTED_POLICY_EVIDENCE',
      options: [],
    });
  });

  it('preserves post-pistol winner through a terminal frame without player fields', () => {
    const runtime = new HudRuntime();
    lifecycle(runtime);
    expect(runtime.snapshot(300_000_000n).options.some((o) => o.mode === 'FULL')).toBe(true);
  });

  it('retains complete history when changing presentation settings', () => {
    const runtime = new HudRuntime();
    lifecycle(runtime);
    const before = runtime.snapshot(300_000_000n).options;
    runtime.updateSettings({ ...DEFAULT_HUD_SETTINGS, scale: 1.2 });
    expect(runtime.snapshot(300_000_000n).options).toEqual(before);
  });

  it('does not recover an unseen pistol winner across a sequence gap', () => {
    const runtime = new HudRuntime();
    lifecycle(runtime, true);
    expect(runtime.snapshot(300_000_000n).options.map((o) => o.mode)).toEqual([
      'PRESERVE',
      'FORCE',
    ]);
  });

  it.each([6_000, 250])(
    'discards known winner history after a time gap or clock rollback: %sms',
    (timeMs) => {
      const runtime = new HudRuntime();
      lifecycle(runtime);
      expect(runtime.snapshot(300_000_000n).options.some((o) => o.mode === 'FULL')).toBe(true);
      const next = payload();
      next.map!.round = 2;
      runtime.observe(receipt(next, 4, timeMs));
      expect(runtime.snapshot(BigInt(timeMs) * 1_000_000n).options.map((o) => o.mode)).toEqual([
        'PRESERVE',
        'FORCE',
      ]);
    },
  );

  it('supports explicitly declared AWP preference without suppressing other options', () => {
    const runtime = new HudRuntime();
    runtime.updateSettings({ ...DEFAULT_HUD_SETTINGS, awpPriority: 'PREFER' });
    runtime.observe(
      receipt(
        payload({
          player: {
            ...payload().player,
            state: { ...payload().player!.state, money: 7000 },
          },
        }),
      ),
    );
    const snap = runtime.snapshot(0n);
    expect(snap.options[0]).toMatchObject({ mode: 'AWP_PATH', isDefault: true });
    expect(snap.defaultOptionId).toBe(snap.options[0]!.id);
    expect(snap.options.length).toBeGreaterThan(1);
  });

  it('computes awpNextReady from AWP + kevlar threshold only when AWP priority is active', () => {
    // lossIndex=1 => next loss bonus $1900; money=3500 => PRESERVE lossNextMoney = $5400 (exact AWP + kevlar)
    const atThreshold = payload({
      player: {
        ...payload().player,
        team: 'CT',
        state: { money: 3500, armor: 0, helmet: false, defusekit: false },
        weapons: {},
      },
    });
    const belowThreshold = payload({
      player: {
        ...payload().player,
        team: 'CT',
        state: { money: 3450, armor: 0, helmet: false, defusekit: false },
        weapons: {},
      },
    });

    const neutral = new HudRuntime();
    neutral.observe(receipt(atThreshold));
    expect(neutral.snapshot(0n).options.find((o) => o.mode === 'PRESERVE')?.awpNextReady).toBe(
      false,
    );

    const prefer = new HudRuntime();
    prefer.updateSettings({ ...DEFAULT_HUD_SETTINGS, awpPriority: 'PREFER' });
    prefer.observe(receipt(atThreshold));
    expect(prefer.snapshot(0n).options.find((o) => o.mode === 'PRESERVE')?.awpNextReady).toBe(true);

    prefer.observe(receipt(belowThreshold, 1, 100));
    expect(
      prefer.snapshot(100_000_000n).options.find((o) => o.mode === 'PRESERVE')?.awpNextReady,
    ).toBe(false);
  });
});
