import type { ItemId, NextRoundGoal, RoundType, Side, WeaponClass } from "@roundsense/shared-types";

/** Kill attribution input — GSI cannot report kill weapons live (assumption A10);
 * weaponId is optional (available from demo path only). */
export interface KillAttribution {
  weaponClass: WeaponClass | "unknown";
  weaponId?: string;
  count: number;
}

export interface InventoryState {
  primary?: ItemId | null;
  secondary?: ItemId;
  /** current armor value (GSI player.state.armor, 0..100); numeric — the
   * boolean is derived as armor > 0, never stored */
  armor: number;
  hasHelmet: boolean;
  hasDefuseKit: boolean;
  /** grenades carried as a multiset (flash ×2 → two entries) */
  grenades: ItemId[];
}

export interface AdvisorInput {
  side: Side;
  roundNumber: number;
  /** current cash (live, from player_state.money) */
  money: number;
  /** consecutive losses BEFORE this round (map.team_*.consecutive_round_losses) */
  lossStreak: number;
  inventory: InventoryState;
  killsThisRound: KillAttribution[];
  /** T side only: bomb was planted this round (affects loss branch) */
  bombPlantedThisRound?: boolean;
  /** CT side only: how many T the CT team eliminated this round — every CT
   *  player receives +$50 each (C5, corpus-verified 2026-08-06) */
  ctTeamKillsOnTs?: number;
  nextRoundGoal: NextRoundGoal;
}

export interface PurchaseItem {
  item: ItemId;
  quantity: number;
}

export interface ProjectionBranches {
  /** win by elimination (3250) — conservative baseline */
  win: number;
  /** win by bomb detonation/defusal (3500) — only when bomb involved */
  winBomb: number;
  /** plain loss */
  loss: number;
  /** T loss with plant (adds plantBonusT) */
  lossWithPlant: number;
}

export interface Scheme {
  id: string;
  label: string;
  character: "recommended" | "aggressive" | "conservative";
  /** what must ACTUALLY be bought from the current inventory */
  purchases: PurchaseItem[];
  /** incremental spend (actual money needed now) */
  totalCost: number;
  /** full target value with an empty inventory (combat value / ranking) */
  targetCost: number;
  roundType: RoundType;
  affordable: boolean;
  projections: ProjectionBranches;
  breaksGoal: boolean;
  breaksGoalReason?: string;
  basis: string[];
  assumptions: string[];
}

export interface AdvisorOutput {
  goal: NextRoundGoal;
  recommended: Scheme | null;
  alternatives: Scheme[];
  rules: {
    ruleSetId: string;
    status: string;
    verifiedAt: string;
    sources: { name: string; url: string; revision: string; accessed: string }[];
  };
}
