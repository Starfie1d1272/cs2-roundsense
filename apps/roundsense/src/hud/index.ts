#!/usr/bin/env tsx
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateToken } from '@roundsense/gsi-protocol';
import { startHudService } from './server.js';
import { parseHudSettings } from './settings.js';
import { DEFAULT_HUD_SETTINGS } from './model.js';
import { renderHudGsiCfg } from './onboarding.js';

const args = process.argv.slice(2);
const flags = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cfg' || args[i] === '--help') {
    flags.set(args[i]!, 'true');
    continue;
  }
  if (
    !['--token', '--gsi-port', '--web-port', '--cfg-out'].includes(args[i]!) ||
    !args[i + 1] ||
    args[i + 1]!.startsWith('--')
  )
    throw new Error('Unknown or incomplete HUD argument');
  flags.set(args[i]!, args[++i]!);
}
if (flags.has('--help')) {
  console.log(
    'RoundSense HUD: [--token TOKEN] [--gsi-port 3001] [--web-port 3100] [--cfg] [--cfg-out PATH]\nToken and presentation settings persist in the per-user RoundSense directory. --cfg prints ONLY the game configuration; --cfg-out writes it as UTF-8 without BOM.',
  );
} else {
  const port = (key: string, fallback: number) => {
    const value = Number(flags.get(key) ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${key}`);
    return value;
  };
  const gsiPort = port('--gsi-port', 3001),
    webPort = port('--web-port', 3100);
  if (gsiPort === webPort) throw new Error('GSI and web ports must differ');
  const dir =
    process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? homedir(), 'RoundSense')
      : join(homedir(), '.config', 'RoundSense');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tokenPath = join(dir, 'gsi-token');
  let token = flags.get('--token');
  if (!token) {
    try {
      token = (await readFile(tokenPath, 'utf8')).trim();
    } catch {
      token = generateToken();
    }
  }
  if (!token || /["\r\n\\]/.test(token))
    throw new Error('Token must be non-empty and safe for the GSI config format');
  await writeFile(tokenPath, token, { mode: 0o600 });
  const cfg = renderHudGsiCfg({ token, port: gsiPort });
  if (flags.has('--cfg-out')) await writeFile(flags.get('--cfg-out')!, cfg, { mode: 0o600 });
  if (flags.has('--cfg')) process.stdout.write(cfg);
  else {
    let settings = { ...DEFAULT_HUD_SETTINGS };
    const settingsPath = join(dir, 'hud-settings.json');
    try {
      settings = parseHudSettings(JSON.parse(await readFile(settingsPath, 'utf8'))) ?? settings;
    } catch {
      /* first run */
    }
    const installPathFile = join(dir, 'cs2-install-path');
    let preferredInstallPath: string | undefined;
    try {
      preferredInstallPath = (await readFile(installPathFile, 'utf8')).trim() || undefined;
    } catch {
      /* auto-discover */
    }
    const service = await startHudService({
      token,
      gsiPort,
      webPort,
      settings,
      saveSettings: async (value) => {
        const temp = `${settingsPath}.tmp`;
        await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
        await rename(temp, settingsPath);
      },
      onboarding: {
        backupDir: join(dir, 'gsi-backups'),
        preferredInstallPath,
        savePreferredInstallPath: async (installPath) => {
          const temp = `${installPathFile}.tmp`;
          await writeFile(temp, installPath, { mode: 0o600 });
          await rename(temp, installPathFile);
        },
      },
    });
    console.log(`RoundSense HUD settings: http://127.0.0.1:${service.webPort}/`);
    console.log(`GSI listening: http://127.0.0.1:${service.gsiPort}/ (token authentication)`);
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void service.close().then(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}
