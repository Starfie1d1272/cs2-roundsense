import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGsiReceiver, type GsiReceipt } from '@roundsense/gsi-protocol';
import { HudRuntime, type HudSettings } from './model.js';
import { buildPreviewSnapshot, isPreviewScenarioId } from './preview.js';
import { parseHudSettings } from './settings.js';
import {
  canRestoreGsiConfig,
  discoverCs2,
  inspectGsiConfig,
  installGsiConfig,
  restoreGsiConfig,
  type Cs2Install,
  type DiscoverCs2Options,
  type GsiRestoreResult,
} from './onboarding.js';

const ASSETS: Record<string, [string, string]> = {
  '/': ['settings.html', 'text/html; charset=utf-8'],
  '/overlay': ['overlay.html', 'text/html; charset=utf-8'],
  '/hud.css': ['hud.css', 'text/css; charset=utf-8'],
  '/hud-renderer.js': ['hud-renderer.js', 'text/javascript; charset=utf-8'],
  '/hud-client.js': ['hud-client.js', 'text/javascript; charset=utf-8'],
  '/settings.js': ['settings.js', 'text/javascript; charset=utf-8'],
};

const CS2_ICON_RE = /^\/assets\/cs2\/([a-z0-9_]+\.svg)$/;
const PREVIEW_ASSET_RE = /^\/assets\/preview\/([a-z0-9_-]+)\.(webp|png|jpg|jpeg)$/;
const IMAGE_MIME: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export interface GsiRuntimeHealth {
  accepted: number;
  rejected: number;
  consumerErrors: number;
  lastAcceptedAtMs: number | null;
  lastRejectAtMs: number | null;
  lastRejectReason: string | null;
}

export interface GsiOnboardingStatus {
  platform: NodeJS.Platform;
  discoveryStatus: 'FOUND' | 'NOT_FOUND';
  installPath: string | null;
  installSource: Cs2Install['source'] | null;
  cfgDirectory: string | null;
  cfgPath: string | null;
  cfgStatus: 'READY' | 'NEEDS_INSTALL' | 'NOT_FOUND' | 'ERROR';
  cfgReason: string | null;
  otherGsiFiles: readonly string[];
  conflictingGsiFiles: readonly string[];
  canInstall: boolean;
  canRestore: boolean;
  warnings: readonly string[];
}

export interface HudOnboardingOptions {
  backupDir?: string;
  preferredInstallPath?: string;
  savePreferredInstallPath?: (installPath: string) => Promise<void>;
  discoverOptions?: Omit<DiscoverCs2Options, 'preferredInstallPath'>;
}

export interface HudServiceOptions {
  token: string;
  gsiPort?: number;
  webPort?: number;
  uiDir?: string;
  nowNs?: () => bigint;
  saveSettings?: (settings: HudSettings) => Promise<void>;
  settings?: HudSettings;
  onboarding?: HudOnboardingOptions;
}

function resolveUiDir(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.ROUNDSENSE_UI_DIR) return process.env.ROUNDSENSE_UI_DIR;
  const sibling = fileURLToPath(new URL('./ui', import.meta.url));
  if (existsSync(join(sibling, 'settings.html'))) return sibling;
  return fileURLToPath(new URL('../../ui', import.meta.url));
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number }> {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > maxBytes) {
      return { ok: false, status: 413 };
    }
  }
  if (!body.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, status: 400 };
  }
}

function parseOptionalInstallPath(input: unknown): string | undefined | null {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'installPath') return null;
  }
  if (record.installPath === undefined) return undefined;
  if (typeof record.installPath !== 'string' || !record.installPath.trim()) {
    return null;
  }
  return record.installPath.trim();
}

