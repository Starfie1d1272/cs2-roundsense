/**
 * CONTROLLED EXPERIMENT: win → next-loss payout, by win type.
 * For each round w (win by team X, endReason E), find the FIRST subsequent
 * loss of team Y before any win, get their payout (from income), and derive
 * the lossCount implied: payout = 1400 + 500 × lossCount → count = (payout−1400)/500.
 * Compare with the model counter before that loss (which depends on the win
 * decrement hypothesis). Report the implied count directly.
 */
import { loadDemoPackage } from "@roundsense/demo-oracle";

const KR: Record<string, number> = { rifle: 300, smg: 600, pistol: 300, awp: 100, sniper: 300, shotgun: 900, mg: 300, knife: 1500, zeus: 100, grenade: 300, p90: 300, cz75a: 100, sawedoff: 900, nova: 900, mag7: 900, xm1014: 600, m249: 300, negev: 300 };
const CLS: Array<[RegExp, string]> = [
  [/^(ak47|m4a4|m4a1_silencer|m4a1|galilar|famas|sg556|aug)$/, "rifle"],
  [/^awp$/, "awp"], [/^(ssg08|scar20|g3sg1)$/, "sniper"],
  [/^(mac10|mp9|mp7|mp5sd|ump45|p90|bizon)$/, "smg"],
  [/^(nova|sawedoff|mag7|xm1014)$/, "shotgun"], [/^(m249|negev)$/, "mg"],
  [/^(glock|usp_silencer|hkp2000|p250|elite|tec9|cz75a|fiveseven|deagle|revolver)$/, "pistol"],
  [/^(hegrenade|molotov|incgrenade|inferno|decoy)$/, "grenade"], [/^taser$/, "zeus"], [/^knife/, "knife"], [/^world$/, "world"],
];
const wc = (w: string) => { if (w === "p90" || w === "cz75a" || w === "sawedoff" || w === "nova" || w === "mag7" || w === "xm1014" || w === "m249" || w === "negev") return w; for (const [re, c] of CLS) if (re.test(w)) return c; return `u:${w}`; };

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  const allPaths: string[] = [];
  for (const p of paths) {
    const { existsSync, lstatSync, readdirSync } = await import("node:fs");
    if (existsSync(p) && lstatSync(p).isDirectory()) { for (const f of readdirSync(p)) allPaths.push(`${p}/${f}`); }
    else allPaths.push(p);
  }
  const byWinType = new Map<string, { n: number; impliedCounts: Map<number, number>; examples: string[] }>();
  let totalLoss = 0;
  for (const p of allPaths) {
    if (!p.endsWith(".zip")) continue;
    const pkg = await loadDemoPackage(p);
    const { players, rounds, kills, bombs, playerEconomies } = pkg.files;
    const teamByPlayer = new Map<number, string>();
    players.forEach((p2, i) => teamByPlayer.set(i, p2.teamKey));
    const money = new Map<number, Map<number, { start: number; spent: number }>>();
    for (const e of playerEconomies) { let m = money.get(e.playerIndex) ?? new Map(); m.set(e.roundNumber, { start: e.startMoney, spent: e.moneySpent }); money.set(e.playerIndex, m); }
    const roundByNumber = new Map(rounds.map((r) => [r.roundNumber, r]));
    const killsByRound = new Map<number, typeof kills>();
    for (const k of kills) { const l = killsByRound.get(k.roundNumber) ?? []; l.push(k); killsByRound.set(k.roundNumber, l); }
    const plantedByRound = new Map<number, boolean>();
    const plantPlayers = new Map<number, Set<number>>();
    const defusePlayers = new Map<number, Set<number>>();
    for (const b of bombs) {
      if (b.type === "planted") { plantedByRound.set(b.roundNumber, true); const s = plantPlayers.get(b.roundNumber) ?? new Set(); s.add(b.actorIndex); plantPlayers.set(b.roundNumber, s); }
      if (b.type === "defused") { const s = defusePlayers.get(b.roundNumber) ?? new Set(); s.add(b.actorIndex); defusePlayers.set(b.roundNumber, s); }
    }
    const roundsSorted = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
    for (const winRound of roundsSorted) {
      const w = winRound.roundNumber;
      const loserTeam = winRound.winnerTeamKey === "teamA" ? "teamB" : "teamA";
      // find next loss of loserTeam (before any win by them, same half)
      const half = w <= 12 ? 1 : 2;
      let nextLoss = -1;
      for (const rr of roundsSorted) {
        if (rr.roundNumber <= w) continue;
        if ((half === 1 && rr.roundNumber > 12) || (half === 2 && rr.roundNumber < 13)) break;
        if (rr.roundNumber >= 25) break; // skip OT
        if (rr.winnerTeamKey !== loserTeam) { nextLoss = rr.roundNumber; break; }
      }
      if (nextLoss < 0) continue;
      const lossRound = roundByNumber.get(nextLoss)!;
      const prev = roundByNumber.get(nextLoss - 1)!;
      const prevKills = killsByRound.get(nextLoss - 1) ?? [];
      const deadSet = new Set<number>();
      for (const k of prevKills) if (k.victimIndex !== null) deadSet.add(k.victimIndex);
      const tTeamKey = prev.teamASide === "t" ? "teamA" : "teamB";
      const tElim = prevKills.filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKey).length;
      const prevPlanted = plantedByRound.get(nextLoss - 1) ?? false;
      // pick one player of loserTeam (dead one, non-TK) for income
      let sample: { playerIndex: number; income: number; killsReward: number; extra: number } | null = null;
      for (const [playerIndex, m] of money) {
        const a = m.get(nextLoss - 1); const b = m.get(nextLoss); if (!a || !b) continue;
        const teamKey = teamByPlayer.get(playerIndex); if (!teamKey) continue;
        if (teamKey !== loserTeam) continue;
        const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;
        if (prev.endReason === "time_ran_out" && prevSide === "t" && !deadSet.has(playerIndex)) continue; // survivor: no bonus
        const income = b.start - a.start + a.spent;
        let killsReward = 0; let tk = 0;
        const myTeam = teamByPlayer.get(playerIndex);
        for (const k of prevKills) {
          if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex) {
            if (teamByPlayer.get(k.victimIndex) === myTeam) { tk++; continue; }
            const v = KR[wc(k.weapon)]; if (v !== undefined) killsReward += v;
          }
        }
        const extra = (prevSide === "ct" ? 50 * tElim : 0) - 300 * tk + (!winRound.winnerTeamKey ? 0 : 0) // team award + TK
          + (plantPlayers.get(nextLoss - 1)?.has(playerIndex) ? 300 : 0) + (defusePlayers.get(nextLoss - 1)?.has(playerIndex) ? 300 : 0)
          + (!(prev.winnerTeamKey === teamKey) && prevSide === "t" && prevPlanted ? 600 : 0);
        sample = { playerIndex, income, killsReward, extra };
        break;
      }
      if (!sample) continue;
      // implied lossCount = (income − killsReward − extra − 1400) / 500
      const implied = (sample.income - sample.killsReward - sample.extra - 1400) / 500;
      if (implied < 0 || implied > 5 || !Number.isInteger(implied)) continue;
      totalLoss++;
      const t = byWinType.get(winRound.endReason) ?? { n: 0, impliedCounts: new Map(), examples: [] };
      t.n++;
      t.impliedCounts.set(implied, (t.impliedCounts.get(implied) ?? 0) + 1);
      if (t.examples.length < 5) t.examples.push(`w=r${w}(${winRound.endReason}) → loss=r${nextLoss} impliedCount=${implied} winLoserStreakBefore=${"?"}`);
      byWinType.set(winRound.endReason, t);
    }
  }
  console.log(`total win→loss samples: ${totalLoss}`);
  for (const [k, t] of byWinType) {
    const dist = [...t.impliedCounts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `cnt${c}×${n}`).join(", ");
    console.log(`${k}: n=${t.n} → ${dist}`);
    for (const e of t.examples) console.log(`    ${e}`);
  }
}

void main();
