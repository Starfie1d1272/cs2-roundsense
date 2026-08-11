import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { gsiCfgFileName } from "@roundsense/gsi-protocol";
import {
  CS2_CFG_RELATIVE,
  CS2_EXECUTABLE_RELATIVE,
  createOnboardingDiagnostics,
  discoverCs2,
  inspectGsiConfig,
  installGsiConfig,
  vdfValues,
} from "./onboarding.js";

const temporary: string[] = [];

async function sandbox(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "roundsense-onboarding-"));
  temporary.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createInstall(path: string): Promise<void> {
  await mkdir(join(path, CS2_CFG_RELATIVE), { recursive: true });
  await mkdir(join(path, CS2_EXECUTABLE_RELATIVE, ".."), { recursive: true });
  await writeFile(join(path, CS2_EXECUTABLE_RELATIVE), "fixture", "utf8");
}

describe("Steam and CS2 discovery", () => {
  it("parses escaped VDF paths without treating unrelated values as libraries", () => {
    const vdf = `"libraryfolders"\n{\n  "0" { "path" "C:\\\\Steam" }\n  "1" { "path" "D:\\\\游戏\\\\Steam" }\n  "label" "not-a-path"\n}`;
    expect(vdfValues(vdf, "path")).toEqual(["C:\\Steam", "D:\\游戏\\Steam"]);
  });

  it("finds a verified non-default Steam library through appmanifest_730", async () => {
    const root = await sandbox();
    const steam = join(root, "Steam");
    const library = join(root, "外置游戏库");
    const install = join(library, "steamapps", "common", "Counter-Strike Global Offensive");
    await mkdir(join(steam, "steamapps"), { recursive: true });
    await mkdir(join(library, "steamapps"), { recursive: true });
    await writeFile(
      join(steam, "steamapps", "libraryfolders.vdf"),
      `"libraryfolders"\n{\n  "1" { "path" "${library}" }\n}`,
      "utf8",
    );
    await writeFile(
      join(library, "steamapps", "appmanifest_730.acf"),
      `"AppState"\n{\n  "appid" "730"\n  "installdir" "Counter-Strike Global Offensive"\n}`,
      "utf8",
    );
    await createInstall(install);

    const result = await discoverCs2({
      env: {},
      extraSteamRoots: [steam],
      registry: async () => undefined,
    });

    expect(result.status).toBe("FOUND");
    if (result.status === "FOUND") {
      expect(result.install.installPath).toBe(install);
      expect(result.install.source).toBe("STEAM_MANIFEST");
    }
  });

  it("never accepts a plausible directory name without cfg and cs2.exe sentinels", async () => {
    const root = await sandbox();
    const lookalike = join(root, "Counter-Strike 2");
    await mkdir(join(lookalike, CS2_CFG_RELATIVE), { recursive: true });
    const result = await discoverCs2({
      env: {},
      preferredInstallPath: lookalike,
      registry: async () => undefined,
    });
    expect(result.status).toBe("NOT_FOUND");
  });
});

describe("RoundSense GSI configuration", () => {
  it("installs BOM-free config once and is idempotent", async () => {
    const root = await sandbox();
    const cfgDirectory = join(root, "游戏", "cfg");
    await mkdir(cfgDirectory, { recursive: true });
    const options = { cfgDirectory, token: "not-a-real-secret", port: 3001, tempSuffix: () => "first" };

    expect(await inspectGsiConfig(options)).toMatchObject({ status: "NEEDS_INSTALL", reason: "MISSING" });
    const first = await installGsiConfig(options);
    expect(first).toMatchObject({ status: "READY", changed: true });
    const bytes = await readFile(join(cfgDirectory, gsiCfgFileName()));
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toContain('"uri" "http://127.0.0.1:3001"');
    expect(bytes.toString("utf8")).toContain('"token" "not-a-real-secret"');
    expect(await inspectGsiConfig(options)).toMatchObject({ status: "READY" });
    expect(await installGsiConfig({ ...options, tempSuffix: () => "second" })).toMatchObject({ changed: false });
  });

  it("backs up only its own mismatched config before repair", async () => {
    const root = await sandbox();
    const cfgDirectory = join(root, "cfg");
    await mkdir(cfgDirectory, { recursive: true });
    const configPath = join(cfgDirectory, gsiCfgFileName());
    await writeFile(configPath, "old RoundSense config\n", "utf8");

    const result = await installGsiConfig({
      cfgDirectory,
      token: "replacement-token",
      now: () => new Date("2026-08-10T12:34:56.000Z"),
      tempSuffix: () => "repair",
    });

    expect(result.changed).toBe(true);
    expect(result.backupPath).toBe(`${configPath}.backup-2026-08-10T12-34-56-000Z`);
    expect(await readFile(result.backupPath!, "utf8")).toBe("old RoundSense config\n");
    expect(await readFile(configPath, "utf8")).toContain('"token" "replacement-token"');
  });

  it("keeps diagnostics free of tokens and raw identity", async () => {
    const root = await sandbox();
    const installPath = join(root, "Counter-Strike Global Offensive");
    await createInstall(installPath);
    const discovery = await discoverCs2({ preferredInstallPath: installPath, env: {}, registry: async () => undefined });
    const inspection = discovery.status === "FOUND"
      ? await inspectGsiConfig({ cfgDirectory: discovery.install.cfgDirectory, token: "do-not-export" })
      : undefined;
    const diagnostics = createOnboardingDiagnostics(discovery, inspection);
    expect(JSON.stringify(diagnostics)).not.toContain("do-not-export");
    expect(diagnostics).toMatchObject({ discoveryStatus: "FOUND", cfgStatus: "NEEDS_INSTALL" });
  });
});
