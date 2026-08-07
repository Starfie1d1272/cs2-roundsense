/**
 * Policy V2 offline replay — DESCRIPTIVE comparison against the frozen
 * professional evidence (research/economy-policy @ 0875db9).
 *
 * Reads the professional policy-review-table from the research branch via
 * `git show` (read-only; nothing is merged). Runs decidePolicy() on every
 * supported state and classifies spend/primary divergence.
 *
 * NO automatic tuning — this is a descriptive review artifact only.
 *
 * Run: pnpm exec tsx experiments/economy-policy/replay-policy-v2.ts
 * Out: experiments/economy-policy/results/policy-v2-review/policy-v2-review.md
 *      experiments/economy-policy/results/policy-v2-review/policy-v2-replay.csv
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decidePolicy, nextRoundBaselineCost } from "../../packages/economy-advisor/src/policy-v2.js";
import { DEFAULT_RULES, price } from "../../packages/economy-advisor/src/rules.js";
import type { InventoryState } from "../../packages/economy-advisor/src/types.js";
import type { Side } from "@roundsense/shared-types";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "results", "policy-v2-review");
mkdirSync(OUT, { recursive: true });

// read the professional review table from the research branch (read-only)
const csvText = execFileSync("git", [
  "show", "research/economy-policy:experiments/economy-policy/results/cologne-2026/policy-review-table.csv",
], { encoding: "utf8", cwd: join(HERE, "..", "..") });
const lines = csvText.trim().split("\n");
const header = lines[0].split(",");
const rows = lines.slice(1).map((l) => {
  const parts: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of l) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === "," && !inQ) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  return Object.fromEntries(header.map((h, i) => [h, parts[i]]));
});
console.log("professional review rows:", rows.length);

function inv(over: Partial<InventoryState> = {}): InventoryState {
  return { primary: null, secondary: undefined, armor: 0, hasHelmet: false, hasDefuseKit: false, grenades: [], ...over };
}

interface Out {
  side: string; lr: number; money: number; retained: string;
  tag: string; intent: string; cost: number; spendCeiling: number;
  profP25: number; profMed: number; profP75: number;
  spendBand: "below_p25" | "within" | "above_p75";
  prim: string; primProb: number; primSupport: "high" | "low" | "absent" | "n/a";
  armor: boolean; helmet: boolean; kit: boolean; util: string;
  nextLoss: number; conf: string;
}

const out: Out[] = [];
for (const r of rows) {
  const side = (r.side === "t" ? "T" : "CT") as Side;
  const lr = Number(r.lossReward);
  const M = Number(r.roundStartMoney);
  const retained = r.retained_value;
  if (retained !== "none" && retained !== "AK-47" && retained !== "M4A4" && retained !== "M4A1-S" && retained !== "AWP" && retained !== "MP9" && retained !== "MAC-10") continue;
  const inventory = retained === "none" ? inv() : inv({ primary: retained === "AK-47" ? "ak47" : retained === "M4A4" ? "m4a4" : retained === "M4A1-S" ? "m4a1s" : retained === "AWP" ? "awp" : retained === "MP9" ? "mp9" : "mac10" });
  const d = decidePolicy({
    side, lossReward: lr, roundStartMoney: M, roundStartMoneyConfidence: "exact",
    currentMoney: M, currentInventory: inventory,
  });
  const p25 = Number(r.spend_p25 ?? 0);
  const p75 = Number(r.spend_p75 ?? 0);
  const spendBand = d.totalCost < p25 ? "below_p25" : d.totalCost > p75 ? "above_p75" : "within";
  // chosen primary probability from the professional distribution
  const primName = (() => {
    const ps = (r.top3_primary ?? "").split(";").map((s) => s.split(":")[0]);
    if (d.primaryIntent === "keep_current") return "keep_current";
    const bought = d.purchases.find((p) => ["ak47", "m4a4", "m4a1s", "galil", "famas", "awp", "mac10", "mp9", "tec9", "fiveseven", "p250"].includes(p.item));
    if (!bought) return "none";
    const map: Record<string, string> = { ak47: "AK-47", m4a4: "M4A4", m4a1s: "M4A1-S", galil: "Galil AR", famas: "FAMAS", awp: "AWP", mac10: "MAC-10", mp9: "MP9", tec9: "Tec-9", fiveseven: "Five-SeveN", p250: "P250" };
    return map[bought.item] ?? bought.item;
  })();
  let primProb = 0;
  let primSupport: Out["primSupport"] = "absent";
  if (primName !== "none" && primName !== "keep_current") {
    for (const seg of (r.top3_primary ?? "").split(";")) {
      const [w, pct] = seg.split(":");
      if (w === primName) {
        primProb = Number(pct) / 100;
        primSupport = primProb >= 0.2 ? "high" : "low";
        break;
      }
    }
  } else if (primName === "keep_current") {
    primSupport = "n/a";
  }
  out.push({
    side, lr, money: M, retained,
    tag: d.displayTag, intent: d.primaryIntent, cost: d.totalCost, spendCeiling: d.spendCeiling,
    profP25: p25, profMed: Number(r.spend_median ?? 0), profP75: p75, spendBand,
    prim: primName, primProb, primSupport,
    armor: d.purchases.some((p) => p.item === "kevlar" || p.item === "kevlar_helmet"),
    helmet: d.purchases.some((p) => p.item === "kevlar_helmet"),
    kit: d.defuseKit,
    util: [d.utilityIntent.smoke ? "smoke" : "", d.utilityIntent.flashes ? `flash${d.utilityIntent.flashes}` : "", d.utilityIntent.he ? "HE" : "", d.utilityIntent.fire ? "fire" : ""].filter(Boolean).join("+") || "-",
    nextLoss: d.projection.lossAfterRecommendation, conf: d.confidence,
  });
}

// ---- summary ----
function pct(n: number, t: number): string {
  return `${t === 0 ? 0 : Math.round((100 * n) / t)}%`;
}
const total = out.length;
const bands = { below_p25: 0, within: 0, above_p75: 0 };
const bySide: Record<string, { below_p25: number; within: number; above_p75: number }> = { T: { below_p25: 0, within: 0, above_p75: 0 }, CT: { below_p25: 0, within: 0, above_p75: 0 } };
const byLr: Record<string, { below_p25: number; within: number; above_p75: number }> = {};
const byRetained: Record<string, { below_p25: number; within: number; above_p75: number }> = {};
for (const o of out) {
  bands[o.spendBand]++;
  bySide[o.side][o.spendBand]++;
  byLr[o.lr] = byLr[o.lr] ?? { below_p25: 0, within: 0, above_p75: 0 };
  byLr[o.lr][o.spendBand]++;
  byRetained[o.retained] = byRetained[o.retained] ?? { below_p25: 0, within: 0, above_p75: 0 };
  byRetained[o.retained][o.spendBand]++;
}

// divergence states: biggest |policy cost - professional median| and tag differences
const divergences = [...out].sort((a, b) => Math.abs(b.cost - b.profMed) - Math.abs(a.cost - a.profMed)).slice(0, 30);

const md: string[] = [];
md.push("# Policy V2 Offline Replay — Descriptive Comparison");
md.push("");
md.push("> Professional evidence source: research/economy-policy @ 0875db9 (policy-review-table.csv, supported states only).");
md.push("> Policy: human-designed V2 (this branch). DESCRIPTIVE COMPARISON — no automatic tuning.");
md.push("");
md.push(`states replayed: ${total}`);
md.push("");
md.push("## Overall spend vs professional distribution");
md.push("");
md.push(`- below professional p25: ${pct(bands.below_p25, total)}`);
md.push(`- within p25–p75: ${pct(bands.within, total)}`);
md.push(`- above professional p75: ${pct(bands.above_p75, total)}`);
md.push("");
md.push("## By side");
md.push("");
for (const side of ["T", "CT"]) {
  const b = bySide[side];
  const t = b.below_p25 + b.within + b.above_p75;
  md.push(`- ${side}: below p25 ${pct(b.below_p25, t)} · within ${pct(b.within, t)} · above p75 ${pct(b.above_p75, t)} (n=${t})`);
}
md.push("");
md.push("## By lossReward");
md.push("");
for (const lr of [1400, 1900, 2400, 2900, 3400]) {
  const b = byLr[lr];
  if (!b) continue;
  const t = b.below_p25 + b.within + b.above_p75;
  md.push(`- lr${lr}: below p25 ${pct(b.below_p25, t)} · within ${pct(b.within, t)} · above p75 ${pct(b.above_p75, t)} (n=${t})`);
}
md.push("");
md.push("## By retained state");
md.push("");
for (const [rv, b] of Object.entries(byRetained)) {
  const t = b.below_p25 + b.within + b.above_p75;
  md.push(`- ${rv}: below p25 ${pct(b.below_p25, t)} · within ${pct(b.within, t)} · above p75 ${pct(b.above_p75, t)} (n=${t})`);
}
md.push("");
md.push("## Chosen primary professional support");
md.push("");
const primSup = { high: 0, low: 0, absent: 0, n_a: 0 };
for (const o of out) {
  if (o.primSupport === "high") primSup.high++;
  else if (o.primSupport === "low") primSup.low++;
  else if (o.primSupport === "absent") primSup.absent++;
  else primSup.n_a++;
}
md.push(`- high professional support (≥20%): ${pct(primSup.high, total)}`);
md.push(`- low support (<20%): ${pct(primSup.low, total)}`);
md.push(`- absent from professional top3: ${pct(primSup.absent, total)}`);
md.push(`- keep_current (n/a): ${pct(primSup.n_a, total)}`);
md.push("");
md.push("## Intentional divergences (human policy)");
md.push("");
md.push("- Conservative strong-buy gate (pro full≥80%) — below gate we prefer preservation over blind force.");
md.push("- AWP auto-disabled: auto never guides non-AWP players to AWP (proficiency divergence).");
md.push("- Retained SMG not auto-replaced (drop/team channel invisible).");
md.push("- CT helmet lower priority than smoke/kit (no enemy weapon context).");
md.push("- Deagle not an auto paid pistol.");
md.push("");
md.push("## Top 30 divergence states (|policy cost − pro median|)");
md.push("");
md.push("| side | lr | money | retained | tag | policy $ | pro p25/med/p75 | band | primary (pro support) |");
md.push("|---|---|---|---|---|---|---|---|---|");
for (const o of divergences) {
  md.push(`| ${o.side} | ${o.lr} | ${o.money} | ${o.retained} | ${o.tag} | ${o.cost} | ${o.profP25}/${o.profMed}/${o.profP75} | ${o.spendBand} | ${o.prim} (${o.primSupport}) |`);
}
md.push("");
md.push("## Answering the review questions (observation only)");
md.push("");
md.push("- Where is the conservative policy deliberately cheaper than pros? Below-gate states where preservationBudget < tier core (we save instead of force).");
md.push("- Where does it value the current round more? strong-buy states spend to full rifle+armor+util within cash; max_combat override explicitly.");
md.push("- AWP auto-disabled divergence: professional AWP probability in non-AWP states is untouched — auto keeps those states rifle/light.");
md.push("- Retained-SMG no-replace divergence: professional may swap SMG→rifle at higher money; V2 keeps SMG (drop channel invisible).");
md.push("");
md.push("## Limitations");
md.push("");
md.push("- Comparison uses professional conditional behavior; professional ≠ optimal.");
md.push("- policy spend is incremental (current inventory); professional spend is per-round observed — retained states are not directly comparable in level.");

writeFileSync(join(OUT, "policy-v2-review.md"), md.join("\n"));

// CSV
const csvHeader = "side,lr,money,retained,tag,intent,cost,spendCeiling,profP25,profMed,profP75,spendBand,primary,primaryProb,primarySupport,armor,helmet,kit,util,nextLoss,confidence";
const csvLines = out.map((o) => [o.side, o.lr, o.money, o.retained, o.tag, o.intent, o.cost, o.spendCeiling, o.profP25, o.profMed, o.profP75, o.spendBand, o.prim, o.primProb.toFixed(3), o.primSupport, o.armor, o.helmet, o.kit, o.util, o.nextLoss, o.conf].join(","));
writeFileSync(join(OUT, "policy-v2-replay.csv"), [csvHeader, ...csvLines].join("\n"));
console.log("replay done:", out.length, "states");
console.log(`spend bands: below_p25 ${bands.below_p25} (${pct(bands.below_p25, total)}) · within ${bands.within} (${pct(bands.within, total)}) · above_p75 ${bands.above_p75} (${pct(bands.above_p75, total)})`);
