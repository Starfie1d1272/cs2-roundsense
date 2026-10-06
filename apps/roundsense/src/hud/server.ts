import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createGsiReceiver, type GsiReceipt } from "@roundsense/gsi-protocol";
import { HudRuntime, type HudSettings } from "./model.js";
import { parseHudSettings } from "./settings.js";

const ASSETS: Record<string, [string, string]> = {
  "/": ["settings.html", "text/html; charset=utf-8"],
  "/overlay": ["overlay.html", "text/html; charset=utf-8"],
  "/hud.css": ["hud.css", "text/css; charset=utf-8"],
  "/hud-client.js": ["hud-client.js", "text/javascript; charset=utf-8"],
  "/settings.js": ["settings.js", "text/javascript; charset=utf-8"],
};
export interface HudServiceOptions {
  token: string;
  gsiPort?: number;
  webPort?: number;
  nowNs?: () => bigint;
  saveSettings?: (settings: HudSettings) => Promise<void>;
  settings?: HudSettings;
}
export async function startHudService(options: HudServiceOptions) {
  if (!options.token.trim())
    throw new Error("HUD requires a non-empty GSI token");
  const runtime = new HudRuntime();
  if (options.settings) runtime.updateSettings(options.settings);
  const now = options.nowNs ?? process.hrtime.bigint;
  const clients = new Set<ServerResponse>();
  const latest = new Map<ServerResponse, string>();
  let settingsBusy = false;
  const snapshot = () => runtime.snapshot(now());
  const broadcast = () => {
    const event = `data: ${JSON.stringify(snapshot())}\n\n`;
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
      runtime.observe(receipt);
      broadcast();
    },
  });
  const web = createServer(async (request, response) => {
    const host = request.headers.host;
    const expectedHost = `127.0.0.1:${(web.address() as { port: number }).port}`;
    if (host !== expectedHost) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://ipc.localhost; frame-ancestors 'none'; base-uri 'none'",
    );
    const path = new URL(request.url ?? "/", `http://${expectedHost}`).pathname;
    if (request.method === "GET" && path === "/events") {
      if (
        request.headers.origin &&
        request.headers.origin !== `http://${expectedHost}`
      ) {
        response.writeHead(403).end();
        return;
      }
      if (clients.size >= 8) {
        response.writeHead(503).end();
        return;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "keep-alive",
      });
      response.write(`retry: 1000\ndata: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(response);
      response.on("drain", () => {
        const event = latest.get(response);
        latest.delete(response);
        if (event) response.write(event);
      });
      response.on("close", () => {
        clients.delete(response);
        latest.delete(response);
      });
      return;
    }
    if (request.method === "GET" && path === "/snapshot") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(snapshot()));
      return;
    }
    if (request.method === "POST" && path === "/settings") {
      if (
        request.headers.origin !== `http://${expectedHost}` ||
        !/^application\/json(?:;|$)/i.test(
          request.headers["content-type"] ?? "",
        )
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
        let body = "";
        for await (const chunk of request) {
          body += String(chunk);
          if (Buffer.byteLength(body) > 2048) {
            response.writeHead(413).end();
            return;
          }
        }
        const settings = parseHudSettings(JSON.parse(body));
        if (!settings) {
          response.writeHead(400).end();
          return;
        }
        await options.saveSettings?.(settings);
        runtime.updateSettings(settings);
        broadcast();
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(snapshot()));
      } catch {
        response.writeHead(400).end();
      } finally {
        settingsBusy = false;
      }
      return;
    }
    const asset = ASSETS[path];
    if ((request.method === "GET" || request.method === "HEAD") && asset) {
      try {
        const contents = await readFile(
          fileURLToPath(new URL(`../../ui/${asset[0]}`, import.meta.url)),
        );
        response
          .writeHead(200, { "content-type": asset[1] })
          .end(request.method === "HEAD" ? undefined : contents);
      } catch {
        response.writeHead(500).end();
      }
      return;
    }
    response.writeHead(404).end();
  });
  web.requestTimeout = 5000;
  gsi.server.requestTimeout = 5000;
  const listen = (server: typeof web, port: number) =>
    new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", onError);
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
