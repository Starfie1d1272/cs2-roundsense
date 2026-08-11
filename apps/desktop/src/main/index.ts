import { join } from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
  type OpenDialogOptions,
} from "electron";
import {
  LOCKABLE_MODES,
  SHORTCUT_ACTIONS,
  type DesktopActionResult,
  type DesktopSettingsPatch,
  type DesktopState,
  type DesktopRuntimeState,
  type DiagnosticEntry,
  type LockableMode,
  type ShortcutAction,
  type ShortcutDiagnostic,
} from "../shared/contracts.js";
import { translate } from "../shared/i18n.js";
import { discoverCs2, inspectGsiConfig, installGsiConfig, type Cs2Discovery } from "./onboarding.js";
import { RoundSenseRuntime, idleProduct, type RuntimeUpdate } from "./runtime.js";
import {
  applySettingsPatch,
  loadDesktopState,
  saveDesktopState,
  type PersistedDesktopState,
} from "./settings.js";

const PORT = 3001;
const STATE_FILE = "product-alpha-state.json";
const STALE_AFTER_MS = 75_000;
const channels = {
  getState: "roundsense:get-state",
  stateChanged: "roundsense:state-changed",
  runtimeChanged: "roundsense:runtime-changed",
  updateSettings: "roundsense:update-settings",
  setIntentLock: "roundsense:set-intent-lock",
  installGsi: "roundsense:install-gsi",
  repairGsi: "roundsense:repair-gsi",
  refreshGsi: "roundsense:refresh-gsi",
  chooseCs2: "roundsense:choose-cs2",
  copyDiagnostics: "roundsense:copy-diagnostics",
} as const;

let dashboardWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let runtime: RoundSenseRuntime | null = null;
let persisted: PersistedDesktopState;
let discovery: Cs2Discovery | null = null;
let quitting = false;
let staleTimer: NodeJS.Timeout | null = null;
let shortcutDiagnostics: ShortcutDiagnostic[] = [];

let state: DesktopState;

function endpoint(): string {
  return `http://127.0.0.1:${PORT}`;
}

function baseState(settings: PersistedDesktopState["settings"]): DesktopState {
  return {
    revision: 0,
    settings,
    connection: { status: "starting", endpoint: endpoint(), acceptedPayloads: 0, rejectedPayloads: 0 },
    gsiSetup: {
      status: process.platform === "win32" ? "checking" : "unsupported",
      canInstall: false,
      canRepair: false,
    },
    product: idleProduct(),
    diagnostics: {
      appVersion: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      shortcutRegistrations: [],
      entries: [],
      roundStartMoneyAnchor: { status: "notObserved" },
    },
  };
}

function diagnosticEntries(): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [];
  if (state.connection.status !== "starting" && state.connection.status !== "error") {
    entries.push({ id: "receiver", level: "ok", code: "receiverListening" });
  }
  if (state.gsiSetup.status === "ready") entries.push({ id: "gsi", level: "ok", code: "gsiReady" });
  if (state.gsiSetup.status === "missing") entries.push({ id: "gsi", level: "warning", code: "gsiMissing" });
  if (state.gsiSetup.status === "needsRepair") entries.push({ id: "gsi", level: "warning", code: "gsiNeedsRepair" });
  if (state.connection.acceptedPayloads > 0) {
    entries.push({ id: "payload", level: "ok", code: "payloadReceived", at: state.connection.lastReceiptAt });
  }
  if (shortcutDiagnostics.some((item) => item.status !== "registered")) {
    entries.push({ id: "shortcuts", level: "warning", code: "shortcutConflict" });
  }
  entries.push({ id: "windows-validation", level: "info", code: "windowsValidationRequired" });
  return entries;
}

function snapshot(): DesktopState {
  return structuredClone(state);
}

function publish(): void {
  state.revision += 1;
  state.diagnostics = {
    ...state.diagnostics,
    shortcutRegistrations: shortcutDiagnostics.map((item) => ({ ...item })),
    entries: diagnosticEntries(),
  };
  const next = snapshot();
  for (const window of [dashboardWindow, overlayWindow]) {
    if (window && !window.isDestroyed() && !window.webContents.isLoading()) {
      window.webContents.send(channels.stateChanged, next);
    }
  }
  syncOverlay();
  rebuildTrayMenu();
}

function publishRuntime(): void {
  state.revision += 1;
  const next: DesktopRuntimeState = {
    revision: state.revision,
    connection: structuredClone(state.connection),
    product: structuredClone(state.product),
    roundStartMoneyAnchor: structuredClone(state.diagnostics.roundStartMoneyAnchor),
  };
  for (const window of [dashboardWindow, overlayWindow]) {
    if (window && !window.isDestroyed() && !window.webContents.isLoading()) {
      window.webContents.send(channels.runtimeChanged, next);
    }
  }
  syncOverlay();
}

