import { createGsiReceiver, type GsiReceipt } from "@roundsense/gsi-protocol";
import type { PlayerLockedMode, ProtectedNextBuyCapability } from "@roundsense/economy-advisor";
import { tick, type RoundScopedLockedMode } from "@roundsense/roundsense/engine";
import { PolicyStateTracker } from "@roundsense/roundsense/policy-state";
import { toProductView, type ProductPlan, type ProductView as CoreProductView } from "@roundsense/roundsense/product-view";
import type {
  AvailableValue,
  LoadoutView,
  LockableMode,
  PlayerVisibleMode,
  ProductItemId,
  ProductItemView,
  ProductView,
  ProtectedCapability,
  SpendingView,
  UnknownReason,
} from "../shared/contracts.js";

export interface RuntimeUpdate {
  product: ProductView;
  lastReceiptAt: string;
  acceptedPayloads: number;
  rejectedPayloads: number;
  gameBuild?: number;
}

export interface RoundSenseRuntimeOptions {
  token: string;
  port?: number;
  onUpdate: (update: RuntimeUpdate) => void;
  onReject?: (code: number, reason: string) => void;
}

const MODE_TO_INTERNAL: Record<LockableMode, PlayerLockedMode> = {
  eco: "PRESERVE",
  semi: "LIGHT",
  force: "FORCE",
  full: "FULL",
};

const INTERNAL_TO_VISIBLE: Record<PlayerLockedMode, LockableMode> = {
  PRESERVE: "eco",
  LIGHT: "semi",
  FORCE: "force",
  FULL: "full",
};

function unknown<T>(reason: UnknownReason): AvailableValue<T> {
  return { status: "unknown", reason };
}

function emptyLoadout(): LoadoutView {
  return { finalConfiguration: [], purchases: [], primaryDisposition: "unknown" };
}

function emptySpending(): SpendingView {
  return {
    currentMoney: unknown("notObserved"),
    remainingSpend: unknown("notObserved"),
    plannedBundleSpend: unknown("notObserved"),
    spentThisRound: unknown("notObserved"),
    lossNextMoney: unknown("notObserved"),
  };
}

export function idleProduct(phase: ProductView["phase"] = "menu"): ProductView {
  return {
    visible: false,
    status: "waiting",
    phase,
    loadout: emptyLoadout(),
    spending: emptySpending(),
  };
}

function visibleMode(mode: ProductPlan["mode"]): PlayerVisibleMode | undefined {
  return mode === "AWP_PATH" ? undefined : INTERNAL_TO_VISIBLE[mode];
}

function itemList(plan: ProductPlan): LoadoutView {
  const items: ProductItemView[] = [];
  const add = (item: string | null, quantity = 1) => {
    if (!item) return;
    const existing = items.find((candidate) => candidate.item === item);
    if (existing) existing.quantity += quantity;
    else items.push({ item: item as ProductItemId, quantity });
  };
  add(plan.finalInventory.primary);
  add(plan.finalInventory.secondary);
  if (plan.finalInventory.hasHelmet) add("kevlar_helmet");
  else if (plan.finalInventory.armor > 0) add("kevlar");
  if (plan.finalInventory.hasDefuseKit) add("defuse_kit");
  for (const grenade of plan.finalInventory.grenades) add(grenade);
  return {
    finalConfiguration: items,
    purchases: plan.purchases.map((purchase) => ({ item: purchase.item as ProductItemId, quantity: purchase.quantity })),
    primaryDisposition: plan.finalInventory.primary ? "present" : "notPlanned",
  };
}

function capability(value: ProtectedNextBuyCapability): ProtectedCapability {
  return value === "RIFLE_ARMOR_BASIC_UTILITY" ? "rifleArmorUtility" : "rifleArmor";
}

function spending(plan: ProductPlan, currentMoney: number): SpendingView {
  const projectedLoss = plan.lossNoPlant.status === "PROJECTED"
    ? { status: "known" as const, value: plan.lossNoPlant.nextMoney }
    : unknown<{ min: number; max: number }>("unsupported");
  const base: SpendingView = {
    currentMoney: { status: "known", value: currentMoney },
    remainingSpend: unknown("notApplicable"),
    plannedBundleSpend: { status: "known", value: plan.bundleSpend },
    spentThisRound: unknown("refundOrTransfer"),
    lossNextMoney: projectedLoss,
    nextSpendConsequence: plan.boundaryConsequence
      ? {
          thresholdAdditionalSpend: plan.boundaryConsequence.thresholdAdditionalSpend,
          before: capability(plan.boundaryConsequence.before),
          after: plan.boundaryConsequence.after ? capability(plan.boundaryConsequence.after) : "none",
        }
      : undefined,
  };
  if (plan.guardrail.kind === "BOUNDED") {
    const protectedCapability = capability(plan.guardrail.protectedCapability);
    return {
      ...base,
      remainingSpend: { status: "known", value: plan.guardrail.maxAdditionalSpend },
      protectedCapability,
    };
  }
  if (plan.guardrail.kind === "MINIMIZE") {
    return {
      ...base,
      remainingSpend: { status: "known", value: 0 },
      protectedCapability: plan.guardrail.protectedCapability ? capability(plan.guardrail.protectedCapability) : undefined,
    };
  }
  return base;
}

