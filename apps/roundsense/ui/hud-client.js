/* Same renderer for the live transparent window and the settings preview. */
(() => {
  "use strict";
  const hud = document.getElementById("hud");
  const preview = document.body.classList.contains("settings-page");
  const invoke = !preview && window.__TAURI__?.core?.invoke;
  let latest = null;
  let lastMessage = -Infinity;
  let nativePending = false;
  const money = (value) =>
    value === null ? "—" : "$" + Number(value).toLocaleString("en-US");
  const text = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };
  function hide() {
    hud.hidden = true;
    latest = null;
  }
  function render(snapshot) {
    if (
      snapshot.version !== 1 ||
      typeof snapshot.visible !== "boolean" ||
      !snapshot.settings
    )
      throw new Error("Invalid HUD snapshot");
    lastMessage = performance.now();
    latest = snapshot;
    const cards = snapshot.visible ? snapshot.cards : [];
    hud.hidden = !cards.length;
    document.documentElement.style.setProperty(
      "--hud-opacity",
      snapshot.settings.opacity,
    );
    document.documentElement.style.setProperty(
      "--hud-scale",
      snapshot.settings.scale,
    );
    const contentKey = JSON.stringify(cards);
    if (hud.dataset.content !== contentKey) {
      hud.dataset.content = contentKey;
      hud.replaceChildren();
      const heading = document.createElement("div");
      heading.className = "hud-heading";
      heading.textContent = "本局可选方案";
      hud.append(heading);
      for (const card of cards) {
        const row = document.createElement("section");
        row.className = "hud-option";
        row.title = card.assumption + " 补买：" + card.purchases;
        const main = document.createElement("div");
        main.className = "hud-main";
        const title = document.createElement("strong");
        title.textContent = card.title;
        main.append(title);
        const qualifier = document.createElement("small");
        qualifier.textContent = card.qualifier === "优先" ? "优先" : "";
        main.append(qualifier);
        const budget = document.createElement("span");
        budget.className = "hud-budget";
        budget.textContent =
          card.budget === null
            ? "—"
            : card.budgetLabel + " " + money(card.budget);
        main.append(budget);
        const next = document.createElement("span");
        next.className = "hud-next";
        next.textContent =
          card.nextMoney === null ? "败后 —" : "败后 ≈" + money(card.nextMoney);
        main.append(next);
        const details = document.createElement("div");
        details.className = "hud-row";
        const purchase = document.createElement("span");
        purchase.className = "purchase";
        purchase.textContent =
          card.purchases +
          (card.spend === null || card.budgetLabel === "花费"
            ? ""
            : " · " + money(card.spend));
        details.append(purchase);
        const capability = document.createElement("span");
        capability.className = "hud-capability";
        capability.textContent = card.capability;
        details.append(capability);
        row.append(main, details);
        hud.append(row);
      }
      if (cards.some((card) => card.nextMoney !== null)) {
        const footnote = document.createElement("div");
        footnote.className = "hud-footnote";
        footnote.textContent = cards.some((card) =>
          card.assumption.startsWith("T 未下包"),
        )
          ? "败后：未下包 · 无额外收入 · 按重买"
          : "败后：无额外收入 · 按重新购买计算";
        hud.append(footnote);
      }
    }
    window.dispatchEvent(
      new CustomEvent("roundsense-snapshot", { detail: snapshot }),
    );
  }
  async function syncNative() {
    if (!invoke || nativePending) return;
    nativePending = true;
    const valid =
      latest && latest.visible && performance.now() - lastMessage < 2000;
    const rect = hud.getBoundingClientRect();
    try {
      await invoke("set_overlay_state", {
        request: {
          visible: Boolean(valid),
          width: Math.ceil(rect.width / (latest?.settings.scale ?? 1) || 248),
          height: Math.ceil(rect.height / (latest?.settings.scale ?? 1) || 80),
          scale: latest?.settings.scale ?? 1,
          position: latest?.settings.position ?? "below-radar",
        },
      });
    } catch {
      hud.hidden = true;
    } finally {
      nativePending = false;
    }
  }
  const source = new EventSource("/events");
  source.onmessage = (event) => {
    try {
      render(JSON.parse(event.data));
      void syncNative();
    } catch {
      hide();
      void syncNative();
    }
  };
  source.onerror = () => {
    hide();
    void syncNative();
    window.dispatchEvent(new CustomEvent("roundsense-offline"));
  };
  setInterval(() => {
    if (performance.now() - lastMessage >= 2000) hide();
    void syncNative();
  }, 250);
  // Native host also has its own lease: a frozen WebView cannot leave an old
  // recommendation over CS2, even if these timers stop executing.
})();
