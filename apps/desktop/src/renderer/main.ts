import "./styles.css";
import {
  LOCKABLE_MODES,
  OVERLAY_POSITIONS,
  SHORTCUT_ACTIONS,
  type DesktopActionResult,
  type DesktopBridge,
  type DesktopSettingsPatch,
  type DesktopState,
  type DesktopRuntimeState,
  type LockableMode,
  type Locale,
} from "../shared/contracts.js";
import { translate } from "../shared/i18n.js";
import { createDemoBridge } from "./demo-state.js";
import { renderOverlay } from "./overlay.js";

const root = document.querySelector<HTMLDivElement>("#app") as HTMLDivElement;
if (!root) throw new Error("missing app root");

const params = new URLSearchParams(location.search);
const view = params.get("view") === "overlay" ? "overlay" : "dashboard";
const isDemo = !window.roundSense || params.get("demo") === "1";
const bridge: DesktopBridge = window.roundSense ?? createDemoBridge();
let state = await bridge.getState();
let toast = isDemo ? translate(state.settings.locale, "action.demo") : "";

function esc(value: string | number | undefined): string {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}

function t(key: Parameters<typeof translate>[1], values: Record<string, string | number> = {}): string {
  return translate(state.settings.locale, key, values);
}

function modeName(mode: LockableMode): string {
  return t(`mode.${mode}`);
}

function setupCard(): string {
  const setup = state.gsiSetup;
  const action = setup.canInstall ? "install" : setup.canRepair ? "repair" : null;
  return `<section class="panel setup-panel" id="setup">
    <div class="panel-title"><div><p class="eyebrow">${t("setup.title")}</p><h3>${t(`setup.${setup.status}`)}</h3></div><span class="status-dot status-${setup.status}"></span></div>
    <p class="muted">${t("setup.description")}</p>
    ${setup.configPath ? `<code class="path-line" title="${esc(setup.configPath)}">${esc(setup.configPath)}</code>` : ""}
    <div class="button-row">
      ${action ? `<button class="button button-primary" data-action="${action}-gsi">${t(`setup.${action}`)}</button>` : ""}
      <button class="button" data-action="refresh-gsi">${t("setup.refresh")}</button>
      <button class="button button-quiet" data-action="choose-cs2">${t("setup.choosePath")}</button>
    </div>
    <small class="safety-note">${t("setup.safeNote")}</small>
  </section>`;
}

function connectionCard(): string {
  const connection = state.connection;
  return `<section class="connection-card" aria-label="${t("aria.connectionStatus", { status: t(`connection.${connection.status}`) })}">
    <div class="connection-top"><span class="connection-pulse status-${connection.status}"></span><div><p>${t("connection.title")}</p><strong>${t(`connection.${connection.status}`)}</strong></div></div>
    <dl><div><dt>${t("connection.endpoint")}</dt><dd>${esc(connection.endpoint)}</dd></div><div><dt>${t("connection.payloads")}</dt><dd>${connection.acceptedPayloads}</dd></div><div><dt>${t("connection.rejected")}</dt><dd>${connection.rejectedPayloads}</dd></div></dl>
  </section>`;
}

function roundStartAnchor(): string {
  const anchor = state.diagnostics.roundStartMoneyAnchor;
  if (anchor.status === "notObserved") return `<span>${t("diagnostics.roundStartAnchorWaiting")}</span>`;
  return `<span>${t("diagnostics.roundStartAnchorCandidate", { round: anchor.roundNumber, money: `$${anchor.money.toLocaleString("en-US")}`, seq: anchor.receiptSeq })}</span>`;
}

function overlaySettings(): string {
  return `<section class="panel" id="overlay-settings">
    <div class="panel-title"><div><p class="eyebrow">OVERLAY</p><h3>${t("overlay.settingsTitle")}</h3></div><label class="switch"><input type="checkbox" data-setting="overlayEnabled" ${state.settings.overlayEnabled ? "checked" : ""}><span></span></label></div>
    <p class="muted">${t("overlay.enabledHelp")}</p>
    <div class="settings-block"><label>${t("overlay.mode")}</label><div class="segmented" role="group" aria-label="${t("aria.modeGroup")}">
      ${(["compact", "detailed"] as const).map((mode) => `<button data-display-mode="${mode}" class="${state.settings.displayMode === mode ? "is-active" : ""}">${t(`overlay.${mode}`)}</button>`).join("")}
    </div></div>
    <div class="settings-block"><label>${t("overlay.position")}</label><div class="position-grid" role="group" aria-label="${t("aria.positionGroup")}">
      ${OVERLAY_POSITIONS.map((position) => `<button data-position="${position}" class="${state.settings.overlayPosition === position ? "is-active" : ""}" title="${t(`position.${position}`)}"><span></span></button>`).join("")}
    </div></div>
    <div class="settings-block scale-control"><label for="overlay-scale">${t("overlay.scale")} <b>${state.settings.overlayScale}%</b></label><input id="overlay-scale" type="range" min="75" max="140" step="5" value="${state.settings.overlayScale}"></div>
  </section>`;
}

