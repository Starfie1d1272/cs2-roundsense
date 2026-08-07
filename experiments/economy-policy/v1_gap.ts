/**
 * V1 gap analysis — runs the CURRENT production advisor (read-only) on key
 * STRICT states and dumps its spend/loadout for comparison with the
 * professional evidence. Output: results/cologne-2026/v1-gap.csv
 *
 * Run with tsx from the repo root (module resolution needs the workspace):
 *   pnpm exec tsx experiments/economy-policy/v1_gap.ts
 */
import { writeFileSync } from "node:fs";
import { recommend } from "../../packages/economy-advisor/src/advisor.js";
import type { AdvisorInput } from "../../packages/economy-advisor/src/types.js";

const GOALS = ["rifle_armor", "rifle_util", "awp", "max_combat_now"] as const;

interface Row {
  side: string;
  lossReward: number;
  retained: string;
  money: number;
  goal: string;
  rec_class: string;
  rec_cost: number;
  rec_purchases: string;
}

const rows: Row[] = [];
const states: Array<[string, number, string, number]> = [];
for (const side of ["t", "ct"] as const) {
  for (const lr of [1400, 1900, 2400, 2900, 3400]) {
    for (const retained of ["none", "rifle", "awp", "smg"]) {
      for (const money of [1500, 2500, 3000, 3500, 4000, 5000]) {
        states.push([side, lr, retained, money]);
      }
    }
  }
}
const KEY_GOAL: Record<string, string> = {
  none: "rifle_armor", rifle: "rifle_armor", awp: "awp", smg: "rifle_armor",
};
const RETAINED_ITEM: Record<string, string | null> = {
  none: null, rifle: "ak47", awp: "awp", smg: "mp9",
};
for (const [side, lr, retained, money] of states) {
  const goal = KEY_GOAL[retained] ?? "rifle_armor";
  const input: AdvisorInput = {
    side: side as "T" | "CT",
    roundNumber: 8,
    money,
    lossStreak: [1400, 1900, 2400, 2900, 3400].indexOf(lr),
    inventory: {
      primary: RETAINED_ITEM[retained] as AdvisorInput["inventory"]["primary"],
      secondary: null,
      armor: 0,
      hasHelmet: false,
      hasDefuseKit: false,
      grenades: [],
    },
    killsThisRound: [],
    nextRoundGoal: goal as AdvisorInput["nextRoundGoal"],
  };
  const out = recommend(input);
  rows.push({
    side, lossReward: lr, retained, money, goal,
    rec_class: out.recommended?.roundType ?? "save",
    rec_cost: out.recommended?.totalCost ?? 0,
    rec_purchases: (out.recommended?.purchases ?? []).map((p) => `${p.item}x${p.quantity}`).join("+"),
  });
}
const csv = [
  "side,lossReward,retained,money,goal,rec_class,rec_cost,rec_purchases",
  ...rows.map((r) => [r.side, r.lossReward, r.retained, r.money, r.goal, r.rec_class, r.rec_cost, r.rec_purchases].join(",")),
].join("\n");
writeFileSync("experiments/economy-policy/results/cologne-2026/v1-gap.csv", csv);
console.log("v1-gap.csv rows:", rows.length);
