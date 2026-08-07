#!/usr/bin/env tsx
/**
 * RoundSense live CLI: GSI receiver → C4 status + economy advice.
 *
 *   pnpm --filter @roundsense/roundsense start [--token <t>] [--port 3001]
 *                                        [--goal rifle_armor|awp|rifle_util|max_combat_now]
 *
 * Add to CS2 (or use gamestate_integration_roundsense.cfg from
 * packages/gsi-protocol):
 *   gamestate_integration_roundsense.cfg → http://127.0.0.1:3001
 */
import { createServer } from "node:http";
import { gsiPayloadSchema, tokenMatches } from "@roundsense/gsi-protocol";
import { NEXT_ROUND_GOALS, type NextRoundGoal } from "@roundsense/shared-types";
import { tick, type BombTracker } from "./engine.js";

const args = process.argv.slice(2);
const token = args.includes("--token") ? args[args.indexOf("--token") + 1] : undefined;
const port = args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : 3001;
const goalArg = args.includes("--goal") ? args[args.indexOf("--goal") + 1] : "rifle_armor";
const goal: NextRoundGoal = (NEXT_ROUND_GOALS as readonly string[]).includes(goalArg) ? (goalArg as NextRoundGoal) : "rifle_armor";

const tracker: BombTracker = { plantedAtMs: null };
let lastAdviceAt = 0;
let lastBombAt = 0;
let accepted = 0;

const server = createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > 1_000_000) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (token && !tokenMatches(token, raw)) { res.writeHead(401); res.end("bad token"); return; }
      const payload = gsiPayloadSchema.parse(JSON.parse(raw));
      accepted++;
      const now = Date.now();
      const out = tick(payload, tracker, { nextRoundGoal: goal }, now);

      // C4 line: at most every 500ms while planted, always on state change
      if (out.bomb.planted && now - lastBombAt >= 500) {
        lastBombAt = now;
        const s = (out.bomb.remainingMs! / 1000).toFixed(1);
        console.log(`[${new Date(now).toLocaleTimeString()}] C4 PLANTED — ${s}s remaining`);
      } else if (!out.bomb.planted && tracker.plantedAtMs === null && now - lastBombAt >= 1000 && accepted > 1) {
        // no-op guard keeps output calm; bomb state changes print immediately
      }

      // Advice line: at most every 5s (GSI pushes ~10 Hz)
      if (out.advice && now - lastAdviceAt >= 5000) {
        lastAdviceAt = now;
        const a = out.advice;
        const ls = a.lossStreakSource === "gsi" ? `loss=${a.lossStreak}` : `loss=${a.lossStreak}(assumed)`;
        const rec = a.recommended ? `推荐: ${a.recommended.label} $${a.recommended.totalCost}` : "推荐: 无（资金不足）";
        const alts = a.alternatives.slice(0, 2).map((x) => `${x.label} $${x.totalCost}`).join(" | ");
        console.log(`[${new Date(now).toLocaleTimeString()}] ${a.side} r${a.roundNumber} money=$${a.money} ${ls} goal=${a.goal}`);
        console.log(`    ${rec}`);
        if (alts) console.log(`    备选: ${alts}`);
        if (a.breaksGoal) console.log(`    ⚠ ${a.breaksGoal}`);
      }
      res.writeHead(204); res.end();
    } catch {
      res.writeHead(400); res.end("bad payload");
    }
  });
});

server.listen(port, () => {
  console.log(`RoundSense listening on http://127.0.0.1:${port} (goal=${goal}${token ? ", token auth" : ""})`);
  console.log("GSI cfg (packages/gsi-protocol): gamestate_integration_roundsense.cfg");
});
