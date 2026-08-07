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

/** App-level item display names (UI concern — NOT economy domain rules). */
const ITEM_DISPLAY: Record<string, string> = {
  ak47: "AK47", m4a4: "M4A4", m4a1s: "M4A1-S", galil: "Galil", famas: "FAMAS",
  awp: "AWP", sg553: "SG553", aug: "AUG", ssg08: "SSG08",
  mac10: "MAC-10", mp9: "MP9", mp7: "MP7", mp5sd: "MP5-SD", ump45: "UMP45", p90: "P90", bizon: "PP-Bizon",
  deagle: "沙鹰", kevlar: "半甲", smoke: "烟雾弹", flash: "闪光弹", he: "手雷", molotov: "燃烧瓶", incendiary: "燃烧弹",
};

/** armor-purchase wording depends on the CURRENT armor condition:
 * full armor without helmet → "头盔升级" ($350 upgrade); otherwise a full
 * kevlar_helmet purchase → "甲 + 头". */
function armorItemDisplay(item: string, armor: number, helmet: boolean): string {
  if (item === "kevlar_helmet") return armor === 100 && !helmet ? "头盔升级" : "甲 + 头";
  return ITEM_DISPLAY[item] ?? item;
}

function purchaseText(items: { item: string; quantity: number }[], armor: number, helmet: boolean): string {
  if (items.length === 0) return "无需购买";
  return items.map((p) => `${armorItemDisplay(p.item, armor, helmet)}${p.quantity > 1 ? `×${p.quantity}` : ""}`).join("、");
}

const presenter = new C4Presenter({ onOutput: (line) => console.log(`[${new Date().toLocaleTimeString()}] ${line}`) });
const machine = new C4StateMachine((e) => presenter.handleEvent(e));
let lastAdviceAtNs: bigint | null = null;

const receiver = createGsiReceiver({
  token,
  onPayload: (receipt) => {
    machine.observe(toC4Observation(receipt));

    // Advice line: payload-driven throttle, at most every 5s measured on the
    // receipt's monotonic clock (wall clock is only for display).
    const advice = tick(receipt.payload, { nextRoundGoal: goal });
    if (
      advice &&
      (lastAdviceAtNs === null || receipt.receivedAtMonotonicNs - lastAdviceAtNs >= 5_000_000_000n)
    ) {
      lastAdviceAtNs = receipt.receivedAtMonotonicNs;
      const ls = advice.lossStreakSource === "gsi" ? `loss=${advice.lossStreak}` : `loss=${advice.lossStreak}(assumed)`;
      const rec = advice.recommended ? `推荐: ${advice.recommended.label} $${advice.recommended.totalCost}` : "推荐: 无（资金不足）";
      const alts = advice.alternatives.slice(0, 2).map((x) => `${x.label} | 需买: ${purchaseText(x.purchases, advice.recommended?.armor ?? 0, advice.recommended?.helmet ?? false)} | $${x.totalCost}`).join("  ");
      console.log(`[${new Date(receipt.receivedAtWallClock).toLocaleTimeString()}] ${advice.side} r${advice.roundNumber} money=$${advice.money} ${ls} goal=${advice.goal}`);
      console.log(`    ${rec}`);
      if (advice.recommended) console.log(`    需买: ${purchaseText(advice.recommended.purchases, advice.recommended.armor, advice.recommended.helmet)}`);
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
