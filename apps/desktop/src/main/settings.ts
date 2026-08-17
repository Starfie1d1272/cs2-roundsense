import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DISPLAY_MODES,
  OVERLAY_POSITIONS,
  SUPPORTED_LOCALES,
  type DesktopSettings,
  type DesktopSettingsPatch,
  type ShortcutAction,
} from "../shared/contracts.js";

export const DEFAULT_SETTINGS: DesktopSettings = {
  locale: "zh-CN",
  overlayEnabled: true,
  displayMode: "compact",
  overlayPosition: "top-center",
  overlayScale: 100,
  shortcuts: {
    toggleOverlay: "Control+Alt+O",
    clearLock: "Control+Alt+0",
    lockEco: "Control+Alt+1",
    lockSemi: "Control+Alt+2",
    lockForce: "Control+Alt+3",
    lockFull: "Control+Alt+4",
  },
};

export interface PersistedDesktopState {
  version: 1;
  settings: DesktopSettings;
  token: string;
  preferredCs2Path?: string;
}

export interface LoadedDesktopState {
  value: PersistedDesktopState;
  warning?: "MISSING" | "INVALID" | "UNREADABLE";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validShortcut(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 3 && value.length <= 80;
}

export function normalizeSettings(value: unknown, base: DesktopSettings = DEFAULT_SETTINGS): DesktopSettings {
  if (!isObject(value)) return structuredClone(base);
  const shortcuts = isObject(value.shortcuts) ? value.shortcuts : {};
  const normalizedShortcuts = { ...base.shortcuts };
  for (const action of Object.keys(normalizedShortcuts) as ShortcutAction[]) {
    if (validShortcut(shortcuts[action])) normalizedShortcuts[action] = shortcuts[action].trim();
  }
  return {
    locale: SUPPORTED_LOCALES.includes(value.locale as never) ? value.locale as DesktopSettings["locale"] : base.locale,
    overlayEnabled: typeof value.overlayEnabled === "boolean" ? value.overlayEnabled : base.overlayEnabled,
    displayMode: DISPLAY_MODES.includes(value.displayMode as never) ? value.displayMode as DesktopSettings["displayMode"] : base.displayMode,
    overlayPosition: OVERLAY_POSITIONS.includes(value.overlayPosition as never)
      ? value.overlayPosition as DesktopSettings["overlayPosition"]
      : base.overlayPosition,
    overlayScale: typeof value.overlayScale === "number" && Number.isFinite(value.overlayScale)
      ? Math.round(Math.min(140, Math.max(75, value.overlayScale)))
      : base.overlayScale,
    shortcuts: normalizedShortcuts,
  };
}

export function applySettingsPatch(current: DesktopSettings, patch: DesktopSettingsPatch): DesktopSettings {
  return normalizeSettings({ ...current, ...patch, shortcuts: { ...current.shortcuts, ...(patch.shortcuts ?? {}) } }, current);
}

function freshState(): PersistedDesktopState {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    token: randomBytes(18).toString("hex"),
  };
}

export async function loadDesktopState(path: string): Promise<LoadedDesktopState> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { value: freshState(), warning: code === "ENOENT" ? "MISSING" : "UNREADABLE" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || parsed.version !== 1 || typeof parsed.token !== "string" || parsed.token.length < 24) {
      return { value: freshState(), warning: "INVALID" };
    }
    return {
      value: {
        version: 1,
        settings: normalizeSettings(parsed.settings),
        token: parsed.token,
        preferredCs2Path: typeof parsed.preferredCs2Path === "string" ? parsed.preferredCs2Path : undefined,
      },
    };
  } catch {
    return { value: freshState(), warning: "INVALID" };
  }
}

export async function saveDesktopState(path: string, value: PersistedDesktopState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  const data = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await writeFile(temporary, data, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
