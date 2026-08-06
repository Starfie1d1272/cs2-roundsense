/** What does the r13 (second-half opener) loser actually get paid? */
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
  const payouts = new Map<number, number>();
  const examples: string[] = [];
  for (const p of allPaths) {
    if (!p.endsWith(".zip")) continue;
    const pkg = await loadDemoPackage(p);
    const { players, rounds, kills, bombs, playerEconomies } = pkg.files;
    const teamByPlayer = new Map<number, string>();
    players.forEach((p2, i) => teamByPlayer.set(i, p2.teamKey));
    const money = new Map<number, Map<number, { start: number; spent: number }>>();
    for (const e of playerEconomies) { let m = money.get(e.playerIndex) ?? new Map(); m.set(e.roundNumber, { start: e.startMoney, spent: e.moneySpent }); money.set(e.playerIndex, m); }
    const r13 = rounds.find((x) => x.roundNumber === 13);
    if (!r13) continue;
    const r14 = rounds.find((x) => x.roundNumber === 14);
    if (!r14) continue;
    const loserTeam = r13.winnerTeamKey === "teamA" ? "teamB" : "teamA";
    const prevKills = kills.filter((k) => k.roundNumber === 13);
    const tTeamKey = r13.teamASide === "t" ? "teamA" : "teamB";
    const tElim = prevKills.filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKey).length;
    const planted = bombs.find((b) => b.roundNumber === 13 && b.type === "planted");
    const defused = bombs.find((b) => b.roundNumber === 13 && b.type === "defused");
    for (const [playerIndex, m] of money) {
      const a = m.get(13); const b = m.get(14); if (!a || !b) continue;
      const teamKey = teamByPlayer.get(playerIndex); if (!teamKey) continue;
      if (teamKey !== loserTeam) continue;
      const prevSide = teamKey === "teamA" ? r13.teamASide : r13.teamBSide;
      const income = b.start - a.start + a.spent;
      let killsReward = 0;
      const myTeam = teamByPlayer.get(playerIndex);
      for (const k of prevKills) {
        if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex && teamByPlayer.get(k.victimIndex) !== myTeam) {
          const v = KR[wc(k.weapon)]; if (v !== undefined) killsReward += v;
        }
      }
      const extras = (prevSide === "ct" ? 50 * tElim : 0) + (planted?.actorIndex === playerIndex ? 300 : 0) + (defused?.actorIndex === playerIndex ? 300 : 0) + (prevSide === "t" && planted ? 600 : 0);
      const payout = income - killsReward - extras;
      payouts.set(payout, (payouts.get(payout) ?? 0) + 1);
      if (examples.length < 8) examples.push(`${p.split("/").pop()} r13 ${prevSide}${r13.winnerTeamKey === teamKey ? "W" : "L"} payout=${payout} income=${income} kills=${killsReward} extras=${extras}`);
      break;
    }
  }
  console.log(`r13 loser payout distribution: ${[...payouts.entries()].sort((x, y) => y[1] - x[1]).map(([d, c]) => `${d}×${c}`).join(", ")}`);
  for (const e of examples) console.log(`  ${e}`);
}
void main();
