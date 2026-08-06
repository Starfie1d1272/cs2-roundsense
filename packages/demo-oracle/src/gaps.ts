import type { ParsedDemoPackage } from "./adapter.js";

export interface Gap {
  /** what is missing or cannot be derived */
  field: string;
  /** how severe for RoundSense research */
  severity: "blocker" | "warning" | "info";
  /** what we do instead (never silent guessing) */
  mitigation: string;
}

/**
 * Explicit gap report for a v3 package (P1 requirement: 哪些字段缺失，
 * 不能静默猜测).
 */
export function gapReport(pkg: ParsedDemoPackage): Gap[] {
  const gaps: Gap[] = [];
  const roundCount = pkg.files.rounds.length;
  const bombRounds = new Set(pkg.files.bombs.map((b) => b.roundNumber));

  // Rounds without any bomb event are legit (no plant that round) — but
  // rounds where a plant exists in kills/round result cannot be checked here.
  const plantedRounds = pkg.files.bombs.filter((b) => b.type === "planted").length;

  if (pkg.files.rounds.some((r) => !bombRounds.has(r.roundNumber))) {
    gaps.push({
      field: "rounds[].bombStatus",
      severity: "info",
      mitigation: `Rounds without bomb events exist (${roundCount - bombRounds.size} of ${roundCount}); treated as no-plant rounds, verified against endReason during corpus validation.`,
    });
  }

  if (plantedRounds === 0) {
    gaps.push({
      field: "bombs.json planted",
      severity: "warning",
      mitigation: "No planted events in this package — C4 truth queries will return null fuse.",
    });
  }

  gaps.push({
    field: "player-economies[].killCount / killWeapons",
    severity: "warning",
    mitigation: "Per-round kill attribution must be joined from kills.json (killerIndex + roundNumber + weapon).",
  });

  gaps.push({
    field: "player-economies[].lossBonus / roundReward",
    severity: "info",
    mitigation: "Not stored; derivable from rounds.json winnerTeamKey + consecutive losses (C2) — validation target for the rules file.",
  });

  gaps.push({
    field: "rounds[].plantedTick",
    severity: "info",
    mitigation: "Not in rounds.json; joined from bombs.json type=planted (truth.ts bombTruth).",
  });

  gaps.push({
    field: "player-economies[].inventoryBefore/After",
    severity: "warning",
    mitigation: "Only round-start snapshot (startMoney/moneySpent/equipmentValue/weapons/grenades) is stored; mid-round changes (drop/pickup) are in bombs/grenades events and replay.json only.",
  });

  return gaps;
}
