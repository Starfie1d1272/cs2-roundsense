import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { applySettingsPatch, DEFAULT_SETTINGS, loadDesktopState, normalizeSettings, saveDesktopState } from "./settings.js";

const temporary: string[] = [];

async function sandbox(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "roundsense-settings-"));
  temporary.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("desktop settings", () => {
  it("clamps scale and rejects unknown enum or empty shortcut values", () => {
    expect(normalizeSettings({
      locale: "unknown",
      overlayEnabled: false,
      displayMode: "detailed",
      overlayPosition: "nowhere",
      overlayScale: 999,
      shortcuts: { lockEco: "" },
    })).toEqual({
      ...DEFAULT_SETTINGS,
      overlayEnabled: false,
      displayMode: "detailed",
      overlayScale: 140,
    });
  });

  it("merges partial shortcut patches without losing other bindings", () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { shortcuts: { lockEco: "Alt+F7" }, overlayScale: 80 });
    expect(next.shortcuts.lockEco).toBe("Alt+F7");
    expect(next.shortcuts.lockFull).toBe(DEFAULT_SETTINGS.shortcuts.lockFull);
    expect(next.overlayScale).toBe(80);
  });

  it("persists the token internally while never returning malformed state", async () => {
    const root = await sandbox();
    const path = join(root, "nested", "state.json");
    const missing = await loadDesktopState(path);
    expect(missing.warning).toBe("MISSING");
    expect(missing.value.token).toHaveLength(36);
    await saveDesktopState(path, missing.value);
    expect(await loadDesktopState(path)).toEqual({ value: missing.value });
    expect((await readFile(path, "utf8")).startsWith("{")).toBe(true);
    await writeFile(path, "not json", "utf8");
    expect((await loadDesktopState(path)).warning).toBe("INVALID");
  });
});