function actionResult(ok: boolean, errorCode?: DesktopActionResult["errorCode"]): DesktopActionResult {
  return { ok, errorCode, state: snapshot() };
}

function rendererPath(): string {
  return join(app.getAppPath(), "dist", "renderer", "index.html");
}

function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on("did-finish-load", () => window.webContents.send(channels.stateChanged, snapshot()));
}

async function loadRenderer(window: BrowserWindow, view: "dashboard" | "overlay"): Promise<void> {
  await window.loadFile(rendererPath(), { query: { view } });
}

function createDashboard(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 820,
    minHeight: 650,
    show: false,
    backgroundColor: "#0b1115",
    title: "RoundSense",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload", "index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  secureWindow(window);
  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  void loadRenderer(window, "dashboard");
  return window;
}

function overlaySize(): { width: number; height: number } {
  const scale = state.settings.overlayScale / 100;
  return {
    width: Math.round(620 * scale),
    height: Math.round((state.settings.displayMode === "compact" ? 225 : 390) * scale),
  };
}

function overlayBounds(): Electron.Rectangle {
  const display = screen.getPrimaryDisplay();
  const { x, y, width: areaWidth, height: areaHeight } = display.workArea;
  const { width, height } = overlaySize();
  const margin = Math.round(28 * state.settings.overlayScale / 100);
  const horizontal = state.settings.overlayPosition.endsWith("left")
    ? x + margin
    : state.settings.overlayPosition.endsWith("right")
      ? x + areaWidth - width - margin
      : x + Math.round((areaWidth - width) / 2);
  const vertical = state.settings.overlayPosition.startsWith("bottom")
    ? y + areaHeight - height - margin
    : y + margin;
  return { x: horizontal, y: vertical, width, height };
}

function createOverlay(): BrowserWindow {
  const window = new BrowserWindow({
    ...overlayBounds(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload", "index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
      backgroundThrottling: false,
    },
  });
  secureWindow(window);
  window.setIgnoreMouseEvents(true, { forward: true });
  window.setAlwaysOnTop(true, "screen-saver");
  void loadRenderer(window, "overlay");
  return window;
}

function syncOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setBounds(overlayBounds(), false);
  const shouldShow = state.settings.overlayEnabled && state.connection.status === "connected" && state.product.visible && state.product.phase === "freezetime";
  if (shouldShow) overlayWindow.showInactive();
  else overlayWindow.hide();
}

