import type {
  DesktopActionResult,
  DesktopBridge,
  DesktopSettingsPatch,
  DesktopState,
  LockableMode,
} from "../shared/contracts.js";

export const DEMO_STATE: DesktopState = {
  revision: 1,
  settings: {
    locale: "zh-CN",
    overlayEnabled: true,
    displayMode: "detailed",
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
  },
  connection: {
    status: "connected",
    endpoint: "http://127.0.0.1:3001",
    acceptedPayloads: 38,
    rejectedPayloads: 0,
    lastReceiptAt: "2026-08-11T00:00:08.000Z",
    gameBuild: 14174,
  },
  gsiSetup: {
    status: "ready",
    gamePath: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive",
    configPath: "…\\game\\csgo\\cfg\\gamestate_integration_roundsense.cfg",
    canInstall: false,
    canRepair: false,
  },
  product: {
    visible: true,
    status: "ready",
    phase: "freezetime",
    mapName: "de_ancient",
    side: "CT",
    roundNumber: 8,
    automaticMode: "full",
    automaticModes: ["full"],
    lockedMode: "semi",
    loadout: {
      finalConfiguration: [
        { item: "m4a4", quantity: 1 },
        { item: "kevlar_helmet", quantity: 1 },
        { item: "smoke", quantity: 1 },
        { item: "flash", quantity: 1 },
      ],
      purchases: [{ item: "smoke", quantity: 1 }, { item: "flash", quantity: 1 }],
      primaryDisposition: "present",
    },
    spending: {
      currentMoney: { status: "known", value: 2600 },
      remainingSpend: { status: "known", value: 950 },
      plannedBundleSpend: { status: "known", value: 500 },
      spentThisRound: { status: "unknown", reason: "refundOrTransfer" },
      lossNextMoney: { status: "known", value: { min: 4500, max: 4500 } },
      protectedCapability: "rifleArmorUtility",
      nextSpendConsequence: {
        thresholdAdditionalSpend: 950,
        before: "rifleArmorUtility",
        after: "rifleArmor",
      },
    },
    updatedAt: "2026-08-11T00:00:08.000Z",
  },
  diagnostics: {
    appVersion: "0.1.0-alpha.1",
    platform: "win32",
    architecture: "x64",
    shortcutRegistrations: [
      { action: "toggleOverlay", accelerator: "Control+Alt+O", status: "registered" },
      { action: "clearLock", accelerator: "Control+Alt+0", status: "registered" },
      { action: "lockEco", accelerator: "Control+Alt+1", status: "registered" },
      { action: "lockSemi", accelerator: "Control+Alt+2", status: "registered" },
      { action: "lockForce", accelerator: "Control+Alt+3", status: "registered" },
      { action: "lockFull", accelerator: "Control+Alt+4", status: "registered" },
    ],
    entries: [
      { id: "receiver", level: "ok", code: "receiverListening" },
      { id: "gsi", level: "ok", code: "gsiReady" },
      { id: "payload", level: "ok", code: "payloadReceived", at: "2026-08-11T00:00:08.000Z" },
      { id: "windows", level: "info", code: "windowsValidationRequired" },
    ],
  },
};

export function createDemoBridge(): DesktopBridge {
  let state = structuredClone(DEMO_STATE);
  const listeners = new Set<(value: DesktopState) => void>();
  const publish = () => {
    state.revision += 1;
    for (const listener of listeners) listener(structuredClone(state));
  };
  const result = (): DesktopActionResult => ({ ok: true, state: structuredClone(state) });
  return {
    async getState() { return structuredClone(state); },
    subscribeState(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async updateSettings(patch: DesktopSettingsPatch) {
      state.settings = {
        ...state.settings,
        ...patch,
        shortcuts: { ...state.settings.shortcuts, ...(patch.shortcuts ?? {}) },
      };
      publish();
      return result();
    },
    async setIntentLock(mode: LockableMode | null) {
      state.product.lockedMode = mode ?? undefined;
      publish();
      return result();
    },
    async installGsiConfig() { state.gsiSetup.status = "ready"; publish(); return result(); },
    async repairGsiConfig() { state.gsiSetup.status = "ready"; publish(); return result(); },
    async refreshGsiSetup() { publish(); return result(); },
    async chooseCs2Path() { publish(); return result(); },
    async copyDiagnostics() { return result(); },
  };
}
