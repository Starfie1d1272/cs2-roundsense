import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, dirname, join, normalize, resolve } from "node:path";
import { promisify } from "node:util";
import { gsiCfgFileName, renderGsiCfg } from "@roundsense/gsi-protocol";

const execFileAsync = promisify(execFile);

export const CS2_APP_ID = "730";
export const CS2_EXECUTABLE_RELATIVE = join("game", "bin", "win64", "cs2.exe");
export const CS2_CFG_RELATIVE = join("game", "csgo", "cfg");
const INSTALL_DIRECTORY_FALLBACKS = ["Counter-Strike Global Offensive", "Counter-Strike 2"] as const;

export type RegistryReader = (key: string, valueName: string) => Promise<string | undefined>;

export interface Cs2Install {
  installPath: string;
  cfgDirectory: string;
  executablePath: string;
  source: "PREFERRED" | "APP_REGISTRY" | "STEAM_MANIFEST" | "STEAM_FALLBACK";
}

export type Cs2Discovery =
  | { status: "FOUND"; install: Cs2Install; checked: readonly string[]; warnings: readonly string[] }
  | { status: "NOT_FOUND"; checked: readonly string[]; warnings: readonly string[] };

export interface DiscoverCs2Options {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  preferredInstallPath?: string;
  extraSteamRoots?: readonly string[];
  registry?: RegistryReader;
}

export type GsiConfigInspection =
  | { status: "READY"; path: string; expectedSha256: string }
  | {
      status: "NEEDS_INSTALL";
      path: string;
      reason: "MISSING" | "CONTENT_MISMATCH";
      expectedSha256: string;
      actualSha256?: string;
    }
  | { status: "NOT_FOUND"; path: string; reason: "CFG_DIRECTORY_MISSING" }
  | { status: "ERROR"; path: string; reason: string };

export interface GsiInstallResult {
  status: "READY";
  path: string;
  changed: boolean;
  backupPath?: string;
  sha256: string;
}

export interface GsiConfigOptions {
  cfgDirectory: string;
  token: string;
  port?: number;
}

function uniquePaths(paths: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of paths) {
    if (!candidate) continue;
    const path = normalize(resolve(candidate));
    const key = process.platform === "win32" ? path.toLocaleLowerCase("en-US") : path;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
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
  return value.replace(/\\\\/g, "\\").replace(/\\\//g, "/");
}

/** Extracts only VDF string values needed for Steam discovery. */
export function vdfValues(input: string, key: string): string[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`"${escaped}"\\s+"([^"]+)"`, "gi");
  return [...input.matchAll(pattern)].map((match) => unescapeVdfPath(match[1]!));
}

export async function readWindowsRegistry(key: string, valueName: string): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  try {
    const { stdout } = await execFileAsync("reg", ["query", key, "/v", valueName], {
      windowsHide: true,
      encoding: "utf8",
    });
    const line = stdout.split(/\r?\n/).find((candidate) => candidate.includes(valueName) && candidate.includes("REG_"));
    return line?.replace(/^.*?REG_\w+\s+/, "").trim() || undefined;
  } catch {
    return undefined;
  }
}

async function validateInstall(installPath: string, source: Cs2Install["source"]): Promise<Cs2Install | null> {
  const cfgDirectory = join(installPath, CS2_CFG_RELATIVE);
  const executablePath = join(installPath, CS2_EXECUTABLE_RELATIVE);
  if (!(await isDirectory(cfgDirectory)) || !(await isFile(executablePath))) return null;
  return { installPath, cfgDirectory, executablePath, source };
}

