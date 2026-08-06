import { z } from "zod";

/**
 * Zod schema for the GSI payload subset RoundSense relies on.
 *
 * Deliberately permissive: CS2 GSI behaviour is only partly confirmed against
 * the CS:GO-era Valve documentation (assumptions A1-A10). Unknown fields are
 * preserved via `.passthrough()`; every field we consume is optional so a
 * payload that lacks a field degrades gracefully instead of crashing.
 */

export const weaponStateSchema = z
  .object({
    name: z.string().optional(),
    paintkit: z.string().optional(),
    type: z.string().optional(),
    ammo_clip: z.number().optional(),
    ammo_reserve: z.number().optional(),
    state: z.string().optional(),
    equipped: z.boolean().optional(),
  })
  .passthrough();

export const playerStateSchema = z
  .object({
    health: z.number().optional(),
    armor: z.number().optional(),
    helmet: z.boolean().optional(),
    flashed: z.number().optional(),
    smoked: z.number().optional(),
    burning: z.number().optional(),
    money: z.number().optional(),
    round_kills: z.number().optional(),
    round_killhs: z.number().optional(),
    equip_value: z.number().optional(),
  })
  .passthrough();

export const playerMatchStatsSchema = z
  .object({
    kills: z.number().optional(),
    assists: z.number().optional(),
    deaths: z.number().optional(),
    mvps: z.number().optional(),
    score: z.number().optional(),
  })
  .passthrough();

export const playerSchema = z
  .object({
    steamid: z.string().optional(),
    name: z.string().optional(),
    activity: z.string().optional(),
    observer_slot: z.number().optional(),
    team: z.string().optional(),
    clan: z.string().optional(),
    state: playerStateSchema.optional(),
    weapons: z.record(z.string(), weaponStateSchema).optional(),
    match_stats: playerMatchStatsSchema.optional(),
  })
  .passthrough();

export const teamInfoSchema = z
  .object({
    score: z.number().optional(),
    consecutive_round_losses: z.number().optional(),
    timeouts_used: z.number().optional(),
    matches_won_this_series: z.number().optional(),
  })
  .passthrough();

export const mapSchema = z
  .object({
    name: z.string().optional(),
    mode: z.string().optional(),
    phase: z.string().optional(),
    round: z.number().optional(),
    team_ct: teamInfoSchema.optional(),
    team_t: teamInfoSchema.optional(),
    num_matches_to_win_series: z.number().optional(),
  })
  .passthrough();

export const roundSchema = z
  .object({
    phase: z.string().optional(),
    bomb: z.string().nullable().optional(),
    win_team: z.string().nullable().optional(),
  })
  .passthrough();

export const providerSchema = z
  .object({
    name: z.string().optional(),
    appid: z.number().optional(),
    version: z.number().optional(),
    steamid: z.string().optional(),
    timestamp: z.number().optional(),
  })
  .passthrough();

/**
 * Root GSI payload. Spectator-only blocks (`bomb`, `phase_countdowns`,
 * `allplayers_*`, `previously`, `added`) are typed as unknown and never
 * consumed by the estimator — if they ever appear (e.g. demo replay on a
 * GOTV connection), they are recorded but not trusted (assumption A2).
 */
export const gsiPayloadSchema = z
  .object({
    provider: providerSchema.optional(),
    map: mapSchema.optional(),
    round: roundSchema.optional(),
    player: playerSchema.optional(),
    bomb: z.unknown().optional(),
    phase_countdowns: z.unknown().optional(),
    allplayers: z.unknown().optional(),
    previously: z.unknown().optional(),
    added: z.unknown().optional(),
  })
  .passthrough();

export type GsiPayload = z.infer<typeof gsiPayloadSchema>;
export type GsiProvider = z.infer<typeof providerSchema>;
export type GsiMap = z.infer<typeof mapSchema>;
export type GsiRound = z.infer<typeof roundSchema>;
export type GsiPlayer = z.infer<typeof playerSchema>;
export type GsiPlayerState = z.infer<typeof playerStateSchema>;

/** True iff the payload carries a planted bomb signal (round.bomb === "planted"). */
export function isBombPlanted(payload: GsiPayload): boolean {
  return payload.round?.bomb === "planted";
}
