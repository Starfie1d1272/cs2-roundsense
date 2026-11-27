import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gsiCfgFileName } from '@roundsense/gsi-protocol';
import {
  canRestoreGsiConfig,
  CS2_CFG_RELATIVE,
  CS2_EXECUTABLE_RELATIVE,
  discoverCs2,
  inspectGsiConfig,
  installGsiConfig,
  renderHudGsiCfg,
  restoreGsiConfig,
} from './onboarding.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'roundsense-onboarding-'));
  tempDirs.push(dir);
  return dir;
}

async function createFakeCs2Install(
  root: string,
): Promise<{ installPath: string; cfgDirectory: string }> {
  const cfgDirectory = join(root, CS2_CFG_RELATIVE);
  const exePath = join(root, CS2_EXECUTABLE_RELATIVE);
  await mkdir(cfgDirectory, { recursive: true });
  await mkdir(join(root, 'game', 'bin', 'win64'), { recursive: true });
  await writeFile(exePath, 'stub', 'utf8');
  return { installPath: root, cfgDirectory };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('CS2 Steam discovery', () => {
  it('discovers CS2 from Steam libraryfolders.vdf and appmanifest_730.acf', async () => {
    const root = await makeTempDir();
    const steamMain = join(root, 'Steam');
    const steamLib = join(root, 'SteamLibrary');
    const cs2Root = join(steamLib, 'steamapps', 'common', 'Counter-Strike Global Offensive');
    await mkdir(join(steamMain, 'steamapps'), { recursive: true });
    await mkdir(join(steamLib, 'steamapps'), { recursive: true });
    await createFakeCs2Install(cs2Root);

    await writeFile(
      join(steamMain, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders" { "0" { "path" "${steamMain.replace(/\\/g, '\\\\')}" } "1" { "path" "${steamLib.replace(/\\/g, '\\\\')}" } }`,
      'utf8',
    );
    await writeFile(
      join(steamLib, 'steamapps', 'appmanifest_730.acf'),
      `"AppState" { "appid" "730" "installdir" "Counter-Strike Global Offensive" }`,
      'utf8',
    );

    const found = await discoverCs2({
      extraSteamRoots: [steamMain],
      env: {},
      registry: async () => undefined,
    });
    expect(found.status).toBe('FOUND');
    if (found.status === 'FOUND') {
      expect(found.install.source).toBe('STEAM_MANIFEST');
      expect(found.install.installPath).toBe(cs2Root);
      expect(found.install.cfgDirectory).toBe(join(cs2Root, CS2_CFG_RELATIVE));
    }
  });

  it('prefers explicit user-selected install path over registry/Steam', async () => {
    const root = await makeTempDir();
    const preferred = join(root, 'CustomCS2');
    await createFakeCs2Install(preferred);

    const found = await discoverCs2({
      preferredInstallPath: preferred,
      env: {},
      registry: async () => undefined,
    });
    expect(found.status).toBe('FOUND');
    if (found.status === 'FOUND') {
      expect(found.install.source).toBe('PREFERRED');
      expect(found.install.installPath).toBe(preferred);
    }
  });

  it('returns NOT_FOUND when cs2.exe or cfg directory is missing', async () => {
    const root = await makeTempDir();
    const incomplete = join(root, 'IncompleteCS2');
    await mkdir(join(incomplete, CS2_CFG_RELATIVE), { recursive: true });

    const found = await discoverCs2({
      preferredInstallPath: incomplete,
      env: {},
      registry: async () => undefined,
    });
    expect(found.status).toBe('NOT_FOUND');
  });
});

describe('GSI config inspection, install, backup, and restore', () => {
  it('installs freshly, stays idempotent, lists other GSI files, and removes cleanly on restore', async () => {
    const root = await makeTempDir();
    const { cfgDirectory } = await createFakeCs2Install(join(root, 'CS2'));
    const backupDir = join(root, 'backups');
    await writeFile(join(cfgDirectory, 'gamestate_integration_mizar.cfg'), '"Mizar" {}', 'utf8');

    const before = await inspectGsiConfig({ cfgDirectory, token: 'tok-1', port: 3001, backupDir });
    expect(before.status).toBe('NEEDS_INSTALL');
    expect(before.otherGsiFiles).toEqual(['gamestate_integration_mizar.cfg']);

    const first = await installGsiConfig({ cfgDirectory, token: 'tok-1', port: 3001, backupDir });
    expect(first.changed).toBe(true);
    expect(first.backupPath).toBeUndefined();

    const written = await readFile(join(cfgDirectory, gsiCfgFileName()), 'utf8');
    expect(written).toBe(renderHudGsiCfg({ token: 'tok-1', port: 3001 }));
    expect(written.startsWith('\uFEFF')).toBe(false);

    const second = await installGsiConfig({ cfgDirectory, token: 'tok-1', port: 3001, backupDir });
    expect(second.changed).toBe(false);

    expect(await canRestoreGsiConfig({ cfgDirectory, backupDir })).toBe(true);
    const restored = await restoreGsiConfig({ cfgDirectory, backupDir });
    expect(restored).toEqual({
      status: 'RESTORED',
      path: join(cfgDirectory, gsiCfgFileName()),
      mode: 'REMOVED',
    });

    const after = await inspectGsiConfig({ cfgDirectory, token: 'tok-1', port: 3001, backupDir });
    expect(after.status).toBe('NEEDS_INSTALL');
    expect(after.otherGsiFiles).toEqual(['gamestate_integration_mizar.cfg']);
  });

  it('backs up existing file once without creating duplicate backups on reinstall, and restores original', async () => {
    const root = await makeTempDir();
    const { cfgDirectory } = await createFakeCs2Install(join(root, 'CS2'));
    const backupDir = join(root, 'backups');
    const cfgPath = join(cfgDirectory, gsiCfgFileName());
    await writeFile(cfgPath, '"Legacy" { "uri" "http://127.0.0.1:9999" }\n', 'utf8');

    const first = await installGsiConfig({ cfgDirectory, token: 'tok-1', port: 3001, backupDir });
    expect(first.changed).toBe(true);
    expect(first.backupPath).toBeDefined();

    // Reinstall with a rotated token: must NOT create a second backup file
    const second = await installGsiConfig({ cfgDirectory, token: 'tok-2', port: 3001, backupDir });
    expect(second.changed).toBe(true);
    expect(second.backupPath).toBe(first.backupPath);

    const backupEntries = (await readdir(backupDir)).filter((f) => f.includes('.original-'));
    expect(backupEntries).toHaveLength(1);

    const restored = await restoreGsiConfig({ cfgDirectory, backupDir });
    expect(restored).toEqual({ status: 'RESTORED', path: cfgPath, mode: 'FROM_BACKUP' });
    expect(await readFile(cfgPath, 'utf8')).toBe('"Legacy" { "uri" "http://127.0.0.1:9999" }\n');
  });

  it('refuses to restore if the user manually modified the cfg after installation', async () => {
    const root = await makeTempDir();
    const { cfgDirectory } = await createFakeCs2Install(join(root, 'CS2'));
    const backupDir = join(root, 'backups');
    const cfgPath = join(cfgDirectory, gsiCfgFileName());

    await installGsiConfig({ cfgDirectory, token: 'tok-1', port: 3001, backupDir });
    await writeFile(cfgPath, '"UserEdited" {}\n', 'utf8');

    const restored = await restoreGsiConfig({ cfgDirectory, backupDir });
    expect(restored).toEqual({
      status: 'REFUSED',
      path: cfgPath,
      reason: 'EXTERNALLY_MODIFIED',
    });
    expect(await readFile(cfgPath, 'utf8')).toBe('"UserEdited" {}\n');
  });
});
