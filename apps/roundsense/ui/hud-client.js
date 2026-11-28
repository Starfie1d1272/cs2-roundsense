/* Live transparent overlay client: subscribes to SSE and syncs bounds to native host. */
(() => {
  'use strict';

  const hud = document.getElementById('hud');
  const invoke = window.__TAURI__?.core?.invoke;
  let latest = null;
  let lastMessage = -Infinity;
  let nativePending = false;
  let lastReportedVisible = null;
  let staleTimer = null;

  function hide() {
    if (hud) hud.hidden = true;
    latest = null;
  }

  async function syncNative() {
    if (!invoke || nativePending || !hud) return;
    const visible = Boolean(latest && latest.visible && performance.now() - lastMessage < 2000);
    // Avoid sending 2/s hidden-state IPC pings when the native overlay is already hidden.
    if (!visible && lastReportedVisible === false) return;
    nativePending = true;
    const size = visible ? window.RoundSenseHud.measure(hud) : { width: 264, height: 84 };
    const scale = window.RoundSenseHud.effectiveScale(latest?.settings?.scale);
    try {
      await invoke('set_overlay_state', {
        request: {
          visible,
          ...size,
          scale,
          position: latest?.settings?.position ?? 'below-radar',
        },
      });
      lastReportedVisible = visible;
    } catch {
      hud.hidden = true;
      lastReportedVisible = null;
    } finally {
      nativePending = false;
    }
  }

  function resetStaleTimer() {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      hide();
      void syncNative();
    }, 2000);
  }

  const source = new EventSource('/events');
  source.onmessage = (event) => {
    try {
      const snapshot = JSON.parse(event.data);
      lastMessage = performance.now();
      latest = snapshot;
      resetStaleTimer();
      window.RoundSenseHud.render(hud, snapshot);
      void syncNative();
    } catch {
      hide();
      void syncNative();
    }
  };
  source.onerror = () => {
    if (staleTimer) clearTimeout(staleTimer);
    hide();
    void syncNative();
  };
})();
