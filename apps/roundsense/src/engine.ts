/**
 * RoundSense engine: GSI payload → C4 status + economy advice.
 *
 * Pure-ish core (testable without network): every GSI frame is reduced
 * through a BombTracker and, when player/map/round fields are present,
 * turned into an advice tick via economy-advisor.
 *
 * Product rules:
 * - C4 remaining time uses C4_FUSE_RULES.fuseMs (41000, corpus-observed
 *   demo semantics; real-game 40 s pending runtime-check).
 * - lossStreak comes from map.team_*.consecutive_round_losses when GSI
 *   provides it (runtime-check #1); when absent, assumed 1 and flagged.
 * - OT start money is a server profile — never inferred here; the live
 *   money read comes straight from player.state.money.
 */
import { C4_FUSE_RULES } from "@roundsense/c4-estimator";
import { recommend, type AdvisorInput, type AdvisorOutput, type InventoryState } from "@roundsense/economy-advisor";
import type { GsiPayload } from "@roundsense/gsi-protocol";
import type { ItemId, NextRoundGoal } from "@roundsense/shared-types";

export interface BombTracker {
  plantedAtMs: number | null;
}

export interface EngineOptions {
  nextRoundGoal: NextRoundGoal;
}

export interface AdviceTick {
  side: "CT" | "T";
  roundNumber: number;
  money: number;
  lossStreak: number;
  lossStreakSource: "gsi" | "assumed-1";
  goal: NextRoundGoal;
  recommended: { character: string; label: string; totalCost: number } | null;
  alternatives: { character: string; label: string; totalCost: number }[];
  breaksGoal: string | null;
}

export interface EngineTick {
  bomb: { planted: boolean; remainingMs: number | null };
  advice: AdviceTick | null;
}

const GSI_TO_ITEM: Record<string, ItemId> = {
  weapon_ak47: "ak47",
  weapon_m4a1: "m4a4",
  weapon_m4a1_silencer: "m4a1s",
  weapon_galilar: "galil",
  weapon_famas: "famas",
  weapon_awp: "awp",
  weapon_mac10: "mac10",
  weapon_mp9: "mp9",
  weapon_deagle: "deagle",
  weapon_glock: "glock",
  weapon_usp_silencer: "usp",
  weapon_hkp2000: "p2000",
  weapon_fiveseven: "fiveseven",
  weapon_tec9: "tec9",
  weapon_p250: "p250",
  weapon_elite: "dual",
  weapon_cz75a: "cz75",
  weapon_kevlar: "kevlar",
  weapon_kevlar_helmet: "kevlar_helmet",
  weapon_defuser: "defuse_kit",
  weapon_smokegrenade: "smoke",
  weapon_flashbang: "flash",
  weapon_hegrenade: "he",
  weapon_molotov: "molotov",
  weapon_incgrenade: "incendiary",
};

function inventoryFrom(payload: GsiPayload): InventoryState {
  const state = payload.player?.state;
  const weapons = payload.player?.weapons ?? {};
  let primary: ItemId | null = null;
  let secondary: ItemId | undefined;
  let hasDefuseKit = false;
  const grenades: ItemId[] = [];
  for (const w of Object.values(weapons)) {
    const item = w?.name ? GSI_TO_ITEM[w.name] : undefined;
    if (!item) continue;
    if (item === "defuse_kit") { hasDefuseKit = true; continue; }
    if (item === "smoke" || item === "flash" || item === "he" || item === "molotov" || item === "incendiary") {
      grenades.push(item);
      continue;
    }
    if (item === "kevlar" || item === "kevlar_helmet") continue;
    const type = w?.type ?? "";
    if (type.includes("Rifle") || type.includes("SMG") || type.includes("Shotgun") || type.includes("Machinegun") || type.includes("SniperRifle")) {
      primary = item;
    } else if (type.includes("Pistol")) {
      secondary = item;
    }
  }
  return {
    primary,
    secondary,
    hasArmor: (state?.armor ?? 0) > 0,
    hasHelmet: state?.helmet === true,
    hasDefuseKit,
    grenades,
    // GSI cannot report whether the player survived the last round; current
    // grenades are held now, so keep them in projections (optimistic)
    survivedLastRound: true,
  };
}

export function tick(payload: GsiPayload, tracker: BombTracker, opts: EngineOptions, receivedAtMs: number): EngineTick {
  // ── C4 ─────────────────────────────────────────────────────────────────────
  const bomb = payload.round?.bomb ?? null;
  if (bomb === "planted" && tracker.plantedAtMs === null) {
    tracker.plantedAtMs = receivedAtMs;
  } else if (bomb !== "planted" && tracker.plantedAtMs !== null) {
    tracker.plantedAtMs = null;
  }
  let remainingMs: number | null = null;
  if (tracker.plantedAtMs !== null) {
    remainingMs = Math.max(0, C4_FUSE_RULES.fuseMs - (receivedAtMs - tracker.plantedAtMs));
  }

  // ── economy advice ─────────────────────────────────────────────────────────
  const player = payload.player;
  const map = payload.map;
  const state = player?.state;
  let advice: AdviceTick | null = null;
  if (player?.team && state?.money !== undefined) {
    const side = player.team === "T" ? "T" : "CT";
    const teamInfo = side === "T" ? map?.team_t : map?.team_ct;
    const lossStreakGsi = teamInfo?.consecutive_round_losses;
    const lossStreak = lossStreakGsi ?? 1;
    const input: AdvisorInput = {
      side,
      roundNumber: map?.round ?? 1,
      money: state.money,
      lossStreak,
      inventory: inventoryFrom(payload),
      killsThisRound: [{ weaponClass: "unknown", count: state.round_kills ?? 0 }],
      bombPlantedThisRound: side === "T" && bomb === "planted",
      nextRoundGoal: opts.nextRoundGoal,
    };
    const out: AdvisorOutput = recommend(input);
    advice = {
      side,
      roundNumber: input.roundNumber,
      money: state.money,
      lossStreak,
      lossStreakSource: lossStreakGsi !== undefined ? "gsi" : "assumed-1",
      goal: out.goal,
      recommended: out.recommended
        ? { character: out.recommended.character, label: out.recommended.label, totalCost: out.recommended.totalCost }
        : null,
      alternatives: out.alternatives.map((s) => ({ character: s.character, label: s.label, totalCost: s.totalCost })),
      breaksGoal: out.recommended?.breaksGoal ? out.recommended.breaksGoalReason ?? "yes" : null,
    };
  }

  return { bomb: { planted: tracker.plantedAtMs !== null, remainingMs }, advice };
}
