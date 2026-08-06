/**
 * Residual triage — the 17.1% nonzero diffs, split by:
 *   prev outcome × player alive/dead × side × wonPrev
 * Goal: explain EVERY residual class (or prove it needs modeling).
 * Run: tsx scripts/residual-triage.ts <zip-or-dir...>
 */
import { loadDemoPackage, teamLossStreakPerRound } from "@roundsense/demo-oracle";

const KR: Record<string, number> = { rifle: 300, smg: 600, pistol: 300, awp: 100, sniper: 300, shotgun: 900, mg: 300, knife: 1500, zeus: 100, grenade: 300, taser: 100 };
const CLS: Array<[RegExp, string]> = [
  [/^ak47$|^m4a4$|^m4a1_silencer$|^m4a1$|^galilar$|^famas$|^sg556$|^aug$/, "rifle"],
  [/^awp$/, "awp"], [/^ssg08$|^scar20$|^g3sg1$/, "sniper"],
  [/^mac10$|^mp9$|^mp7$|^mp5sd$|^ump45$|^p90$|^bizon$/, "smg"],
  [/^nova$|^sawedoff$|^mag7$|^xm1014$/, "shotgun"], [/^m249$|^negev$/, "mg"],
  [/^knife/, "knife"], [/^zeus$/, "zeus"], [/^hegrenade$|^molotov$|^incgrenade$|^inferno$/, "grenade"],
  [/^glock$|^usp_silencer$|^hkp2000$|^p250$|^elite$|^tec9$|^cz75a$|^fiveseven$|^deagle$|^revolver$/, "pistol"],
];
const wc = (w: string) => { for (const [re, c] of CLS) if (re.test(w)) return c; return w; };

interface Row { start: number; spent: number }
interface PlayerRound { playerIndex: number; prevSide: string; wonPrev: boolean; alive: boolean; income: number; modeled: number; residual: number; prevEnd: string; r: number; teamKey: string }

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const paths: string[] = [];
  for (const a of args) {
    const { existsSync, lstatSync, readdirSync } = await import("node:fs");
    if (existsSync(a) && lstatSync(a).isDirectory()) {
      for (const f of readdirSync(a)) paths.push(`${a}/${f}`);
    } else paths.push(a);
  }
  const triage = new Map<string, { n: number; residuals: Map<number, number>; examples: string[] }>();
  let total = 0, exact = 0, capped = 0;
  const row = (key: string, residual: number, ex: string) => {
    let t = triage.get(key);
    if (!t) { t = { n: 0, residuals: new Map<number, number>(), examples: [] }; triage.set(key, t); }
    t.n++;
    t.residuals.set(residual, (t.residuals.get(residual) ?? 0) + 1);
    if (t.examples.length < 3) t.examples.push(ex);
    triage.set(key, t);
  };
  for (const p of paths) {
    if (!p.endsWith(".zip")) continue;
    const pkg = await loadDemoPackage(p);
    const { players, rounds, kills, bombs, playerEconomies } = pkg.files;
    const teamByPlayer = new Map<number, string>();
    players.forEach((p2, i) => teamByPlayer.set(i, p2.teamKey));
    const money = new Map<number, Map<number, Row>>();
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
      // alive/dead in prev round: victim in prevKills → dead
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
        else if (r - 1 === 1 || r - 1 === 13) modeled += 1900;
        else {
          const streak = streaks.get(`${r - 1}:${teamKey}`) ?? 0;
          modeled += [1400, 1900, 2400, 2900, 3400][Math.min(streak, 4)]!;
        }
        const myTeam = teamByPlayer.get(playerIndex);
        for (const k of prevKills) {
          if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex && teamByPlayer.get(k.victimIndex) !== myTeam) {
            const v = KR[wc(k.weapon)]; if (v !== undefined) modeled += v;
          }
        }
        if (!wonPrev && prevSide === "t" && prevPlanted) modeled += 600;
        if (plantPlayers.get(r - 1)?.has(playerIndex)) modeled += 300;
        if (defusePlayers.get(r - 1)?.has(playerIndex)) modeled += 300;
        // TK penalty (unmodeled, expected −300 per teamkill by this player)
        const tkCount = prevKills.filter((k) => k.killerIndex === playerIndex && k.victimIndex !== playerIndex && teamByPlayer.get(k.victimIndex) === myTeam).length;
        if (b.start >= 16000 && income < modeled) { capped++; continue; }
        total++;
        const residual = income - modeled;
        if (residual === 0) { exact++; continue; }
        const alive = !deadSet.has(playerIndex);
        const endKey = prev.endReason;
        const sideKey = prevSide === "ct" ? "CT" : "T";
        const outKey = wonPrev ? "W" : "L";
        const statusKey = alive ? "alive" : "dead";
        const tkKey = tkCount > 0 ? ` tk=${tkCount}` : "";
        const key = `${endKey} ${outKey} ${sideKey} ${statusKey}${tkKey}`;
        const ex = `r${r} p${playerIndex} res=${residual} inc=${income} mod=${modeled} tk=${tkCount} streak=${streaks.get(`${r - 1}:${teamKey}`)} pre=${a.start}/${a.spent}→${b.start}`;
        row(key, residual, ex);
      }
    }
  }
  console.log(`TOTAL samples=${total} exact=${exact} (${(100 * exact / total).toFixed(1)}%) capped=${capped}`);
  const sorted = [...triage.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [key, t] of sorted) {
    const topRes = [...t.residuals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([d, c]) => `${d}×${c}`).join(", ");
    console.log(`${key}: n=${t.n} top=${topRes}`);
    for (const e of t.examples) console.log(`    ${e}`);
  }
}

void main();
