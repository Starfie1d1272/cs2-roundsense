import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, dirname, join, normalize, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gsiCfgFileName, renderGsiCfg } from '@roundsense/gsi-protocol';

const execFileAsync = promisify(execFile);

export const CS2_APP_ID = '730';
export const CS2_EXECUTABLE_RELATIVE = join('game', 'bin', 'win64', 'cs2.exe');
export const CS2_CFG_RELATIVE = join('game', 'csgo', 'cfg');
const INSTALL_DIRECTORY_FALLBACKS = [
  'Counter-Strike Global Offensive',
  'Counter-Strike 2',
] as const;
const BACKUP_MANIFEST_PREFIX = 'gsi-backup-manifest';

export type RegistryReader = (key: string, valueName: string) => Promise<string | undefined>;

export interface Cs2Install {
  installPath: string;
  cfgDirectory: string;
  executablePath: string;
  source: 'PREFERRED' | 'APP_REGISTRY' | 'STEAM_MANIFEST' | 'STEAM_FALLBACK';
}

export type Cs2Discovery =
  | {
      status: 'FOUND';
      install: Cs2Install;
      checked: readonly string[];
      warnings: readonly string[];
    }
  | {
      status: 'NOT_FOUND';
      checked: readonly string[];
      warnings: readonly string[];
    };

export interface DiscoverCs2Options {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  preferredInstallPath?: string;
  /** When true, an invalid preferredInstallPath returns NOT_FOUND instead of falling back to auto-discovery. */
  strictPreferredPath?: boolean;
  extraSteamRoots?: readonly string[];
  registry?: RegistryReader;
}

export type GsiConfigInspection =
  | {
      status: 'READY';
      path: string;
      expectedSha256: string;
      otherGsiFiles: readonly string[];
      conflictingGsiFiles: readonly string[];
    }
  | {
      status: 'NEEDS_INSTALL';
      path: string;
      reason: 'MISSING' | 'CONTENT_MISMATCH';
      expectedSha256: string;
      actualSha256?: string;
      otherGsiFiles: readonly string[];
      conflictingGsiFiles: readonly string[];
    }
  | {
      status: 'NOT_FOUND';
      path: string;
      reason: 'CFG_DIRECTORY_MISSING';
      otherGsiFiles: readonly string[];
      conflictingGsiFiles: readonly string[];
    }
  | {
      status: 'ERROR';
      path: string;
      reason: string;
      otherGsiFiles: readonly string[];
      conflictingGsiFiles: readonly string[];
    };

export interface GsiInstallResult {
  status: 'READY';
  path: string;
  changed: boolean;
  backupPath?: string;
  sha256: string;
}

export type GsiRestoreResult =
  | { status: 'RESTORED'; path: string; mode: 'FROM_BACKUP' | 'REMOVED' }
  | { status: 'NO_ACTION'; path: string; reason: 'NO_MANIFEST' | 'ALREADY_MISSING' }
  | { status: 'REFUSED'; path: string; reason: 'EXTERNALLY_MODIFIED' | 'BACKUP_MISSING' };

export interface GsiConfigOptions {
  cfgDirectory: string;
  token: string;
  port?: number;
  backupDir?: string;
}

interface BackupManifest {
  cfgPath: string;
  installedSha256: string;
  hadPreviousFile: boolean;
  backupFileName?: string;
  createdAt: string;
}

export function renderHudGsiCfg(options: { token: string; port?: number }): string {
  return renderGsiCfg({
    uri: `http://127.0.0.1:${options.port ?? 3001}/`,
    token: options.token,
    buffer: 0.1,
    throttle: 0.2,
    heartbeat: 1,
  });
}

function uniquePaths(paths: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of paths) {
    if (!candidate) continue;
    const path = normalize(resolve(candidate));
    const key = process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function unescapeVdfPath(value: string): string {
  return value.replace(/\\\\/g, '\\').replace(/\\\//g, '/');
}

/** Extracts only VDF string values needed for Steam discovery. */
export function vdfValues(input: string, key: string): string[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`"${escaped}"\\s+"([^"]+)"`, 'gi');
  return [...input.matchAll(pattern)].map((match) => unescapeVdfPath(match[1]!));
}

export async function readWindowsRegistry(
  key: string,
  valueName: string,
): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  try {
    const { stdout } = await execFileAsync('reg', ['query', key, '/v', valueName], {
      windowsHide: true,
      encoding: 'utf8',
    });
    const line = stdout
      .split(/\r?\n/)
      .find((candidate) => candidate.includes(valueName) && candidate.includes('REG_'));
    return line?.replace(/^.*?REG_\w+\s+/, '').trim() || undefined;
  } catch {
    return undefined;
  }
}

