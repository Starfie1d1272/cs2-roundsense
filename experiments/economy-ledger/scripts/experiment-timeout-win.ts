/**
 * CONTROLLED EXPERIMENT: does a time_ran_out win decrement the loss counter
 * by 1 or 2?
 * For every round r-1 that ended time_ran_out (team X won), look at team Y's
 * NEXT loss payout (r+... first loss by Y after that win, before any win).
 * Compare actual payout vs modeled under dec=1 and dec=2.
 * Also: same for bomb wins (dec=1 expected).
 */
import { loadDemoPackage } from "@roundsense/demo-oracle";

const LOSS = [1400, 1900, 2400, 2900, 3400];

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  const counts = new Map<string, { dec1: number; dec2: number; examples: string[] }>();
  let total = 0, exact1 = 0, exact2 = 0;
  for (const p of paths) {
    if (!p.endsWith(".zip")) continue;
    const pkg = await loadDemoPackage(p);
    const { players, rounds, kills, playerEconomies } = pkg.files;
    const teamByPlayer = new Map<number, string>();
    players.forEach((p2, i) => teamByPlayer.set(i, p2.teamKey));
    const money = new Map<number, Map<number, { start: number; spent: number }>>();
    for (const e of playerEconomies) { let m = money.get(e.playerIndex) ?? new Map(); m.set(e.roundNumber, { start: e.startMoney, spent: e.moneySpent }); money.set(e.playerIndex, m); }
    const roundByNumber = new Map(rounds.map((r) => [r.roundNumber, r]));
    const killsByRound = new Map<number, typeof kills>();
    for (const k of kills) { const l = killsByRound.get(k.roundNumber) ?? []; l.push(k); killsByRound.set(k.roundNumber, l); }
    for (const round of rounds) {
      const r = round.roundNumber;
      if (r < 2 || r === 13) continue;
      const prev = roundByNumber.get(r - 1); if (!prev) continue;
      if (prev.endReason !== "time_ran_out" && prev.endReason !== "bomb_defused" && prev.endReason !== "target_bombed" && prev.endReason !== "ct_win" && prev.endReason !== "t_win") continue;
      // find team that LOST prev round (they got the loss bonus)
      const loserTeam = prev.winnerTeamKey === "teamA" ? "teamB" : "teamA";
      // loser's lossCount BEFORE prev round, from their own payout history:
      // reconstruct: count consecutive losses before r-1 in this half (losses
      // since r13 or r1), minus wins. Simple approach: brute both hypotheses.
      const prevKills = killsByRound.get(r - 1) ?? [];
      const tTeamKey = prev.teamASide === "t" ? "teamA" : "teamB";
      const tElim = prevKills.filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKey).length;
      const deadSet = new Set<number>();
      for (const k of prevKills) if (k.victimIndex !== null) deadSet.add(k.victimIndex);
      for (const [playerIndex, m] of money) {
        const a = m.get(r - 1); const b = m.get(r); if (!a || !b) continue;
        const teamKey = teamByPlayer.get(playerIndex); if (!teamKey) continue;
        const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;
        if (teamKey !== loserTeam) continue;
        if (prev.endReason === "time_ran_out" && prevSide === "t" && !deadSet.has(playerIndex)) continue; // survivor gets nothing
        const income = b.start - a.start + a.spent;
        // kill rewards this player earned in prev round
        let killsReward = 0;
        const myTeam = teamByPlayer.get(playerIndex);
        for (const k of prevKills) {
          if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex && teamByPlayer.get(k.victimIndex) !== myTeam) {
            const w = k.weapon;
            if (w === "p90") killsReward += 300; else if (w === "cz75a") killsReward += 100;
            else if (/^(ak47|m4a4|m4a1_silencer|m4a1|galilar|famas|sg556|aug)$/.test(w)) killsReward += 300;
            else if (w === "awp") killsReward += 100;
            else if (/^(mac10|mp9|mp7|mp5sd|ump45|bizon)$/.test(w)) killsReward += 600;
            else if (/^(nova|sawedoff|mag7)$/.test(w)) killsReward += 900;
            else if (w === "xm1014") killsReward += 600;
            else if (/^(glock|usp_silencer|hkp2000|p250|elite|tec9|fiveseven|deagle|revolver)$/.test(w)) killsReward += 300;
            else if (/^knife/.test(w)) killsReward += 1500;
            else if (w === "taser" || w === "zeus") killsReward += 100;
            else if (/^(hegrenade|molotov|incgrenade|inferno|decoy)$/.test(w)) killsReward += 300;
          }
        }
        // reconstruct lossCount-before under both hypotheses. We don't have
        // the counter; instead ask: which LOSS index fits income?
        // income = LOSS[idx] + killsReward (+ plant600 if t & planted & lost)
        // Find idx such that LOSS[idx] = income - killsReward
        const raw = income - killsReward;
        const idx = LOSS.indexOf(raw);
        if (idx >= 0) {
          total++;
          const key = prev.endReason;
          const c = counts.get(key) ?? { dec1: 0, dec2: 0, examples: [] };
          // now: what would the counter be under each hypothesis?
          // We know the payout index = losses-before + 1 (payout uses lossCount AFTER counting this loss? or before?)
          // payout = min(3400, 1400 + 500 × lossCount) with lossCount BEFORE the payout (mp_starting_losses=1):
          //   lossCount=1 → 1900, 2 → 2400, 3 → 2900, 4 → 3400 → idx = lossCount
          //   so lossCount-before = idx
          // Under dec=1: after a win the counter = (counter before win) − 1
          // We can't know counter before win directly — instead compare idx to
          // the naive counter (losses since half start, ignoring wins):
          c.dec1++;
          counts.set(key, c);
          if (c.examples.length < 4) c.examples.push(`r${r} p${playerIndex} ${prev.endReason} prevSide=${prevSide} payoutIdx=${idx} raw=${raw} income=${income} kills=${killsReward}`);
        }
      }
    }
  }
  console.log(`TOTAL resolved payouts=${total}`);
  for (const [k, c] of counts) {
    console.log(`${k}: n=${c.dec1} (dec1 & dec2 undecided without counter history)`);
    for (const e of c.examples) console.log(`    ${e}`);
  }
  console.log(`\n→ need counter reconstruction; see payoutIdx distribution above.`);
}

void main();
