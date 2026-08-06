/**
 * Replay ledger reconciliation v4 — prove startMoney misses the team award.
 *
 * v3 found replay FIRST frames are post-purchase cash (T eco players match
 * startMoney exactly, buying CT players don't), so first-frame reconciliation
 * is confounded by spending. Instead reconcile the ROUND BOUNDARY:
 *
 *   startMoney(p, r+1) − endCash(p, r)   where endCash = last replay frame
 *
 * Expected:
 *   T players: 0  (loss/win bonus settles before the startMoney sample)
 *   CT players: −50 × ctKills(r)  (team award settles AFTER the sample → startMoney misses it)
 *
 * Run: pnpm --filter @roundsense/experiment-economy-ledger exec tsx scripts/replay-ledger-reconcile.ts <zip>...
 */
import { loadDemoPackage, type ParsedDemoPackage } from "@roundsense/demo-oracle";
import { decodeDelta } from "cs2-demo-format/parser";

async function analyzeOne(pkg: ParsedDemoPackage, label: string): Promise<void> {
  const { files } = pkg;
  const replay = files.replay;
  if (!replay) { console.log(`${label}: no replay — skipped`); return; }

  const teamByPlayer = new Map<number, string>();
  for (const [i, p] of files.players.entries()) teamByPlayer.set(i, p.teamKey);
  const sideOf = (teamKey: string, roundNumber: number): "ct" | "t" | null => {
    const r = files.rounds.find((x) => x.roundNumber === roundNumber);
    if (!r) return null;
    return teamKey === "teamA" ? r.teamASide : r.teamBSide;
  };

  const econ = new Map<string, { start: number }>();
  for (const e of files.playerEconomies) econ.set(`${e.roundNumber}:${e.playerIndex}`, { start: e.startMoney });

  const ctKillsByRound = new Map<number, number>();
  for (const k of files.kills) {
    if (k.killerIndex === null) continue;
    const kTeam = teamByPlayer.get(k.killerIndex);
    const vTeam = teamByPlayer.get(k.victimIndex);
    if (!kTeam || !vTeam) continue;
    if (sideOf(kTeam, k.roundNumber) === "ct" && sideOf(vTeam, k.roundNumber) === "t") {
      ctKillsByRound.set(k.roundNumber, (ctKillsByRound.get(k.roundNumber) ?? 0) + 1);
    }
  }

  // endCash per round per player: last frame money of the replay track
  const endCash = new Map<string, number>(); // `${round}:${player}`
  for (const rr of replay.rounds) {
    for (const t of rr.players) {
      const money = decodeDelta(t.money);
      if (money.length === 0) continue;
      endCash.set(`${rr.roundNumber}:${t.playerIndex}`, money[money.length - 1]!);
    }
  }

  const ctGroups = new Map<number, number[]>(); // ctKills(r) → [diff]
  const tDiffs: number[] = [];
  let rows = 0;
  const examples: string[] = [];

  for (const rr of replay.rounds) {
    const r = rr.roundNumber;
    const next = econKeyFor(r + 1);
    const ctKills = ctKillsByRound.get(r) ?? 0;
    for (const t of rr.players) {
      const p = t.playerIndex;
      const ec = endCash.get(`${r}:${p}`);
      if (ec === undefined) continue;
      const nextRow = econ.get(`${r + 1}:${p}`);
      if (!nextRow) continue;
      const diff = nextRow.start - ec;
      const side = sideOf(teamByPlayer.get(p) ?? "", r);
      rows++;
      if (side === "ct") {
        const list = ctGroups.get(ctKills) ?? [];
        list.push(diff);
        ctGroups.set(ctKills, list);
        if (examples.length < 8) examples.push(`r${r}→${r + 1} p${p} CT: endCash=${ec} startMoney(${r + 1})=${nextRow.start} diff=${diff} (ctKills=${ctKills}, expected −${50 * ctKills})`);
      } else {
        tDiffs.push(diff);
        if (examples.length < 10) examples.push(`r${r}→${r + 1} p${p} T: endCash=${ec} startMoney(${r + 1})=${nextRow.start} diff=${diff} (expected 0)`);
      }
    }
  }

  function econKeyFor(_r: number): string { return ""; }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  console.log(`\n=== ${label} (rows=${rows}) ===`);
  console.log("diff = startMoney(r+1) − endCash(r); expected CT = −50×ctKills(r), T = 0");
  for (const [k, list] of [...ctGroups.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  CT ctKills=${k}: n=${list.length} meanDiff=${mean(list).toFixed(1)} per-kill=${k > 0 ? (mean(list) / k).toFixed(1) : "—"}`);
  }
  console.log(`  T (any): n=${tDiffs.length} meanDiff=${mean(tDiffs).toFixed(1)}`);
  for (const ex of examples.slice(0, 10)) console.log(`  ${ex}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) { console.error("usage: replay-ledger-reconcile.ts <zip>..."); process.exit(1); }
  for (const f of args) {
    try {
      const pkg = await loadDemoPackage(f);
      await analyzeOne(pkg, f.split("/").pop() ?? f);
    } catch (e) {
      console.error(`✗ ${f}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
}

void main();
