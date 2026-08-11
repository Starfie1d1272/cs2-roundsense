export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DISPLAY_MODES = ["compact", "detailed"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export const OVERLAY_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

export const LOCKABLE_MODES = ["eco", "semi", "force", "full"] as const;
export type LockableMode = (typeof LOCKABLE_MODES)[number];
export type PlayerVisibleMode = "pistol" | LockableMode;

export const SHORTCUT_ACTIONS = [
  "toggleOverlay",
  "clearLock",
  "lockEco",
  "lockSemi",
  "lockForce",
  "lockFull",
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type ShortcutBindings = Record<ShortcutAction, string>;

export interface DesktopSettings {
  locale: Locale;
  overlayEnabled: boolean;
  displayMode: DisplayMode;
  overlayPosition: OverlayPosition;
  /** Integer percent. The main process clamps this to 75..140. */
  overlayScale: number;
  shortcuts: ShortcutBindings;
}

export type DesktopSettingsPatch = Partial<Omit<DesktopSettings, "shortcuts">> & {
  shortcuts?: Partial<ShortcutBindings>;
};

export type ConnectionStatus = "starting" | "waiting" | "connected" | "stale" | "error";

export interface ConnectionState {
  status: ConnectionStatus;
  endpoint: string;
  acceptedPayloads: number;
  rejectedPayloads: number;
  lastReceiptAt?: string;
  gameBuild?: number;
  errorCode?: "portInUse" | "receiverStopped" | "invalidToken" | "unknown";
}

export type GsiSetupStatus = "checking" | "missing" | "needsRepair" | "ready" | "unsupported" | "error";

export interface GsiSetupState {
  status: GsiSetupStatus;
  gamePath?: string;
  configPath?: string;
  canInstall: boolean;
  canRepair: boolean;
  errorCode?: "steamNotFound" | "cs2NotFound" | "configUnreadable" | "configUnwritable" | "unknown";
}

export type ProductItemId =
  | "ak47" | "m4a4" | "m4a1s" | "galil" | "famas" | "sg553" | "aug" | "ssg08" | "awp"
  | "scar20" | "g3sg1" | "mac10" | "mp9" | "mp7" | "mp5sd" | "ump45" | "p90" | "bizon"
  | "nova" | "sawedoff" | "mag7" | "xm1014" | "m249" | "negev" | "glock" | "usp" | "p2000"
  | "p250" | "dual" | "tec9" | "cz75" | "fiveseven" | "deagle" | "r8" | "kevlar"
  | "kevlar_helmet" | "defuse_kit" | "zeus" | "smoke" | "flash" | "he" | "molotov"
  | "incendiary" | "decoy";

export interface ProductItemView {
  item: ProductItemId;
  quantity: number;
}

export type UnknownReason =
  | "notObserved"
  | "coldStart"
  | "sequenceGap"
  | "refundOrTransfer"
  | "notApplicable"
  | "unsupported";

export type AvailableValue<T> =
  | { status: "known"; value: T }
  | { status: "unknown"; reason: UnknownReason };

export interface MoneyRange {
  min: number;
  max: number;
}

export type ProtectedCapability = "rifleArmor" | "rifleArmorUtility";

export interface SpendConsequence {
  /** Current additional-spend threshold; this is not an observed transaction. */
  thresholdAdditionalSpend: number;
  before: ProtectedCapability;
  after: ProtectedCapability | "none";
}

export interface SpendingView {
  currentMoney: AvailableValue<number>;
  /** Additional spend that still fits the selected future-affordability boundary at the latest receipt. */
  remainingSpend: AvailableValue<number>;
  /** Incremental price of the current `purchases` list. */
  plannedBundleSpend: AvailableValue<number>;
  /** Deliberately UNKNOWN until a safe round-start purchase ledger exists. */
  spentThisRound: AvailableValue<number>;
  lossNextMoney: AvailableValue<MoneyRange>;
  protectedCapability?: ProtectedCapability;
  overBy?: number;
  nextSpendConsequence?: SpendConsequence;
}

export type PrimaryDisposition = "present" | "notPlanned" | "unknown";

export interface LoadoutView {
  finalConfiguration: readonly ProductItemView[];
  purchases: readonly ProductItemView[];
  primaryDisposition: PrimaryDisposition;
}

export type ProductStatus = "waiting" | "ready" | "insufficient" | "unsupported";

export interface ProductView {
  visible: boolean;
  status: ProductStatus;
  phase: "menu" | "freezetime" | "live" | "over" | "unknown";
  mapName?: string;
  side?: "CT" | "T";
  roundNumber?: number;
  automaticMode?: PlayerVisibleMode;
  automaticModes?: readonly PlayerVisibleMode[];
  automaticIsMultimodal?: boolean;
  lockedMode?: LockableMode;
  loadout: LoadoutView;
  spending: SpendingView;
  updatedAt?: string;
}

export type ShortcutRegistrationStatus = "registered" | "conflict" | "invalid" | "unavailable";

export interface ShortcutDiagnostic {
  action: ShortcutAction;
  accelerator: string;
  status: ShortcutRegistrationStatus;
}

export type DiagnosticCode =
  | "receiverListening"
  | "gsiReady"
  | "gsiMissing"
  | "gsiNeedsRepair"
  | "payloadReceived"
  | "shortcutConflict"
  | "windowsValidationRequired";

export interface DiagnosticEntry {
  id: string;
  level: "ok" | "info" | "warning" | "error";
  code: DiagnosticCode;
  detail?: string;
  at?: string;
}

export interface DiagnosticsState {
  appVersion: string;
  platform: string;
  architecture: string;
  shortcutRegistrations: readonly ShortcutDiagnostic[];
  entries: readonly DiagnosticEntry[];
  /** First receipt in a verified freeze-time window. This is a diagnostic
   * candidate, not a validated round-start balance or spend ledger. */
  roundStartMoneyAnchor: RoundStartMoneyAnchor;
}

export type RoundStartMoneyAnchor =
  | { status: "notObserved" }
  | { status: "candidate"; mapName: string; roundNumber: number; side: "CT" | "T"; money: number; receiptSeq: number; receivedAt: string };

export interface DesktopState {
  revision: number;
  settings: DesktopSettings;
  connection: ConnectionState;
  gsiSetup: GsiSetupState;
  product: ProductView;
  diagnostics: DiagnosticsState;
}

/** High-frequency game-state channel. It intentionally excludes settings,
 * tray/configuration state, and the dashboard's static DOM. */
export interface DesktopRuntimeState {
  revision: number;
  connection: ConnectionState;
  product: ProductView;
  roundStartMoneyAnchor: RoundStartMoneyAnchor;
}

export interface DesktopActionResult {
  ok: boolean;
  errorCode?: "notAvailable" | "permissionDenied" | "invalidInput" | "conflict" | "unknown";
  state?: DesktopState;
}

export interface DesktopBridge {
  getState(): Promise<DesktopState>;
  subscribeState(listener: (state: DesktopState) => void): () => void;
  subscribeRuntimeState(listener: (state: DesktopRuntimeState) => void): () => void;
  updateSettings(patch: DesktopSettingsPatch): Promise<DesktopActionResult>;
  setIntentLock(mode: LockableMode | null): Promise<DesktopActionResult>;
  installGsiConfig(): Promise<DesktopActionResult>;
  repairGsiConfig(): Promise<DesktopActionResult>;
  refreshGsiSetup(): Promise<DesktopActionResult>;
  chooseCs2Path(): Promise<DesktopActionResult>;
  copyDiagnostics(): Promise<DesktopActionResult>;
}

declare global {
  interface Window {
    roundSense?: DesktopBridge;
  }
}
