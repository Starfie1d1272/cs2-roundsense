/**
 * Economy truth validation over the v3 ZIP corpus (docs/experiments/economy-validation.md).
 *
 * Method: per-player per-round income differences
 *   income(p, r) = startMoney(p, r) − startMoney(p, r−1) + moneySpent(p, r−1)
 *
 * Modeled income (all rewards that the rules file claims):
 *   roundReward (3250/3500 by endReason) + lossBonus[streak] + plant/defuse
 *   player bonus (+300) + plantBonusT(0 in model — target of validation)
 *   + kill rewards (0 in model — estimated by OLS)
 *   + CT team kill reward (0 in model — estimated by OLS)
 *
 * residual = income − modeled. Group means READ OUT the true values:
 *   won-group mean  = trueWinReward − 3250
 *   loss streak i   = trueLossBonus[i] − model
 *   T-loss-with-plant group = truePlantBonusT
 * OLS over kill-class counts + team kill count estimates per-kill rewards.
 *
 * Run: pnpm --filter @roundsense/experiment-economy-ledger exec tsx scripts/validate-economy.ts <zip|dir>...
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadDemoPackage, loadDemoPackageDir, teamLossStreakPerRound, type ParsedDemoPackage } from "@roundsense/demo-oracle";

// ── weapon internal-name → class (cs2df exports internal names) ──────────────
const CLASS_RULES: [RegExp, string][] = [
  [/^(ak47|m4a4|m4a1_silencer|m4a1|galilar|famas|sg556|aug)$/, "rifle"],
  [/^awp$/, "awp"],
  [/^(ssg08|scar20|g3sg1)$/, "sniper"],
  [/^(mac10|mp9|mp7|mp5sd|ump45|p90|bizon)$/, "smg"],
  [/^(nova|sawedoff|mag7|xm1014)$/, "shotgun"],
  [/^(m249|negev)$/, "mg"],
  [/^(glock|usp_silencer|p2000|hkp2000|p250|elite|tec9|cz75a|fiveseven|deagle|revolver)$/, "pistol"],
  [/^(hegrenade|molotov|incgrenade|inferno|decoy)$/, "grenade"],
  [/^taser$/, "zeus"],
  [/^knife/, "knife"],
  [/^world$/, "world"],
];
function weaponClass(weapon: string): string {
  for (const [re, cls] of CLASS_RULES) if (re.test(weapon)) return cls;
  return `unknown:${weapon}`;
}

const WIN_BY_BOMB = new Set(["target_bombed", "bomb_defused"]);
const LOSS_BONUS_MODEL = [1400, 1900, 2400, 2900, 3400];
const WIN_REWARD_ELIM = 3250;
const WIN_REWARD_BOMB = 3500;

// ── versioned personal kill-reward model (fandom Money page; Δ-verified) ────
const KILL_REWARD_MODEL: Record<string, number> = {
  rifle: 300, smg: 600, pistol: 300, awp: 100, sniper: 300, shotgun: 900, mg: 300,
  knife: 1500, zeus: 100, grenade: 300, world: 0, taser: 100, unknown: 0,
};

interface Sample {
  residual: number;
  won: boolean;
  /** whether the player's team won the PREVIOUS round (team award belongs to r−1) */
  prevWon: boolean;
  wonBomb: boolean;
  lostStreak: number | null;
  tLostWithPlant: boolean;
  killCounts: Map<string, number>;
  /** own kills total (for LOO computation) */
  ownKills: number;
  /** CT team kills in prev round (CT players only; 0 for T) */
  ctTeamKillsPrev: number;
  /** leave-one-out: CT team kills EXCLUDING this player's own kills — breaks
   *  collinearity with per-class kill rewards in the OLS */
  ctTeamKillsLoo: number;
  /** true when the player was CT in the PREVIOUS round (team reward applies) */
  prevWasCt: boolean;
  side: "CT" | "T";
  playerIndex: number;
  round: number;
  month: number; // match month (1-12) — detect recent rule changes
}

interface Stats {
  samples: Sample[];
  fuseMs: number[];
  fuseDistinct: Map<number, number>;
  matches: number;
  rounds: number;
}

