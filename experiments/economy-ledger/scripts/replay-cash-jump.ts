/**
 * Replay cash-jump analysis: does a T-elimination give EVERY CT player +$50
 * (2025-07-15 shared team award) at the moment of the kill?
 *
 * Uses replay.json per-frame cash (8Hz, covers the whole round incl. freeze
 * time) — pure integer arithmetic, no statistics.
 *
 * Run: pnpm --filter @roundsense/experiment-economy-ledger exec tsx scripts/replay-cash-jump.ts <zip> [<zip>...]
 */
import { readFile } from "node:fs/promises";
import { loadDemoPackage, type ParsedDemoPackage } from "@roundsense/demo-oracle";
import { decodeDelta } from "cs2-demo-format/parser";

interface KillEvent { roundNumber: number; tick: number; killerIndex: number | null; victimIndex: number; }

function weaponClass(weapon: string): string {
  const m: Array<[RegExp, string]> = [
    [/^ak47$|^m4a4$|^m4a1_silencer$|^galilar$|^famas$|^sg556$|^aug$/, "rifle"],
    [/^awp$/, "awp"],
    [/^ssg08$|^scar20$|^g3sg1$/, "sniper"],
    [/^mac10$|^mp9$|^mp7$|^mp5sd$|^ump45$|^p90$|^bizon$/, "smg"],
    [/^nova$|^sawedoff$|^mag7$|^xm1014$/, "shotgun"],
    [/^m249$|^negev$/, "mg"],
    [/^knife/, "knife"],
    [/^zeus$/, "zeus"],
    [/^hegrenade$|^molotov$|^incgrenade$|^inferno$|^flashbang$|^decoy$/, "grenade"],
    [/^glock$|^usp_silencer$|^hkp2000$|^p250$|^elite$|^tec9$|^cz75a$|^fiveseven$|^deagle$|^revolver$/, "pistol"],
  ];
  for (const [re, cls] of m) if (re.test(weapon)) return cls;
  return weapon.startsWith("unknown") ? "unknown:" + weapon : weapon;
}

async function analyzeOne(pkg: ParsedDemoPackage, label: string): Promise<void> {
  const { files } = pkg;
  const teamByPlayer = new Map<number, string>();
  for (const [i, p] of files.players.entries()) teamByPlayer.set(i, p.teamKey);

  // teamKey → side per round (teamA/teamB sides swap at half)
  const sideOf = (teamKey: string, roundNumber: number): "ct" | "t" | null => {
    const r = files.rounds.find((x) => x.roundNumber === roundNumber);
    if (!r) return null;
    return teamKey === "teamA" ? r.teamASide : r.teamBSide;
  };

  // kills per round
  const killsByRound = new Map<number, KillEvent[]>();
  for (const k of files.kills) {
    const list = killsByRound.get(k.roundNumber) ?? [];
    list.push({ roundNumber: k.roundNumber, tick: k.tick, killerIndex: k.killerIndex, victimIndex: k.victimIndex });
    killsByRound.set(k.roundNumber, list);
  }

  const replay = files.replay;
  if (!replay) { console.log(`${label}: no replay — skipped`); return; }

  let checkedKills = 0;
  let nonKillerPlus50 = 0;
  let nonKillerNoChange = 0;
  const examples: string[] = [];

  for (const rr of replay.rounds) {
    const roundNumber = rr.roundNumber;
    const kills = killsByRound.get(roundNumber) ?? [];
    const ctKills = kills.filter((k) => {
      if (k.killerIndex === null) return false;
      const kTeam = teamByPlayer.get(k.killerIndex);
      const vTeam = teamByPlayer.get(k.victimIndex);
      return kTeam !== undefined && vTeam !== undefined && sideOf(kTeam, roundNumber) === "ct" && sideOf(vTeam, roundNumber) === "t";
    });
    if (ctKills.length === 0) continue;

    // CT players this round
    const ctPlayers = rr.players.filter((t) => sideOf(teamByPlayer.get(t.playerIndex) ?? "", roundNumber) === "ct");
    // decode money tracks
    const moneyByPlayer = new Map<number, number[]>();
    for (const t of ctPlayers) moneyByPlayer.set(t.playerIndex, decodeDelta(t.money));

    for (const kill of ctKills) {
      checkedKills++;
      const fi = Math.round((kill.tick - rr.startTick) / rr.tickStep);
      if (fi <= 0 || fi + 1 >= rr.frameCount) continue;
      for (const t of ctPlayers) {
        const money = moneyByPlayer.get(t.playerIndex)!;
        const before = money[fi - 1];
        const after = money[fi + 1];
        if (before === undefined || after === undefined) continue;
        const jump = after - before;
        const isKiller = t.playerIndex === kill.killerIndex;
        if (!isKiller) {
          if (jump === 50) { nonKillerPlus50++; if (examples.length < 5) examples.push(`r${roundNumber} tick=${kill.tick} nonKiller p${t.playerIndex} money ${before}→${after} (+50 ✓)`); }
          else if (jump === 0) { nonKillerNoChange++; if (examples.length < 5) examples.push(`r${roundNumber} tick=${kill.tick} nonKiller p${t.playerIndex} money ${before}→${after} (no change)`); }
          else if (examples.length < 8) examples.push(`r${roundNumber} tick=${kill.tick} nonKiller p${t.playerIndex} money ${before}→${after} (jump=${jump})`);
        }
      }
    }
  }

  console.log(`\n=== ${label} ===`);
  console.log(`CT kills checked: ${checkedKills}`);
  console.log(`non-killer CT players: +$50 at kill frame: ${nonKillerPlus50}, no change: ${nonKillerNoChange}`);
  for (const ex of examples) console.log(`  ${ex}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) { console.error("usage: replay-cash-jump.ts <zip>..."); process.exit(1); }
  for (const f of args) {
    try {
      const pkg = await loadDemoPackage(f);
      await analyzeOne(pkg, f.split("/").pop() ?? f);
    } catch (e) {
      console.error(`✗ ${f}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
}

void main();
