#!/usr/bin/env tsx
/**
 * RoundSense live CLI: GSI receiver → C4 countdown + economy advice.
 *
 *   pnpm --filter @roundsense/roundsense start [--token <t>] [--port 3001]
 *                                        [--goal rifle_armor|awp|rifle_util|max_combat_now]
 *
 * Add to CS2 (or use gamestate_integration_roundsense.cfg from
 * packages/gsi-protocol):
 *   gamestate_integration_roundsense.cfg → http://127.0.0.1:3001
 */
import { createGsiReceiver } from "@roundsense/gsi-protocol";
import { C4StateMachine } from "@roundsense/c4-estimator";
import { NEXT_ROUND_GOALS, type NextRoundGoal } from "@roundsense/shared-types";
import { tick } from "./engine.js";
import { toC4Observation } from "./observation.js";
import { C4Presenter } from "./presenter.js";

const args = process.argv.slice(2);
const token = args.includes("--token") ? args[args.indexOf("--token") + 1] : undefined;
const port = args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : 3001;
const goalArg = args.includes("--goal") ? args[args.indexOf("--goal") + 1] : "rifle_armor";
const goal: NextRoundGoal = (NEXT_ROUND_GOALS as readonly string[]).includes(goalArg) ? (goalArg as NextRoundGoal) : "rifle_armor";

const presenter = new C4Presenter({ onOutput: (line) => console.log(`[${new Date().toLocaleTimeString()}] ${line}`) });
const machine = new C4StateMachine((e) => presenter.handleEvent(e));
let lastAdviceAt = 0;

const receiver = createGsiReceiver({
  token,
  onPayload: (receipt) => {
    machine.observe(toC4Observation(receipt));

    // Advice line: at most every 5s while a payload provides player state
    const now = Date.now();
    const advice = tick(receipt.payload, { nextRoundGoal: goal });
    if (advice && now - lastAdviceAt >= 5000) {
      lastAdviceAt = now;
      const ls = advice.lossStreakSource === "gsi" ? `loss=${advice.lossStreak}` : `loss=${advice.lossStreak}(assumed)`;
      const rec = advice.recommended ? `推荐: ${advice.recommended.label} $${advice.recommended.totalCost}` : "推荐: 无（资金不足）";
      const alts = advice.alternatives.slice(0, 2).map((x) => `${x.label} $${x.totalCost}`).join(" | ");
      console.log(`[${new Date(now).toLocaleTimeString()}] ${advice.side} r${advice.roundNumber} money=$${advice.money} ${ls} goal=${advice.goal}`);
      console.log(`    ${rec}`);
      if (alts) console.log(`    备选: ${alts}`);
      if (advice.breaksGoal) console.log(`    ⚠ ${advice.breaksGoal}`);
    }
  },
  onReject: (code, reason) => console.warn(`[reject] ${code} ${reason}`),
});

receiver.server.listen(port, "127.0.0.1", () => {
  console.log(`RoundSense listening on http://127.0.0.1:${port} (goal=${goal}${token ? ", token auth" : ""})`);
  console.log("GSI cfg (packages/gsi-protocol): gamestate_integration_roundsense.cfg");
});
