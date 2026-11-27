import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CS2_CFG_RELATIVE, CS2_EXECUTABLE_RELATIVE } from './onboarding.js';
import { startHudService } from './server.js';
import { DEFAULT_HUD_SETTINGS } from './model.js';
import { parseHudSettings } from './settings.js';

const SELF = '76561198000000001';
const data = {
  auth: { token: 'test-only' },
  provider: { appid: 730, steamid: SELF },
  map: {
    name: 'de_mirage',
    phase: 'live',
    mode: 'competitive',
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
};
const services: Awaited<ReturnType<typeof startHudService>>[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.close()));
});
async function service() {
  const out = await startHudService({
    token: 'test-only',
    gsiPort: 0,
    webPort: 0,
  });
  services.push(out);
  return out;
}

describe('HUD real HTTP pipeline', () => {
  it('authenticates GSI and streams derived cards, not the raw token or identity', async () => {
    const s = await service();
    const base = `http://127.0.0.1:${s.webPort}`;
    const rejected = await fetch(`http://127.0.0.1:${s.gsiPort}`, {
      method: 'POST',
      body: JSON.stringify({ ...data, auth: { token: 'wrong' } }),
    });
    expect(rejected.status).toBe(401);
    expect(s.snapshot().visible).toBe(false);
    const accepted = await fetch(`http://127.0.0.1:${s.gsiPort}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    expect(accepted.status).toBe(204);
    const response = await fetch(base + '/snapshot');
    const text = await response.text();
    expect(text).not.toContain('test-only');
    expect(text).not.toContain(SELF);
    expect(JSON.parse(text).cards).toHaveLength(3);
    const controller = new AbortController();
    const events = await fetch(base + '/events', { signal: controller.signal });
    const reader = events.body!.getReader();
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toContain('data:');
    controller.abort();
    const live = await fetch(`http://127.0.0.1:${s.gsiPort}`, {
      method: 'POST',
      body: JSON.stringify({ ...data, round: { phase: 'live' } }),
    });
    expect(live.status).toBe(204);
    expect(s.snapshot()).toMatchObject({ visible: false, cards: [] });
  });
  it('allows same-origin settings and rejects external origins and malformed values', async () => {
    const s = await service();
    const base = `http://127.0.0.1:${s.webPort}`;
    const send = (origin: string, body: unknown) =>
      fetch(base + '/settings', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await send('https://example.com', DEFAULT_HUD_SETTINGS)).status).toBe(403);
    expect((await send(base, { ...DEFAULT_HUD_SETTINGS, scale: 100 })).status).toBe(400);
    expect((await send(base, { ...DEFAULT_HUD_SETTINGS, scale: 1.25 })).status).toBe(200);
    expect(s.snapshot().settings.scale).toBe(1.25);
  });
  it('rejects DNS-rebinding hostnames and unbounded settings input', async () => {
    const s = await service();
    const code = await new Promise<number>((resolve) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: s.webPort,
          path: '/snapshot',
          headers: { Host: 'evil.example' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.end();
    });
    expect(code).toBe(403);
    const base = `http://127.0.0.1:${s.webPort}`;
    const huge = await fetch(base + '/settings', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: ' '.repeat(4096),
    });
    expect(huge.status).toBe(413);
  });
  it('rejects missing/extra/nonfinite settings rather than coercing them', () => {
    expect(parseHudSettings(DEFAULT_HUD_SETTINGS)).toEqual(DEFAULT_HUD_SETTINGS);
    for (const x of [
      {},
      { ...DEFAULT_HUD_SETTINGS, scale: Infinity },
      { ...DEFAULT_HUD_SETTINGS, scale: '1' },
      { ...DEFAULT_HUD_SETTINGS, mode: 'FORCE' },
      { ...DEFAULT_HUD_SETTINGS, position: 'center' },
    ])
      expect(parseHudSettings(x)).toBeNull();
  });
  it('exposes GSI status, install, and restore APIs without leaking the token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'roundsense-hud-gsi-'));
    try {
      const cs2Root = join(root, 'CS2');
      await mkdir(join(cs2Root, CS2_CFG_RELATIVE), { recursive: true });
      await mkdir(join(cs2Root, 'game', 'bin', 'win64'), { recursive: true });
      await writeFile(join(cs2Root, CS2_EXECUTABLE_RELATIVE), 'stub', 'utf8');

      const s = await startHudService({
        token: 'secret-gsi-token',
        gsiPort: 0,
        webPort: 0,
        onboarding: {
          backupDir: join(root, 'backups'),
          preferredInstallPath: cs2Root,
          discoverOptions: { env: {}, registry: async () => undefined },
        },
      });
      services.push(s);
      const base = `http://127.0.0.1:${s.webPort}`;

      const statusRes = await fetch(base + '/gsi/status');
      expect(statusRes.status).toBe(200);
      const statusText = await statusRes.text();
      expect(statusText).not.toContain('secret-gsi-token');
      const status = JSON.parse(statusText) as {
        discoveryStatus: string;
        cfgStatus: string;
        canInstall: boolean;
        canRestore: boolean;
      };
      expect(status.discoveryStatus).toBe('FOUND');
      expect(status.cfgStatus).toBe('NEEDS_INSTALL');
      expect(status.canInstall).toBe(true);
      expect(status.canRestore).toBe(false);

      // Cross-origin POST must be rejected
      const badOrigin = await fetch(base + '/gsi/install', {
        method: 'POST',
        headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(badOrigin.status).toBe(403);

      // Install
      const installRes = await fetch(base + '/gsi/install', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(installRes.status).toBe(200);
      const installedText = await installRes.text();
      expect(installedText).not.toContain('secret-gsi-token');
      const installed = JSON.parse(installedText) as {
        changed: boolean;
        status: { cfgStatus: string; canInstall: boolean; canRestore: boolean };
      };
      expect(installed.changed).toBe(true);
      expect(installed.status.cfgStatus).toBe('READY');
      expect(installed.status.canInstall).toBe(false);
      expect(installed.status.canRestore).toBe(true);

      // Restore
      const restoreRes = await fetch(base + '/gsi/restore', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(restoreRes.status).toBe(200);
      const restored = (await restoreRes.json()) as {
        restore: { status: string; mode: string };
        status: { cfgStatus: string; canRestore: boolean };
      };
      expect(restored.restore.status).toBe('RESTORED');
      expect(restored.restore.mode).toBe('REMOVED');
      expect(restored.status.cfgStatus).toBe('NEEDS_INSTALL');
      expect(restored.status.canRestore).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
