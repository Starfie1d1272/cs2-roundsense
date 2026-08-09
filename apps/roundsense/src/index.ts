#!/usr/bin/env tsx
/**
 * RoundSense live CLI: GSI receiver → C4 state + Policy V3 advice.
 *
 *   pnpm --filter @roundsense/roundsense start [--token <t>] [--port 3001]
 *
 * Add to CS2 (or use gamestate_integration_roundsense.cfg from
 * packages/gsi-protocol):
 *   gamestate_integration_roundsense.cfg → http://127.0.0.1:3001
 */
import { createGsiReceiver } from "@roundsense/gsi-protocol";
import { C4StateMachine } from "@roundsense/c4-estimator";
import { tick } from "./engine.js";
import { toC4Observation } from "./observation.js";
import { C4Presenter } from "./presenter.js";
import { PolicyStateTracker } from "./policy-state.js";

const args = process.argv.slice(2);
const token = args.includes("--token") ? args[args.indexOf("--token") + 1] : undefined;
const port = args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : 3001;

/** App-level item display names (UI concern — NOT economy domain rules). */
const ITEM_DISPLAY: Record<string, string> = {
  ak47: "AK47", m4a4: "M4A4", m4a1s: "M4A1-S", galil: "Galil", famas: "FAMAS",
  awp: "AWP", sg553: "SG553", aug: "AUG", ssg08: "SSG08",
  mac10: "MAC-10", mp9: "MP9", mp7: "MP7", mp5sd: "MP5-SD", ump45: "UMP45", p90: "P90", bizon: "PP-Bizon",
  deagle: "沙鹰", kevlar: "半甲", smoke: "烟雾弹", flash: "闪光弹", he: "手雷", molotov: "燃烧瓶", incendiary: "燃烧弹",
};

/** Presentation-only item wording. */
function armorItemDisplay(item: string, armor: number, helmet: boolean): string {
  if (item === "kevlar_helmet") return armor === 100 && !helmet ? "头盔升级" : "甲 + 头";
  return ITEM_DISPLAY[item] ?? item;
}

function purchaseText(items: readonly { item: string; quantity: number }[], armor: number, helmet: boolean): string {
  if (items.length === 0) return "无需购买";
  return items.map((p) => `${armorItemDisplay(p.item, armor, helmet)}${p.quantity > 1 ? `×${p.quantity}` : ""}`).join("、");
}

const presenter = new C4Presenter({ onOutput: (line) => console.log(`[${new Date().toLocaleTimeString()}] ${line}`) });
const machine = new C4StateMachine((e) => presenter.handleEvent(e));
const policyTracker = new PolicyStateTracker();
let lastAdviceAtNs: bigint | null = null;

const receiver = createGsiReceiver({
  token,
  onPayload: (receipt) => {
    machine.observe(toC4Observation(receipt));

    // Advice line: payload-driven throttle, at most every 5s measured on the
    // receipt's monotonic clock (wall clock is only for display).
    const advice = tick(receipt.payload, { tracker: policyTracker, seq: receipt.seq });
    if (
      advice &&
      (lastAdviceAtNs === null || receipt.receivedAtMonotonicNs - lastAdviceAtNs >= 5_000_000_000n)
    ) {
      lastAdviceAtNs = receipt.receivedAtMonotonicNs;
      console.log(`[${new Date(receipt.receivedAtWallClock).toLocaleTimeString()}] ${advice.side} r${advice.roundNumber} money=$${advice.money} policy=${advice.policy.status}`);
      for (const option of advice.policy.options) {
        console.log(`    ${option.adviceStrength} ${option.mode}: ${purchaseText(option.purchases, 0, false) || "无需购买"} | $${option.bundleSpend}`);
      }
      if (advice.policy.unresolved.length) console.log(`    UNKNOWN: ${advice.policy.unresolved.join("; ")}`);
    }
  },
  onReject: (code, reason) => console.warn(`[reject] ${code} ${reason}`),
});

receiver.server.listen(port, "127.0.0.1", () => {
  console.log(`RoundSense listening on http://127.0.0.1:${port}${token ? ", token auth" : ""}`);
  console.log("GSI cfg (packages/gsi-protocol): gamestate_integration_roundsense.cfg");
});
