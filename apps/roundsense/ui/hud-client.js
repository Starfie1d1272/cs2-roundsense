/* Live transparent overlay client: subscribes to SSE and syncs bounds to native host. */
(() => {
  'use strict';

  const hud = document.getElementById('hud');
  const invoke = window.__TAURI__?.core?.invoke;
  let latest = null;
  let lastMessage = -Infinity;
  let nativePending = false;
  let staleTimer = null;

  function hide() {
    if (hud) hud.hidden = true;
    latest = null;
  }

  async function syncNative() {
    if (!invoke || nativePending || !hud) return;
    nativePending = true;
    const valid = latest && latest.visible && performance.now() - lastMessage < 2000;
    const rect = hud.getBoundingClientRect();
    const scale = latest?.settings?.scale ?? 1;
    try {
      await invoke('set_overlay_state', {
        request: {
          visible: Boolean(valid),
          width: Math.ceil(rect.width / scale || 264),
          height: Math.ceil(rect.height / scale || 84),
          scale,
          position: latest?.settings?.position ?? 'below-radar',
        },
      });
    } catch {
      hud.hidden = true;
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
