/* Settings & GSI onboarding controller: real Policy V3 preview + instant auto-save + GSI API. */
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

  const BACKDROP_URLS = {
    bright: '/assets/preview/bright.webp',
    dark: '/assets/preview/dark.webp',
  };

  const PREVIEW_WIDTHS = { game: 1920, '4-3': 1440, '16-10': 1728, '16-9': 1920 };

  const stageEl = document.getElementById('cs2-stage');
  const hudAnchor = document.getElementById('hud-anchor');
  const hudPreview = document.getElementById('hud-preview');
  const previewSourceBadge = document.getElementById('preview-source-badge');
  const previewViewport = document.getElementById('preview-viewport');
  const scenarioLiveBtn = document.getElementById('scenario-live-btn');

  const scaleRange = document.getElementById('scale-range');
  const scaleOutput = document.getElementById('scale-output');
  const opacityRange = document.getElementById('opacity-range');
  const opacityOutput = document.getElementById('opacity-output');
  const saveStatus = document.getElementById('save-status');

  const gsiDot = document.getElementById('gsi-dot');
  const gsiStateLabel = document.getElementById('gsi-state-label');
  const gsiSummary = document.getElementById('gsi-summary');
  const gsiConflictWarning = document.getElementById('gsi-conflict-warning');
  const gsiPrimaryBtn = document.getElementById('gsi-primary-btn');
  const gsiSecondaryActions = document.getElementById('gsi-secondary-actions');
  const gsiRedetectBtn = document.getElementById('gsi-redetect-btn');
  const gsiManualToggle = document.getElementById('gsi-manual-toggle');
  const gsiRestoreBtn = document.getElementById('gsi-restore-btn');
  const gsiManualBox = document.getElementById('gsi-manual-box');
  const manualPathInput = document.getElementById('manual-install-path');
  const pickFolderBtn = document.getElementById('gsi-pick-folder-btn');
  const manualApplyBtn = document.getElementById('gsi-manual-apply');
  const manualError = document.getElementById('gsi-manual-error');
  const diagNativeRow = document.getElementById('diag-native-row');
  const diagOpenCfgBtn = document.getElementById('diag-open-cfg');
  const diagOpenLogsBtn = document.getElementById('diag-open-logs');
  const tauriInvoke = window.__TAURI__?.core?.invoke;

  const liveDot = document.getElementById('live-dot');
  const liveStateLabel = document.getElementById('live-state-label');

  const diagInstall = document.getElementById('diag-install');
  const diagCfg = document.getElementById('diag-cfg');
  const diagSource = document.getElementById('diag-source');
  const diagOther = document.getElementById('diag-other');
  const diagLive = document.getElementById('diag-live');

  let currentSettings = { ...DEFAULT_SETTINGS };
  let activeScenario = 'ct-mid';
  let activeBackdrop = 'bright';
  let activeAspect = 'game';
  let liveSnapshot = null;
  let lastFreezeSnapshot = null;
  let lastGsiHealth = null;
  let lastCfgDirectory = null;
  let lastCfgStatus = null;
  let lastHasConflict = false;
  let previewSnapshot = null;
  let previewSeq = 0;
  let saveTimer = null;
  let saving = false;
  let pendingSave = false;
  let gsiBusy = false;
  let gameGeometry = null;
  let geometrySeq = 0;

  function applyBackdrop() {
    stageEl.style.backgroundImage = 'url("' + BACKDROP_URLS[activeBackdrop] + '")';
  }

  function layoutPreview() {
    const game = activeAspect === 'game' ? gameGeometry : null;
    const width = game?.gameWidth ?? PREVIEW_WIDTHS[activeAspect];
    const height = game?.gameHeight ?? 1080;
    stageEl.style.setProperty('--preview-ratio', String(width / height));
    const fit = stageEl.clientWidth / width;
    hudAnchor.style.setProperty(
      '--preview-hud-scale',
      String(currentSettings.scale * window.RoundSenseHud.BASE_SCALE * fit * (game?.dpi ?? 1)),
    );
    hudAnchor.classList.toggle('is-game-position', Boolean(game));
    if (game) {
      hudAnchor.style.setProperty('--preview-x', (100 * game.x) / width + '%');
      hudAnchor.style.setProperty('--preview-y', (100 * game.y) / height + '%');
    }
    const source = game ? '游戏窗口' : '示意';
    const awaiting = !game && activeAspect === 'game' && tauriInvoke ? ' · 等待检测游戏窗口' : '';
    const label = `${width} × ${height} ${source}${awaiting}`;
    if (previewViewport.textContent !== label) previewViewport.textContent = label;
  }

  async function refreshGameGeometry() {
    if (!tauriInvoke || activeAspect !== 'game' || !hudPreview.firstElementChild) return;
    const seq = ++geometrySeq;
    const { width, height } = window.RoundSenseHud.measure(hudPreview);
    try {
      const geometry = await tauriInvoke('preview_overlay_geometry', {
        request: {
          visible: true,
          width,
          height,
          scale: currentSettings.scale,
          position: currentSettings.position,
        },
      });
      if (seq !== geometrySeq) return;
      gameGeometry = geometry;
      layoutPreview();
    } catch {
      // Browser previews and older desktop hosts use the reference frame.
    }
  }

  function syncSettingsControls() {
    for (const btn of document.querySelectorAll('#pos-seg button')) {
      const on = btn.dataset.position === currentSettings.position;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('is-active', on);
    }
    for (const btn of document.querySelectorAll('#awp-seg button')) {
      const on = btn.dataset.awp === currentSettings.awpPriority;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('is-active', on);
    }
    scaleRange.value = String(currentSettings.scale);
    scaleOutput.textContent = Math.round(currentSettings.scale * 100) + '%';
    opacityRange.value = String(currentSettings.opacity);
    opacityOutput.textContent = Math.round(currentSettings.opacity * 100) + '%';
  }

  function renderPreview() {
    hudAnchor.className = 'rs-hud-anchor pos-' + currentSettings.position;
    document.documentElement.style.setProperty('--hud-scale', String(currentSettings.scale));
    document.documentElement.style.setProperty('--hud-opacity', String(currentSettings.opacity));

    const useLive = activeScenario === 'live' && lastFreezeSnapshot;
    const baseSnap = useLive || previewSnapshot;
    if (!baseSnap) return;

    const previewSaveAwpOverride =
      !useLive &&
      activeScenario === 'ct-save-awp' &&
      currentSettings.awpPriority !== 'SAVE_FOR_AWP';
    const effectiveSettings = previewSaveAwpOverride
      ? { ...currentSettings, awpPriority: 'SAVE_FOR_AWP' }
      : { ...currentSettings };
    const snap = { ...baseSnap, settings: effectiveSettings };
    window.RoundSenseHud.render(hudPreview, snap, { forceShow: true, skipRootVars: true });

    previewSourceBadge.textContent = useLive
      ? liveSnapshot?.visible
        ? '实时对局接入'
        : `最近冻结回合 · R${baseSnap.round ?? '–'}`
      : previewSaveAwpOverride
        ? '按「Jame 攒狙」预览'
        : 'Policy V3 预览';
    previewSourceBadge.classList.toggle('is-live', Boolean(useLive));
    previewSourceBadge.classList.toggle('is-preview-override', Boolean(previewSaveAwpOverride));
    layoutPreview();
    void refreshGameGeometry();
  }

  async function refreshPreviewSnapshot() {
    if (activeScenario === 'live') {
      renderPreview();
      return;
    }
    const seq = ++previewSeq;
    const effectiveAwpPriority =
      activeScenario === 'ct-save-awp' && currentSettings.awpPriority !== 'SAVE_FOR_AWP'
        ? 'SAVE_FOR_AWP'
        : currentSettings.awpPriority;
    const url =
      '/preview?scenario=' +
      encodeURIComponent(activeScenario) +
      '&awpPriority=' +
      encodeURIComponent(effectiveAwpPriority);
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const snap = await res.json();
      if (seq !== previewSeq) return;
      previewSnapshot = snap;
      renderPreview();
    } catch {
      // keep previous preview snapshot if local server is momentarily unavailable
    }
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
    const awpChanged =
      patch.awpPriority !== undefined && patch.awpPriority !== currentSettings.awpPriority;
    currentSettings = { ...currentSettings, ...patch };
    syncSettingsControls();
    renderPreview();
    if (awpChanged) void refreshPreviewSnapshot();
    scheduleSave(immediate);
  }

  function renderGsiStatus(status) {
    gsiPrimaryBtn.hidden = true;
    gsiRestoreBtn.hidden = !status.canRestore;
    gsiConflictWarning.hidden = true;
    manualError.hidden = true;
    lastCfgDirectory = status.cfgDirectory || null;
    lastCfgStatus = status.cfgStatus || null;
    lastHasConflict =
      Array.isArray(status.conflictingGsiFiles) && status.conflictingGsiFiles.length > 0;
    if (diagOpenCfgBtn) diagOpenCfgBtn.disabled = !lastCfgDirectory;
    diagInstall.textContent = status.installPath || '未检测到';
    diagCfg.textContent = status.cfgPath || '—';
    diagSource.textContent = status.installSource || '—';
    diagOther.textContent =
      Array.isArray(status.otherGsiFiles) && status.otherGsiFiles.length > 0
        ? status.otherGsiFiles.join('、')
        : '无';

    if (Array.isArray(status.conflictingGsiFiles) && status.conflictingGsiFiles.length > 0) {
      gsiConflictWarning.textContent =
        '检测到同端口冲突配置：' +
        status.conflictingGsiFiles.join('、') +
        '，可能导致数据重复或认证失败。';
      gsiConflictWarning.hidden = false;
    }

    if (status.cfgStatus === 'READY') {
      gsiDot.className = 'rs-dot ok';
      gsiStateLabel.textContent = '已就绪';
      gsiStateLabel.className = 'rs-status-val ok';
      gsiSummary.textContent = '配置已安装并校验一致，正常启动 CS2 即可自动生效。';
      gsiManualBox.hidden = true;
      gsiManualToggle.hidden = false;
      gsiManualToggle.textContent = '指定目录';
      gsiSecondaryActions.hidden = !status.canRestore;
      return;
    }

    gsiSecondaryActions.hidden = false;

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
      gsiManualToggle.hidden = false;
      gsiManualToggle.textContent = gsiManualBox.hidden ? '指定目录' : '收起输入';
      return;
    }

    if (status.cfgStatus === 'NOT_FOUND') {
      gsiDot.className = 'rs-dot err';
      gsiStateLabel.textContent = '未找到 CS2 目录';
      gsiStateLabel.className = 'rs-status-val err';
      gsiSummary.textContent = '未自动检测到 Counter-Strike 2，请在下方输入或选择安装目录。';
      gsiManualBox.hidden = false;
      gsiManualToggle.hidden = true;
      return;
    }

    gsiManualToggle.hidden = false;
    gsiManualToggle.textContent = gsiManualBox.hidden ? '指定目录' : '收起输入';

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
          manualError.textContent = '该路径不是有效的 CS2 安装目录（缺少 cs2.exe 或 cfg 目录）。';
          manualError.hidden = false;
          gsiManualBox.hidden = false;
        } else if (
          res.status === 409 &&
          data.restore &&
          data.restore.reason === 'EXTERNALLY_MODIFIED'
        ) {
          gsiSummary.textContent =
            '配置文件在安装后曾被外部修改，为避免覆盖已停止恢复；如需重新对齐可点击一键修复。';
          gsiPrimaryBtn.textContent = '一键修复 GSI 配置';
          gsiPrimaryBtn.hidden = false;
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
      liveSnapshot = null;
      liveDot.className = 'rs-dot err';
      liveStateLabel.textContent = '本地服务未连接';
      liveStateLabel.className = 'rs-status-val err';
      diagLive.textContent = 'SSE 断开';
      if (activeScenario === 'live') renderPreview();
      return;
    }
    if (!snapshot) return;
    liveSnapshot = snapshot;

    if (snapshot.visible) {
      lastFreezeSnapshot = snapshot;
      liveDot.className = 'rs-dot ok';
      liveStateLabel.textContent =
        snapshot.displayPhase === 'post-freezetime' ? '已接入 · 保留开局策略' : '已接入 · 冻结时间';
      liveStateLabel.className = 'rs-status-val ok';
      scenarioLiveBtn.hidden = false;
      diagLive.textContent = 'rev ' + snapshot.revision + ' · visible';
    } else if (
      snapshot.hiddenReason === 'outside-freezetime' ||
      snapshot.hiddenReason === 'not-self' ||
      snapshot.hiddenReason === 'not-competitive'
    ) {
      liveDot.className = 'rs-dot ok';
      liveStateLabel.textContent =
        '连接正常 · ' + (HIDDEN_REASON_LABELS[snapshot.hiddenReason] || '已隐藏');
      liveStateLabel.className = 'rs-status-val ok';
      diagLive.textContent = 'rev ' + snapshot.revision + ' · ' + snapshot.hiddenReason;
    } else if (
      lastGsiHealth &&
      lastGsiHealth.rejected > 0 &&
      lastGsiHealth.lastRejectReason &&
      /auth|token|unauthorized/i.test(lastGsiHealth.lastRejectReason) &&
      lastGsiHealth.lastRejectAtMs !== null &&
      Date.now() - lastGsiHealth.lastRejectAtMs < 60000 &&
      (lastGsiHealth.lastAcceptedAtMs === null ||
        lastGsiHealth.lastRejectAtMs > lastGsiHealth.lastAcceptedAtMs)
    ) {
      liveDot.className = 'rs-dot err';
      if (lastHasConflict) {
        liveStateLabel.textContent = '存在同端口冲突配置';
      } else if (lastCfgStatus === 'READY') {
        liveStateLabel.textContent = '配置已更新，请重启 CS2';
      } else {
        liveStateLabel.textContent = 'Token 不匹配，请修复配置';
      }
      liveStateLabel.className = 'rs-status-val err';
      diagLive.textContent = 'rejected: ' + lastGsiHealth.lastRejectReason;
    } else {
      liveDot.className = 'rs-dot idle';
      liveStateLabel.textContent = HIDDEN_REASON_LABELS[snapshot.hiddenReason] || '等待进入比赛';
      liveStateLabel.className = 'rs-status-val muted';
      diagLive.textContent =
        'rev ' + snapshot.revision + ' · ' + (snapshot.hiddenReason || 'hidden');
    }

    if (activeScenario === 'live') renderPreview();
  }

  for (const btn of document.querySelectorAll('#scenario-tabs button')) {
    btn.addEventListener('click', () => {
      activeScenario = btn.dataset.scenario;
      for (const b of document.querySelectorAll('#scenario-tabs button')) {
        b.classList.toggle('is-active', b === btn);
      }
      void refreshPreviewSnapshot();
    });
  }

  for (const btn of document.querySelectorAll('#aspect-tabs button')) {
    btn.addEventListener('click', () => {
      activeAspect = btn.dataset.aspect;
      for (const b of document.querySelectorAll('#aspect-tabs button')) {
        b.classList.toggle('is-active', b === btn);
      }
      applyBackdrop();
      layoutPreview();
      void refreshGameGeometry();
    });
  }

  for (const btn of document.querySelectorAll('#backdrop-tabs button')) {
    btn.addEventListener('click', () => {
      activeBackdrop = btn.dataset.backdrop;
      for (const b of document.querySelectorAll('#backdrop-tabs button')) {
        b.classList.toggle('is-active', b === btn);
      }
      applyBackdrop();
    });
  }

  for (const btn of document.querySelectorAll('#pos-seg button')) {
    btn.addEventListener('click', () =>
      updateSettingsLocal({ position: btn.dataset.position }, true),
    );
  }

  for (const btn of document.querySelectorAll('#awp-seg button')) {
    btn.addEventListener('click', () =>
      updateSettingsLocal({ awpPriority: btn.dataset.awp }, true),
    );
  }

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
    gsiManualToggle.textContent = gsiManualBox.hidden ? '指定目录' : '收起输入';
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

  if (typeof tauriInvoke === 'function') {
    pickFolderBtn.hidden = false;
    diagNativeRow.hidden = false;
    pickFolderBtn.addEventListener('click', async () => {
      try {
        const picked = await tauriInvoke('pick_cs2_folder');
        if (typeof picked === 'string' && picked.trim()) {
          manualPathInput.value = picked.trim();
          await runGsiMutation('/gsi/install', { installPath: picked.trim() });
        }
      } catch {
        manualError.textContent = '无法打开系统文件夹选择器。';
        manualError.hidden = false;
      }
    });
    diagOpenCfgBtn.addEventListener('click', () => {
      if (lastCfgDirectory) void tauriInvoke('open_directory', { path: lastCfgDirectory });
    });
    diagOpenLogsBtn.addEventListener('click', () => {
      void tauriInvoke('open_logs_dir');
    });
  }

  async function boot() {
    syncSettingsControls();
    applyBackdrop();
    void refreshGsiStatus();

    try {
      const res = await fetch('/snapshot');
      if (res.ok) {
        const snap = await res.json();
        if (snap && snap.settings) {
          currentSettings = { ...DEFAULT_SETTINGS, ...snap.settings };
          syncSettingsControls();
        }
        updateLiveStatus(snap, false);
      }
    } catch {
      updateLiveStatus(null, true);
    }

    await refreshPreviewSnapshot();

    const source = new EventSource('/events');
    source.onmessage = (event) => {
      try {
        const snap = JSON.parse(event.data);
        if (snap && snap.gsiHealth) lastGsiHealth = snap.gsiHealth;
        updateLiveStatus(snap, false);
      } catch {
        // ignore malformed event
      }
    };
    source.onerror = () => updateLiveStatus(null, true);
  }

  new ResizeObserver(layoutPreview).observe(stageEl);
  window.addEventListener('focus', () => void refreshGameGeometry());
  void boot();
})();
