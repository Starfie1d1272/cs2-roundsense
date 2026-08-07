/**
 * RoundSense engine: GSI payload → economy advice.
 *
 * Pure-ish core (testable without network): when player/map/round fields are
 * present, turns a payload into an advice tick via economy-advisor.
 *
 * C4 lives in packages/c4-estimator (C4StateMachine) + apps/roundsense
 * presenter.ts — NOT here.
 *
 * Product rules:
 * - lossStreak comes from map.team_*.consecutive_round_losses when GSI
 *   provides it (runtime-check #1); when absent, assumed 1 and flagged.
 * - OT start money is a server profile — never inferred here; the live
 *   money read comes straight from player.state.money.
 */
import { recommend, type AdvisorInput, type AdvisorOutput, type InventoryState } from "@roundsense/economy-advisor";
import type { GsiPayload } from "@roundsense/gsi-protocol";
import type { ItemId, NextRoundGoal } from "@roundsense/shared-types";

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

/** GSI weapon `type` values observed live (Windows build 14174): SMGs send
 * "Submachine Gun", NOT "SMG" — match the real strings. */
const PRIMARY_TYPE_HINTS = ["Rifle", "Submachine Gun", "Shotgun", "Machinegun", "SniperRifle"];

export function inventoryFrom(payload: GsiPayload): InventoryState {
  const state = payload.player?.state;
  const weapons = payload.player?.weapons ?? {};
  let primary: ItemId | null = null;
  let secondary: ItemId | undefined;
  const grenades: ItemId[] = [];
  for (const w of Object.values(weapons)) {
    const item = w?.name ? GSI_TO_ITEM[w.name] : undefined;
    if (!item) continue;
    if (item === "smoke" || item === "flash" || item === "he" || item === "molotov" || item === "incendiary") {
      // Grenade quantity is ammo_reserve on the single weapon entry
      // (observed build 14174: flash ×2 = one weapon_flashbang, reserve=2).
      // Missing reserve still proves ≥1 carried.
      const reserve = w?.ammo_reserve;
      const count = reserve !== undefined && reserve >= 0 ? reserve : 1;
      for (let i = 0; i < count; i++) grenades.push(item);
      continue;
    }
    if (item === "kevlar" || item === "kevlar_helmet") continue;
    const type = w?.type ?? "";
    if (PRIMARY_TYPE_HINTS.some((h) => type.includes(h))) {
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
    // observed build 14174: player.state.defusekit=true — the kit never
    // appears in player.weapons
    hasDefuseKit: state?.defusekit === true,
    grenades,
  };
}

export function tick(payload: GsiPayload, opts: EngineOptions): AdviceTick | null {
  const player = payload.player;
  const map = payload.map;
  const state = player?.state;
  // C1: advice only during freezetime — the only verified buy window in
  // normal-player GSI (no buytime countdown contract observed yet). live /
  // planted / over / undefined phases get no purchase advice.
  if (payload.round?.phase !== "freezetime") return null;
  // C2: only explicit CT/T teams (observed as "CT"/"T" strings).
  if (!player?.team || (player.team !== "CT" && player.team !== "T")) return null;
  if (state?.money === undefined) return null;
  // map.round must be present — no silent round-1 guess.
  if (map?.round === undefined) return null;
  const side = player.team;
  const teamInfo = side === "T" ? map?.team_t : map?.team_ct;
  const lossStreakGsi = teamInfo?.consecutive_round_losses;
  const lossStreak = lossStreakGsi ?? 1;
  const input: AdvisorInput = {
    side,
    roundNumber: map.round,
    money: state.money,
    lossStreak,
    inventory: inventoryFrom(payload),
    // C3: current GSI money already includes rewards earned before this
    // payload (observed: money 1650 → 2250 exactly when round_kills 0 → 1,
    // Windows build 14174). Past round_kills are NOT future income — never
    // re-add them to the projection.
    killsThisRound: [],
    bombPlantedThisRound: side === "T" && payload.round?.bomb === "planted",
    nextRoundGoal: opts.nextRoundGoal,
  };
  const out: AdvisorOutput = recommend(input);
  return {
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