function analyze(pkg: ParsedDemoPackage, s: Stats, month: number): void {
  s.matches++;
  s.rounds += pkg.files.rounds.length;
  const { players, rounds, kills, bombs, playerEconomies } = pkg.files;
  const tickrate = pkg.manifest.tickrate ?? 64;

  const teamByPlayer = new Map<number, string>();
  players.forEach((p, i) => teamByPlayer.set(i, p.teamKey));

  const money = new Map<number, Map<number, { start: number; spent: number }>>();
  for (const row of playerEconomies) {
    let m = money.get(row.playerIndex);
    if (!m) { m = new Map(); money.set(row.playerIndex, m); }
    m.set(row.roundNumber, { start: row.startMoney, spent: row.moneySpent });
  }

  const roundByNumber = new Map(rounds.map((r) => [r.roundNumber, r]));
  const streaks = teamLossStreakPerRound(pkg);

  const plantedByRound = new Map<number, boolean>();
  const plantPlayersByRound = new Map<number, Set<number>>();
  const defusePlayersByRound = new Map<number, Set<number>>();
  const bombsByRound = new Map<number, typeof bombs>();
  for (const b of bombs) {
    const list = bombsByRound.get(b.roundNumber) ?? [];
    list.push(b); bombsByRound.set(b.roundNumber, list);
    if (b.type === "planted") {
      plantedByRound.set(b.roundNumber, true);
      const set = plantPlayersByRound.get(b.roundNumber) ?? new Set();
      set.add(b.actorIndex); plantPlayersByRound.set(b.roundNumber, set);
    }
    if (b.type === "defused") {
      const set = defusePlayersByRound.get(b.roundNumber) ?? new Set();
      set.add(b.actorIndex); defusePlayersByRound.set(b.roundNumber, set);
    }
  }

  // fuse truth
  for (const round of rounds) {
    const bm = bombsByRound.get(round.roundNumber);
    const planted = bm?.find((b) => b.type === "planted");
    const exploded = bm?.find((b) => b.type === "exploded");
    if (planted && exploded) {
      const fuseMs = ((exploded.tick - planted.tick) / tickrate) * 1000;
      s.fuseMs.push(fuseMs);
      s.fuseDistinct.set(fuseMs, (s.fuseDistinct.get(fuseMs) ?? 0) + 1);
    }
  }

  const killsByRound = new Map<number, typeof kills>();
  for (const k of kills) {
    const list = killsByRound.get(k.roundNumber) ?? [];
    list.push(k); killsByRound.set(k.roundNumber, list);
  }

  for (const round of rounds) {
    const r = round.roundNumber;
    if (r < 2) continue;
    const prev = roundByNumber.get(r - 1);
    if (!prev) continue;

    const prevKills = killsByRound.get(r - 1) ?? [];
    // CT team kill reward (2025-07-15 rule): EVERY CT player gets +$50 per
    // T eliminated in the previous round. Determine which teamKey is CT in
    // the PREVIOUS round (sides swap every half!) and count their kills.
    const ctTeamKeyPrev = prev.teamASide === "ct" ? "teamA" : "teamB";
    const ctKillsPrev = prevKills.filter(
      (k) =>
        k.killerIndex !== null &&
        teamByPlayer.get(k.killerIndex) === ctTeamKeyPrev &&
        teamByPlayer.get(k.victimIndex) !== ctTeamKeyPrev,
    ).length;

    const prevPlanted = plantedByRound.get(r - 1) ?? false;
    const prevPlantPlayers = plantPlayersByRound.get(r - 1) ?? new Set();
    const prevDefusePlayers = defusePlayersByRound.get(r - 1) ?? new Set();
    const prevIsPistol = r - 1 === 1 || r - 1 === 14;

    for (const [playerIndex, m] of money) {
      const cur = m.get(r);
      const pre = m.get(r - 1);
      if (!cur || !pre) continue;
      if (process.env.RS_DEBUG && s.samples.length === 0 && r === 2) {
        console.error(`DEBUG p=${playerIndex} cur=${JSON.stringify(cur)} pre=${JSON.stringify(pre)}`);
      }
      const teamKey = teamByPlayer.get(playerIndex);
      if (!teamKey) continue;
      const side = (teamKey === "teamA" ? round.teamASide : round.teamBSide) as "CT" | "T";
      // NOTE: demo format uses lowercase "t"/"ct" (sideSchema); GSI uses "CT"/"T"
      const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;

      const income = cur.start - pre.start + pre.spent;
      const wonPrev = prev.winnerTeamKey === teamKey; // outcome of round r-1 feeds income(r)
      const won = round.winnerTeamKey === teamKey;

      // personal kill rewards of the PREVIOUS round (class table — versioned)
      const killCounts = new Map<string, number>();
      const myTeam = teamByPlayer.get(playerIndex);
      let ownKills = 0;
      for (const k of prevKills) {
        if (k.killerIndex === playerIndex && k.victimIndex !== playerIndex) {
          // team-kills pay NO reward — exclude same-team victims
          if (teamByPlayer.get(k.victimIndex) === myTeam) continue;
          ownKills++;
          const cls = weaponClass(k.weapon);
          if (cls === "world" || cls.startsWith("unknown")) continue; // no reward
          killCounts.set(cls, (killCounts.get(cls) ?? 0) + 1);
        }
      }

      // modeled rewards — FULL integer ledger (everything is modeled):
      //   win/loss + plant/defuse + PERSONAL KILL REWARDS (class table) +
      //   CT shared team award (50 × prev-round CT kills for CT players)
      let modeled = 0;
      let wonBomb = false;
      let lostStreak: number | null = null;
      if (prevSide === "ct") modeled += 50 * ctKillsPrev; // 2025-07-16 shared team award
      if (wonPrev) {
        wonBomb = WIN_BY_BOMB.has(prev.endReason);
        modeled += wonBomb ? WIN_REWARD_BOMB : WIN_REWARD_ELIM;
      } else {
        // pistol-round loss pays 1900 (fandom separate row, C10); verify via Δ
        if (prevIsPistol) {
          modeled += 1900;
          lostStreak = -1; // pistol bucket
        } else {
          const streak = streaks.get(`${r - 1}:${teamKey}`) ?? 0; // streak BEFORE round r-1
          lostStreak = streak;
          modeled += LOSS_BONUS_MODEL[Math.min(streak, 4)]!;
        }
      }
      for (const [cls, cnt] of killCounts) {
        const per = KILL_REWARD_MODEL[cls as keyof typeof KILL_REWARD_MODEL];
        if (per !== undefined) modeled += per * cnt;
      }
      if (prevPlantPlayers.has(playerIndex)) modeled += 300;
      if (prevDefusePlayers.has(playerIndex)) modeled += 300;

      const residual = income - modeled;
      // cap (C6): $16000 truncation makes residual non-informative for the
      // affected sample — mark it and exclude from ALL statistics instead of
      // dropping it outright (modeled is now complete, so nearly every capped
      // player would otherwise be filtered).
      const capped = cur.start >= 16000 && income < modeled;
      if (capped) continue;

      const isCt = prevSide === "ct";
      if (process.env.RS_DEBUG5 && wonPrev && isCt && ctKillsPrev === 5 && s.samples.length < 12) {
        console.error(`D5 r=${r} p=${playerIndex} income=${income} modeled=${modeled} residual=${residual} kills=[${[...killCounts.entries()].map(([c, n]) => `${c}x${n}`).join(",")}] ownKills=${ownKills} prevEnd=${prev.endReason} pre=${pre.start}/${pre.spent} cur=${cur.start}`);
      }
      s.samples.push({
        residual,
        won,
        prevWon: wonPrev,
        wonBomb,
        lostStreak,
        tLostWithPlant: !wonPrev && prevSide === "t" && prevPlanted,
        killCounts,
        ownKills,
        ctTeamKillsPrev: isCt ? ctKillsPrev : 0, // CT players only (2025-07-15 rule)
        ctTeamKillsLoo: isCt ? Math.max(0, ctKillsPrev - ownKills) : 0,
        prevWasCt: isCt,
        side,
        playerIndex,
        round: r,
        month,
      });
    }
  }
}

