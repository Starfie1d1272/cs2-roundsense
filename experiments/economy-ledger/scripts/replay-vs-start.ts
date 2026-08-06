/**
 * Compare startMoney(r+1) vs replay round-r LAST-frame cash (per player).
 * If demoparser2's start_money is sampled at a different time than the end of
 * the previous round (e.g. before round-end settlements), the income-difference
 * ledger systematically misses some money — which would explain residuals.
 * Also compare replay round-r last frame vs round r+1 first frame (buy window).
 */
import { loadDemoPackage } from "@roundsense/demo-oracle";
import { decodeDelta } from "cs2-demo-format/parser";

async function main(): Promise<void> {
  const zipPath = process.argv[2]!;
  const targetR = Number(process.argv[3] ?? 14);
  const pkg = await loadDemoPackage(zipPath);
  const { players, playerEconomies, replay: replayFile } = pkg.files;
  const money = new Map<number, Map<number, { start: number; spent: number }>>();
  for (const e of playerEconomies) { let m = money.get(e.playerIndex) ?? new Map(); m.set(e.roundNumber, { start: e.startMoney, spent: e.moneySpent }); money.set(e.playerIndex, m); }
  const rounds = pkg.files.rounds;
  const rr = rounds.find((r) => r.roundNumber === targetR);
  if (!rr) { console.log("no round", targetR); return; }
  const replay = replayFile;
  if (!replay) { console.log("no replay"); return; }
  const step = rr.tickStep ?? 8;
  // cash per player per replay round: decode once per round (money arrays are
  // delta-encoded per column; decodeDelta gives full stream)
  const startTick = rr.startTick;
  const nextRound = rounds.find((r) => r.roundNumber === targetR + 1);
  for (const t of replay.rounds) {
    if (t.roundNumber !== targetR) continue;
    for (const tr of t.players) {
      const cash = decodeDelta(tr.money);
      const econ = money.get(tr.playerIndex);
      if (!econ) continue;
      const cur = econ.get(targetR);
      const next = econ.get(targetR + 1);
      const lastFrameCash = cash[cash.length - 1];
      const diffToStart = next ? next.start - lastFrameCash : null;
      const name = players[tr.playerIndex]?.name ?? `p${tr.playerIndex}`;
      console.log(`${name}: replayLast=${lastFrameCash} startNext=${next?.start ?? "?"} diff=${diffToStart} spentNext=${next?.spent ?? "?"} (curStart=${cur?.start}) frames=${cash.length}`);
    }
  }
}

void main();