function intentCard(): string {
  return `<section class="panel" id="intent"><div class="panel-title"><div><p class="eyebrow">GUARDRAIL</p><h3>${t("intent.title")}</h3></div></div><p class="muted">${t("intent.description")}</p>
    <div class="intent-row" role="group" aria-label="${t("aria.intentGroup")}">${LOCKABLE_MODES.map((mode) => `<button class="intent-button ${state.product.lockedMode === mode ? "is-locked" : ""}" data-lock="${mode}"><span>${modeName(mode)}</span><small>${state.settings.shortcuts[`lock${mode === "semi" ? "Semi" : mode[0]!.toUpperCase() + mode.slice(1)}` as keyof typeof state.settings.shortcuts] ?? ""}</small></button>`).join("")}</div>
    <div class="intent-state"><span>${state.product.lockedMode ? t("intent.locked", { mode: modeName(state.product.lockedMode) }) : t("intent.automatic")}</span>${state.product.lockedMode ? `<button class="text-button" data-action="clear-lock">${t("intent.clear")}</button>` : ""}</div>
  </section>`;
}

function shortcutCard(): string {
  return `<section class="panel wide-panel" id="shortcuts"><div class="panel-title"><div><p class="eyebrow">INPUT</p><h3>${t("shortcut.title")}</h3></div></div><p class="muted">${t("shortcut.description")}</p><div class="shortcut-list">
    ${SHORTCUT_ACTIONS.map((action) => {
      const diagnostic = state.diagnostics.shortcutRegistrations.find((entry) => entry.action === action);
      return `<label><span>${t(`shortcut.${action}`)}</span><input data-shortcut="${action}" value="${esc(state.settings.shortcuts[action])}" aria-label="${t("shortcut.inputLabel", { action: t(`shortcut.${action}`) })}"><em class="shortcut-${diagnostic?.status ?? "unavailable"}">${t(`shortcut.${diagnostic?.status ?? "unavailable"}`)}</em></label>`;
    }).join("")}
    </div><button class="button" data-action="apply-shortcuts">${t("shortcut.apply")}</button></section>`;
}

function diagnosticsCard(): string {
  return `<section class="panel wide-panel" id="diagnostics"><div class="panel-title"><div><p class="eyebrow">SYSTEM</p><h3>${t("diagnostics.title")}</h3></div><button class="button button-quiet" data-action="copy-diagnostics">${t("diagnostics.copy")}</button></div><p class="muted">${t("diagnostics.description")}</p>
    <div class="diagnostic-list">${state.diagnostics.entries.map((entry) => `<div class="diagnostic diagnostic-${entry.level}"><i></i><span>${t(`diagnostics.${entry.code}`)}</span>${entry.detail ? `<code>${esc(entry.detail)}</code>` : ""}</div>`).join("")}</div>
    <p class="runtime-anchor" id="round-start-anchor">${roundStartAnchor()}</p>
    <footer><span>${t("diagnostics.version")} ${esc(state.diagnostics.appVersion)}</span><span>${t("diagnostics.system")} ${esc(state.diagnostics.platform)} · ${esc(state.diagnostics.architecture)}</span></footer>
  </section>`;
}

function dashboard(): string {
  const locale = state.settings.locale;
  return `<div class="app-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">RS</span><div><strong>${t("app.title")}</strong><small>${t("app.alpha")}</small></div></div><nav><a href="#overview">${t("nav.overview")}</a><a href="#overlay-settings">${t("nav.overlay")}</a><a href="#intent">${t("nav.intent")}</a><a href="#shortcuts">${t("nav.shortcuts")}</a><a href="#diagnostics">${t("nav.diagnostics")}</a></nav><div class="local-badge">${t("app.localOnly")}</div></aside>
    <main><header class="topbar"><div><p>${t("app.tagline")}</p><strong id="runtime-map">${state.product.mapName ? esc(state.product.mapName.replace("de_", "").toUpperCase()) : "—"}</strong></div><label class="locale-control"><span>${t("locale.label")}</span><select id="locale"><option value="zh-CN" ${locale === "zh-CN" ? "selected" : ""}>${t("locale.zh")}</option><option value="en" ${locale === "en" ? "selected" : ""}>${t("locale.en")}</option></select></label></header>
      <section class="hero" id="overview"><div class="hero-copy"><p class="eyebrow">${t("overview.kicker")}</p><h1>${t("overview.title")}</h1><p>${t("overview.description")}</p><div id="runtime-connection">${connectionCard()}</div></div><div class="preview-frame"><div class="preview-label"><span>${t("preview.title")}</span><small>${t("preview.live")}</small></div><div id="runtime-preview">${renderOverlay(state, true)}</div></div></section>
      <div class="dashboard-grid">${setupCard()}${overlaySettings()}${intentCard()}${shortcutCard()}${diagnosticsCard()}</div>
    </main>${toast ? `<div class="toast">${esc(toast)}</div>` : ""}</div>`;
}

