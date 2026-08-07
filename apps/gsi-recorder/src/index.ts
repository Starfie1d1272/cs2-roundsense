import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createGsiReceiver, NdjsonWriter, renderGsiCfg, generateToken, sanitizePayload } from "@roundsense/gsi-protocol";

interface CliArgs {
  port: number;
  host: string;
  token?: string;
  out?: string;
  bufferMs?: number;
  throttleMs?: number;
  printCfg: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { port: 3000, host: "127.0.0.1", printCfg: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--host") args.host = argv[++i];
    else if (a === "--token") args.token = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--buffer") args.bufferMs = Math.round(Number(argv[++i]) * 1000);
    else if (a === "--throttle") args.throttleMs = Math.round(Number(argv[++i]) * 1000);
    else if (a === "--cfg") args.printCfg = true;
    else if (a === "--help") {
      console.log(`RoundSense GSI recorder

Usage: tsx src/index.ts [options]

  --port <n>        listen port (default 3000)
  --host <ip>       bind host (default 127.0.0.1 — keep it loopback)
  --token <t>       auth token; if omitted a random one is generated
  --out <path>      NDJSON output file (default recordings/gsi-<ts>.ndjson)
  --buffer <s>      GSI buffer seconds for the printed cfg (default 0.1)
  --throttle <s>    GSI throttle seconds for the printed cfg (default 0.5)
  --cfg             print the gamestate_integration cfg and exit`);
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.printCfg) {
    const token = args.token ?? generateToken();
    const cfg = renderGsiCfg({
      uri: `http://${args.host}:${args.port}/`,
      buffer: (args.bufferMs ?? 100) / 1000,
      throttle: (args.throttleMs ?? 500) / 1000,
      token,
    });
    console.log(cfg);
    console.log(`# Save as gamestate_integration_roundsense.cfg in the CS2 csgo/cfg directory (Windows).`);
    console.log(`# No UTF-8 BOM allowed.`);
    return;
  }

  const token = args.token ?? generateToken();
  const outPath = args.out ?? join("recordings", `gsi-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`);
  mkdirSync(dirname(outPath), { recursive: true });

  const gsi = { bufferMs: args.bufferMs ?? 100, throttleMs: args.throttleMs ?? 500, tokenConfigured: true };
  const writer = new NdjsonWriter(outPath, gsi, (err) => console.error("[writer]", err));

  const handle = createGsiReceiver({
    token,
    onPayload: (receipt) => {
      const seq = writer.write({
        receivedAtWallClock: receipt.receivedAtWallClock,
        receivedAtMonotonicNs: receipt.receivedAtMonotonicNs.toString(),
        providerTimestamp: receipt.payload.provider?.timestamp,
        build: receipt.payload.provider
          ? {
              providerName: receipt.payload.provider.name,
              appid: receipt.payload.provider.appid,
              version: receipt.payload.provider.version,
            }
          : undefined,
        payload: sanitizePayload(receipt.payload),
      });
      console.log(`[recv] seq=${seq} → ${outPath}`);
    },
    onReject: (code, reason) => console.warn(`[reject] ${code} ${reason}`),
  });

  handle.server.listen(args.port, args.host, () => {
    const cfg = renderGsiCfg({
      uri: `http://${args.host}:${args.port}/`,
      buffer: (args.bufferMs ?? 100) / 1000,
      throttle: (args.throttleMs ?? 500) / 1000,
      token,
    });
    console.log(`RoundSense GSI recorder listening on http://${args.host}:${args.port}/`);
    console.log(`NDJSON → ${resolve(outPath)}`);
    console.log(`Token: ${token}`);
    console.log("── gamestate_integration_roundsense.cfg (Windows CS2) ──");
    console.log(cfg);
    console.log("── (place the cfg above into <Steam>/steamapps/common/Counter-Strike 2/game/csgo/cfg/) ──");
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[${signal}] shutting down…`);
    handle.server.close();
    await writer.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
