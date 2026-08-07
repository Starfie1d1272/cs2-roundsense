import { loadDemoPackage } from "./adapter.js";
import { bombTruth, economyTruth, roundTruth, modeledLossCountsPerRound } from "./truth.js";
import { gapReport } from "./gaps.js";

/**
 * `demo-oracle inspect <zip>` — read-only truth summary for one v3 ZIP.
 * Usage: pnpm oracle:inspect -- <path-to.zip>
 */
export async function inspect(zipPath: string): Promise<void> {
  const pkg = await loadDemoPackage(zipPath);
  const m = pkg.manifest;
  console.log(`manifest: schemaVersion=${m.schemaVersion} exporter=${m.exporter.name}@${m.exporter.version}`);
  console.log(`match: ${pkg.files.match.mapName} tickrate=${pkg.files.match.tickrate} ` +
    `${pkg.files.match.teamA.name ?? "teamA"} ${pkg.files.match.teamA.score} - ${pkg.files.match.teamB.score} ${pkg.files.match.teamB.name ?? "teamB"}`);
  console.log(`players: ${pkg.files.players.length}  rounds: ${pkg.files.rounds.length}`);

  const bombs = bombTruth(pkg);
  const planted = bombs.filter((b) => b.plantedTick !== null);
  const withFuse = bombs.filter((b) => b.fuseMs !== null);
  console.log(`bombs: ${planted.length} rounds with plant, ${withFuse.length} with measurable fuse`);
  for (const b of withFuse.slice(0, 6)) {
    console.log(`  r${b.roundNumber}: planted@tick ${b.plantedTick} exploded@tick ${b.explodedTick} fuse=${b.fuseMs?.toFixed(0)}ms`);
  }

  const econ = economyTruth(pkg);
  const player0 = econ.filter((e) => e.playerIndex === 0).slice(0, 4);
  console.log(`economy: ${econ.length} rows (playerIndex=0 sample):`);
  for (const e of player0) {
    console.log(`  r${e.roundNumber} ${e.teamResult ?? "?"}: startMoney=${e.startMoney} spent=${e.moneySpent} eq=${e.equipmentValue} type=${e.type} primary=${e.primaryWeapon ?? "-"} secondary=${e.secondaryWeapon}`);
  }

  const streaks = modeledLossCountsPerRound(pkg, { winDecrement: "count-dep" });
  console.log(`lossStreak: r1 teamA=${streaks.get("1:teamA")} teamB=${streaks.get("1:teamB")}  r2 teamA=${streaks.get("2:teamA")} teamB=${streaks.get("2:teamB")}`);

  console.log("gaps:");
  for (const g of gapReport(pkg)) {
    console.log(`  [${g.severity}] ${g.field} — ${g.mitigation}`);
  }

  void roundTruth;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx src/cli.ts <path-to-v3.zip>");
    process.exit(1);
  }
  await inspect(path);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
