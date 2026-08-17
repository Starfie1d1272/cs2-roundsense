import type {
  AvailableValue,
  DesktopState,
  Locale,
  PlayerVisibleMode,
  ProductItemView,
  ProtectedCapability,
} from "../shared/contracts.js";
import { itemLabel, translate } from "../shared/i18n.js";

function esc(value: string | number | undefined): string {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function moneyValue(value: AvailableValue<number>, locale: Locale): string {
  return value.status === "known" ? money(value.value) : translate(locale, "product.unknown");
}

function modeLabel(locale: Locale, mode: PlayerVisibleMode): string {
  return translate(locale, `mode.${mode}`);
}

function capabilityLabel(locale: Locale, capability: ProtectedCapability | "none"): string {
  return translate(locale, `capability.${capability}`);
}

function itemChips(locale: Locale, items: readonly ProductItemView[]): string {
  return items.map((entry) => `<span class="item-chip">${esc(itemLabel(locale, entry.item))}${entry.quantity > 1 ? `<b>×${entry.quantity}</b>` : ""}</span>`).join("");
}

export function renderOverlay(state: DesktopState, preview = false): string {
  const { product, settings } = state;
  const locale = settings.locale;
  if (!product.visible || product.phase !== "freezetime") {
    return preview
      ? `<section class="round-overlay round-overlay--waiting"><p>${translate(locale, "product.waiting")}</p></section>`
      : "";
  }
  if (product.status !== "ready") {
    return `<section class="round-overlay round-overlay--waiting" aria-label="${translate(locale, "aria.overlayPreview")}"><p>${translate(locale, `product.${product.status}`)}</p></section>`;
  }
  const modes = product.automaticModes ?? (product.automaticMode ? [product.automaticMode] : []);
  const activeMode = product.lockedMode ?? product.automaticMode;
  const modeText = activeMode ? modeLabel(locale, activeMode) : modes.map((mode) => modeLabel(locale, mode)).join(" / ");
  const suggestion = product.lockedMode
    ? translate(locale, "product.locked")
    : modes.length > 1
      ? translate(locale, "product.multimodal", { modes: modes.map((mode) => modeLabel(locale, mode)).join(" / ") })
      : translate(locale, "product.suggestion");
  const remaining = product.spending.remainingSpend;
  const finalItems = itemChips(locale, product.loadout.finalConfiguration);
  const purchaseItems = itemChips(locale, product.loadout.purchases);
  const primaryNote = product.loadout.primaryDisposition === "notPlanned"
    ? `<span class="item-note">${translate(locale, "product.noPrimary")}</span>`
    : product.loadout.primaryDisposition === "unknown"
      ? `<span class="item-note item-note--warning">${translate(locale, "product.primaryUnknown")}</span>`
      : "";
  const consequence = product.spending.nextSpendConsequence;
  const hasDefaultPlan = Boolean(finalItems || purchaseItems || primaryNote);
  const isEco = activeMode === "eco";
  const isSemi = activeMode === "semi";
  const isForce = activeMode === "force";
  const guardrail = isSemi
    ? `<div class="guardrail-call"><span>${translate(locale, "product.remainingSpend")}</span><strong>${moneyValue(remaining, locale)}</strong>${product.spending.protectedCapability ? `<em>${capabilityLabel(locale, product.spending.protectedCapability)}</em>` : ""}</div>`
    : "";
  const strategyCall = isEco
    ? `<p class="strategy-call">${translate(locale, "product.ecoGuidance")}</p>`
    : isForce
      ? `<p class="strategy-call">${translate(locale, "product.forceGuidance")}</p>`
      : "";
  const consequenceCall = isSemi && consequence
    ? `<div class="consequence consequence--guardrail"><p>${translate(locale, "product.consequenceTitle", { amount: money(consequence.thresholdAdditionalSpend) })}</p><strong>${translate(locale, "product.consequence", { before: capabilityLabel(locale, consequence.before), after: capabilityLabel(locale, consequence.after) })}</strong></div>`
    : "";
  const defaultLoadout = hasDefaultPlan
    ? `<div class="loadout-column"><p>${translate(locale, "product.defaultConfiguration")}</p><div class="item-list">${finalItems || primaryNote || `<span class="item-note">${translate(locale, "product.unknown")}</span>`}</div></div>
      <div class="loadout-column"><p>${translate(locale, "product.defaultPurchases")}</p><div class="item-list">${purchaseItems || `<span class="item-note">${translate(locale, "product.noPurchases")}</span>`}</div>${primaryNote}</div>`
    : `<div class="default-unavailable">${translate(locale, "product.defaultPlanUnavailable")}</div>`;
  const details = !activeMode
    ? ""
    : isEco
      ? `<div class="intent-detail">${translate(locale, "product.ecoDetail")}</div>`
      : `${defaultLoadout}`;

  return `<section class="round-overlay ${preview ? "round-overlay--preview" : ""} mode-${settings.displayMode}" aria-label="${translate(locale, "aria.overlayPreview")}">
    <header class="overlay-head">
      <div class="round-id"><span class="side side-${product.side?.toLowerCase()}">${esc(product.side)}</span><span>${translate(locale, "product.sideRound", { side: product.side ?? "–", round: product.roundNumber ?? "–" })}</span></div>
      <span class="phase-mark"><i></i>${translate(locale, "product.freeze")}</span>
    </header>
    <div class="decision-row">
      <div><p class="eyebrow">${suggestion}</p><h2>${esc(modeText || translate(locale, "product.unknown"))}</h2>${strategyCall}</div>
      ${guardrail}
    </div>
    ${consequenceCall}
    ${settings.displayMode === "detailed" ? `<div class="overlay-details">${details}</div>` : ""}
  </section>`;
}
