/**
 * Strictly identifiable loss-counter windows (for future runtime cross-check).
 *
 * Pattern:  [L, W, L] — a team loses (known state via payout), wins EXACTLY
 * ONCE (winReason = r.endReason), then loses immediately again.
 *
 * The pre-win state is inferred INDIRECTLY from the pre-win loss payout
 * (payout = min(3400, 1400 + 500×count), extracted from the replay round-end
 * settlement, excluding the CT team award). Windows whose pre/post state is
 * not uniquely identifiable (3400 cap), or that touch any confounder, are
 * excluded. No model is fitted from this set; it is only for later
 * cross-validation against direct GSI/convar reads.
 *
 * Run: pnpm --filter @roundsense/experiment-economy-ledger exec tsx scripts/loss-window-candidates.ts <dir|zip...>
 */
import { loadDemoPackage, loadDemoPackageDir } from "@roundsense/demo-oracle";
import { decodeDelta } from "cs2-demo-format/parser";
import { existsSync, lstatSync, readdirSync } from "node:fs";

interface Candidate {
  match: string;
  round: number; // the WIN round
  side: "CT" | "T";
  player: string;
  inferredStateBefore: number; // lossCount before the win (from r−1 payout)
  winReason: string;
  nextLossPayout: number;
  winTeam: string;
  exclusions: string[]; // empty = passed
}