async function validateInstall(
  installPath: string,
  source: Cs2Install['source'],
): Promise<Cs2Install | null> {
  const cfgDirectory = join(installPath, CS2_CFG_RELATIVE);
  const executablePath = join(installPath, CS2_EXECUTABLE_RELATIVE);
  if (!(await isDirectory(cfgDirectory)) || !(await isFile(executablePath))) return null;
  return { installPath, cfgDirectory, executablePath, source };
}

async function readTextIfPresent(path: string, warnings: string[]): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (!isMissing(error)) warnings.push(`${basename(path)}: ${(error as Error).message}`);
    return undefined;
  }
}

/**
 * Finds CS2 from verified Windows install evidence. Directory names are only
 * fallbacks; every result must contain both the cfg directory and cs2.exe.
 */
export async function discoverCs2(options: DiscoverCs2Options = {}): Promise<Cs2Discovery> {
  const env = options.env ?? process.env;
  const registry = options.registry ?? readWindowsRegistry;
  const checked: string[] = [];
  const warnings: string[] = [];

  if (options.preferredInstallPath) {
    const startPath = normalize(resolve(options.preferredInstallPath));
    // Walk up from cs2.exe, game/, csgo/, or cfg/ to locate the CS2 install root.
    let cursor = startPath;
    for (let depth = 0; depth < 5; depth++) {
      checked.push(cursor);
      const found = await validateInstall(cursor, 'PREFERRED');
      if (found) return { status: 'FOUND', install: found, checked, warnings };
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    if (options.strictPreferredPath) {
      return { status: 'NOT_FOUND', checked: uniquePaths(checked), warnings };
    }
  }

  const appRegistryKeys = [
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App ${CS2_APP_ID}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App ${CS2_APP_ID}`,
  ];
  for (const key of appRegistryKeys) {
    const candidate = await registry(key, 'InstallLocation');
    if (!candidate) continue;
    const path = normalize(resolve(candidate));
    checked.push(path);
    const found = await validateInstall(path, 'APP_REGISTRY');
    if (found) return { status: 'FOUND', install: found, checked, warnings };
  }

  const steamRegistryRoots = await Promise.all([
    registry('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    registry('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
  ]);
  const steamRoots = uniquePaths([
    ...(options.extraSteamRoots ?? []),
    ...steamRegistryRoots,
    env['PROGRAMFILES(X86)'] ? join(env['PROGRAMFILES(X86)'], 'Steam') : undefined,
    env.ProgramFiles ? join(env.ProgramFiles, 'Steam') : undefined,
  ]);

  for (const steamRoot of steamRoots) {
    const libraryVdf = await readTextIfPresent(
      join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
      warnings,
    );
    const libraries = uniquePaths([
      steamRoot,
      ...(libraryVdf ? vdfValues(libraryVdf, 'path') : []),
    ]);
    for (const library of libraries) {
      const common = join(library, 'steamapps', 'common');
      const manifest = await readTextIfPresent(
        join(library, 'steamapps', `appmanifest_${CS2_APP_ID}.acf`),
        warnings,
      );
      const installDirs = manifest ? vdfValues(manifest, 'installdir') : [];
      for (const installDir of installDirs) {
        const candidate = normalize(join(common, installDir));
        checked.push(candidate);
        const found = await validateInstall(candidate, 'STEAM_MANIFEST');
        if (found) return { status: 'FOUND', install: found, checked, warnings };
      }
      for (const fallback of INSTALL_DIRECTORY_FALLBACKS) {
        const candidate = normalize(join(common, fallback));
        checked.push(candidate);
        const found = await validateInstall(candidate, 'STEAM_FALLBACK');
        if (found) return { status: 'FOUND', install: found, checked, warnings };
      }
    }
  }

  return { status: 'NOT_FOUND', checked: uniquePaths(checked), warnings };
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function listOtherGsiFiles(cfgDirectory: string): Promise<string[]> {
  try {
    const entries = await readdir(cfgDirectory);
    const ownName = gsiCfgFileName().toLowerCase();
    return entries
      .filter((name) => {
        const lower = name.toLowerCase();
        return (
          lower.startsWith('gamestate_integration_') && lower.endsWith('.cfg') && lower !== ownName
        );
      })
      .sort();
  } catch {
    return [];
  }
}

async function findConflictingGsiFiles(
  cfgDirectory: string,
  otherFiles: readonly string[],
  port: number,
): Promise<string[]> {
  const conflicts: string[] = [];
  for (const name of otherFiles) {
    try {
      const text = await readFile(join(cfgDirectory, name), 'utf8');
      const match = /"uri"\s+"([^"]+)"/i.exec(text);
      if (!match?.[1]) continue;
      const uri = new URL(match[1]);
      const host = uri.hostname.toLowerCase();
      const targetPort = uri.port ? Number(uri.port) : uri.protocol === 'https:' ? 443 : 80;
      if ((host === '127.0.0.1' || host === 'localhost' || host === '::1') && targetPort === port) {
        conflicts.push(name);
      }
    } catch {
      // ignore unreadable or malformed third-party cfg files
    }
  }
  return conflicts;
}

function pathHashFor(cfgPath: string): string {
  return sha256(normalize(cfgPath).toLowerCase()).slice(0, 12);
}

function manifestFileNameFor(cfgPath: string): string {
  return `${BACKUP_MANIFEST_PREFIX}.${pathHashFor(cfgPath)}.json`;
}

async function readManifest(backupDir?: string, cfgPath?: string): Promise<BackupManifest | null> {
  if (!backupDir || !cfgPath) return null;
  try {
    const raw = await readFile(join(backupDir, manifestFileNameFor(cfgPath)), 'utf8');
    const parsed = JSON.parse(raw) as Partial<BackupManifest>;
    if (
      typeof parsed.cfgPath !== 'string' ||
      typeof parsed.installedSha256 !== 'string' ||
      typeof parsed.hadPreviousFile !== 'boolean'
    ) {
      return null;
    }
    return parsed as BackupManifest;
  } catch {
    return null;
  }
}

async function writeManifest(backupDir: string, manifest: BackupManifest): Promise<void> {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const target = join(backupDir, manifestFileNameFor(manifest.cfgPath));
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await rename(temp, target);
}

export async function inspectGsiConfig(options: GsiConfigOptions): Promise<GsiConfigInspection> {
  const path = join(options.cfgDirectory, gsiCfgFileName());
  if (!(await isDirectory(options.cfgDirectory))) {
    return {
      status: 'NOT_FOUND',
      path,
      reason: 'CFG_DIRECTORY_MISSING',
      otherGsiFiles: [],
      conflictingGsiFiles: [],
    };
  }
  const otherGsiFiles = await listOtherGsiFiles(options.cfgDirectory);
  const conflictingGsiFiles = await findConflictingGsiFiles(
    options.cfgDirectory,
    otherGsiFiles,
    options.port ?? 3001,
  );
  const expected = renderHudGsiCfg(options);
  const expectedSha256 = sha256(expected);
  try {
    const actual = await readFile(path);
    if (actual.equals(Buffer.from(expected, 'utf8')))
      return { status: 'READY', path, expectedSha256, otherGsiFiles, conflictingGsiFiles };
    return {
      status: 'NEEDS_INSTALL',
      path,
      reason: 'CONTENT_MISMATCH',
      expectedSha256,
      actualSha256: sha256(actual),
      otherGsiFiles,
      conflictingGsiFiles,
    };
  } catch (error) {
    if (isMissing(error))
      return {
        status: 'NEEDS_INSTALL',
        path,
        reason: 'MISSING',
        expectedSha256,
        otherGsiFiles,
        conflictingGsiFiles,
      };
    return {
      status: 'ERROR',
      path,
      reason: (error as Error).message,
      otherGsiFiles,
      conflictingGsiFiles,
    };
  }
}

/**
 * Installs only RoundSense's own cfg (UTF-8 without BOM, atomic rename).
 * When backupDir is provided, preserves the pre-RoundSense file once in
 * backupDir without creating duplicate backups on reinstall.
 */
export async function installGsiConfig(
  options: GsiConfigOptions & { now?: () => Date; tempSuffix?: () => string },
): Promise<GsiInstallResult> {
  await access(options.cfgDirectory, fsConstants.W_OK);
  const inspection = await inspectGsiConfig(options);
  if (inspection.status === 'READY') {
    return {
      status: 'READY',
      path: inspection.path,
      changed: false,
      sha256: inspection.expectedSha256,
    };
  }
  if (inspection.status === 'NOT_FOUND' || inspection.status === 'ERROR') {
    throw new Error(inspection.reason);
  }

  const expected = renderHudGsiCfg(options);
  const expectedSha256 = sha256(expected);
  const path = inspection.path;
  const now = options.now?.() ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const suffix = options.tempSuffix?.() ?? randomBytes(6).toString('hex');
  const temporary = join(dirname(path), `.${gsiCfgFileName()}.${suffix}.tmp`);
  let backupPath: string | undefined;

  const existingManifest = await readManifest(options.backupDir, path);
  if (options.backupDir) {
    await mkdir(options.backupDir, { recursive: true, mode: 0o700 });
    const hasOriginalBackup =
      existingManifest !== null &&
      existingManifest.cfgPath === path &&
      (existingManifest.hadPreviousFile
        ? Boolean(
            existingManifest.backupFileName &&
            (await isFile(join(options.backupDir, existingManifest.backupFileName))),
          )
        : true);

    const hash = pathHashFor(path);
    if (hasOriginalBackup && existingManifest) {
      if (inspection.reason === 'CONTENT_MISMATCH') {
        const preRepair = join(options.backupDir, `${hash}.pre-repair.cfg`);
        await copyFile(path, preRepair);
      }
      backupPath = existingManifest.backupFileName
        ? join(options.backupDir, existingManifest.backupFileName)
        : undefined;
    } else if (inspection.reason === 'CONTENT_MISMATCH') {
      const backupFileName = `${hash}.original.cfg`;
      backupPath = join(options.backupDir, backupFileName);
      await copyFile(path, backupPath);
      await writeManifest(options.backupDir, {
        cfgPath: path,
        installedSha256: expectedSha256,
        hadPreviousFile: true,
        backupFileName,
        createdAt: now.toISOString(),
      });
    } else {
      await writeManifest(options.backupDir, {
        cfgPath: path,
        installedSha256: expectedSha256,
        hadPreviousFile: false,
        createdAt: now.toISOString(),
      });
    }
  } else if (inspection.reason === 'CONTENT_MISMATCH') {
    backupPath = `${path}.backup-${stamp}`;
    await copyFile(path, backupPath, fsConstants.COPYFILE_EXCL);
  }

  try {
    await writeFile(temporary, Buffer.from(expected, 'utf8'), {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }

  if (options.backupDir && existingManifest && existingManifest.cfgPath === path) {
    await writeManifest(options.backupDir, {
      ...existingManifest,
      installedSha256: expectedSha256,
    });
  }

  return {
    status: 'READY',
    path,
    changed: true,
    backupPath,
    sha256: expectedSha256,
  };
}

/**
 * Restores the pre-RoundSense cfg or removes the RoundSense-created cfg.
 * Refuses to overwrite if the file was modified externally after installation.
 */
export async function restoreGsiConfig(
  options: Pick<GsiConfigOptions, 'cfgDirectory' | 'backupDir'>,
): Promise<GsiRestoreResult> {
  const path = join(options.cfgDirectory, gsiCfgFileName());
  const manifest = await readManifest(options.backupDir, path);
  if (!manifest || !options.backupDir || manifest.cfgPath !== path) {
    return { status: 'NO_ACTION', path, reason: 'NO_MANIFEST' };
  }
  const removeManifests = () =>
    rm(join(options.backupDir!, manifestFileNameFor(path)), { force: true });

  let currentContent: Buffer | null = null;
  try {
    currentContent = await readFile(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  if (currentContent === null) {
    if (!manifest.hadPreviousFile) {
      await removeManifests();
      return { status: 'NO_ACTION', path, reason: 'ALREADY_MISSING' };
    }
  } else if (sha256(currentContent) !== manifest.installedSha256) {
    return { status: 'REFUSED', path, reason: 'EXTERNALLY_MODIFIED' };
  }

  if (manifest.hadPreviousFile) {
    if (!manifest.backupFileName) {
      return { status: 'REFUSED', path, reason: 'BACKUP_MISSING' };
    }
    const backupFullPath = join(options.backupDir, manifest.backupFileName);
    if (!(await isFile(backupFullPath))) {
      return { status: 'REFUSED', path, reason: 'BACKUP_MISSING' };
    }
    const suffix = randomBytes(6).toString('hex');
    const temporary = join(dirname(path), `.${gsiCfgFileName()}.${suffix}.tmp`);
    try {
      await copyFile(backupFullPath, temporary, fsConstants.COPYFILE_EXCL);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    await rm(backupFullPath, { force: true });
    await removeManifests();
    return { status: 'RESTORED', path, mode: 'FROM_BACKUP' };
  }

  await rm(path, { force: true });
  await removeManifests();
  return { status: 'RESTORED', path, mode: 'REMOVED' };
}

export async function canRestoreGsiConfig(
  options: Pick<GsiConfigOptions, 'cfgDirectory' | 'backupDir'>,
): Promise<boolean> {
  const path = join(options.cfgDirectory, gsiCfgFileName());
  const manifest = await readManifest(options.backupDir, path);
  return manifest !== null && manifest.cfgPath === path;
}