function render(): void {
  document.documentElement.lang = state.settings.locale;
  document.body.className = view === "overlay" ? `overlay-page mode-${state.settings.displayMode}` : "dashboard-page";
  root.innerHTML = view === "overlay" ? renderOverlay(state) : dashboard();
  if (view === "dashboard") bindDashboard();
}

function renderRuntime(): void {
  if (view === "overlay") {
    render();
    return;
  }
  const connection = document.querySelector<HTMLDivElement>("#runtime-connection");
  if (connection) connection.innerHTML = connectionCard();
  const preview = document.querySelector<HTMLDivElement>("#runtime-preview");
  if (preview) preview.innerHTML = renderOverlay(state, true);
  const map = document.querySelector<HTMLElement>("#runtime-map");
  if (map) map.textContent = state.product.mapName ? state.product.mapName.replace("de_", "").toUpperCase() : "—";
  const anchor = document.querySelector<HTMLParagraphElement>("#round-start-anchor");
  if (anchor) anchor.innerHTML = roundStartAnchor();
}

async function action(promise: Promise<DesktopActionResult>, success = "action.saved"): Promise<void> {
  const result = await promise;
  if (result.state) state = result.state;
  toast = t(result.ok ? success as "action.saved" : "action.failed");
  render();
  setTimeout(() => { toast = ""; render(); }, 1800);
}

function bindDashboard(): void {
  document.querySelector<HTMLSelectElement>("#locale")?.addEventListener("change", (event) => {
    void action(bridge.updateSettings({ locale: (event.currentTarget as HTMLSelectElement).value as Locale }));
  });
  document.querySelector<HTMLInputElement>('[data-setting="overlayEnabled"]')?.addEventListener("change", (event) => {
    void action(bridge.updateSettings({ overlayEnabled: (event.currentTarget as HTMLInputElement).checked }));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-display-mode]").forEach((button) => button.addEventListener("click", () => {
    void action(bridge.updateSettings({ displayMode: button.dataset.displayMode as "compact" | "detailed" }));
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-position]").forEach((button) => button.addEventListener("click", () => {
    void action(bridge.updateSettings({ overlayPosition: button.dataset.position as DesktopState["settings"]["overlayPosition"] }));
  }));
  document.querySelector<HTMLInputElement>("#overlay-scale")?.addEventListener("change", (event) => {
    void action(bridge.updateSettings({ overlayScale: Number((event.currentTarget as HTMLInputElement).value) }));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lock]").forEach((button) => button.addEventListener("click", () => {
    void action(bridge.setIntentLock(button.dataset.lock as LockableMode));
  }));
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => element.addEventListener("click", () => {
    const name = element.dataset.action;
    if (name === "clear-lock") void action(bridge.setIntentLock(null));
    if (name === "install-gsi") void action(bridge.installGsiConfig());
    if (name === "repair-gsi") void action(bridge.repairGsiConfig());
    if (name === "refresh-gsi") void action(bridge.refreshGsiSetup());
    if (name === "choose-cs2") void action(bridge.chooseCs2Path());
    if (name === "copy-diagnostics") void action(bridge.copyDiagnostics(), "diagnostics.copied");
    if (name === "apply-shortcuts") {
      const shortcuts: Record<string, string> = {};
      document.querySelectorAll<HTMLInputElement>("[data-shortcut]").forEach((input) => { shortcuts[input.dataset.shortcut!] = input.value; });
      void action(bridge.updateSettings({ shortcuts } as DesktopSettingsPatch));
    }
  }));
}

bridge.subscribeState((next) => { state = next; render(); });
bridge.subscribeRuntimeState((next: DesktopRuntimeState) => {
  state.revision = next.revision;
  state.connection = next.connection;
  state.product = next.product;
  state.diagnostics.roundStartMoneyAnchor = next.roundStartMoneyAnchor;
  renderRuntime();
});
render();