const WIN_TYPE = (end: string): "elimination" | "time_ran_out" | "target_bombed" | "bomb_defused" =>
  end === "time_ran_out" ? "time_ran_out" : end === "target_bombed" ? "target_bombed" : end === "bomb_defused" ? "bomb_defused" : "elimination";

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  const all: string[] = [];
  for (const p of paths) {
    if (existsSync(p) && lstatSync(p).isDirectory()) { for (const f of readdirSync(p)) all.push(`${p}/${f}`); }
    else all.push(p);
  }
  const candidates: Candidate[] = [];
  const exclusionLog: string[] = [];
  let scanned = 0;
  let debugShown = 0;
  for (const p of all) {
    if (!p.endsWith(".zip")) continue;
    const pkg = await loadDemoPackage(p);
    const { players, rounds, kills, bombs, playerEconomies, replay } = pkg.files;
    if (!replay) continue;
    scanned++;
    const base = p.split("/").pop() ?? p;
    const teamByPlayer = new Map<number, string>();
    players.forEach((pl, i) => teamByPlayer.set(i, pl.teamKey));
    const nameOf = new Map(players.map((pl, i) => [i, pl.name]));
    const roundByNumber = new Map(rounds.map((r) => [r.roundNumber, r]));
    const killsByRound = new Map<number, typeof kills>();
    for (const k of kills) { const a = killsByRound.get(k.roundNumber) ?? []; a.push(k); killsByRound.set(k.roundNumber, a); }
    const plantsByRound = new Map<number, number>();
    for (const b of bombs) if (b.type === "planted") plantsByRound.set(b.roundNumber, (plantsByRound.get(b.roundNumber) ?? 0) + 1);

    for (const r of rounds) {
      if (r.roundNumber < 3) continue; // need r−1, r, r+1
      const prev = roundByNumber.get(r.roundNumber - 1);
      const next = roundByNumber.get(r.roundNumber + 1);
      if (!prev || !next) continue;
      // same half, no OT: r+1 ≤ 12 (first half) or 13 ≤ r−1 and r+1 ≤ 24 (second half)
      const sameHalf = (prev.roundNumber >= 1 && next.roundNumber <= 12) || (prev.roundNumber >= 13 && next.roundNumber <= 24);
      if (!sameHalf) continue;
      const winTeam = r.winnerTeamKey;
      if (!winTeam) continue;
      // L-W-L for the LOSING team X: X loses prev (winner = A), X WINS r
      // (winner = X), X loses next (winner = A). So prev winner == next
      // winner == A, and A != r's winner (X).
      if (prev.winnerTeamKey !== next.winnerTeamKey || prev.winnerTeamKey === winTeam) continue;
      const loseSide = (t: string) => (r.teamASide === t ? "ct" : r.teamBSide === t ? "ct" : r.teamASide === t ? "t" : "t");
      const sideOf = (teamKey: string, rn: number): "ct" | "t" => {
        const rd = roundByNumber.get(rn)!;
        return rd.teamASide === teamKey ? "ct" : "t";
      };
      const loseTeam = prev.winnerTeamKey!; // the team that wins prev+next = NOT the losing team
      const teamIdx = players.map((pl, i) => [i, pl.teamKey] as const).filter(([, t]) => t !== loseTeam).map(([i]) => i);
      const rr = replay.rounds.find((x) => x.roundNumber === r.roundNumber);
      const rrPrev = replay.rounds.find((x) => x.roundNumber === prev.roundNumber);
      const rrNext = replay.rounds.find((x) => x.roundNumber === next.roundNumber);
      if (!rr || !rrPrev || !rrNext) continue;

      // team award for the loss rounds: 50 × tElim (CT side wins only)
      const tElim = (rn: number) => {
        const rd = roundByNumber.get(rn)!;
        const tTeam = rd.teamASide === "t" ? "teamA" : "teamB";
        return (killsByRound.get(rn) ?? []).filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeam).length;
      };

      for (const pi of teamIdx) {
        const tPrev = rrPrev.players.find((t) => t.playerIndex === pi);
        const tNext = rrNext.players.find((t) => t.playerIndex === pi);
        if (!tPrev || !tNext) continue;
        const econ = playerEconomies.filter((e) => e.playerIndex === pi);
        const econPrev = econ.find((e) => e.roundNumber === prev.roundNumber);
        const econNext = econ.find((e) => e.roundNumber === next.roundNumber);
        if (!econPrev || !econNext) continue;
        const exclusions: string[] = [];

        // cash cap
        if (econPrev.startMoney >= 16000 || econNext.startMoney >= 16000) exclusions.push("cash-cap");

        // TK in any of the 3 rounds by this player
        for (const rn of [prev.roundNumber, r.roundNumber, next.roundNumber]) {
          const tk = (killsByRound.get(rn) ?? []).some((k) => k.killerIndex === pi && k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === teamByPlayer.get(pi));
          if (tk) { exclusions.push(`TK-r${rn}`); break; }
        }

        // plant reward pollutes the T-side loss payout (600)
        const sidePrev = sideOf(teamByPlayer.get(pi)!, prev.roundNumber);
        const sideNext = sideOf(teamByPlayer.get(pi)!, next.roundNumber);
        if (sidePrev === "t" && (plantsByRound.get(prev.roundNumber) ?? 0) > 0) exclusions.push("plant-prev");
        if (sideNext === "t" && next.endReason === "bomb_defused" && (plantsByRound.get(next.roundNumber) ?? 0) > 0) exclusions.push("plant-next");
        if (sideNext === "t" && next.endReason === "time_ran_out") exclusions.push("t-survivor-no-bonus");
        // time_ran_out loser payout semantics are unsettled (a counter-example
        // observed: T survivor received 1400) — both sides of the window must
        // avoid time_ran_out loss rounds entirely.
        if (prev.endReason === "time_ran_out") exclusions.push("prev-timeout-loss");
        if (next.endReason === "time_ran_out") exclusions.push("next-timeout-loss");

        // buytime-tail cash flow in the loss rounds (moneySpent blind spot)
        void tPrev; void tNext;

        // pre-win loss payout (replay settlement at prev round end)
        const prevMoney = decodeDelta(tPrev.money);
        const nextMoney = decodeDelta(tNext.money);
        const prevEnd = prev.endTick;
        const tickrate = pkg.manifest.tickrate ?? 64;
        let p1 = 0;
        for (let f = 0; f < prevMoney.length - 1; f++) {
          const tick = rrPrev.startTick + f * rrPrev.tickStep;
          if (tick < prevEnd - 16 || tick > prevEnd + Math.round(5 * tickrate)) continue;
          const d = prevMoney[f + 1]! - prevMoney[f]!;
          if (d > p1) p1 = d; // payout is the single largest positive jump (≥1400)
        }
        // p1 = loss payout (losers never get the team award; kill rewards land
        // at kill time, not in the settlement window)
        const P1 = p1;
        const p1State = P1 >= 3400 ? null : (P1 - 1400) / 500;

        // next loss payout
        let p2 = 0;
        for (let f = 0; f < nextMoney.length - 1; f++) {
          const tick = rrNext.startTick + f * rrNext.tickStep;
          if (tick < next.endTick - 16 || tick > next.endTick + Math.round(5 * tickrate)) continue;
          const d = nextMoney[f + 1]! - nextMoney[f]!;
          if (d > p2) p2 = d; // payout is the single largest positive jump (≥1400)
        }
        if (p2 >= 3400) exclusions.push("cap-next"); // post-win state not identifiable
        if (p2 < 1400) exclusions.push("no-settlement-next"); // missing/aborted round
        if (p2 >= 1400 && !Number.isInteger((p2 - 1400) / 500)) exclusions.push("non-table-payout-next");
        if (p1State === null) exclusions.push("cap-prev");
        if (!Number.isInteger(p1State) || (p1State ?? 0) < 0) exclusions.push("non-table-payout-prev");
        if (process.env.CAND_DEBUG && exclusions.includes("non-table-payout-prev") && debugShown < 4) {
          debugShown++;
          const jumps: string[] = [];
          for (let f = 0; f < prevMoney.length - 1; f++) {
            const tick = rrPrev.startTick + f * rrPrev.tickStep;
            if (tick < prevEnd - 32 || tick > prevEnd + Math.round(6 * tickrate)) continue;
            const d = prevMoney[f + 1]! - prevMoney[f]!;
            if (d !== 0) jumps.push(`${d}@${tick - prevEnd}`);
          }
          console.error(`DBG ${base} r${prev.roundNumber} p${pi} ${nameOf.get(pi)} p1=${p1} jumps=[${jumps.join(", ")}] endReason=${prev.endReason} winner=${prev.winnerTeamKey}`);
        }

        // missing frames / no replay track beyond settlement
        if (prevMoney.length < 4 || nextMoney.length < 4) exclusions.push("short-replay");

        // buytime tail check on the loss rounds (equip-coupled cash after freezeEnd)
        for (const [t, rd] of [[tPrev, prev], [tNext, next]] as const) {
          const money = decodeDelta(t.money);
          const equip = decodeDelta(t.equipValue);
          for (let f = 0; f < money.length - 1; f++) {
            const tick = (rd.roundNumber === prev.roundNumber ? rrPrev : rrNext).startTick + f * (rd.roundNumber === prev.roundNumber ? rrPrev : rrNext).tickStep;
            if (tick <= rd.freezeEndTick) continue;
            const d = money[f + 1]! - money[f]!;
            const eq = equip[f + 1]! - equip[f]!;
            if (d !== 0 && eq !== 0) { exclusions.push(`tail-flow-r${rd.roundNumber}`); break; }
          }
        }

        if (exclusions.length === 0) {
          candidates.push({
            match: base,
            round: r.roundNumber,
            side: sideOf(teamByPlayer.get(pi)!, r.roundNumber) === "ct" ? "CT" : "T",
            player: nameOf.get(pi) ?? `p${pi}`,
            inferredStateBefore: p1State!,
            winReason: WIN_TYPE(r.endReason),
            nextLossPayout: p2,
            winTeam,
            exclusions,
          });
        } else {
          exclusionLog.push(...exclusions);
        }
      }
    }
  }
  const byType = (t: string) => candidates.filter((c) => c.winReason === t);
  console.log(`scanned ${scanned} matches with replay; strict candidates: ${candidates.length}`);
  // exclusion diagnostics
  const exclCount = new Map<string, number>();
  for (const e of exclusionLog) exclCount.set(e, (exclCount.get(e) ?? 0) + 1);
  console.log("exclusions:", [...exclCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(", "));
  // descriptive decrement summary (NO model selection from this set)
  const decAgg = new Map<string, { n: number; decs: Map<number, number> }>();
  for (const c of candidates) {
    const nextState = (c.nextLossPayout - 1400) / 500;
    const dec = c.inferredStateBefore - nextState;
    const key = `${c.winReason}|stateBefore=${c.inferredStateBefore}`;
    const row = decAgg.get(key) ?? { n: 0, decs: new Map() };
    row.n++;
    row.decs.set(dec, (row.decs.get(dec) ?? 0) + 1);
    decAgg.set(key, row);
  }
  console.log("\ndec (stateBefore − stateAfter) distribution by win type:");
  for (const [k, v] of [...decAgg.entries()].sort()) {
    console.log(`  ${k}: n=${v.n} decs={${[...v.decs.entries()].map(([d, c]) => `${d}×${c}`).join(", ")}}`);
  }
  // unique windows (one per match+round) for the report table
  const uniq = new Set<string>();
  for (const c of candidates) uniq.add(`${c.match}|${c.round}|${c.winReason}|${c.inferredStateBefore}`);
  console.log(`unique windows: ${uniq.size}`);
  for (const t of ["elimination", "time_ran_out", "target_bombed", "bomb_defused"] as const) {
    const list = byType(t);
    console.log(`\n== ${t}: ${list.length} ==`);
    for (const c of list) console.log(`  ${c.match} r${c.round} ${c.side} ${c.player.padEnd(12)} stateBefore=${c.inferredStateBefore} nextLossPayout=${c.nextLossPayout}`);
  }
}

void main();
