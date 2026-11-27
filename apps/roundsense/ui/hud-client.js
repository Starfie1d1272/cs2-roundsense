/* Same renderer for the live transparent window and the settings preview. */
(() => {
  'use strict';
  const hud = document.getElementById('hud');
  const preview = document.body.classList.contains('settings-page');
  const invoke = !preview && window.__TAURI__?.core?.invoke;
  let latest = null;
  let lastMessage = -Infinity;
  let nativePending = false;

  const ITEM_NAMES = {
    ak47: 'AK',
    m4a4: 'M4A4',
    m4a1s: 'M4A1-S',
    galil: 'Galil',
    famas: 'FAMAS',
    aug: 'AUG',
    sg553: 'SG553',
    awp: 'AWP',
    ssg08: '鸟狙',
    scar20: 'SCAR',
    g3sg1: 'G3SG1',
    mac10: 'MAC-10',
    mp9: 'MP9',
    mp7: 'MP7',
    mp5sd: 'MP5',
    ump45: 'UMP',
    p90: 'P90',
    bizon: '野牛',
    nova: 'Nova',
    xm1014: 'XM1014',
    mag7: 'MAG7',
    sawedoff: '短喷',
    m249: 'M249',
    negev: 'Negev',
    glock: 'Glock',
    usp: 'USP',
    p2000: 'P2000',
    p250: 'P250',
    dual: '双枪',
    tec9: 'Tec9',
    cz75: 'CZ',
    fiveseven: 'FN57',
    deagle: '沙鹰',
    r8: 'R8',
    zeus: '电击枪',
    kevlar: '半甲',
    kevlar_helmet: '甲头',
    defuse_kit: '钳',
    smoke: '烟',
    flash: '闪',
    he: '雷',
    molotov: '火',
    incendiary: '火',
    decoy: '诱饵',
  };
  const MODE_NAMES = {
    FULL: '全起',
    FORCE: '强起',
    LIGHT: '半起',
    PRESERVE: 'ECO',
    AWP_PATH: '起 AWP',
  };
  const CAPABILITY_NAMES = {
    RIFLE_ARMOR_BASIC_UTILITY: '长枪甲道具',
    RIFLE_ARMOR: '长枪甲',
    INSUFFICIENT: '长枪钱不足',
    NOT_EVALUATED: '能力未评估',
  };

  const money = (value) => (value === null ? '—' : '$' + Number(value).toLocaleString('en-US'));
  const formatPurchases = (items) =>
    items
      .map((p) => {
        const name = p.helmetUpgradeOnly ? '头盔' : (ITEM_NAMES[p.item] ?? p.item);
        return name + (p.quantity > 1 ? `×${p.quantity}` : '');
      })
      .join(' · ') || '无需购买';

  function hide() {
    hud.hidden = true;
    latest = null;
  }

  function render(snapshot) {
    if (snapshot.version !== 2 || typeof snapshot.visible !== 'boolean' || !snapshot.settings)
      throw new Error('Invalid HUD snapshot');
    lastMessage = performance.now();
    latest = snapshot;
    hud.hidden = !snapshot.visible;
    document.documentElement.style.setProperty('--hud-opacity', snapshot.settings.opacity);
    document.documentElement.style.setProperty('--hud-scale', snapshot.settings.scale);
    const contentKey = JSON.stringify({
      visible: snapshot.visible,
      side: snapshot.side,
      money: snapshot.money,
      policyStatus: snapshot.policyStatus,
      options: snapshot.options,
    });
    if (hud.dataset.content !== contentKey) {
      hud.dataset.content = contentKey;
      hud.replaceChildren();
      if (snapshot.visible) {
        const heading = document.createElement('div');
        heading.className = 'hud-heading';
        heading.textContent =
          snapshot.money === null ? '本局可选方案' : `本局可选方案 · ${money(snapshot.money)}`;
        hud.append(heading);
        if (snapshot.options.length > 0) {
          for (const option of snapshot.options) {
            const row = document.createElement('section');
            row.className = 'hud-option';
            const main = document.createElement('div');
            main.className = 'hud-main';
            const title = document.createElement('strong');
            title.textContent = MODE_NAMES[option.mode] ?? option.mode;
            main.append(title);
            const qualifier = document.createElement('small');
            qualifier.textContent = option.isDefault ? '优先' : '';
            main.append(qualifier);
            const hasBound = option.maxSpendNow !== null;
            const budget = document.createElement('span');
            budget.className = 'hud-budget';
            budget.textContent = hasBound
              ? `投入 ≤ ${money(option.maxSpendNow)}`
              : `花费 ${money(option.spend)}`;
            main.append(budget);
            const next = document.createElement('span');
            next.className = 'hud-next';
            next.textContent =
              option.lossNextMoney === null ? '败后 —' : '败后 ≈' + money(option.lossNextMoney);
            main.append(next);
            const details = document.createElement('div');
            details.className = 'hud-row';
            const purchase = document.createElement('span');
            purchase.className = 'purchase';
            purchase.textContent =
              formatPurchases(option.purchases) + (hasBound ? ' · ' + money(option.spend) : '');
            details.append(purchase);
            const capability = document.createElement('span');
            capability.className = 'hud-capability';
            capability.textContent =
              CAPABILITY_NAMES[option.futureCapability] ?? option.futureCapability;
            details.append(capability);
            row.append(main, details);
            hud.append(row);
          }
          if (snapshot.options.some((option) => option.lossNextMoney !== null)) {
            const footnote = document.createElement('div');
            footnote.className = 'hud-footnote';
            footnote.textContent =
              snapshot.side === 'T'
                ? '败后：未下包 · 无额外收入 · 按重买'
                : '败后：无额外收入 · 按重新购买计算';
            hud.append(footnote);
          }
        } else {
          const row = document.createElement('section');
          row.className = 'hud-option';
          const main = document.createElement('div');
          main.className = 'hud-main';
          const title = document.createElement('strong');
          title.textContent =
            snapshot.policyStatus === 'UNSUPPORTED_POLICY_EVIDENCE' ? '手枪局' : '信息不足';
          main.append(title);
          const details = document.createElement('div');
          details.className = 'hud-row';
          const purchase = document.createElement('span');
          purchase.className = 'purchase';
          purchase.textContent =
            snapshot.policyStatus === 'UNSUPPORTED_POLICY_EVIDENCE'
              ? '暂不提供购买建议'
              : '等待完整状态';
          details.append(purchase);
          row.append(main, details);
          hud.append(row);
        }
      }
    }
    window.dispatchEvent(new CustomEvent('roundsense-snapshot', { detail: snapshot }));
  }

  async function syncNative() {
    if (!invoke || nativePending) return;
    nativePending = true;
    const valid = latest && latest.visible && performance.now() - lastMessage < 2000;
    const rect = hud.getBoundingClientRect();
    try {
      await invoke('set_overlay_state', {
        request: {
          visible: Boolean(valid),
          width: Math.ceil(rect.width / (latest?.settings.scale ?? 1) || 248),
          height: Math.ceil(rect.height / (latest?.settings.scale ?? 1) || 80),
          scale: latest?.settings.scale ?? 1,
          position: latest?.settings.position ?? 'below-radar',
        },
      });
    } catch {
      hud.hidden = true;
    } finally {
      nativePending = false;
    }
  }

  const source = new EventSource('/events');
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
    window.dispatchEvent(new CustomEvent('roundsense-offline'));
  };
  setInterval(() => {
    if (performance.now() - lastMessage >= 2000) hide();
    void syncNative();
  }, 250);
  // Native host also has its own lease: a frozen WebView cannot leave an old
  // recommendation over CS2, even if these timers stop executing.
})();
