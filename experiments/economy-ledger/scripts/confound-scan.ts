/**
 * Hunt the three unmodeled confounders:
 *  1. SHORTHANDED: rounds where a team has <5 players with economy rows
 *     (cash_team_bonus_shorthanded = 1000, present in gamemode_competitive.cfg)
 *  2. CAP: samples with start(r) === 16000 (income truncated)
 *  3. REFUND: spent > plausible purchase (can't verify directly, count big spent)
 * Run: tsx scripts/confound-scan.ts <zip-or-dir...>
 */
import { loadDemoPackage, teamLossStreakPerRound } from "@roundsense/demo-oracle";

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  const allPaths: string[] = [];
  for (const p of paths) {
    const { existsSync, lstatSync, readdirSync } = await import("node:fs");
    if (existsSync(p) && lstatSync(p).isDirectory()) { for (const f of readdirSync(p)) allPaths.push(`${p}/${f}`); }
    else allPaths.push(p);
  }
  let shortRounds = 0;
  let shortSamples = 0;
  let capSamples = 0;
  let capResidualSum = 0;
  const capResiduals = new Map<number, number>();
  let bigSpent = 0;
  const shortExamples: string[] = [];
  const matches = allPaths.filter((p) => p.endsWith(".zip"));
  for (const p of matches) {
    const pkg = await loadDemoPackage(p);
    const { players, rounds, kills, playerEconomies } = pkg.files;
    const teamByPlayer = new Map<number, string>();
    players.forEach((p2, i) => teamByPlayer.set(i, p2.teamKey));
    const money = new Map<number, Map<number, { start: number; spent: number }>>();
    for (const e of playerEconomies) { let m = money.get(e.playerIndex) ?? new Map(); m.set(e.roundNumber, { start: e.startMoney, spent: e.moneySpent }); money.set(e.playerIndex, m); }
    const roundByNumber = new Map(rounds.map((r) => [r.roundNumber, r]));
    const streaks = teamLossStreakPerRound(pkg);
    const killsByRound = new Map<number, typeof kills>();
    for (const k of kills) { const l = killsByRound.get(k.roundNumber) ?? []; l.push(k); killsByRound.set(k.roundNumber, l); }
    // per-round team player counts
    for (const round of rounds) {
      const r = round.roundNumber;
      if (r < 2 || r === 13) continue;
      const prev = roundByNumber.get(r - 1); if (!prev) continue;
      const prevKills = killsByRound.get(r - 1) ?? [];
      const deadSet = new Set<number>();
      for (const k of prevKills) if (k.victimIndex !== null) deadSet.add(k.victimIndex);
      const tTeamKey = prev.teamASide === "t" ? "teamA" : "teamB";
      const tElim = prevKills.filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKey).length;
      for (const teamKey of ["teamA", "teamB"] as const) {
        // count players of this team with economy rows in prev round
        // (v3: players.json has no index field — array position is the index)
        const withRows = players.filter((p2, i) => p2.teamKey === teamKey && money.get(i)?.has(r - 1)).length;
        if (withRows < 5) {
          shortRounds++;
          if (shortExamples.length < 6) shortExamples.push(`${p.split("/").pop()} r${r - 1} ${teamKey} players=${withRows}/5 (prev round)`);
        }
      }
      for (const [playerIndex, m] of money) {
        const a = m.get(r - 1); const b = m.get(r); if (!a || !b) continue;
        if (b.start >= 16000) {
          capSamples++;
          const teamKey = teamByPlayer.get(playerIndex); if (!teamKey) continue;
          const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;
          const wonPrev = prev.winnerTeamKey === teamKey;
          let modeled = 0;
          if (prevSide === "ct") modeled += 50 * tElim;
          if (wonPrev) modeled += prev.endReason === "target_bombed" || prev.endReason === "bomb_defused" ? 3500 : 3250;
          else modeled += Math.min(3400, 1400 + 500 * (streaks.get(`${r - 1}:${teamKey}`) ?? 0));
          const myTeam = teamByPlayer.get(playerIndex);
          for (const k of prevKills) {
            if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex && teamByPlayer.get(k.victimIndex) !== myTeam) modeled += 300;
          }
          const income = b.start - a.start + a.spent;
          const residual = income - modeled;
          capResiduals.set(residual, (capResiduals.get(residual) ?? 0) + 1);
          capResidualSum += residual;
        }
        if (a.spent > 6000) bigSpent++;
      }
    }
  }
  console.log(`matches=${matches.length}`);
  console.log(`SHORTHANDED rounds (team <5 economy rows in prev round): ${shortRounds}`);
  for (const e of shortExamples) console.log(`  ${e}`);
  console.log(`CAP samples (start=16000): ${capSamples} meanResidual=${(capResidualSum / Math.max(1, capSamples)).toFixed(0)}`);
  console.log(`  cap residual dist: ${[...capResiduals.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([d, c]) => `${d}×${c}`).join(", ")}`);
  console.log(`BIG SPENT (>6000/round): ${bigSpent}`);
}

void main();
