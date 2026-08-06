/** Diagnostic: print 40 nonzero-residual samples with FULL weapon detail. */
import { loadDemoPackage, teamLossStreakPerRound } from "@roundsense/demo-oracle";

const KRM: Record<string, number> = { rifle: 300, smg: 600, pistol: 300, awp: 100, sniper: 300, shotgun: 900, mg: 300, knife: 1500, zeus: 100, grenade: 300, p90: 300, cz75a: 100, sawedoff: 900, nova: 900, mag7: 900, xm1014: 600, m249: 300, negev: 300 };
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
  let shown = 0;
  const dist = new Map<number, number>();
  for (const p of allPaths) {
    if (!p.endsWith(".zip")) continue;
    const pkg = await loadDemoPackage(p);
    const { players, rounds, kills, bombs, playerEconomies } = pkg.files;
    const teamByPlayer = new Map<number, string>();
    players.forEach((p2, i) => teamByPlayer.set(i, p2.teamKey));
    const money = new Map<number, Map<number, { start: number; spent: number }>>();
    for (const e of playerEconomies) { let m = money.get(e.playerIndex) ?? new Map(); m.set(e.roundNumber, { start: e.startMoney, spent: e.moneySpent }); money.set(e.playerIndex, m); }
    const roundByNumber = new Map(rounds.map((r) => [r.roundNumber, r]));
    const streaks = teamLossStreakPerRound(pkg);
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
      for (const [playerIndex, m] of money) {
        const a = m.get(r - 1); const b = m.get(r); if (!a || !b) continue;
        const teamKey = teamByPlayer.get(playerIndex); if (!teamKey) continue;
        const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;
        const wonPrev = prev.winnerTeamKey === teamKey;
        const income = b.start - a.start + a.spent;
        let modeled = 0;
        if (prevSide === "ct") modeled += 50 * tElim;
        if (wonPrev) modeled += prev.endReason === "target_bombed" || prev.endReason === "bomb_defused" ? 3500 : 3250;
        else {
          const streak = streaks.get(`${r - 1}:${teamKey}`) ?? 0;
          modeled += [1400, 1900, 2400, 2900, 3400][Math.min(streak, 4)]!;
        }
        const myTeam = teamByPlayer.get(playerIndex);
        const myKills: string[] = [];
        let tk = 0;
        for (const k of prevKills) {
          if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex) {
            if (teamByPlayer.get(k.victimIndex) === myTeam) { tk++; continue; }
            const cls = wc(k.weapon);
            const v = KRM[cls];
            if (v !== undefined) { modeled += v; myKills.push(`${k.weapon}=${v}`); }
          }
        }
        modeled -= 300 * tk;
        if (!wonPrev && prevSide === "t" && prevPlanted) modeled += 600;
        if (plantPlayers.get(r - 1)?.has(playerIndex)) modeled += 300;
        if (defusePlayers.get(r - 1)?.has(playerIndex)) modeled += 300;
        if (b.start >= 16000 && income < modeled) continue;
        const residual = income - modeled;
        dist.set(residual, (dist.get(residual) ?? 0) + 1);
        if (residual !== 0 && shown < 40) {
          shown++;
          const alive = deadSet.has(playerIndex) ? "DEAD" : "ALIVE";
          console.log(`r${r} p${playerIndex} ${prev.endReason} ${prevSide}${wonPrev ? "W" : "L"} ${alive} streak=${streaks.get(`${r - 1}:${teamKey}`)} res=${residual} inc=${income} mod=${modeled} kills=[${myKills.join(",") || "-"}] tk=${tk} pre=${a.start}/${a.spent}→${b.start}${b.start >= 16000 ? " CAP" : ""}`);
        }
      }
    }
  }
  console.log("DIST:", [...dist.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([d, c]) => `${d}×${c}`).join(", "));
}

void main();