function trayIcon(): Electron.NativeImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="5" fill="#121c22"/><path d="M8 23V9h8.2c4 0 6.3 2 6.3 5 0 2-1 3.4-3 4.2L23 23h-4.8l-2.8-4.2h-3.2V23H8Zm4.2-7.5h3.6c1.6 0 2.4-.5 2.4-1.6 0-1.1-.8-1.6-2.4-1.6h-3.6v3.2Z" fill="#68afa2"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`).resize({ width: 16, height: 16 });
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const locale = state.settings.locale;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "RoundSense", enabled: false },
    { type: "separator" },
    { label: translate(locale, "nav.overview"), click: () => { dashboardWindow?.show(); dashboardWindow?.focus(); } },
    {
      label: translate(locale, "overlay.enabled"),
      type: "checkbox",
      checked: state.settings.overlayEnabled,
      click: (item) => { void updateSettings({ overlayEnabled: item.checked }); },
    },
    {
      label: translate(locale, `overlay.${state.settings.displayMode}`),
      submenu: [
        { label: translate(locale, "overlay.compact"), type: "radio", checked: state.settings.displayMode === "compact", click: () => { void updateSettings({ displayMode: "compact" }); } },
        { label: translate(locale, "overlay.detailed"), type: "radio", checked: state.settings.displayMode === "detailed", click: () => { void updateSettings({ displayMode: "detailed" }); } },
      ],
    },
    { type: "separator" },
    { label: translate(locale, "intent.clear"), enabled: runtime?.lock !== null, click: () => { void setIntentLock(null); } },
    { label: translate(locale, "diagnostics.title"), click: () => { dashboardWindow?.show(); dashboardWindow?.focus(); } },
    { type: "separator" },
    { label: translate(locale, "app.quit"), click: () => { quitting = true; app.quit(); } },
  ]));
}

async function persist(): Promise<void> {
  await saveDesktopState(join(app.getPath("userData"), STATE_FILE), persisted);
}

function shortcutHandler(action: ShortcutAction): () => void {
  if (action === "toggleOverlay") return () => { void updateSettings({ overlayEnabled: !state.settings.overlayEnabled }); };
  if (action === "clearLock") return () => { void setIntentLock(null); };
  const mode: Record<Exclude<ShortcutAction, "toggleOverlay" | "clearLock">, LockableMode> = {
    lockEco: "eco",
    lockSemi: "semi",
    lockForce: "force",
    lockFull: "full",
  };
  return () => { void setIntentLock(mode[action]); };
}

function registerShortcuts(): void {
  globalShortcut.unregisterAll();
  shortcutDiagnostics = SHORTCUT_ACTIONS.map((action) => {
    const accelerator = state.settings.shortcuts[action];
    try {
      const registered = globalShortcut.register(accelerator, shortcutHandler(action));
      return { action, accelerator, status: registered ? "registered" : "conflict" };
    } catch {
      return { action, accelerator, status: "invalid" };
    }
  });
}

async function updateSettings(patch: DesktopSettingsPatch): Promise<DesktopActionResult> {
  state.settings = applySettingsPatch(state.settings, patch);
  persisted.settings = state.settings;
  try {
    await persist();
    registerShortcuts();
    publish();
    return actionResult(true);
  } catch {
    return actionResult(false, "permissionDenied");
  }
}

async function setIntentLock(mode: LockableMode | null): Promise<DesktopActionResult> {
  if (mode !== null && !LOCKABLE_MODES.includes(mode)) return actionResult(false, "invalidInput");
  const accepted = runtime?.setIntentLock(mode) ?? false;
  if (!accepted) return actionResult(false, "notAvailable");
  // The next GSI receipt resolves the intent and publishes its matching plan.
  // Do not combine a new lock label with purchases from the previous plan.
  publish();
  return actionResult(true);
}

async function refreshGsi(): Promise<DesktopActionResult> {
  if (process.platform !== "win32") {
    state.gsiSetup = { status: "unsupported", canInstall: false, canRepair: false };
    publish();
    return actionResult(true);
  }
  state.gsiSetup = { status: "checking", canInstall: false, canRepair: false };
  publish();
  try {
    discovery = await discoverCs2({ preferredInstallPath: persisted.preferredCs2Path });
    if (discovery.status === "NOT_FOUND") {
      state.gsiSetup = { status: "missing", canInstall: false, canRepair: false, errorCode: "cs2NotFound" };
    } else {
      const inspection = await inspectGsiConfig({ cfgDirectory: discovery.install.cfgDirectory, token: persisted.token, port: PORT });
      if (inspection.status === "READY") {
        state.gsiSetup = { status: "ready", gamePath: discovery.install.installPath, configPath: inspection.path, canInstall: false, canRepair: false };
      } else if (inspection.status === "NEEDS_INSTALL") {
        state.gsiSetup = {
          status: inspection.reason === "MISSING" ? "missing" : "needsRepair",
          gamePath: discovery.install.installPath,
          configPath: inspection.path,
          canInstall: inspection.reason === "MISSING",
          canRepair: inspection.reason === "CONTENT_MISMATCH",
        };
      } else {
        state.gsiSetup = { status: "error", gamePath: discovery.install.installPath, configPath: inspection.path, canInstall: false, canRepair: false, errorCode: "configUnreadable" };
      }
    }
    publish();
    return actionResult(true);
  } catch {
    state.gsiSetup = { status: "error", canInstall: false, canRepair: false, errorCode: "unknown" };
    publish();
    return actionResult(false, "unknown");
  }
}

async function writeGsi(): Promise<DesktopActionResult> {
  if (discovery?.status !== "FOUND") await refreshGsi();
  if (discovery?.status !== "FOUND") return actionResult(false, "notAvailable");
  try {
    await installGsiConfig({ cfgDirectory: discovery.install.cfgDirectory, token: persisted.token, port: PORT });
    return await refreshGsi();
  } catch {
    state.gsiSetup = { ...state.gsiSetup, status: "error", canInstall: false, canRepair: false, errorCode: "configUnwritable" };
    publish();
    return actionResult(false, "permissionDenied");
  }
}

async function chooseCs2(): Promise<DesktopActionResult> {
  if (process.platform !== "win32") return actionResult(false, "notAvailable");
  const options: OpenDialogOptions = {
    title: translate(state.settings.locale, "setup.chooseDialog"),
    properties: ["openDirectory"],
  };
  const selection = dashboardWindow
    ? await dialog.showOpenDialog(dashboardWindow, options)
    : await dialog.showOpenDialog(options);
  if (selection.canceled || !selection.filePaths[0]) return actionResult(false, "notAvailable");
  persisted.preferredCs2Path = selection.filePaths[0];
  await persist();
  return refreshGsi();
}

function sanitizedDiagnostics(): string {
  return JSON.stringify({
    appVersion: state.diagnostics.appVersion,
    platform: state.diagnostics.platform,
    architecture: state.diagnostics.architecture,
    connection: state.connection,
    gsiSetup: state.gsiSetup,
    overlay: {
      enabled: state.settings.overlayEnabled,
      displayMode: state.settings.displayMode,
      position: state.settings.overlayPosition,
      scale: state.settings.overlayScale,
      bounds: overlayWindow?.getBounds(),
    },
    shortcuts: state.diagnostics.shortcutRegistrations,
  }, null, 2);
}

function wireIpc(): void {
  ipcMain.handle(channels.getState, () => snapshot());
  ipcMain.handle(channels.updateSettings, (_event, patch: DesktopSettingsPatch) => updateSettings(patch));
  ipcMain.handle(channels.setIntentLock, (_event, mode: LockableMode | null) => setIntentLock(mode));
  ipcMain.handle(channels.installGsi, () => writeGsi());
  ipcMain.handle(channels.repairGsi, () => writeGsi());
  ipcMain.handle(channels.refreshGsi, () => refreshGsi());
  ipcMain.handle(channels.chooseCs2, () => chooseCs2());
  ipcMain.handle(channels.copyDiagnostics, () => {
    clipboard.writeText(sanitizedDiagnostics());
    return actionResult(true);
  });
}

function onRuntimeUpdate(update: RuntimeUpdate): void {
  state.connection = {
    status: "connected",
    endpoint: endpoint(),
    acceptedPayloads: update.acceptedPayloads,
    rejectedPayloads: update.rejectedPayloads,
    lastReceiptAt: update.lastReceiptAt,
    gameBuild: update.gameBuild,
  };
  state.product = update.product;
  state.diagnostics = { ...state.diagnostics, roundStartMoneyAnchor: update.roundStartMoneyAnchor };
  publishRuntime();
}

async function startRuntime(): Promise<void> {
  runtime = new RoundSenseRuntime({
    token: persisted.token,
    port: PORT,
    onUpdate: onRuntimeUpdate,
    onReject: (code) => {
      state.connection = {
        ...state.connection,
        status: code === 401 ? "error" : state.connection.status,
        rejectedPayloads: (state.connection.rejectedPayloads ?? 0) + 1,
        errorCode: code === 401 ? "invalidToken" : state.connection.errorCode,
      };
      if (code === 401) state.product = { ...state.product, visible: false };
      publish();
    },
  });
  try {
    await runtime.start();
    state.connection = { ...state.connection, status: "waiting" };
  } catch (error) {
    state.connection = {
      ...state.connection,
      status: "error",
      errorCode: (error as NodeJS.ErrnoException).code === "EADDRINUSE" ? "portInUse" : "unknown",
    };
  }
  publish();
}

async function boot(): Promise<void> {
  const loaded = await loadDesktopState(join(app.getPath("userData"), STATE_FILE));
  persisted = loaded.value;
  state = baseState(persisted.settings);
  wireIpc();
  dashboardWindow = createDashboard();
  overlayWindow = createOverlay();
  tray = new Tray(trayIcon());
  tray.setToolTip("RoundSense");
  tray.on("click", () => { dashboardWindow?.show(); dashboardWindow?.focus(); });
  registerShortcuts();
  rebuildTrayMenu();
  await Promise.all([startRuntime(), refreshGsi()]);
  staleTimer = setInterval(() => {
    if (!state.connection.lastReceiptAt || state.connection.status !== "connected") return;
    if (Date.now() - Date.parse(state.connection.lastReceiptAt) > STALE_AFTER_MS) {
      state.connection = { ...state.connection, status: "stale" };
      state.product = { ...state.product, visible: false };
      publish();
    }
  }, 5_000);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.enableSandbox();
  app.setAppUserModelId("top.starfie1d.roundsense");
  app.on("second-instance", () => { dashboardWindow?.show(); dashboardWindow?.focus(); });
  app.whenReady().then(boot).catch((error) => {
    dialog.showErrorBox("RoundSense", error instanceof Error ? error.message : String(error));
    app.quit();
  });
}

app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => {
  if (staleTimer) clearInterval(staleTimer);
  globalShortcut.unregisterAll();
  void runtime?.stop();
});
