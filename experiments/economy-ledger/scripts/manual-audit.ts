/**
 * Full-ledger manual reconciliation: print EVERY sample with diff≠0 and its
 * complete term breakdown. This is the "manual computation vs actual" audit.
 * Run: tsx scripts/manual-audit.ts <zip>...
 */
import { loadDemoPackage, teamLossStreakPerRound } from "@roundsense/demo-oracle";

const KR: Record<string, number> = { rifle: 300, smg: 600, pistol: 300, awp: 100, sniper: 300, shotgun: 900, mg: 300, knife: 1500, zeus: 100, grenade: 300 };
const CLS: Array<[RegExp, string]> = [
  [/^ak47$|^m4a4$|^m4a1_silencer$|^m4a1$|^galilar$|^famas$|^sg556$|^aug$/, "rifle"],
  [/^awp$/, "awp"], [/^ssg08$|^scar20$|^g3sg1$/, "sniper"],
  [/^mac10$|^mp9$|^mp7$|^mp5sd$|^ump45$|^p90$|^bizon$/, "smg"],
  [/^nova$|^sawedoff$|^mag7$|^xm1014$/, "shotgun"], [/^m249$|^negev$/, "mg"],
  [/^knife/, "knife"], [/^zeus$/, "zeus"], [/^hegrenade$|^molotov$|^incgrenade$|^inferno$/, "grenade"],
  [/^glock$|^usp_silencer$|^hkp2000$|^p250$|^elite$|^tec9$|^cz75a$|^fiveseven$|^deagle$|^revolver$/, "pistol"],
];
const wc = (w: string) => { for (const [re, c] of CLS) if (re.test(w)) return c; return w; };

const WIN = 3250, WIN_BOMB = 3500, LOSS = [1400, 1900, 2400, 2900, 3400], PISTOL_LOSS = 1900, PLANT_T = 600, TEAM = 50;

async function main(): Promise<void> {
  for (const zip of process.argv.slice(2)) {
    const pkg = await loadDemoPackage(zip);
    const { players, rounds, kills, bombs, playerEconomies } = pkg.files;
    const teamByPlayer = new Map<number, string>();
    players.forEach((p, i) => teamByPlayer.set(i, p.teamKey));
    const money = new Map<number, Map<number, { start: number; spent: number }>>();
    for (const row of playerEconomies) { let m = money.get(row.playerIndex) ?? new Map(); m.set(row.roundNumber, { start: row.startMoney, spent: row.moneySpent }); money.set(row.playerIndex, m); }
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
    let total = 0, exact = 0;
    const nonzero: string[] = [];
    for (const round of rounds) {
      const r = round.roundNumber; if (r < 2) continue;
      const prev = roundByNumber.get(r - 1)!;
      const prevKills = killsByRound.get(r - 1) ?? [];
      const ctTeamKey = prev.teamASide === "ct" ? "teamA" : "teamB";
      const ctKills = prevKills.filter((k) => k.killerIndex !== null && teamByPlayer.get(k.killerIndex) === ctTeamKey && teamByPlayer.get(k.victimIndex) !== ctTeamKey).length;
      const prevPlanted = plantedByRound.get(r - 1) ?? false;
      for (const [playerIndex, m] of money) {
        const a = m.get(r - 1); const b = m.get(r); if (!a || !b) continue;
        const teamKey = teamByPlayer.get(playerIndex); if (!teamKey) continue;
        const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;
        const wonPrev = prev.winnerTeamKey === teamKey;
        const income = b.start - a.start + a.spent;
        let modeled = 0;
        if (prevSide === "ct") modeled += TEAM * ctKills;
        if (wonPrev) modeled += prev.endReason === "target_bombed" || prev.endReason === "bomb_defused" ? WIN_BOMB : WIN;
        else modeled += r - 1 === 1 || r - 1 === 13 ? PISTOL_LOSS : LOSS[Math.min(streaks.get(`${r - 1}:${teamKey}`) ?? 0, 4)]!;
        const myTeam = teamByPlayer.get(playerIndex);
        const myKills: string[] = [];
        for (const k of prevKills) {
          if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex && teamByPlayer.get(k.victimIndex) !== myTeam) {
            const c = wc(k.weapon); const v = KR[c]; if (v !== undefined) { modeled += v; myKills.push(`${c}=${v}`); }
          }
        }
        if (!wonPrev && prevSide === "t" && prevPlanted) modeled += PLANT_T;
        if (plantPlayers.get(r - 1)?.has(playerIndex)) modeled += 300;
        if (defusePlayers.get(r - 1)?.has(playerIndex)) modeled += 300;
        if (b.start >= 16000 && income < modeled) continue;
        const diff = income - modeled;
        total++;
        if (diff === 0) exact++;
        else if (nonzero.length < 16) {
          nonzero.push(`r${r} p${playerIndex} [${prevSide === "ct" ? "CT" : "T"}${wonPrev ? "W" : "L"} e=${prev.endReason} k=${ctKills}] income=${income} modeled=${modeled} diff=${diff} kills=[${myKills.join(",") || "-"}] start=${a.start}/${a.spent}→${b.start}`);
        }
      }
    }
    console.log(`\n=== ${zip.split("/").pop()} === diff=0: ${exact}/${total} (${((100 * exact) / total).toFixed(1)}%)`);
    for (const n of nonzero) console.log(`  ${n}`);
  }
}

void main();
