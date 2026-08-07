import { z } from "zod";
import type { ItemId, WeaponClass } from "@roundsense/shared-types";
import rulesJson from "../rules/cs2-competitive-2026-08.json";
import weaponsJson from "../rules/weapons.v2026-08-06.json" with { type: "json" };

/**
 * Versioned economy rules. Every concrete number lives either in the rules
 * file (round rewards, bonuses, non-weapon prices, thresholds) or in the
 * GENERATED weapon table (weapons.v2026-08-06.json, from GameTracking-CS2
 * weapons.vdata @ 2e606a0b). Weapon prices and kill rewards are read from
 * the weapon table — the rules file does NOT duplicate them.
 */

const sourceSchema = z.object({
  name: z.string(),
  url: z.string(),
  revision: z.string(),
  accessed: z.string(),
  notes: z.string().optional(),
});

export const economyRulesSchema = z.object({
  ruleSetId: z.string(),
  applicableModes: z.array(z.string()),
  status: z.enum(["provisional", "verified"]),
  verifiedAt: z.string(),
  sources: z.array(sourceSchema),
  maxMoney: z.number().int().positive(),
  startMoney: z.number().int().nonnegative(),
  roundRewards: z.object({
    winByElimination: z.number().int().nonnegative(),
    winByTimeCt: z.number().int().nonnegative(),
    winByBombDefusal: z.number().int().nonnegative(),
    winByBombDetonation: z.number().int().nonnegative(),
    lossBonusByStreak: z.array(z.number().int().nonnegative()).length(5),
    plantBonusT: z.number().int().nonnegative(),
    plantBonusPlayer: z.number().int().nonnegative(),
    defuseBonusPlayer: z.number().int().nonnegative(),
    ctTeamKillReward: z.number().int().nonnegative(),
    /** −$300 per teamkill (cash_player_killed_teammate) — single source */
    tkPenalty: z.number().int().nonnegative(),
  }),
  /** class-level kill rewards are DERIVED from the weapon table at load
   * time (mode of the class's weapons); no hand-written duplicates. */
  killRewards: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** non-weapon prices (armor/kit/grenades) + weapon items resolved via
   * the weapon table (see price()) */
  prices: z.record(z.string(), z.number().int().nonnegative()),
  roundTypeThresholds: z.object({
    ecoMaxSpend: z.number().int().nonnegative(),
    semiMinSpend: z.number().int().nonnegative(),
    forceMinSpend: z.number().int().nonnegative(),
  }),
  corpusValidation: z
    .object({
      method: z.string(),
      run: z.string(),
      results: z.record(z.string(), z.string()),
    })
    .optional(),
  notes: z.record(z.string(), z.string()).optional(),
});

export type EconomyRules = z.infer<typeof economyRulesSchema>;
export type RulesSource = z.infer<typeof sourceSchema>;

export const DEFAULT_RULES: EconomyRules = economyRulesSchema.parse(rulesJson);

/** Load and validate a rules file (path or parsed object). */
export function loadRules(input: unknown): EconomyRules {
  return economyRulesSchema.parse(input);
}

// ── generated weapon table (weapons.v2026-08-06.json) ────────────────────────
interface WeaponRow { price: number; killAward: number; class: string; weaponType: string; aliases: string[] }
type WeaponsPayload = { weaponAliases: Record<string, string>; weapons: Record<string, WeaponRow> };
const WP = weaponsJson as WeaponsPayload;
const WEAPON_AWARD = new Map<string, number>();
const WEAPON_PRICE = new Map<string, number>();
for (const [id, w] of Object.entries(WP.weapons)) {
  WEAPON_AWARD.set(id, w.killAward);
  WEAPON_PRICE.set(id, w.price);
}
for (const [alias, id] of Object.entries(WP.weaponAliases)) WEAPON_AWARD.set(alias, WEAPON_AWARD.get(id) ?? 0);

/** class → modal kill award from the weapon table (no hand-written class table) */
export const CLASS_AWARD = (() => {
  const byClass = new Map<string, number[]>();
  for (const w of Object.values(WP.weapons)) {
    const list = byClass.get(w.class) ?? [];
    list.push(w.killAward);
    byClass.set(w.class, list);
  }
  const out = new Map<string, number>();
  for (const [cls, xs] of byClass) {
    const counts = new Map<number, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    out.set(cls, [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]!);
  }
  return out;
})();

/**
 * Kill reward lookup: weapon-specific (weapon table, id or alias) → class
 * default (aggregated from the weapon table) → throw. NEVER guesses 300.
 */
export function killReward(
  rules: EconomyRules,
  opts: { weaponId?: string; fallbackClass?: WeaponClass | "unknown" },
): number {
  if (opts.weaponId) {
    const award = WEAPON_AWARD.get(opts.weaponId);
    if (award !== undefined) return award;
  }
  if (opts.fallbackClass && opts.fallbackClass !== "unknown") {
    const award = CLASS_AWARD.get(opts.fallbackClass);
    if (award !== undefined) return award;
  }
  throw new Error(`no kill reward for weaponId="${opts.weaponId ?? "-"}" class="${opts.fallbackClass ?? "-"}"`);
}

/** Item → weapon-table id for weapon items; non-weapons stay in rules.prices. */
const ITEM_TO_WEAPON: Partial<Record<ItemId, string>> = {
  ak47: "weapon_ak47", m4a4: "weapon_m4a1", m4a1s: "weapon_m4a1_silencer", galil: "weapon_galilar",
  famas: "weapon_famas", sg553: "weapon_sg556", aug: "weapon_aug", ssg08: "weapon_ssg08",
  awp: "weapon_awp", scar20: "weapon_scar20", g3sg1: "weapon_g3sg1", mac10: "weapon_mac10",
  mp9: "weapon_mp9", mp7: "weapon_mp7", mp5sd: "weapon_mp5sd", ump45: "weapon_ump45",
  p90: "weapon_p90", bizon: "weapon_bizon", nova: "weapon_nova", sawedoff: "weapon_sawedoff",
  mag7: "weapon_mag7", xm1014: "weapon_xm1014", m249: "weapon_m249", negev: "weapon_negev",
  glock: "weapon_glock", usp: "weapon_usp_silencer", p2000: "weapon_hkp2000", p250: "weapon_p250",
  dual: "weapon_elite", tec9: "weapon_tec9", cz75: "weapon_cz75a", fiveseven: "weapon_fiveseven",
  deagle: "weapon_deagle", r8: "weapon_revolver", zeus: "weapon_taser",
};

export function price(rules: EconomyRules, item: ItemId): number {
  const wid = ITEM_TO_WEAPON[item];
  if (wid) {
    const p = WEAPON_PRICE.get(wid);
    if (p !== undefined) return p;
  }
  const p = rules.prices[item];
  if (p === undefined) throw new Error(`no price for item "${item}" in ruleSet ${rules.ruleSetId}`);
  return p;
}

export function lossBonus(rules: EconomyRules, lossStreak: number): number {
  const idx = Math.min(Math.max(0, Math.floor(lossStreak)), rules.roundRewards.lossBonusByStreak.length - 1);
  return rules.roundRewards.lossBonusByStreak[idx]!;
}
