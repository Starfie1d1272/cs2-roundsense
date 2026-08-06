/**
 * RoundSense cross-package domain enums and types.
 *
 * These are intentional copies of the literals defined in `cs2-demo-format`
 * (economyTypeSchema etc.) so that pure packages (c4-estimator,
 * economy-advisor) do not depend on the demo-format package. A consistency
 * test in `demo-oracle` asserts the values never drift.
 */

/** Round economy classification — mirrors cs2-demo-format `economyTypeSchema`. */
export const ROUND_TYPES = ["pistol", "eco", "semi", "force", "full"] as const;
export type RoundType = (typeof ROUND_TYPES)[number];

/** Round end reasons — mirrors cs2-demo-format `endReasonSchema`. */
export const END_REASONS = [
  "t_win",
  "ct_win",
  "target_bombed",
  "bomb_defused",
  "time_ran_out",
] as const;
export type EndReason = (typeof END_REASONS)[number];

/** Bomb event types in demo truth — mirrors cs2-demo-format `bombEventTypeSchema`. */
export const BOMB_EVENT_TYPES = [
  "plant_begin",
  "planted",
  "defuse_begin",
  "defused",
  "exploded",
  "dropped",
  "picked_up",
] as const;
export type BombEventType = (typeof BOMB_EVENT_TYPES)[number];

/** `round.bomb` values observable via GSI (assumption A3; Valve doc lists
 * planted/exploded/defused, community observations add exploding/dropped). */
export const GSI_BOMB_STATES = [
  "planted",
  "exploding",
  "exploded",
  "defused",
  "dropped",
] as const;
export type GsiBombState = (typeof GSI_BOMB_STATES)[number] | null;

/** `round.phase` values (assumption A1). */
export const ROUND_PHASES = ["freezetime", "live", "over"] as const;
export type RoundPhase = (typeof ROUND_PHASES)[number] | string;

/** `map.phase` values — loose on purpose until verified on Windows (A4). */
export type MapPhase = string;

export type Side = "CT" | "T";

/** Weapon classes used for kill-reward lookup and buy planning. */
export const WEAPON_CLASSES = [
  "knife",
  "pistol",
  "smg",
  "shotgun",
  "rifle",
  "mg",
  "awp",
  "sniper",
  "grenade",
  "zeus",
] as const;
export type WeaponClass = (typeof WEAPON_CLASSES)[number];

/** Next-round purchase goals for the advisor (P0-B). */
export const NEXT_ROUND_GOALS = [
  "awp",
  "rifle_armor",
  "rifle_util",
  "max_combat_now",
] as const;
export type NextRoundGoal = (typeof NEXT_ROUND_GOALS)[number];

/** C4 state machine states (P0-A). */
export const C4_STATES = [
  "idle",
  "planted_unknown", // planted seen without a round baseline (receiver mid-round start)
  "planted", // planted with known plantedAt
  "exploded",
  "defused",
  "round_over", // round ended without observed explosion/defuse — no fabrication
] as const;
export type C4State = (typeof C4_STATES)[number];

/** C4 state machine events emitted to consumers. */
export const C4_EVENT_TYPES = [
  "planted",
  "defused",
  "exploded",
  "round_over",
  "baseline_only", // suppressed event — receiver started mid-round
  "reset",
] as const;
export type C4EventType = (typeof C4_EVENT_TYPES)[number];

/** Weapon item ids for the economy advisor's price table. */
export const ITEM_IDS = [
  // rifles
  "ak47", "m4a4", "m4a1s", "galil", "famas", "sg553", "aug", "ssg08", "awp", "scar20", "g3sg1",
  // smg / heavy
  "mac10", "mp9", "mp7", "mp5sd", "ump45", "p90", "bizon", "nova", "sawedoff", "mag7", "xm1014", "m249", "negev",
  // pistols
  "glock", "usp", "p2000", "p250", "dual", "tec9", "cz75", "fiveseven", "deagle", "r8",
  // equipment / grenades
  "kevlar", "kevlar_helmet", "defuse_kit", "zeus", "smoke", "flash", "he", "molotov", "incendiary", "decoy",
] as const;
export type ItemId = (typeof ITEM_IDS)[number];
