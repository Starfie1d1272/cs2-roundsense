/* Settings & GSI onboarding controller: offline preview + instant auto-save + real GSI API. */
(() => {
  'use strict';

  const DEFAULT_SETTINGS = {
    awpPriority: 'NEUTRAL',
    position: 'below-radar',
    scale: 1,
    opacity: 0.84,
  };

  const HIDDEN_REASON_LABELS = {
    awaiting: '等待进入比赛',
    stale: 'GSI 数据超时，已自动隐藏',
    'not-playing': '不在对局中',
    'not-self': '观战模式（已隐藏）',
    'not-competitive': '非竞技模式（已隐藏）',
    'outside-freezetime': '回合进行中（自动隐藏）',
  };

  function makeScenario(partial) {
    return {
      version: 2,
      revision: 0,
      visible: true,
      hiddenReason: null,
      lossIndex: 1,
      roundContext: 'NORMAL',
      policyStatus: 'OK',
      defaultOptionId: null,
      unresolved: [],
      settings: { ...DEFAULT_SETTINGS },
      ...partial,
    };
  }

  const OFFLINE_SCENARIOS = {
    'ct-mid': makeScenario({
      side: 'CT',
      round: 8,
      money: 3450,
      defaultOptionId: 'light',
      options: [
        {
          id: 'force',
          mode: 'FORCE',
          isDefault: false,
          adviceStrength: 'OPTION',
          spendingGuidance: { kind: 'UNBOUNDED' },
          spend: 3450,
          maxSpendNow: null,
          purchases: [
            { item: 'mp9', quantity: 1, helmetUpgradeOnly: false },
            { item: 'kevlar_helmet', quantity: 1, helmetUpgradeOnly: false },
            { item: 'smoke', quantity: 1, helmetUpgradeOnly: false },
            { item: 'flash', quantity: 2, helmetUpgradeOnly: false },
          ],
          lossNextMoney: 1900,
          lossWithPlantNextMoney: null,
          futureCapability: 'INSUFFICIENT',
          conditionalAlternatives: [],
        },
        {
          id: 'light',
          mode: 'LIGHT',
          isDefault: true,
          adviceStrength: 'DEFAULT',
          spendingGuidance: {
            kind: 'PROTECT_NEXT_ROUND',
            protectedCapability: 'RIFLE_ARMOR_BASIC_UTILITY',
          },
          spend: 1150,
          maxSpendNow: 1300,
          purchases: [
            { item: 'kevlar', quantity: 1, helmetUpgradeOnly: false },
            { item: 'smoke', quantity: 1, helmetUpgradeOnly: false },
            { item: 'flash', quantity: 1, helmetUpgradeOnly: false },
          ],
          lossNextMoney: 4200,
          lossWithPlantNextMoney: null,
          futureCapability: 'RIFLE_ARMOR_BASIC_UTILITY',
          conditionalAlternatives: [
            {
              condition: '若队友无钳',
              purchases: [{ item: 'defuse_kit', quantity: 1, helmetUpgradeOnly: false }],
              reason: '补拆弹器',
            },
          ],
        },
        {
          id: 'preserve',
          mode: 'PRESERVE',
          isDefault: false,
          adviceStrength: 'OPTION',
          spendingGuidance: { kind: 'PRESERVE' },
          spend: 0,
          maxSpendNow: null,
          purchases: [],
          lossNextMoney: 5350,
          lossWithPlantNextMoney: null,
          futureCapability: 'RIFLE_ARMOR_BASIC_UTILITY',
          conditionalAlternatives: [],
        },
      ],
    }),
    'retained-rifle': makeScenario({
      side: 'CT',
      round: 10,
      money: 4200,
      lossIndex: 0,
      defaultOptionId: 'full',
      options: [
        {
          id: 'full',
          mode: 'FULL',
          isDefault: true,
          adviceStrength: 'DEFAULT',
          spendingGuidance: { kind: 'UNBOUNDED' },
          spend: 1750,
          maxSpendNow: null,
          purchases: [
            { item: 'kevlar_helmet', quantity: 1, helmetUpgradeOnly: true },
            { item: 'defuse_kit', quantity: 1, helmetUpgradeOnly: false },
            { item: 'smoke', quantity: 1, helmetUpgradeOnly: false },
            { item: 'flash', quantity: 2, helmetUpgradeOnly: false },
            { item: 'he', quantity: 1, helmetUpgradeOnly: false },
          ],
          lossNextMoney: 3850,
          lossWithPlantNextMoney: null,
          futureCapability: 'RIFLE_ARMOR',
          conditionalAlternatives: [],
        },
        {
          id: 'light',
          mode: 'LIGHT',
          isDefault: false,
          adviceStrength: 'OPTION',
          spendingGuidance: {
            kind: 'PROTECT_NEXT_ROUND',
            protectedCapability: 'RIFLE_ARMOR_BASIC_UTILITY',
          },
          spend: 850,
          maxSpendNow: 950,
          purchases: [
            { item: 'kevlar_helmet', quantity: 1, helmetUpgradeOnly: true },
            { item: 'smoke', quantity: 1, helmetUpgradeOnly: false },
            { item: 'flash', quantity: 1, helmetUpgradeOnly: false },
          ],
          lossNextMoney: 4750,
          lossWithPlantNextMoney: null,
          futureCapability: 'RIFLE_ARMOR_BASIC_UTILITY',
          conditionalAlternatives: [],
        },
      ],
    }),
    't-rich': makeScenario({
      side: 'T',
      round: 11,
      money: 8000,
      lossIndex: 2,
      defaultOptionId: 'full',
      options: [
        {
          id: 'awp',
          mode: 'AWP_PATH',
          isDefault: false,
          adviceStrength: 'OPTION',
          spendingGuidance: { kind: 'UNBOUNDED' },
          spend: 6750,
          maxSpendNow: null,
          purchases: [
            { item: 'awp', quantity: 1, helmetUpgradeOnly: false },
            { item: 'kevlar_helmet', quantity: 1, helmetUpgradeOnly: false },
            { item: 'smoke', quantity: 1, helmetUpgradeOnly: false },
            { item: 'flash', quantity: 2, helmetUpgradeOnly: false },
            { item: 'molotov', quantity: 1, helmetUpgradeOnly: false },
          ],
          lossNextMoney: 3650,
          lossWithPlantNextMoney: 4450,
          futureCapability: 'RIFLE_ARMOR',
          conditionalAlternatives: [],
        },
        {
          id: 'full',
          mode: 'FULL',
          isDefault: true,
          adviceStrength: 'DEFAULT',
          spendingGuidance: { kind: 'UNBOUNDED' },
          spend: 4700,
          maxSpendNow: null,
          purchases: [
            { item: 'ak47', quantity: 1, helmetUpgradeOnly: false },
            { item: 'kevlar_helmet', quantity: 1, helmetUpgradeOnly: false },
            { item: 'smoke', quantity: 1, helmetUpgradeOnly: false },
            { item: 'flash', quantity: 2, helmetUpgradeOnly: false },
            { item: 'molotov', quantity: 1, helmetUpgradeOnly: false },
          ],
          lossNextMoney: 5700,
          lossWithPlantNextMoney: 6500,
          futureCapability: 'RIFLE_ARMOR_BASIC_UTILITY',
          conditionalAlternatives: [],
        },
      ],
    }),
    'ct-low': makeScenario({
      side: 'CT',
      round: 5,
      money: 1200,
      lossIndex: 2,
      defaultOptionId: 'preserve',
      options: [
        {
          id: 'force',
          mode: 'FORCE',
          isDefault: false,
          adviceStrength: 'OPTION',
          spendingGuidance: { kind: 'UNBOUNDED' },
          spend: 1150,
          maxSpendNow: null,
          purchases: [
            { item: 'kevlar', quantity: 1, helmetUpgradeOnly: false },
            { item: 'fiveseven', quantity: 1, helmetUpgradeOnly: false },
          ],
          lossNextMoney: 2450,
          lossWithPlantNextMoney: null,
          futureCapability: 'INSUFFICIENT',
          conditionalAlternatives: [],
        },
        {
          id: 'preserve',
          mode: 'PRESERVE',
          isDefault: true,
          adviceStrength: 'DEFAULT',
          spendingGuidance: { kind: 'PRESERVE' },
          spend: 0,
          maxSpendNow: null,
          purchases: [],
          lossNextMoney: 3600,
          lossWithPlantNextMoney: null,
          futureCapability: 'RIFLE_ARMOR',
          conditionalAlternatives: [],
        },
      ],
    }),
    pistol: makeScenario({
      side: 'CT',
      round: 1,
      money: 800,
      lossIndex: 0,
      roundContext: 'PISTOL',
      policyStatus: 'UNSUPPORTED_POLICY_EVIDENCE',
      options: [],
    }),
  };

  // DOM refs
  const stageEl = document.getElementById('cs2-stage');
  const hudAnchor = document.getElementById('hud-anchor');
  const hudPreview = document.getElementById('hud-preview');
  const stageMapLabelEl = document.getElementById('stage-map-label');
  const stageMapLabel = document.getElementById('stage-map-label');
  const stageCash = document.getElementById('stage-cash');
  const stageWeaponImg = document.getElementById('stage-weapon-img');
  const previewSourceBadge = document.getElementById('preview-source-badge');
  const scenarioLiveBtn = document.getElementById('scenario-live-btn');

  const scaleRange = document.getElementById('scale-range');
  const scaleOutput = document.getElementById('scale-output');
  const opacityRange = document.getElementById('opacity-range');
  const opacityOutput = document.getElementById('opacity-output');
  const saveStatus = document.getElementById('save-status');

  const gsiDot = document.getElementById('gsi-dot');
  const gsiStateLabel = document.getElementById('gsi-state-label');
  const gsiSummary = document.getElementById('gsi-summary');
  const gsiOtherFiles = document.getElementById('gsi-other-files');
  const gsiPrimaryBtn = document.getElementById('gsi-primary-btn');
  const gsiRedetectBtn = document.getElementById('gsi-redetect-btn');
  const gsiManualToggle = document.getElementById('gsi-manual-toggle');
  const gsiRestoreBtn = document.getElementById('gsi-restore-btn');
  const gsiManualBox = document.getElementById('gsi-manual-box');
  const manualPathInput = document.getElementById('manual-install-path');
  const manualApplyBtn = document.getElementById('gsi-manual-apply');
  const manualError = document.getElementById('gsi-manual-error');

  const liveDot = document.getElementById('live-dot');
  const liveStateLabel = document.getElementById('live-state-label');

  const diagInstall = document.getElementById('diag-install');
  const diagCfg = document.getElementById('diag-cfg');
  const diagSource = document.getElementById('diag-source');
  const diagLive = document.getElementById('diag-live');

  let currentSettings = { ...DEFAULT_SETTINGS };
  let activeScenario = 'ct-mid';
  let activeBackdrop = 'bright';
  let activeAspect = '4-3';
  let liveSnapshot = null;
  let saveTimer = null;
  let saving = false;
  let pendingSave = false;
  let gsiBusy = false;
  const BACKDROP_URLS = {
    bright: '/assets/preview/bright.webp',
    dark: '/assets/preview/dark.webp',
  };

  function applyBackdrop() {
    stageEl.classList.toggle('map-bright', activeBackdrop === 'bright');
    stageEl.classList.toggle('map-dark', activeBackdrop === 'dark');
    stageEl.classList.toggle('aspect-4-3', activeAspect === '4-3');
    stageEl.classList.toggle('aspect-16-10', activeAspect === '16-10');
    stageEl.classList.toggle('aspect-16-9', activeAspect === '16-9');
    stageEl.style.backgroundImage = 'url("' + BACKDROP_URLS[activeBackdrop] + '")';
    stageEl.classList.add('has-photo');
    if (stageMapLabelEl) {
      stageMapLabelEl.textContent = activeBackdrop === 'bright' ? 'DE_DUST2' : 'DE_ANCIENT';
    }
  }

  function syncSettingsControls() {
    document.querySelectorAll('#pos-seg button').forEach((btn) => {
      const on = btn.dataset.position === currentSettings.position;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('is-active', on);
    });
    document.querySelectorAll('#awp-seg button').forEach((btn) => {
      const on = btn.dataset.awp === currentSettings.awpPriority;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('is-active', on);
    });
    scaleRange.value = String(currentSettings.scale);
    scaleOutput.textContent = Math.round(currentSettings.scale * 100) + '%';
    opacityRange.value = String(currentSettings.opacity);
    opacityOutput.textContent = Math.round(currentSettings.opacity * 100) + '%';
  }

  function renderPreview() {
    hudAnchor.className = 'rs-hud-anchor pos-' + currentSettings.position;
    document.documentElement.style.setProperty('--hud-scale', String(currentSettings.scale));
    document.documentElement.style.setProperty('--hud-opacity', String(currentSettings.opacity));

    const useLive = activeScenario === 'live' && liveSnapshot && liveSnapshot.visible;
    const baseSnap = useLive
      ? liveSnapshot
      : (OFFLINE_SCENARIOS[activeScenario] ?? OFFLINE_SCENARIOS['ct-mid']);
    const snap = { ...baseSnap, settings: { ...currentSettings } };

    window.RoundSenseHud.render(hudPreview, snap, { forceShow: true, skipRootVars: true });

    stageCash.textContent =
      snap.money !== null && snap.money !== undefined
        ? window.RoundSenseHud.formatMoney(snap.money)
        : '$3,450';
    stageWeaponImg.src = snap.side === 'T' ? '/assets/cs2/ak47.svg' : '/assets/cs2/m4a1s.svg';
    previewSourceBadge.textContent = useLive ? '实时对局接入' : '离线示例预览';
    previewSourceBadge.classList.toggle('is-live', Boolean(useLive));
  }

  async function persistSettings() {
    if (saving) {
      pendingSave = true;
      return;
    }
    saving = true;
    pendingSave = false;
    saveStatus.textContent = '保存中…';
    saveStatus.classList.remove('is-error');
    try {
      const res = await fetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentSettings),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      saveStatus.textContent = '已自动保存';
    } catch {
      saveStatus.textContent = '保存失败，请检查本地服务';
      saveStatus.classList.add('is-error');
    } finally {
      saving = false;
      if (pendingSave) void persistSettings();
    }
  }

  function scheduleSave(immediate = false) {
    if (saveTimer) clearTimeout(saveTimer);
    if (immediate) {
      void persistSettings();
    } else {
      saveTimer = setTimeout(() => void persistSettings(), 140);
    }
  }

  function updateSettingsLocal(patch, immediate = false) {
    currentSettings = { ...currentSettings, ...patch };
    syncSettingsControls();
    renderPreview();
    scheduleSave(immediate);
  }

  function renderGsiStatus(status) {
    gsiPrimaryBtn.hidden = true;
    gsiRestoreBtn.hidden = !status.canRestore;
    gsiOtherFiles.hidden = true;
    manualError.hidden = true;

    diagInstall.textContent = status.installPath || '未检测到';
    diagCfg.textContent = status.cfgPath || '—';
    diagSource.textContent = status.installSource || '—';

    if (Array.isArray(status.otherGsiFiles) && status.otherGsiFiles.length > 0) {
      gsiOtherFiles.textContent =
        '检测到其他工具的 GSI 配置：' + status.otherGsiFiles.join('、') + '（不会改动）';
      gsiOtherFiles.hidden = false;
    }

    if (status.cfgStatus === 'READY') {
      gsiDot.className = 'rs-dot ok';
      gsiStateLabel.textContent = '已就绪';
      gsiStateLabel.className = 'rs-status-val ok';
      gsiSummary.textContent = '已安装并校验 RoundSense 配置文件。';
      gsiManualBox.hidden = true;
      return;
    }

    if (status.cfgStatus === 'NEEDS_INSTALL') {
      gsiDot.className = 'rs-dot warn';
      const mismatch = status.cfgReason === 'CONTENT_MISMATCH';
      gsiStateLabel.textContent = mismatch ? '配置需更新' : '尚未安装';
      gsiStateLabel.className = 'rs-status-val warn';
      gsiSummary.textContent = mismatch
        ? '检测到旧版或被修改的 RoundSense 配置，点击下方按钮一键修复。'
        : '已定位到 CS2 安装目录，点击下方按钮一键写入配置。';
      gsiPrimaryBtn.textContent = mismatch ? '一键修复 GSI 配置' : '一键安装 GSI 配置';
      gsiPrimaryBtn.hidden = false;
      return;
    }

    if (status.cfgStatus === 'NOT_FOUND') {
      gsiDot.className = 'rs-dot err';
      gsiStateLabel.textContent = '未找到 CS2 目录';
      gsiStateLabel.className = 'rs-status-val err';
      gsiSummary.textContent = '未自动检测到 Counter-Strike 2，请在下方手动输入安装根目录。';
      gsiManualBox.hidden = false;
      return;
    }

    gsiDot.className = 'rs-dot err';
    gsiStateLabel.textContent = '配置异常';
    gsiStateLabel.className = 'rs-status-val err';
    gsiSummary.textContent = status.cfgReason || '读取或校验配置文件失败。';
    gsiPrimaryBtn.textContent = '尝试重新写入配置';
    gsiPrimaryBtn.hidden = false;
  }

  async function refreshGsiStatus() {
    try {
      const res = await fetch('/gsi/status');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      renderGsiStatus(await res.json());
    } catch {
      gsiDot.className = 'rs-dot err';
      gsiStateLabel.textContent = '状态获取失败';
      gsiStateLabel.className = 'rs-status-val err';
      gsiSummary.textContent = '无法连接本地 RoundSense 服务。';
    }
  }

  async function runGsiMutation(endpoint, bodyObj) {
    if (gsiBusy) return;
    gsiBusy = true;
    manualError.hidden = true;
    gsiPrimaryBtn.disabled = true;
    gsiRedetectBtn.disabled = true;
    gsiRestoreBtn.disabled = true;
    manualApplyBtn.disabled = true;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (data.status) renderGsiStatus(data.status);
      if (!res.ok) {
        if (res.status === 404 && bodyObj && bodyObj.installPath) {
          manualError.textContent = '该目录不是有效的 CS2 安装目录（缺少 cs2.exe 或 cfg 目录）。';
          manualError.hidden = false;
          gsiManualBox.hidden = false;
        } else {
          gsiSummary.textContent = '操作未完成（' + (data.error || 'HTTP ' + res.status) + '）。';
        }
      } else {
        gsiManualBox.hidden = true;
        manualPathInput.value = '';
      }
    } catch {
      gsiSummary.textContent = '操作失败：无法连接本地服务。';
    } finally {
      gsiBusy = false;
      gsiPrimaryBtn.disabled = false;
      gsiRedetectBtn.disabled = false;
      gsiRestoreBtn.disabled = false;
      manualApplyBtn.disabled = false;
    }
  }

  function updateLiveStatus(snapshot, offline = false) {
    if (offline) {
      liveDot.className = 'rs-dot err';
      liveStateLabel.textContent = '本地服务未连接';
      liveStateLabel.className = 'rs-status-val err';
      diagLive.textContent = 'SSE 断开';
      return;
    }
    if (!snapshot) return;
    liveSnapshot = snapshot;

    if (snapshot.visible) {
      liveDot.className = 'rs-dot ok';
      liveStateLabel.textContent = '已接入 · 冻结时间';
      liveStateLabel.className = 'rs-status-val ok';
      scenarioLiveBtn.hidden = false;
      diagLive.textContent = 'rev ' + snapshot.revision + ' · visible';
    } else {
      liveDot.className = 'rs-dot idle';
      liveStateLabel.textContent = HIDDEN_REASON_LABELS[snapshot.hiddenReason] || '等待进入比赛';
      liveStateLabel.className = 'rs-status-val muted';
      diagLive.textContent =
        'rev ' + snapshot.revision + ' · ' + (snapshot.hiddenReason || 'hidden');
    }

    if (activeScenario === 'live') renderPreview();
  }

  // Bind UI events
  document.querySelectorAll('#scenario-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeScenario = btn.dataset.scenario;
      for (const b of document.querySelectorAll('#scenario-tabs button')) {
        b.classList.toggle('is-active', b === btn);
      }
      renderPreview();
    });
  });

  document.querySelectorAll('#aspect-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeAspect = btn.dataset.aspect;
      for (const b of document.querySelectorAll('#aspect-tabs button')) {
        b.classList.toggle('is-active', b === btn);
      }
      applyBackdrop();
    });
  });

  document.querySelectorAll('#backdrop-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeBackdrop = btn.dataset.backdrop;
      for (const b of document.querySelectorAll('#backdrop-tabs button')) {
        b.classList.toggle('is-active', b === btn);
      }
      applyBackdrop();
    });
  });

  document.querySelectorAll('#pos-seg button').forEach((btn) => {
    btn.addEventListener('click', () =>
      updateSettingsLocal({ position: btn.dataset.position }, true),
    );
  });

  document.querySelectorAll('#awp-seg button').forEach((btn) => {
    btn.addEventListener('click', () =>
      updateSettingsLocal({ awpPriority: btn.dataset.awp }, true),
    );
  });

  scaleRange.addEventListener('input', () => {
    updateSettingsLocal({ scale: Number(scaleRange.value) }, false);
  });

  opacityRange.addEventListener('input', () => {
    updateSettingsLocal({ opacity: Number(opacityRange.value) }, false);
  });

  document.getElementById('reset-defaults-btn').addEventListener('click', () => {
    updateSettingsLocal({ ...DEFAULT_SETTINGS }, true);
  });

  gsiPrimaryBtn.addEventListener('click', () => void runGsiMutation('/gsi/install', {}));
  gsiRedetectBtn.addEventListener('click', () => void refreshGsiStatus());
  gsiRestoreBtn.addEventListener('click', () => void runGsiMutation('/gsi/restore', {}));
  gsiManualToggle.addEventListener('click', () => {
    gsiManualBox.hidden = !gsiManualBox.hidden;
    if (!gsiManualBox.hidden) manualPathInput.focus();
  });
  manualApplyBtn.addEventListener('click', () => {
    const val = manualPathInput.value.trim();
    if (!val) {
      manualError.textContent = '请输入 CS2 安装根目录路径。';
      manualError.hidden = false;
      return;
    }
    void runGsiMutation('/gsi/install', { installPath: val });
  });

  // Boot: load current settings from /snapshot, start SSE, and fetch /gsi/status
  async function boot() {
    syncSettingsControls();
    applyBackdrop();
    renderPreview();
    void refreshGsiStatus();

    try {
      const res = await fetch('/snapshot');
      if (res.ok) {
        const snap = await res.json();
        if (snap && snap.settings) {
          currentSettings = { ...DEFAULT_SETTINGS, ...snap.settings };
          syncSettingsControls();
          renderPreview();
        }
        updateLiveStatus(snap, false);
      }
    } catch {
      updateLiveStatus(null, true);
    }

    const source = new EventSource('/events');
    source.onmessage = (event) => {
      try {
        const snap = JSON.parse(event.data);
        updateLiveStatus(snap, false);
      } catch {
        // ignore malformed event
      }
    };
    source.onerror = () => updateLiveStatus(null, true);
  }

  void boot();
})();