// ── tiny OLS via normal equations + Gaussian elimination ─────────────────────
function ols(design: number[][], y: number[]): number[] {
  const n = design.length;
  const p = design[0]!.length;
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty: number[] = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a]! += design[i]![a]! * y[i]!;
      for (let b = 0; b < p; b++) XtX[a]![b]! += design[i]![a]! * design[i]![b]!;
    }
  }
  // augmented matrix
  const M = XtX.map((row, i) => [...row, Xty[i]!]);
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let c = col; c <= p; c++) M[col]![c]! /= d;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      if (Math.abs(f) < 1e-12) continue;
      for (let c = col; c <= p; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row) => row[p]!);
}

function report(s: Stats): void {
  console.log(`matches=${s.matches} rounds=${s.rounds} samples=${s.samples.length}`);
  const fuseMean = s.fuseMs.length ? s.fuseMs.reduce((a, b) => a + b, 0) / s.fuseMs.length : NaN;
  console.log(`C4 fuse: mean=${fuseMean.toFixed(1)}ms n=${s.fuseMs.length} distinct=${JSON.stringify([...s.fuseDistinct.entries()])}`);

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const n = (xs: number[]) => xs.length;

  // OLS first, then report group means on KILL-CORRECTED residuals so the
  // group Δ values read out the TRUE reward − model directly.
  // Rare classes (knife/zeus/grenade: <~100 samples, special scenarios) are
  // excluded from the OLS — their tiny counts and collinearity with team
  // kills distort every other coefficient (observed knife ≈ 2600 artifacts).
  const classes = [...new Set(s.samples.flatMap((x) => [...x.killCounts.keys()]))]
    .filter((c) => s.samples.reduce((n, x) => n + (x.killCounts.get(c) ?? 0), 0) >= 150)
    .sort();
  const design: number[][] = [];
  const y: number[] = [];
  for (const x of s.samples) {
    const row = classes.map((c) => x.killCounts.get(c) ?? 0);
    row.push(x.ctTeamKillsLoo);
    row.push(1); // intercept
    design.push(row);
    y.push(x.residual);
  }
  const coef = ols(design, y);
  const corrected = (x: Sample): number => {
    let k = 0;
    for (const c of classes) k += (x.killCounts.get(c) ?? 0) * coef[classes.indexOf(c)]!;
    return x.residual - k - coef[classes.length + 1]!;
  };
  const cm = (xs: Sample[]) => (xs.length ? xs.reduce((a, b) => a + corrected(b), 0) / xs.length : NaN);
  const cn = (xs: Sample[]) => xs.length;

  // ── CT team kill reward (2025-07-15 rule): direct group means ──────────────
  // CT players only AND the player was CT in the previous round (that is when
  // the reward applies). Each additional team kill should add ~$50 to EVERY
  // CT player's income.
  const ctSamples = s.samples.filter((x) => x.prevWasCt);
  const ctByKills = new Map<number, Sample[]>();
  for (const x of ctSamples) {
    const list = ctByKills.get(x.ctTeamKillsPrev) ?? [];
    list.push(x);
    ctByKills.set(x.ctTeamKillsPrev, list);
  }
  console.log("CT team-kill reward — residual by prev-round CT kills (CT players, prev round CT):");
  const base = ctByKills.get(0) ?? [];
  const baseMean = cm(base);
  for (const [k, list] of [...ctByKills.entries()].sort((a, b) => a[0] - b[0])) {
    const perKill = k === 0 ? 0 : (cm(list) - baseMean) / k;
    console.log(`  ctKills=${k}: correctedMean=${cm(list).toFixed(0)} (n=${list.length})  → +$${perKill.toFixed(1)}/kill vs ctKills=0`);
  }

  // ── CT team-award residual by (prev-round outcome × prev-round CT kills) ────
  // FULL integer ledger: personal kill rewards are now IN modeled, so raw
  // residual groups directly measure the team-award correctness. Grouping key
  // uses the PREVIOUS round's outcome (the award belongs to round r−1, paid
  // into income(r)).
  const rawBy = new Map<string, number[]>(); // `${prevWon}:${ctKills}` → residuals
  for (const x of s.samples) {
    if (!x.prevWasCt) continue;
    const key = `${x.prevWon ? "W" : "L"}:${x.ctTeamKillsPrev}`;
    const list = rawBy.get(key) ?? [];
    list.push(x.residual);
    rawBy.set(key, list);
  }
  const rmean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log("CT team-award residual by (PREV outcome × PREV CT kills) — full integer ledger; all groups → 0 if award=50/kill:");
  for (const won of ["W", "L"]) {
    const base = rawBy.get(`${won}:0`) ?? [];
    const baseMean = rmean(base);
    for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const list = rawBy.get(`${won}:${k}`);
      if (!list || list.length === 0) continue;
      const pk = (rmean(list) - baseMean) / k;
      console.log(`  ${won === "W" ? "win " : "loss"} ctKills=${k}: n=${list.length} mean=${rmean(list).toFixed(0)} → +$${pk.toFixed(1)}/kill vs ctKills=0 (base=${baseMean.toFixed(0)}, n=${base.length})`);
    }
  }

  const won = s.samples.filter((x) => x.won && !x.wonBomb);
  const wonBomb = s.samples.filter((x) => x.wonBomb);
  console.log(`win elim: true=${(WIN_REWARD_ELIM + cm(won)).toFixed(0)} (model ${WIN_REWARD_ELIM}, Δ=${cm(won).toFixed(0)}, n=${cn(won)})`);
  console.log(`win bomb: true=${(WIN_REWARD_BOMB + cm(wonBomb)).toFixed(0)} (model ${WIN_REWARD_BOMB}, Δ=${cm(wonBomb).toFixed(0)}, n=${cn(wonBomb)})`);

  for (let i = 0; i < 5; i++) {
    const g = s.samples.filter((x) => x.lostStreak !== null && x.lostStreak >= 0 && Math.min(x.lostStreak, 4) === i);
    console.log(`loss streak ${i}: true=${(LOSS_BONUS_MODEL[i]! + cm(g)).toFixed(0)} (model ${LOSS_BONUS_MODEL[i]}, Δ=${cm(g).toFixed(0)}, n=${cn(g)})`);
  }
  const pistolLoss = s.samples.filter((x) => x.lostStreak === -1);
  console.log(`pistol-round loss: true=${(1900 + cm(pistolLoss)).toFixed(0)} (model 1900, Δ=${cm(pistolLoss).toFixed(0)}, n=${cn(pistolLoss)})`);

  const plant = s.samples.filter((x) => x.tLostWithPlant);
  console.log(`T lost with plant: true plantBonusT=${cm(plant).toFixed(1)} (model 0, n=${cn(plant)})`);

  console.log("OLS per-kill reward (residual ~ Σ kills_cls × r_cls + ctTeamKills_LOO × r_ct + 1):");
  for (let i = 0; i < classes.length; i++) {
    console.log(`  ${classes[i]}: ${coef[i]!.toFixed(1)}`);
  }
  console.log(`  ctTeamKills(LOO): ${coef[classes.length]!.toFixed(1)}`);
  console.log(`  intercept: ${coef[classes.length + 1]!.toFixed(1)} (n=${s.samples.length})`);

  const olsFor = (samples: Sample[], label: string): void => {
    const d: number[][] = [];
    const yy: number[] = [];
    for (const x of samples) {
      const row = classes.map((c) => x.killCounts.get(c) ?? 0);
      row.push(x.ctTeamKillsLoo);
      row.push(1);
      d.push(row);
      yy.push(x.residual);
    }
    const c = ols(d, yy);
    console.log(`OLS ${label} (n=${samples.length}):`);
    for (let i = 0; i < classes.length; i++) console.log(`  ${classes[i]}: ${c[i]!.toFixed(1)}`);
    console.log(`  ctTeamKills(LOO): ${c[classes.length]!.toFixed(1)}  intercept: ${c[classes.length + 1]!.toFixed(1)}`);
  };
  const early = s.samples.filter((x) => x.month <= 3);
  const recent = s.samples.filter((x) => x.month >= 5);
  if (early.length > 200) olsFor(early, "by match date — early (≤2026-03)");
  if (recent.length > 200) olsFor(recent, "by match date — recent (≥2026-05)");
  const june = s.samples.filter((x) => x.month === 6);
  if (june.length > 100) olsFor(june, "by match date — 2026-06 only");

  // group means for the residual sanity
  const all = s.samples.map((x) => x.residual);
  console.log(`residual all: mean=${mean(all).toFixed(1)} n=${n(all)}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files: string[] = [];
  const dirs: string[] = [];
  for (const arg of args) {
    if (arg.endsWith(".zip")) files.push(arg);
    else if (existsSync(join(arg, "manifest.json"))) dirs.push(arg); // unpacked v3 dir
    else if (existsSync(arg)) {
      // directory of zips and/or unpacked v3 package dirs
      for (const entry of readdirSync(arg, { withFileTypes: true })) {
        const p = join(arg, entry.name);
        if (entry.isDirectory()) {
          if (existsSync(join(p, "manifest.json"))) dirs.push(p);
        } else if (entry.name.endsWith(".zip")) {
          files.push(p);
        }
      }
    }
  }
  if (files.length === 0 && dirs.length === 0) { console.error("usage: tsx validate-economy.ts <zip|dir> ..."); process.exit(1); }
  const s: Stats = { samples: [], fuseMs: [], fuseDistinct: new Map(), matches: 0, rounds: 0 };
  for (const f of files) {
    try {
      const pkg = await loadDemoPackage(f);
      const base = f.split("/").pop() ?? f;
      const m = /(?:^|-)2026-(\d{2})/.exec(base);
      const month = m ? Number(m[1]) : 0;
      analyze(pkg, s, month);
      console.error(`✓ ${base}`);
    } catch (e) {
      console.error(`✗ ${f.split("/").pop()}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  for (const d of dirs) {
    try {
      const pkg = await loadDemoPackageDir(d);
      analyze(pkg, s, 0); // month unknown for Windows corpus
      console.error(`✓ dir:${d.split("/").pop()}`);
    } catch (e) {
      console.error(`✗ dir:${d.split("/").pop()}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  report(s);
}

main().catch((e) => { console.error(e); process.exit(1); });
