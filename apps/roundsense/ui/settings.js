(() => {
  "use strict";
  const form = document.getElementById("settings-form");
  const modes = {
    FULL: "全起",
    FORCE: "强起",
    LIGHT: "半起",
    PRESERVE: "ECO",
    AWP_PATH: "AWP",
  };
  const reasons = {
    awaiting: "等待游戏数据",
    stale: "GSI 数据已过期，HUD 已隐藏",
    "not-playing": "当前不在正式游戏中，HUD 已隐藏",
    "not-self": "无法确认是本玩家数据，HUD 已隐藏",
    "not-competitive": "仅支持竞技模式，HUD 已隐藏",
    "outside-freezetime": "回合进行或阶段未知，HUD 已隐藏",
  };
  let initialized = false;
  function labels() {
    document.getElementById("scale-label").textContent =
      Math.round(Number(form.elements.scale.value) * 100) + "%";
    document.getElementById("opacity-label").textContent =
      Math.round(Number(form.elements.opacity.value) * 100) + "%";
  }
  form.addEventListener("input", labels);
  window.addEventListener("roundsense-snapshot", (event) => {
    const snapshot = event.detail;
    document.getElementById("connection-status").textContent = snapshot.visible
      ? `${snapshot.side ?? ""} · 第 ${snapshot.round ?? "?"} 回合 · 冻结时间 · HUD 可见`
      : reasons[snapshot.hiddenReason] || "暂无输出";
    document.getElementById("empty-preview").hidden = snapshot.visible;
    document.getElementById("assumption").textContent =
      snapshot.cards[0]?.assumption || "";
    const list = document.getElementById("options");
    list.replaceChildren();
    snapshot.options.forEach((option) => {
      const li = document.createElement("li");
      li.textContent = `${option.selected ? "●" : "○"} ${modes[option.mode]} · $${option.spend.toLocaleString("en-US")}`;
      list.append(li);
    });
    if (!initialized) {
      for (const [key, value] of Object.entries(snapshot.settings))
        form.elements[key].value = value;
      initialized = true;
      labels();
    }
  });
  window.addEventListener("roundsense-offline", () => {
    document.getElementById("connection-status").textContent =
      "本地服务已断开，HUD 已隐藏";
    document.getElementById("empty-preview").hidden = false;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.scale = Number(data.scale);
    data.opacity = Number(data.opacity);
    const status = document.getElementById("save-result");
    try {
      const response = await fetch("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("save failed");
      status.textContent = "已保存";
    } catch {
      status.textContent = "保存失败，请检查本地服务。";
    }
  });
})();
