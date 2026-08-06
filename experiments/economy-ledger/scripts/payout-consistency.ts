/**
 * Team-level payout consistency check: for every losing round, compute each
 * losing player's implied payout (income − kills − team award − plant/defuse)
 * and compare to the team's modal payout. Mismatches reveal per-player
 * unmodeled items (refund, TK, bots, joins/leaves).
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
  const mismatchDist = new Map<number, number>();
  const cleanDist = new Map<number, number>();
  const examples: string[] = [];
  let roundsChecked = 0;
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
      const implied = new Map<number, { payout: number; name: string }>(); // playerIndex → implied payout
      for (const [playerIndex, m] of money) {
        const a = m.get(r - 1); const b = m.get(r); if (!a || !b) continue;
        const teamKey = teamByPlayer.get(playerIndex); if (!teamKey) continue;
        if (teamKey !== loserTeam) continue;
        const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;
        if (prev.endReason === "time_ran_out" && prevSide === "t" && !deadSet.has(playerIndex)) continue; // survivor: no bonus
        const income = b.start - a.start + a.spent;
        if (b.start >= 16000) continue; // capped
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
        implied.set(playerIndex, { payout: income - killsReward - extras, name: players[playerIndex]?.name ?? `p${playerIndex}` });
      }
      if (implied.size < 2) continue;
      roundsChecked++;
      // modal payout
      const counts = new Map<number, number>();
      for (const v of implied.values()) counts.set(v.payout, (counts.get(v.payout) ?? 0) + 1);
      const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      cleanDist.set(modal, (cleanDist.get(modal) ?? 0) + 1);
      for (const [pi, v] of implied) {
        if (v.payout !== modal) {
          const diff = v.payout - modal;
          mismatchDist.set(diff, (mismatchDist.get(diff) ?? 0) + 1);
          if (examples.length < 12) examples.push(`${p.split("/").pop()} r${r - 1} ${v.name} payout=${v.payout} modal=${modal} diff=${diff}`);
        }
      }
    }
  }
  console.log(`rounds checked=${roundsChecked}`);
  console.log(`modal payout dist: ${[...cleanDist.entries()].sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d}×${c}`).join(", ")}`);
  console.log(`MISMATCHES (player payout vs team modal): ${[...mismatchDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([d, c]) => `${d}×${c}`).join(", ")}`);
  for (const e of examples) console.log(`  ${e}`);
}

void main();
