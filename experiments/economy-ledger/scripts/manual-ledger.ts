/**
 * Manual per-sample ledger breakdown — print EVERY term for round 2 of a match.
 * Run: tsx scripts/manual-ledger.ts <zip> [roundNumber]
 */
import { loadDemoPackage, teamLossStreakPerRound } from "@roundsense/demo-oracle";

const KR: Record<string, number> = { rifle: 300, smg: 600, pistol: 300, awp: 100, sniper: 300, shotgun: 900, mg: 300, knife: 1500, zeus: 100, grenade: 300 };
const CLS: Array<[RegExp, string]> = [
  [/^ak47$|^m4a4$|^m4a1_silencer$|^galilar$|^famas$|^sg556$|^aug$/, "rifle"],
  [/^awp$/, "awp"], [/^ssg08$|^scar20$|^g3sg1$/, "sniper"],
  [/^mac10$|^mp9$|^mp7$|^mp5sd$|^ump45$|^p90$|^bizon$/, "smg"],
  [/^nova$|^sawedoff$|^mag7$|^xm1014$/, "shotgun"], [/^m249$|^negev$/, "mg"],
  [/^knife/, "knife"], [/^zeus$/, "zeus"], [/^hegrenade$|^molotov$|^incgrenade$|^inferno$/, "grenade"],
  [/^glock$|^usp_silencer$|^hkp2000$|^p250$|^elite$|^tec9$|^cz75a$|^fiveseven$|^deagle$|^revolver$/, "pistol"],
];
const wc = (w: string) => { for (const [re, c] of CLS) if (re.test(w)) return c; return w; };

async function main(): Promise<void> {
  const zip = process.argv[2]!;
  const target = Number(process.argv[3] ?? 2);
  const pkg = await loadDemoPackage(zip);
  const { players, rounds, kills, bombs, playerEconomies } = pkg.files;
  const teamByPlayer = new Map<number, string>();
  players.forEach((p, i) => teamByPlayer.set(i, p.teamKey));
  const money = new Map<number, Map<number, { start: number; spent: number }>>();
  for (const row of playerEconomies) { let m = money.get(row.playerIndex) ?? new Map(); m.set(row.roundNumber, { start: row.startMoney, spent: row.moneySpent }); money.set(row.playerIndex, m); }
  const roundByNumber = new Map(rounds.map((r) => [r.roundNumber, r]));
  const prev = roundByNumber.get(target - 1)!;
  const cur = roundByNumber.get(target)!;
  const prevKills = kills.filter((k) => k.roundNumber === target - 1);
  const prevBombs = bombs.filter((b) => b.roundNumber === target - 1);
  const ctTeamKey = prev.teamASide === "ct" ? "teamA" : "teamB";
  const ctKills = prevKills.filter((k) => k.killerIndex !== null && teamByPlayer.get(k.killerIndex) === ctTeamKey && teamByPlayer.get(k.victimIndex) !== ctTeamKey).length;
  const planted = prevBombs.find((b) => b.type === "planted");
  const defused = prevBombs.find((b) => b.type === "defused");
  console.log(`match=${zip.split("/").pop()} round ${target}: prev(r${target - 1}) ${prev.teamASide} vs ${prev.teamBSide}, endReason=${prev.endReason}, winner=${prev.winnerTeamKey}, ctKills=${ctKills}`);
  console.log(`players: ${players.map((p, i) => `${i}:${p.teamKey === ctTeamKey ? (prev.teamASide === "ct" ? "CT" : "T") : (prev.teamASide === "ct" ? "T" : "CT")}`).join(" ")}`);
  for (const [playerIndex, m] of money) {
    const a = m.get(target - 1); const b = m.get(target);
    if (!a || !b) continue;
    const teamKey = teamByPlayer.get(playerIndex)!;
    const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;
    const wonPrev = prev.winnerTeamKey === teamKey;
    const income = b.start - a.start + a.spent;
    const winReward = wonPrev ? (prev.endReason === "target_bombed" || prev.endReason === "bomb_defused" ? 3500 : 3250) : 0;
    const lossReward = !wonPrev ? (target - 1 === 1 || target - 1 === 14 ? 1900 : 1400) : 0;
    const teamAward = prevSide === "ct" ? 50 * ctKills : 0;
    let killReward = 0;
    const myKills: string[] = [];
    const myTeam = teamByPlayer.get(playerIndex);
    for (const k of prevKills) {
      if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex && teamByPlayer.get(k.victimIndex) !== myTeam) {
        const c = wc(k.weapon); const v = KR[c] ?? 0; killReward += v; myKills.push(`${c}(${k.weapon})=${v}`);
      }
    }
    const plantBonus = !wonPrev && prevSide === "t" && planted ? 600 : 0;
    const objBonus = (planted && planted.actorIndex === playerIndex ? 300 : 0) + (defused && defused.actorIndex === playerIndex ? 300 : 0);
    const modeled = winReward + lossReward + teamAward + killReward + plantBonus + objBonus;
    const diff = income - modeled;
    console.log(`p${playerIndex} [${prevSide === "ct" ? "CT" : "T"}${wonPrev ? " W" : " L"}]: start${target - 1}=${a.start} spent=${a.spent} start${target}=${b.start} → income=${income}`);
    console.log(`    win=${winReward} loss=${lossReward} teamAward=${teamAward} kills=[${myKills.join(",") || "-"}] plantBonus=${plantBonus} obj=${objBonus} → modeled=${modeled} diff=${diff}`);
  }
}

void main();
