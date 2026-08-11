import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopActionResult,
  DesktopBridge,
  DesktopSettingsPatch,
  DesktopState,
  LockableMode,
} from "../shared/contracts.js";

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

const bridge: DesktopBridge = {
  getState: () => ipcRenderer.invoke(channels.getState) as Promise<DesktopState>,
  subscribeState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopState) => listener(state);
    ipcRenderer.on(channels.stateChanged, handler);
    return () => ipcRenderer.removeListener(channels.stateChanged, handler);
  },
  subscribeRuntimeState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
    ipcRenderer.on(channels.runtimeChanged, handler);
    return () => ipcRenderer.removeListener(channels.runtimeChanged, handler);
  },
  updateSettings: (patch: DesktopSettingsPatch) => ipcRenderer.invoke(channels.updateSettings, patch) as Promise<DesktopActionResult>,
  setIntentLock: (mode: LockableMode | null) => ipcRenderer.invoke(channels.setIntentLock, mode) as Promise<DesktopActionResult>,
  installGsiConfig: () => ipcRenderer.invoke(channels.installGsi) as Promise<DesktopActionResult>,
  repairGsiConfig: () => ipcRenderer.invoke(channels.repairGsi) as Promise<DesktopActionResult>,
  refreshGsiSetup: () => ipcRenderer.invoke(channels.refreshGsi) as Promise<DesktopActionResult>,
  chooseCs2Path: () => ipcRenderer.invoke(channels.chooseCs2) as Promise<DesktopActionResult>,
  copyDiagnostics: () => ipcRenderer.invoke(channels.copyDiagnostics) as Promise<DesktopActionResult>,
};

contextBridge.exposeInMainWorld("roundSense", bridge);
