import type { GsiPayload } from '@roundsense/gsi-protocol';
import { DEFAULT_HUD_SETTINGS, HudRuntime, type HudSettings, type HudSnapshot } from './model.js';

export type PreviewScenarioId = 'ct-mid' | 'retained-rifle' | 't-rich' | 'ct-save-awp' | 'pistol';

const PREVIEW_SCENARIO_IDS = new Set<string>([
  'ct-mid',
  'retained-rifle',
  't-rich',
  'ct-save-awp',
  'pistol',
]);

export function isPreviewScenarioId(value: string): value is PreviewScenarioId {
  return PREVIEW_SCENARIO_IDS.has(value);
}

function previewPayloadFor(id: PreviewScenarioId): GsiPayload {
  const self = '76561198000000001';
  const base: GsiPayload = {
    provider: { appid: 730, steamid: self },
    map: {
      name: 'de_dust2',
      mode: 'competitive',
      phase: 'live',
      round: 8,
      team_ct: { score: 4, consecutive_round_losses: 1 },
      team_t: { score: 3, consecutive_round_losses: 1 },
    },
    round: { phase: 'freezetime' },
    player: {
      steamid: self,
      activity: 'playing',
      team: 'CT',
      state: { money: 3450, armor: 0, helmet: false, defusekit: false },
      weapons: {},
    },
  };

  if (id === 'retained-rifle') {
    base.map!.round = 10;
    base.map!.team_ct = { score: 5, consecutive_round_losses: 0 };
    base.player!.state = { money: 4200, armor: 100, helmet: false, defusekit: false };
    base.player!.weapons = {
      weapon_0: { name: 'weapon_m4a1_silencer', type: 'Rifle' },
      weapon_1: { name: 'weapon_usp_silencer', type: 'Pistol' },
    };
  } else if (id === 't-rich') {
    base.map!.round = 11;
    base.map!.team_t = { score: 5, consecutive_round_losses: 2 };
    base.player!.team = 'T';
    base.player!.state = { money: 8000, armor: 0, helmet: false, defusekit: false };
  } else if (id === 'ct-save-awp') {
    base.map!.round = 9;
    base.map!.team_ct = { score: 3, consecutive_round_losses: 2 };
    base.player!.state = { money: 3900, armor: 0, helmet: false, defusekit: false };
  } else if (id === 'pistol') {
    base.map!.round = 1;
    base.map!.team_ct = { score: 0, consecutive_round_losses: 0 };
    base.map!.team_t = { score: 0, consecutive_round_losses: 0 };
    base.player!.state = { money: 800, armor: 0, helmet: false, defusekit: false };
  }

  return base;
}

/**
 * Computes an offline preview snapshot through an isolated HudRuntime + Policy V3
 * instance so Settings previews never drift from live engine semantics.
 */
export function buildPreviewSnapshot(
  id: PreviewScenarioId,
  settings: HudSettings = DEFAULT_HUD_SETTINGS,
): HudSnapshot {
  const runtime = new HudRuntime(60_000);
  runtime.updateSettings(settings);
  const nowNs = 1_000_000_000n;
  runtime.observe({
    seq: 1,
    receivedAtMonotonicNs: nowNs,
    receivedAtWallClock: '2026-01-01T00:00:00.000Z',
    payload: previewPayloadFor(id),
  });
  return runtime.snapshot(nowNs + 1_000_000n);
}
