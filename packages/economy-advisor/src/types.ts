import type { ItemId, NextRoundGoal, RoundType, Side, WeaponClass } from "@roundsense/shared-types";

/** Kill attribution input — GSI cannot report kill weapons live (assumption A10). */
export interface KillAttribution {
  weaponClass: WeaponClass | "unknown";
  count: number;
}

export interface InventoryState {
  primary?: ItemId | null;
  secondary?: ItemId;
  hasArmor: boolean;
  hasHelmet: boolean;
  hasDefuseKit: boolean;
  /** grenades carried; they survive if the player survived the round */
  grenades: ItemId[];
  survivedLastRound: boolean;
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
  purchases: PurchaseItem[];
  totalCost: number;
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
