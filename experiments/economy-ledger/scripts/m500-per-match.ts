/** −500 residuals per match (standard model + timeout2). */
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
  const paths = process.argv.slice(2); const allPaths: string[] = [];
  for (const p of paths) { const { existsSync, lstatSync, readdirSync } = await import("node:fs"); if (existsSync(p) && lstatSync(p).isDirectory()) { for (const f of readdirSync(p)) allPaths.push(`${p}/${f}`); } else allPaths.push(p); }
  for (const p of allPaths) {
    if (!p.endsWith(".zip")) continue;
    const pkg = await loadDemoPackage(p);
    const { players, rounds, kills, bombs, playerEconomies } = pkg.files;
    const teamByPlayer = new Map<number, string>(); players.forEach((p2, i) => teamByPlayer.set(i, p2.teamKey));
    const money = new Map<number, Map<number, { start: number; spent: number }>>();
    for (const e of playerEconomies) { let m = money.get(e.playerIndex) ?? new Map(); m.set(e.roundNumber, { start: e.startMoney, spent: e.moneySpent }); money.set(e.playerIndex, m); }
    const roundByNumber = new Map(rounds.map((r) => [r.roundNumber, r]));
    const killsByRound = new Map<number, typeof kills>();
    for (const k of kills) { const l = killsByRound.get(k.roundNumber) ?? []; l.push(k); killsByRound.set(k.roundNumber, l); }
    const plantedByRound = new Map<number, boolean>(); const plantPlayers = new Map<number, Set<number>>(); const defusePlayers = new Map<number, Set<number>>();
    for (const b of bombs) { if (b.type === "planted") { plantedByRound.set(b.roundNumber, true); const s = plantPlayers.get(b.roundNumber) ?? new Set(); s.add(b.actorIndex); plantPlayers.set(b.roundNumber, s); } if (b.type === "defused") { const s = defusePlayers.get(b.roundNumber) ?? new Set(); s.add(b.actorIndex); defusePlayers.set(b.roundNumber, s); } }
    // standard counter with timeout2
    const lossAt = new Map<number, { teamA: number; teamB: number }>();
    const lc = { teamA: 1, teamB: 1 };
    for (const round of rounds) { if (round.roundNumber === 13) { lc.teamA = 1; lc.teamB = 1; } lossAt.set(round.roundNumber, { ...lc }); const dec = round.endReason === "time_ran_out" ? 2 : 1; if (round.winnerTeamKey === "teamA") { lc.teamA = Math.max(0, lc.teamA - dec); lc.teamB = Math.min(4, lc.teamB + 1); } else { lc.teamB = Math.max(0, lc.teamB - dec); lc.teamA = Math.min(4, lc.teamA + 1); } }
    let m500 = 0, total = 0;
    for (const round of rounds) {
      const r = round.roundNumber; if (r < 2 || r === 13) continue;
      const prev = roundByNumber.get(r - 1); if (!prev) continue;
      const prevKills = killsByRound.get(r - 1) ?? [];
      const deadSet = new Set<number>(); for (const k of prevKills) if (k.victimIndex !== null) deadSet.add(k.victimIndex);
      const tTeamKey = prev.teamASide === "t" ? "teamA" : "teamB";
      const tElim = prevKills.filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKey).length;
      const prevPlanted = plantedByRound.get(r - 1) ?? false;
      const lrow = lossAt.get(r - 1) ?? { teamA: 1, teamB: 1 };
      for (const [playerIndex, m] of money) {
        const a = m.get(r - 1); const b = m.get(r); if (!a || !b) continue;
        const teamKey = teamByPlayer.get(playerIndex); if (!teamKey) continue;
        const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;
        const wonPrev = prev.winnerTeamKey === teamKey;
        const income = b.start - a.start + a.spent;
        let modeled = 0;
        if (prevSide === "ct") modeled += 50 * tElim;
        if (wonPrev) modeled += prev.endReason === "target_bombed" || prev.endReason === "bomb_defused" ? 3500 : 3250;
        else if (prev.endReason === "time_ran_out" && prevSide === "t" && !deadSet.has(playerIndex)) modeled += 0;
        else modeled += Math.min(3400, 1400 + 500 * (teamKey === "teamA" ? lrow.teamA : lrow.teamB));
        const myTeam = teamByPlayer.get(playerIndex);
        let tk = 0;
        for (const k of prevKills) { if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex) { if (teamByPlayer.get(k.victimIndex) === myTeam) { tk++; continue; } const v = KR[wc(k.weapon)]; if (v !== undefined) modeled += v; } }
        modeled -= 300 * tk;
        if (!wonPrev && prevSide === "t" && prevPlanted) modeled += 600;
        if (plantPlayers.get(r - 1)?.has(playerIndex)) modeled += 300;
        if (defusePlayers.get(r - 1)?.has(playerIndex)) modeled += 300;
        if (b.start >= 16000 && income < modeled) continue;
        total++;
        if (income - modeled === -500) m500++;
      }
    }
    console.log(`${p.split("/").pop()}: m500=${m500}/${total} (${(100 * m500 / total).toFixed(1)}%)`);
  }
}
void main();