function selectedPlan(view: CoreProductView): ProductPlan | undefined {
  if (view.active.source === "PLAYER_LOCKED") return view.active.status === "SELECTED" ? view.active.plan : undefined;
  return view.active.selection.status === "SELECTED" ? view.active.selection.plan : undefined;
}

function automaticModes(view: CoreProductView): PlayerVisibleMode[] {
  if (view.automatic.status === "SELECTED") {
    const mode = visibleMode(view.automatic.plan.mode);
    return mode ? [mode] : [];
  }
  if (view.automatic.status === "MULTIMODAL") {
    return [...new Set(view.automatic.plans.map((plan) => visibleMode(plan.mode)).filter((mode): mode is PlayerVisibleMode => mode !== undefined))];
  }
  return [];
}

export function toDesktopProduct(view: CoreProductView, updatedAt: string): ProductView {
  const plan = selectedPlan(view);
  const modes = automaticModes(view);
  const lockedMode = view.active.source === "PLAYER_LOCKED" ? INTERNAL_TO_VISIBLE[view.active.mode] : undefined;
  const unavailableReason = view.active.source === "PLAYER_LOCKED" && view.active.status === "UNAVAILABLE"
    ? view.active.reason
    : view.automatic.status === "UNAVAILABLE" ? view.automatic.reason : undefined;
  const status: ProductView["status"] = unavailableReason === "UNSUPPORTED_POLICY_EVIDENCE"
    ? "unsupported"
    : unavailableReason ? "insufficient" : "ready";
  return {
    visible: true,
    status,
    phase: "freezetime",
    mapName: view.round.mapName ?? undefined,
    side: view.round.side,
    roundNumber: view.round.number,
    automaticMode: modes.length === 1 ? modes[0] : undefined,
    automaticModes: modes,
    automaticIsMultimodal: view.automatic.status === "MULTIMODAL",
    lockedMode,
    loadout: plan ? itemList(plan) : emptyLoadout(),
    spending: plan ? spending(plan, view.round.currentMoney) : {
      ...emptySpending(),
      currentMoney: { status: "known", value: view.round.currentMoney },
      spentThisRound: unknown("refundOrTransfer"),
    },
    updatedAt,
  };
}

function roundKey(receipt: GsiReceipt): Omit<RoundScopedLockedMode, "mode"> | null {
  const mapName = receipt.payload.map?.name;
  const roundNumber = receipt.payload.map?.round;
  const side = receipt.payload.player?.team;
  if (!mapName || roundNumber === undefined || (side !== "CT" && side !== "T")) return null;
  return { mapName, roundNumber, side };
}

function sameRound(a: Omit<RoundScopedLockedMode, "mode">, b: Omit<RoundScopedLockedMode, "mode">): boolean {
  return a.mapName === b.mapName && a.roundNumber === b.roundNumber && a.side === b.side;
}

export class RoundSenseRuntime {
  private readonly tracker = new PolicyStateTracker();
  private readonly port: number;
  private receiver: ReturnType<typeof createGsiReceiver> | null = null;
  private currentRound: Omit<RoundScopedLockedMode, "mode"> | null = null;
  private lockedMode: RoundScopedLockedMode | null = null;

  constructor(private readonly options: RoundSenseRuntimeOptions) {
    this.port = options.port ?? 3001;
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get lock(): RoundScopedLockedMode | null {
    return this.lockedMode ? { ...this.lockedMode } : null;
  }

  async start(): Promise<void> {
    if (this.receiver) return;
    const receiver = createGsiReceiver({
      token: this.options.token,
      onPayload: (receipt) => this.observe(receipt),
      onReject: (code, reason) => this.options.onReject?.(code, reason),
    });
    this.receiver = receiver;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        receiver.server.off("listening", onListening);
        this.receiver = null;
        reject(error);
      };
      const onListening = () => {
        receiver.server.off("error", onError);
        resolve();
      };
      receiver.server.once("error", onError);
      receiver.server.once("listening", onListening);
      receiver.server.listen(this.port, "127.0.0.1");
    });
  }

  observe(receipt: GsiReceipt): void {
    const key = roundKey(receipt);
    if (key) {
      if (this.currentRound && !sameRound(this.currentRound, key)) this.lockedMode = null;
      this.currentRound = key;
    }
    const phase = receipt.payload.round?.phase;
    const advice = tick(receipt.payload, { tracker: this.tracker, seq: receipt.seq, lockedMode: this.lockedMode ?? undefined });
    const updatedAt = receipt.receivedAtWallClock;
    const product = advice
      ? toDesktopProduct(toProductView(advice), updatedAt)
      : { ...idleProduct(phase === "live" || phase === "over" ? phase : "unknown"), updatedAt };
    this.options.onUpdate({
      product,
      lastReceiptAt: updatedAt,
      acceptedPayloads: this.receiver?.accepted() ?? receipt.seq + 1,
      rejectedPayloads: this.receiver?.rejected() ?? 0,
      gameBuild: receipt.payload.provider?.version,
    });
  }

  setIntentLock(mode: LockableMode | null): boolean {
    if (mode === null) {
      this.lockedMode = null;
      return true;
    }
    if (!this.currentRound) return false;
    this.lockedMode = { ...this.currentRound, mode: MODE_TO_INTERNAL[mode] };
    return true;
  }

  async stop(): Promise<void> {
    const receiver = this.receiver;
    this.receiver = null;
    if (receiver) await receiver.close();
  }
}