export async function startHudService(options: HudServiceOptions) {
  if (!options.token.trim()) throw new Error('HUD requires a non-empty GSI token');
  const uiDir = resolveUiDir(options.uiDir);
  const runtime = new HudRuntime();
  if (options.settings) runtime.updateSettings(options.settings);
  const now = options.nowNs ?? process.hrtime.bigint;
  const clients = new Set<ServerResponse>();
  const latest = new Map<ServerResponse, string>();
  let settingsBusy = false;
  let gsiMutationBusy = false;
  let preferredInstallPath = options.onboarding?.preferredInstallPath;
  let consumerErrors = 0;
  let lastAcceptedAtMs: number | null = null;
  let lastRejectAtMs: number | null = null;
  let lastRejectReason: string | null = null;

  const snapshot = () => runtime.snapshot(now());
  const gsiHealth = (): GsiRuntimeHealth => ({
    accepted: gsi.accepted(),
    rejected: gsi.rejected(),
    consumerErrors,
    lastAcceptedAtMs,
    lastRejectAtMs,
    lastRejectReason,
  });
  const formatEvent = () =>
    `data: ${JSON.stringify({ ...snapshot(), gsiHealth: gsiHealth() })}\n\n`;
  const broadcast = () => {
    const event = formatEvent();
    for (const client of clients) {
      if (client.writableNeedDrain) {
        latest.set(client, event);
        continue;
      }
      client.write(event);
    }
  };

  const gsi = createGsiReceiver({
    token: options.token,
    maxBodyBytes: 64 * 1024,
    onPayload: (receipt) => {
      lastAcceptedAtMs = Date.now();
      try {
        runtime.observe(receipt);
      } catch {
        consumerErrors++;
      }
      broadcast();
    },
    onReject: (_status, reason) => {
      lastRejectAtMs = Date.now();
      lastRejectReason = reason;
      broadcast();
    },
  });

  const resolvedGsiPort = () =>
    (gsi.server.address() as { port: number } | null)?.port ?? options.gsiPort ?? 3001;

  const computeGsiStatus = async (overrideInstallPath?: string): Promise<GsiOnboardingStatus> => {
    const discovery = await discoverCs2({
      ...options.onboarding?.discoverOptions,
      preferredInstallPath: overrideInstallPath ?? preferredInstallPath,
      strictPreferredPath: overrideInstallPath !== undefined,
    });
    if (discovery.status === 'NOT_FOUND') {
      return {
        platform: options.onboarding?.discoverOptions?.platform ?? process.platform,
        discoveryStatus: 'NOT_FOUND',
        installPath: null,
        installSource: null,
        cfgDirectory: null,
        cfgPath: null,
        cfgStatus: 'NOT_FOUND',
        cfgReason: 'CS2_INSTALL_NOT_FOUND',
        otherGsiFiles: [],
        conflictingGsiFiles: [],
        canInstall: false,
        canRestore: false,
        warnings: discovery.warnings,
      };
    }
    const cfgDirectory = discovery.install.cfgDirectory;
    const backupDir = options.onboarding?.backupDir;
    const inspection = await inspectGsiConfig({
      cfgDirectory,
      token: options.token,
      port: resolvedGsiPort(),
      backupDir,
    });
    const canRestore = await canRestoreGsiConfig({ cfgDirectory, backupDir });
    return {
      platform: options.onboarding?.discoverOptions?.platform ?? process.platform,
      discoveryStatus: 'FOUND',
      installPath: discovery.install.installPath,
      installSource: discovery.install.source,
      cfgDirectory,
      cfgPath: inspection.path,
      cfgStatus: inspection.status,
      cfgReason: 'reason' in inspection ? inspection.reason : null,
      otherGsiFiles: inspection.otherGsiFiles,
      conflictingGsiFiles: inspection.conflictingGsiFiles,
      canInstall: inspection.status === 'NEEDS_INSTALL',
      canRestore,
      warnings: discovery.warnings,
    };
  };

  const web = createServer(async (request, response) => {
    const host = request.headers.host;
    const expectedHost = `127.0.0.1:${(web.address() as { port: number }).port}`;
    if (host !== expectedHost) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://ipc.localhost; frame-ancestors 'none'; base-uri 'none'",
    );
    const parsedUrl = new URL(request.url ?? '/', `http://${expectedHost}`);
    const path = parsedUrl.pathname;
    if (request.method === 'GET' && path === '/events') {
      if (request.headers.origin && request.headers.origin !== `http://${expectedHost}`) {
        response.writeHead(403).end();
        return;
      }
      if (clients.size >= 8) {
        response.writeHead(503).end();
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        connection: 'keep-alive',
      });
      response.write(`retry: 1000\n${formatEvent()}`);
      clients.add(response);
      response.on('drain', () => {
        const event = latest.get(response);
        latest.delete(response);
        if (event) response.write(event);
      });
      response.on('close', () => {
        clients.delete(response);
        latest.delete(response);
      });
      return;
    }
    if (request.method === 'GET' && path === '/health') {
      const body = Buffer.from(JSON.stringify({ ok: true, product: 'roundsense' }), 'utf8');
      response
        .writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(body.length),
        })
        .end(body);
      return;
    }
    if (request.method === 'GET' && path === '/snapshot') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(snapshot()));
      return;
    }
    if (request.method === 'GET' && path === '/preview') {
      const scenario = parsedUrl.searchParams.get('scenario') ?? 'ct-mid';
      if (!isPreviewScenarioId(scenario)) {
        response.writeHead(404).end();
        return;
      }
      const currentSettings = snapshot().settings;
      const awpParam = parsedUrl.searchParams.get('awpPriority');
      const awpPriority =
        awpParam === 'NEUTRAL' || awpParam === 'PREFER' || awpParam === 'SAVE_FOR_AWP'
          ? awpParam
          : currentSettings.awpPriority;
      const previewSnapshot = buildPreviewSnapshot(scenario, {
        ...currentSettings,
        awpPriority,
      });
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(previewSnapshot));
      return;
    }
    if (request.method === 'GET' && path === '/gsi/status') {
      const status = await computeGsiStatus();
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(status));
      return;
    }
    if (request.method === 'POST' && (path === '/gsi/install' || path === '/gsi/restore')) {
      if (
        request.headers.origin !== `http://${expectedHost}` ||
        !/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')
      ) {
        response.writeHead(403).end();
        return;
      }
      if (gsiMutationBusy) {
        response.writeHead(409).end();
        return;
      }
      gsiMutationBusy = true;
      try {
        const parsed = await readJsonBody(request, 2048);
        if (!parsed.ok) {
          response.writeHead(parsed.status).end();
          return;
        }
        const requestedInstallPath = parseOptionalInstallPath(parsed.value);
        if (requestedInstallPath === null) {
          response.writeHead(400).end();
          return;
        }
        const before = await computeGsiStatus(requestedInstallPath);
        if (before.discoveryStatus !== 'FOUND' || !before.cfgDirectory) {
          response
            .writeHead(404, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: 'CS2_INSTALL_NOT_FOUND', status: before }));
          return;
        }
        if (requestedInstallPath && before.installPath) {
          preferredInstallPath = before.installPath;
          await options.onboarding?.savePreferredInstallPath?.(before.installPath);
        }
        if (path === '/gsi/install') {
          const result = await installGsiConfig({
            cfgDirectory: before.cfgDirectory,
            token: options.token,
            port: resolvedGsiPort(),
            backupDir: options.onboarding?.backupDir,
          });
          const after = await computeGsiStatus();
          response
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ changed: result.changed, status: after }));
        } else {
          const restore: GsiRestoreResult = await restoreGsiConfig({
            cfgDirectory: before.cfgDirectory,
            backupDir: options.onboarding?.backupDir,
          });
          const after = await computeGsiStatus();
          const code = restore.status === 'REFUSED' ? 409 : 200;
          response
            .writeHead(code, { 'content-type': 'application/json' })
            .end(JSON.stringify({ restore, status: after }));
        }
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'GSI_ERROR',
          }),
        );
      } finally {
        gsiMutationBusy = false;
      }
      return;
    }
    if (request.method === 'POST' && path === '/settings') {
      if (
        request.headers.origin !== `http://${expectedHost}` ||
        !/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')
      ) {
        response.writeHead(403).end();
        return;
      }
      if (settingsBusy) {
        response.writeHead(409).end();
        return;
      }
      settingsBusy = true;
      try {
        const parsed = await readJsonBody(request, 2048);
        if (!parsed.ok) {
          response.writeHead(parsed.status).end();
          return;
        }
        const settings = parseHudSettings(parsed.value);
        if (!settings) {
          response.writeHead(400).end();
          return;
        }
        await options.saveSettings?.(settings);
        runtime.updateSettings(settings);
        broadcast();
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(snapshot()));
      } catch {
        response.writeHead(400).end();
      } finally {
        settingsBusy = false;
      }
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = ASSETS[path];
      if (asset) {
        try {
          const contents = await readFile(join(uiDir, asset[0]));
          response
            .writeHead(200, { 'content-type': asset[1] })
            .end(request.method === 'HEAD' ? undefined : contents);
        } catch {
          response.writeHead(500).end();
        }
        return;
      }
      const iconMatch = CS2_ICON_RE.exec(path);
      if (iconMatch) {
        try {
          const contents = await readFile(join(uiDir, 'assets', 'cs2', iconMatch[1]));
          response
            .writeHead(200, {
              'content-type': 'image/svg+xml; charset=utf-8',
              'cache-control': 'public, max-age=3600',
            })
            .end(request.method === 'HEAD' ? undefined : contents);
        } catch {
          response.writeHead(404).end();
        }
        return;
      }
      const previewMatch = PREVIEW_ASSET_RE.exec(path);
      if (previewMatch) {
        try {
          const fileName = `${previewMatch[1]}.${previewMatch[2]}`;
          const contents = await readFile(join(uiDir, 'assets', 'preview', fileName));
          response
            .writeHead(200, {
              'content-type': IMAGE_MIME[previewMatch[2]] ?? 'application/octet-stream',
              'cache-control': 'public, max-age=3600',
            })
            .end(request.method === 'HEAD' ? undefined : contents);
        } catch {
          response.writeHead(404).end();
        }
        return;
      }
    }
    response.writeHead(404).end();
  });
  web.requestTimeout = 5000;
  gsi.server.requestTimeout = 5000;
  const listen = (server: typeof web, port: number) =>
    new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError);
        resolve();
      });
    });
  try {
    await listen(gsi.server, options.gsiPort ?? 3001);
    await listen(web, options.webPort ?? 3100);
  } catch (error) {
    gsi.server.close();
    web.close();
    throw error;
  }
  // Updates freshness even when no new GSI packet arrives; also renews the
  // renderer's lease. Slow subscribers get at most one pending latest state.
  const timer = setInterval(broadcast, 500);
  return {
    gsiPort: (gsi.server.address() as { port: number }).port,
    webPort: (web.address() as { port: number }).port,
    snapshot,
    // Shared entry for deterministic replay/QA; production uses the receiver.
    observe: (receipt: GsiReceipt) => {
      runtime.observe(receipt);
      broadcast();
    },
    close: async () => {
      clearInterval(timer);
      for (const client of clients) client.end();
      clients.clear();
      latest.clear();
      await Promise.all([
        gsi.close(),
        new Promise<void>((resolve) => {
          web.close(() => resolve());
          web.closeIdleConnections();
        }),
      ]);
    },
  };
}
