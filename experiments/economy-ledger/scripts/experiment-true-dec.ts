/**
 * Decisive: TRUE win decrement measured from TEAM MODAL payouts (robust to
 * per-player noise). For each win round: countBeforeWin (from modal payout of
 * the last loss before the win) vs countAfterWin (modal payout of the next
 * loss), decrement = countBefore − countAfter.
 * payout = 1400 + 500 × lossCount (gamemode_competitive.cfg).
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

interface TruthRow { payout: number; lossCount: number }

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  const allPaths: string[] = [];
  for (const p of paths) {
    const { existsSync, lstatSync, readdirSync } = await import("node:fs");
    if (existsSync(p) && lstatSync(p).isDirectory()) { for (const f of readdirSync(p)) allPaths.push(`${p}/${f}`); }
    else allPaths.push(p);
  }
  const decByType = new Map<string, Map<number, number>>();
  const examples: string[] = [];
  let resolved = 0;
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
    const truth = new Map<string, TruthRow>(); // `${round}:${teamKey}` = modal payout of that team's loss in that round
    const modalCount = (r: number, teamKey: string): number => {
      const row = truth.get(`${r}:${teamKey}`);
      return row ? row.lossCount : -1;
    };
    for (const round of rounds) {
      const r = round.roundNumber;
      if (r < 2 || r === 13) continue;
      const prev = roundByNumber.get(r - 1); if (!prev) continue;
      const prevKills = killsByRound.get(r - 1) ?? [];
      const deadSet = new Set<number>();
      for (const k of prevKills) if (k.victimIndex !== null) deadSet.add(k.victimIndex);
      const tTeamKey = prev.teamASide === "t" ? "teamA" : "teamB";
      const tElim = prevKills.filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKey).length;
      const prevPlanted = plantedByRound.get(r - 1) ?? false;
      const loserTeam = prev.winnerTeamKey === "teamA" ? "teamB" : "teamA";
      const payouts: number[] = [];
      for (const [playerIndex, m] of money) {
        const a = m.get(r - 1); const b = m.get(r); if (!a || !b) continue;
        const teamKey = teamByPlayer.get(playerIndex); if (!teamKey) continue;
        if (teamKey !== loserTeam) continue;
        const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;
        if (prev.endReason === "time_ran_out" && prevSide === "t" && !deadSet.has(playerIndex)) continue;
        const income = b.start - a.start + a.spent;
        if (b.start >= 16000) continue;
        let killsReward = 0; let tk = 0;
        const myTeam = teamByPlayer.get(playerIndex);
        for (const k of prevKills) {
          if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex) {
            if (teamByPlayer.get(k.victimIndex) === myTeam) { tk++; continue; }
            const v = KR[wc(k.weapon)]; if (v !== undefined) killsReward += v;
          }
        }
        const extras = (prevSide === "ct" ? 50 * tElim : 0) - 300 * tk
          + (plantPlayers.get(r - 1)?.has(playerIndex) ? 300 : 0) + (defusePlayers.get(r - 1)?.has(playerIndex) ? 300 : 0)
          + (prevSide === "t" && prevPlanted ? 600 : 0);
        payouts.push(income - killsReward - extras);
      }
      if (payouts.length < 2) continue;
      const cnt = new Map<number, number>();
      for (const pv of payouts) cnt.set(pv, (cnt.get(pv) ?? 0) + 1);
      const modal = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const lossCount = (modal - 1400) / 500;
      if (lossCount >= 0 && lossCount <= 5 && Number.isInteger(lossCount)) {
        if (!truth.has(`${r - 1}:${loserTeam}`)) { truth.set(`${r - 1}:${loserTeam}`, { payout: modal, lossCount }); resolved++; }
      }
    }
    const roundsSorted = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
    for (const winRound of roundsSorted) {
      const r = winRound.roundNumber;
      const winnerTeam = winRound.winnerTeamKey;
      const half = r <= 12 ? 1 : 2;
      const lastLoss = [...roundsSorted].filter((x) => x.roundNumber < r && x.winnerTeamKey !== winnerTeam && (half === 1 ? x.roundNumber >= 1 : x.roundNumber >= 13)).pop();
      if (!lastLoss) continue;
      const beforeRow = truth.get(`${lastLoss.roundNumber}:${winnerTeam}`);
      if (!beforeRow) continue;
      let winsBetween = 0;
      for (const rr of roundsSorted) if (rr.roundNumber > lastLoss.roundNumber && rr.roundNumber < r && rr.winnerTeamKey === winnerTeam) winsBetween++;
      const countBeforeWin = Math.max(0, Math.min(4, beforeRow.lossCount + 1) - winsBetween);
      const nextLoss = roundsSorted.find((x) => x.roundNumber > r && x.winnerTeamKey !== winnerTeam && (half === 1 ? x.roundNumber <= 12 : x.roundNumber >= 13 && x.roundNumber < 25));
      if (!nextLoss) continue;
      let lossesBetween = 0;
      for (const rr of roundsSorted) if (rr.roundNumber > r && rr.roundNumber < nextLoss.roundNumber && rr.winnerTeamKey !== winnerTeam) lossesBetween++;
      const nextRow = truth.get(`${nextLoss.roundNumber}:${winnerTeam}`);
      if (!nextRow) continue;
      const countAfterWin = Math.max(0, nextRow.lossCount - lossesBetween);
      const dec = Math.max(0, countBeforeWin - countAfterWin);
      const m2 = decByType.get(winRound.endReason) ?? new Map<number, number>();
      m2.set(dec, (m2.get(dec) ?? 0) + 1);
      decByType.set(winRound.endReason, m2);
      if (examples.length < 14) examples.push(`${winRound.endReason} w=r${r} before=${countBeforeWin} after=${countAfterWin} dec=${dec} (${p.split("/").pop()})`);
    }
  }
  console.log(`resolved modal payouts=${resolved}`);
  for (const [k, m] of decByType) {
    const dist = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([d, c]) => `dec${d}×${c}`).join(", ");
    console.log(`${k}: ${dist}`);
  }
  for (const e of examples) console.log(`  ${e}`);
}

void main();
