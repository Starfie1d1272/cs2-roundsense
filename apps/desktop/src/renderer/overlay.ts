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
  const planned = product.spending.plannedBundleSpend;
  const limit = remaining.status === "known" ? remaining.value : undefined;
  const plan = planned.status === "known" ? planned.value : undefined;
  const fill = limit !== undefined && limit > 0 && plan !== undefined ? Math.min(100, Math.round((plan / limit) * 100)) : 0;
  const loss = product.spending.lossNextMoney;
  const lossText = loss.status === "known"
    ? loss.value.min === loss.value.max ? money(loss.value.min) : `${money(loss.value.min)}–${money(loss.value.max)}`
    : translate(locale, "product.unknown");
  const finalItems = itemChips(locale, product.loadout.finalConfiguration);
  const purchaseItems = itemChips(locale, product.loadout.purchases);
  const primaryNote = product.loadout.primaryDisposition === "notPlanned"
    ? `<span class="item-note">${translate(locale, "product.noPrimary")}</span>`
    : product.loadout.primaryDisposition === "unknown"
      ? `<span class="item-note item-note--warning">${translate(locale, "product.primaryUnknown")}</span>`
      : "";
  const consequence = product.spending.nextSpendConsequence;

  return `<section class="round-overlay ${preview ? "round-overlay--preview" : ""} mode-${settings.displayMode}" aria-label="${translate(locale, "aria.overlayPreview")}">
    <header class="overlay-head">
      <div class="round-id"><span class="side side-${product.side?.toLowerCase()}">${esc(product.side)}</span><span>${translate(locale, "product.sideRound", { side: product.side ?? "–", round: product.roundNumber ?? "–" })}</span></div>
      <span class="phase-mark"><i></i>${translate(locale, "product.freeze")}</span>
    </header>
    <div class="decision-row">
      <div><p class="eyebrow">${suggestion}</p><h2>${esc(modeText || translate(locale, "product.unknown"))}</h2></div>
      <div class="guardrail-number"><span>${translate(locale, "product.remainingSpend")}</span><strong>${moneyValue(remaining, locale)}</strong></div>
    </div>
    <div class="spend-track" role="img" aria-label="${translate(locale, "aria.budgetTrack", { planned: plan === undefined ? "–" : money(plan), limit: limit === undefined ? "–" : money(limit) })}">
      <progress class="track-line" max="100" value="${fill}">${fill}%</progress>
      <div class="track-labels"><span>${translate(locale, "product.plannedSpend")} <b>${moneyValue(planned, locale)}</b></span><span>${translate(locale, "product.currentMoney")} <b>${moneyValue(product.spending.currentMoney, locale)}</b></span></div>
    </div>
    <div class="compact-future"><span>${translate(locale, "product.nextLossMoney")}</span><b>${lossText}</b>${product.spending.protectedCapability ? `<em>${capabilityLabel(locale, product.spending.protectedCapability)}</em>` : ""}</div>
    <div class="overlay-details">
      <div class="loadout-column"><p>${translate(locale, "product.finalConfiguration")}</p><div class="item-list">${finalItems || primaryNote || `<span class="item-note">${translate(locale, "product.unknown")}</span>`}</div></div>
      <div class="loadout-column"><p>${translate(locale, "product.purchases")}</p><div class="item-list">${purchaseItems || `<span class="item-note">${translate(locale, "product.noPurchases")}</span>`}</div>${primaryNote}</div>
      <div class="fact-row"><span>${translate(locale, "product.spent")}</span><b>${translate(locale, "product.unknown")}</b><small>${translate(locale, "product.spentUnknownHelp")}</small></div>
      ${consequence ? `<div class="consequence"><p>${translate(locale, "product.consequenceTitle", { amount: money(consequence.thresholdAdditionalSpend) })}</p><strong>${translate(locale, "product.consequence", { before: capabilityLabel(locale, consequence.before), after: capabilityLabel(locale, consequence.after) })}</strong></div>` : ""}
    </div>
  </section>`;
}
