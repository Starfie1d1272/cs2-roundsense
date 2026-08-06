/**
 * Brute-force search over loss-bonus counter rules.
 * Model: counter starts 0 each half; per round: loser += inc(pistol?), winner -= dec(wintype?)
 * bonus index: counter or counter+1; cap at 4.
 * Score = fraction of samples with diff=0 on ONE match (QF1-m1).
 */
import { loadDemoPackage } from "@roundsense/demo-oracle";

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
const LOSS = [1400, 1900, 2400, 2900, 3400];

async function main(): Promise<void> {
  const pkg = await loadDemoPackage(process.argv[2]!);
  const { players, rounds, kills, bombs, playerEconomies } = pkg.files;
  const teamByPlayer = new Map<number, string>();
  players.forEach((p, i) => teamByPlayer.set(i, p.teamKey));
  const money = new Map<number, Map<number, { start: number; spent: number }>>();
  for (const row of playerEconomies) { let m = money.get(row.playerIndex) ?? new Map(); m.set(row.roundNumber, { start: row.startMoney, spent: row.moneySpent }); money.set(row.playerIndex, m); }
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

  const results: Array<{ label: string; score: number; best: number }> = [];
  // winDec variants: [elim, bomb, timeout] decrements (3 = reset for that type)
  const winVariants: Array<[string, number[]]> = [
    ["all-1", [1, 1, 1]],
    ["all-2", [2, 2, 2]],
    ["bomb2", [1, 2, 1]],
    ["timeout2", [1, 1, 2]],
    ["bomb2-timeout2", [1, 2, 2]],
    ["bomb3", [1, 3, 1]],
    ["timeout3", [1, 1, 3]],
    ["bomb2-timeout3", [1, 2, 3]],
  ];
  for (const pistolInc1 of [1, 2]) {
    for (const pistolInc13 of [1, 2]) {
      for (const [wlabel, [decElim, decBomb, decTimeout]] of winVariants) {
      for (const offset of [0, 1]) {
        // simulate
        const streak = { teamA: 0, teamB: 0 };
        const streakAtStart = new Map<number, { teamA: number; teamB: number }>(); // roundNumber → streak before that round
        let total = 0, exact = 0;
        for (const round of rounds) {
          const r = round.roundNumber;
          if (r === 13) { streak.teamA = 0; streak.teamB = 0; }
          streakAtStart.set(r, { ...streak });
          // score samples for round r (income from r-1) using r-1's START counter
          if (r >= 2 && r !== 13) {
            const prev = roundByNumber.get(r - 1);
            const prevStart = streakAtStart.get(r - 1) ?? { teamA: 0, teamB: 0 };
            if (prev) {
              const prevKills = killsByRound.get(r - 1) ?? [];
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
                  const cnt = teamKey === "teamA" ? prevStart.teamA : prevStart.teamB;
                  modeled += LOSS[Math.min(cnt + offset, 4)]!;
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
                if (b.start >= 16000 && income < modeled) continue;
                total++;
                if (income - modeled === 0) exact++;
              }
            }
          }
          // update counters with CURRENT round outcome
          const isPistol = round.roundNumber === 1 || round.roundNumber === 13;
          const pistolInc = round.roundNumber === 1 ? pistolInc1 : round.roundNumber === 13 ? pistolInc13 : 1;
          const winnerTeam = round.winnerTeamKey;
          const dec = round.endReason === "bomb_defused" || round.endReason === "target_bombed" ? decBomb : round.endReason === "time_ran_out" ? decTimeout : decElim;
          if (winnerTeam === "teamA") {
            streak.teamA = Math.max(0, streak.teamA - dec);
            streak.teamB = Math.min(4, streak.teamB + (isPistol ? pistolInc : 1));
          } else {
            streak.teamB = Math.max(0, streak.teamB - dec);
            streak.teamA = Math.min(4, streak.teamA + (isPistol ? pistolInc : 1));
          }
        }
        results.push({ label: `pistol1=${pistolInc1} pistol13=${pistolInc13} win=[${wlabel}] offset=${offset}`, score: exact / total, best: exact });
      }
    }
    }
  }
  results.sort((a, b) => b.score - a.score);
  for (const r of results.slice(0, 8)) console.log(`${r.label}: ${(100 * r.score).toFixed(1)}% (${r.best})`);
}

void main();