async function readTextIfPresent(path: string, warnings: string[]): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
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
    const preferred = normalize(resolve(options.preferredInstallPath));
    checked.push(preferred);
    const found = await validateInstall(preferred, "PREFERRED");
    if (found) return { status: "FOUND", install: found, checked, warnings };
  }

  const appRegistryKeys = [
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App ${CS2_APP_ID}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App ${CS2_APP_ID}`,
  ];
  for (const key of appRegistryKeys) {
    const candidate = await registry(key, "InstallLocation");
    if (!candidate) continue;
    const path = normalize(resolve(candidate));
    checked.push(path);
    const found = await validateInstall(path, "APP_REGISTRY");
    if (found) return { status: "FOUND", install: found, checked, warnings };
  }

  const steamRegistryRoots = await Promise.all([
    registry("HKCU\\Software\\Valve\\Steam", "SteamPath"),
    registry("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"),
  ]);
  const steamRoots = uniquePaths([
    ...(options.extraSteamRoots ?? []),
    ...steamRegistryRoots,
    env["PROGRAMFILES(X86)"] ? join(env["PROGRAMFILES(X86)"], "Steam") : undefined,
    env.ProgramFiles ? join(env.ProgramFiles, "Steam") : undefined,
  ]);

  for (const steamRoot of steamRoots) {
    const libraryVdf = await readTextIfPresent(join(steamRoot, "steamapps", "libraryfolders.vdf"), warnings);
    const libraries = uniquePaths([steamRoot, ...(libraryVdf ? vdfValues(libraryVdf, "path") : [])]);
    for (const library of libraries) {
      const common = join(library, "steamapps", "common");
      const manifest = await readTextIfPresent(join(library, "steamapps", `appmanifest_${CS2_APP_ID}.acf`), warnings);
      const installDirs = manifest ? vdfValues(manifest, "installdir") : [];
      for (const installDir of installDirs) {
        const candidate = normalize(join(common, installDir));
        checked.push(candidate);
        const found = await validateInstall(candidate, "STEAM_MANIFEST");
        if (found) return { status: "FOUND", install: found, checked, warnings };
      }
      for (const fallback of INSTALL_DIRECTORY_FALLBACKS) {
        const candidate = normalize(join(common, fallback));
        checked.push(candidate);
        const found = await validateInstall(candidate, "STEAM_FALLBACK");
        if (found) return { status: "FOUND", install: found, checked, warnings };
      }
    }
  }

  return { status: "NOT_FOUND", checked: uniquePaths(checked), warnings };
}

function desiredConfig({ token, port = 3001 }: Pick<GsiConfigOptions, "token" | "port">): string {
  return renderGsiCfg({ uri: `http://127.0.0.1:${port}`, token });
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function inspectGsiConfig(options: GsiConfigOptions): Promise<GsiConfigInspection> {
  const path = join(options.cfgDirectory, gsiCfgFileName());
  if (!(await isDirectory(options.cfgDirectory))) {
    return { status: "NOT_FOUND", path, reason: "CFG_DIRECTORY_MISSING" };
  }
  const expected = desiredConfig(options);
  const expectedSha256 = sha256(expected);
  try {
    const actual = await readFile(path);
    if (actual.equals(Buffer.from(expected, "utf8"))) return { status: "READY", path, expectedSha256 };
    return {
      status: "NEEDS_INSTALL",
      path,
      reason: "CONTENT_MISMATCH",
      expectedSha256,
      actualSha256: sha256(actual),
    };
  } catch (error) {
    if (isMissing(error)) return { status: "NEEDS_INSTALL", path, reason: "MISSING", expectedSha256 };
    return { status: "ERROR", path, reason: (error as Error).message };
  }
}

/**
 * Installs only RoundSense's own cfg. Existing different content is preserved
 * as a timestamped backup before a temporary file is atomically renamed.
 */
export async function installGsiConfig(
  options: GsiConfigOptions & { now?: () => Date; tempSuffix?: () => string },
): Promise<GsiInstallResult> {
  await access(options.cfgDirectory, fsConstants.W_OK);
  const inspection = await inspectGsiConfig(options);
  if (inspection.status === "READY") {
    return { status: "READY", path: inspection.path, changed: false, sha256: inspection.expectedSha256 };
  }
  if (inspection.status === "NOT_FOUND" || inspection.status === "ERROR") {
    throw new Error(inspection.reason);
  }

  const expected = desiredConfig(options);
  const path = inspection.path;
  const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const suffix = options.tempSuffix?.() ?? randomBytes(6).toString("hex");
  const temporary = join(dirname(path), `.${gsiCfgFileName()}.${suffix}.tmp`);
  let backupPath: string | undefined;

  if (inspection.reason === "CONTENT_MISMATCH") {
    backupPath = `${path}.backup-${stamp}`;
    await copyFile(path, backupPath, fsConstants.COPYFILE_EXCL);
  }

  try {
    await mkdir(dirname(temporary), { recursive: false }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    await writeFile(temporary, Buffer.from(expected, "utf8"), { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }

  return { status: "READY", path, changed: true, backupPath, sha256: sha256(expected) };
}

export function createOnboardingDiagnostics(
  discovery: Cs2Discovery,
  inspection?: GsiConfigInspection,
): Record<string, string | number | readonly string[] | undefined> {
  return {
    discoveryStatus: discovery.status,
    installPath: discovery.status === "FOUND" ? discovery.install.installPath : undefined,
    cfgPath: inspection?.path,
    cfgStatus: inspection?.status,
    cfgSha256: inspection && "expectedSha256" in inspection ? inspection.expectedSha256 : undefined,
    checkedPathCount: discovery.checked.length,
    warnings: discovery.warnings,
  };
}
