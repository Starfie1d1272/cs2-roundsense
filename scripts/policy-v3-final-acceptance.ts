/**
 * Frozen-corpus behavioral acceptance audit for Policy V3.
 *
 * Demo/replay fields are used only to reconstruct the player's own pre-buy
 * inventory or as post-hoc labels. recommendPolicyV3() receives only fields
 * available to a normal-player GSI client (or their replay-equivalent public
 * round facts). Professional behavior is a behavioral reference, not an
 * optimal-policy label.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import JSZip from "jszip";
import {
  DEFAULT_RULES,
  inferOpponentEconomy,
  isItemLegalForSide,
  lossBonus,
  planPurchases,
  price,
  recommend,
  recommendPolicyV3,
  resultingLoadout,
  rifleFor,
  smgFor,
  weaponClassOf,
  type InventoryState,
  type PolicyMode,
  type PolicyV3State,
  type PurchaseItem,
} from "../packages/economy-advisor/src/index.js";
import { unknownTiming } from "../packages/c4-estimator/src/index.js";
import type { ItemId, RoundType, Side } from "../packages/shared-types/src/index.js";

const EXPECTED_CORPUS_SHA256 = "33f29c35fb124a4e45d38a00be8f389d32403c0762576b607db7a9a37fe0d9e6";
const BASELINE_POLICY_SHA = "584ec5ce91c6d1bf8d138783a42d137fe7276a47";
const DEFAULT_CORPUS = "/tmp/roundsense-cologne-policy/player-rounds.json";
const DEFAULT_MAPS = "/tmp/roundsense-cologne-policy/maps";
const DEFAULT_OUTPUT = "experiments/policy-v3/results/policy-v3-final-acceptance.json";

const DEMO_TO_ITEM: Readonly<Record<string, ItemId>> = {
  "AK-47": "ak47", M4A4: "m4a4", "M4A1-S": "m4a1s", "Galil AR": "galil", FAMAS: "famas",
  "SG 553": "sg553", AUG: "aug", "SSG 08": "ssg08", AWP: "awp", "SCAR-20": "scar20", G3SG1: "g3sg1",
  "MAC-10": "mac10", MP9: "mp9", MP7: "mp7", "MP5-SD": "mp5sd", "UMP-45": "ump45", P90: "p90", "PP-Bizon": "bizon",
  Nova: "nova", XM1014: "xm1014", "Sawed-Off": "sawedoff", "MAG-7": "mag7", M249: "m249", Negev: "negev",
  "Glock-18": "glock", "USP-S": "usp", P2000: "p2000", P250: "p250", "Dual Berettas": "dual",
  "Tec-9": "tec9", "CZ75-Auto": "cz75", "Five-SeveN": "fiveseven", "Desert Eagle": "deagle", "R8 Revolver": "r8",
  "Zeus x27": "zeus",
};
const DEMO_GRENADE: Readonly<Record<string, ItemId>> = {
  flashbang: "flash", smoke: "smoke", hegrenade: "he", molotov: "molotov", incendiary: "incendiary", decoy: "decoy",
};
const GRENADE_PRICES: Readonly<Record<string, number>> = {
  smoke: 300, flashbang: 200, hegrenade: 300, molotov: 400, incendiary: 600, decoy: 50,
};

type ActualMode = Exclude<PolicyMode, "AWP_PATH">;
type TeamEconomy = "pistol" | "eco" | "semi" | "force" | "full";
type PrimaryFamily = "rifle" | "sniper" | "smg" | "heavy" | "none" | "other";
type ArmorState = "none" | "kevlar" | "vesthelm";
type Reason = "COVERED_ALTERNATIVE" | "UNAVAILABLE_CONTEXT" | "ROBUST_GENERAL_DEFAULT" | "DATA_AMBIGUITY" | "POLICY_MISS" | "UNEXPLAINED";

interface Row {
  map: string;
  roundNumber: number;
  playerIndex: number;
  name: string;
  teamKey: string;
  side: "ct" | "t";
  scoreCT: number;
  scoreT: number;
  overtime: boolean;
  winnerSide: "ct" | "t";
  endReason: string;
  startMoney: number;
  moneySpent: number;
  actionType: RoundType;
  primary: string | null;
  secondary: string | null;
  hasArmor: boolean;
  hasHelmet: boolean;
  hasDefuseKit: boolean;
  grenades: string | string[];
  retainedPrimary: string | null;
  retainedSecondary: string | null;
  retainedArmor: boolean;
  retainedHelmet: boolean;
  retainedKit: boolean;
  retainedGrenades: string | string[];
  survivedPrev: boolean;
  lossIndex: number;
  lossIndexAmbiguous: boolean;
  dropGave: boolean;
  dropReceived: boolean;
  estLoadoutValue: number;
  estRetainedValue: number;
}

interface ReplayPlayer {
  playerIndex: number;
  flags: number[];
  armor: number[];
  grenades: string[][];
}

interface ReplayRound {
  roundNumber: number;
  players: ReplayPlayer[];
}

interface Prestate {
  alive: boolean;
  armor: number;
  kit: boolean;
  grenades: string[];
}

interface Eligible {
  row: Row;
  money: number;
  inventory: InventoryState;
  opponentLossIndex: number;
  context: "POST_PISTOL" | "NORMAL" | "OVERTIME";
  previousWinner: Side | "UNKNOWN";
  teamEconomy: TeamEconomy;
}

interface Candidate {
  mode: ActualMode;
  primaryFamily: PrimaryFamily;
  armorState: ArmorState;
  utility: string;
  utilityBits: readonly number[];
  kit: boolean;
  spend: number;
  purchases: readonly PurchaseItem[];
  primary: ItemId | null;
}

interface Actual extends Candidate {
  sourceMode: RoundType;
}

interface SevereFlags {
  force_actual_eco: boolean;
  preserve_actual_full: boolean;
  full_actual_eco: boolean;
  primary_family: boolean;
  spend_ge_1000: boolean;
  armor: boolean;
  helmet: boolean;
  retained_weapon: boolean;
}

interface CaseRecord {
  map: string;
  round: number;
  player_index: number;
  side: Side;
  context: Eligible["context"];
  money: number;
  loss_index: number;
  retained_primary_family: PrimaryFamily;
  actual: Pick<Actual, "mode" | "primaryFamily" | "armorState" | "utility" | "kit" | "spend">;
  lead: Pick<Candidate, "mode" | "primaryFamily" | "armorState" | "utility" | "kit" | "spend">;
  reason: Reason;
  severe: SevereFlags;
}

function parseArgs(): { corpus: string; maps: string; output: string } {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("usage: tsx scripts/policy-v3-final-acceptance.ts [--corpus PATH] [--maps-dir PATH] [--output PATH]");
    values.set(key, value);
  }
  return {
    corpus: resolve(values.get("--corpus") ?? DEFAULT_CORPUS),
    maps: resolve(values.get("--maps-dir") ?? DEFAULT_MAPS),
    output: resolve(values.get("--output") ?? DEFAULT_OUTPUT),
  };
}

function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function fact<T>(value: T, source: string) {
  return { status: "OBSERVED" as const, value, source, asOfSeq: 1 };
}

function normGrenades(value: string | string[]): string[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error("invalid grenade multiset");
  return parsed;
}

function key(row: Pick<Row, "map" | "roundNumber" | "playerIndex">): string {
  return `${row.map}:${row.roundNumber}:${row.playerIndex}`;
}

function dropFlags(row: Row): { gave: boolean; received: boolean } {
  const newValue = Math.max(0, row.estLoadoutValue - row.estRetainedValue);
  return { gave: row.moneySpent > newValue + 800, received: newValue > row.moneySpent + 800 };
}

function correctedRetainedPrimary(row: Row, rowByKey: ReadonlyMap<string, Row>): string | null | "UNKNOWN" {
  if (row.roundNumber === 13 || (row.overtime && (row.roundNumber - 25) % 3 === 0)) return null;
  if (row.retainedPrimary && row.primary === null && row.moneySpent >= 200 && row.moneySpent <= 800) {
    const previous = rowByKey.get(`${row.map}:${row.roundNumber - 1}:${row.playerIndex}`);
    return previous?.primary ? "UNKNOWN" : row.retainedPrimary;
  }
  return row.retainedPrimary;
}

function itemOf(name: string | null): ItemId | null {
  if (name === null) return null;
  const item = DEMO_TO_ITEM[name];
  if (!item) throw new Error(`unknown demo weapon: ${name}`);
  return item;
}

function family(item: ItemId | null | undefined): PrimaryFamily {
  if (!item) return "none";
  const cls = weaponClassOf(item);
  if (cls === "rifle") return "rifle";
  if (cls === "sniper" || cls === "awp") return "sniper";
  if (cls === "smg") return "smg";
  if (cls === "shotgun" || cls === "mg") return "heavy";
  return "other";
}

function armorState(armor: number | boolean, helmet: boolean): ArmorState {
  const present = typeof armor === "number" ? armor > 0 : armor;
  return !present ? "none" : helmet ? "vesthelm" : "kevlar";
}

function canonicalGrenades(items: readonly ItemId[]): string {
  return [...items].sort().join("+");
}

function utilityBits(items: readonly ItemId[]): readonly number[] {
  return [
    Number(items.includes("smoke")),
    Number(items.includes("molotov") || items.includes("incendiary")),
    Number(items.includes("flash")),
    Number(items.filter((item) => item === "flash").length >= 2),
    Number(items.includes("he")),
  ];
}

function actualMode(type: RoundType): ActualMode {
  if (type === "full") return "FULL";
  if (type === "force") return "FORCE";
  if (type === "semi") return "LIGHT";
  return "PRESERVE";
}

function candidateFrom(mode: PolicyMode, inventory: InventoryState, purchases: readonly PurchaseItem[], spend: number): Candidate {
  const loadout = resultingLoadout(inventory, [...purchases]);
  const normalizedMode: ActualMode = mode === "AWP_PATH" ? "FULL" : mode;
  return {
    mode: normalizedMode,
    primaryFamily: family(loadout.primary),
    armorState: armorState(loadout.armor, loadout.hasHelmet),
    utility: canonicalGrenades(loadout.grenades),
    utilityBits: utilityBits(loadout.grenades),
    kit: loadout.hasDefuseKit,
    spend,
    purchases,
    primary: loadout.primary,
  };
}

function actualFrom(row: Row, mode = actualMode(row.actionType)): Actual {
  const grenades = normGrenades(row.grenades).map((item) => {
    const mapped = DEMO_GRENADE[item];
    if (!mapped) throw new Error(`unknown demo grenade: ${item}`);
    return mapped;
  });
  const primary = itemOf(row.primary);
  return {
    sourceMode: row.actionType,
    mode,
    primaryFamily: family(primary),
    armorState: armorState(row.hasArmor, row.hasHelmet),
    utility: canonicalGrenades(grenades),
    utilityBits: utilityBits(grenades),
    kit: row.hasDefuseKit,
    spend: row.moneySpent,
    purchases: [],
    primary,
  };
}

function purchaseSpend(inventory: InventoryState, purchases: readonly PurchaseItem[]): number {
  let total = 0;
  for (const purchase of purchases) {
    const unit = purchase.item === "kevlar_helmet" && inventory.armor === 100 && !inventory.hasHelmet
      ? price(DEFAULT_RULES, "kevlar_helmet") - price(DEFAULT_RULES, "kevlar")
      : price(DEFAULT_RULES, purchase.item);
    total += unit * purchase.quantity;
  }
  return total;
}

function dedupe(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const signature = `${candidate.mode}|${candidate.spend}|${candidate.purchases.map((purchase) => `${purchase.item}:${purchase.quantity}`).join(",")}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function v3Candidates(state: PolicyV3State): { output: ReturnType<typeof recommendPolicyV3>; candidates: Candidate[] } {
  const output = recommendPolicyV3(state);
  const inventory = state.player.inventory.value!;
  const candidates: Candidate[] = [];
  for (const option of output.options) {
    candidates.push(candidateFrom(option.mode, inventory, option.purchases, option.bundleSpend));
    for (const alternative of option.conditionalAlternatives) {
      candidates.push(candidateFrom(option.mode, inventory, alternative.purchases, purchaseSpend(inventory, alternative.purchases)));
    }
  }
  return { output, candidates: dedupe(candidates) };
}

function naiveCandidates(eligible: Eligible): Candidate[] {
  const { inventory } = eligible;
  const side: Side = eligible.row.side === "t" ? "T" : "CT";
  const paidPistol: ItemId = side === "T" ? "tec9" : "fiveseven";
  const tiers: Array<[ActualMode, ItemId[]]> = [
    ["FULL", [rifleFor(side), "kevlar"]],
    ["LIGHT", [smgFor(side), "kevlar"]],
    ["FORCE", [paidPistol, "kevlar"]],
    ["FORCE", [paidPistol]],
    ["PRESERVE", []],
  ];
  for (const [mode, items] of tiers) {
    const counts = new Map<ItemId, number>();
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
    const target = [...counts].map(([item, quantity]) => ({ item, quantity }));
    const plan = planPurchases(inventory, target, DEFAULT_RULES, side);
    if (plan.isComplete && plan.totalCost <= eligible.money) return [candidateFrom(mode, inventory, plan.purchases, plan.totalCost)];
  }
  throw new Error("naive baseline has no legal preserve fallback");
}

function mapV2Mode(type: RoundType): ActualMode {
  return actualMode(type);
}

function v2Candidates(eligible: Eligible): Candidate[] {
  const side: Side = eligible.row.side === "t" ? "T" : "CT";
  const output = recommend({
    side,
    roundNumber: eligible.row.roundNumber,
    money: eligible.money,
    lossStreak: eligible.row.lossIndex,
    inventory: eligible.inventory,
    killsThisRound: [],
    nextRoundGoal: "rifle_armor",
  });
  const schemes = [output.recommended, ...output.alternatives.slice(0, 2)].filter((scheme): scheme is NonNullable<typeof scheme> => scheme !== null);
  return dedupe(schemes.map((scheme) => candidateFrom(mapV2Mode(scheme.roundType), eligible.inventory, scheme.purchases, scheme.totalCost)));
}

function stateFor(eligible: Eligible): PolicyV3State {
  const side: Side = eligible.row.side === "t" ? "T" : "CT";
  const opponentSide: Side = side === "T" ? "CT" : "T";
  const score = { ct: eligible.row.scoreCT, t: eligible.row.scoreT };
  const opponent = inferOpponentEconomy({
    asOfSeq: 1,
    opponentSide: fact(opponentSide, "opponent side inferred from player.team"),
    roundNumber: fact(eligible.row.roundNumber, "map.round"),
    score: fact(score, "map.team_*.score"),
    opponentLossIndex: fact(eligible.opponentLossIndex, "opponent map.team_*.consecutive_round_losses"),
  });
  const ownLoss = fact(Math.max(0, Math.min(4, eligible.row.lossIndex)), "own map.team_*.consecutive_round_losses");
  const opponentLoss = fact(Math.max(0, Math.min(4, eligible.opponentLossIndex)), "opponent map.team_*.consecutive_round_losses");
  return {
    round: {
      number: fact(eligible.row.roundNumber, "map.round"),
      phase: fact("freezetime", "round.phase"),
      side: fact(side, "player.team"),
      score: fact(score, "map.team_*.score"),
      context: fact(eligible.context, "map.round"),
    },
    player: { money: fact(eligible.money, "player.state.money"), lossIndex: ownLoss, inventory: fact(eligible.inventory, "player.state + player.weapons") },
    teamLoss: side === "CT" ? { ct: ownLoss, t: opponentLoss } : { ct: opponentLoss, t: ownLoss },
    history: eligible.context === "POST_PISTOL"
      ? {
          integrity: "COMPLETE",
          previousRounds: [{
            roundNumber: eligible.row.roundNumber - 1,
            winner: eligible.previousWinner === "UNKNOWN"
              ? { status: "UNKNOWN", source: "continuous prior-round GSI winner", asOfSeq: 1, reason: "terminal winner unavailable" }
              : fact(eligible.previousWinner, "continuous prior-round GSI winner"),
            planted: { status: "UNKNOWN", source: "not used by post-pistol policy", asOfSeq: 1, reason: "not reconstructed for this audit" },
          }],
        }
      : { integrity: "COMPLETE", previousRounds: [] },
    opponent,
    preference: { source: "DEFAULT", awpPriority: "NEUTRAL" },
  };
}

function modesEqual(a: Candidate, b: Actual): boolean { return a.mode === b.mode; }
function primaryEqual(a: Candidate, b: Actual): boolean { return a.primaryFamily === b.primaryFamily; }
function armorEqual(a: Candidate, b: Actual): boolean { return a.armorState === b.armorState; }
function helmetEqual(a: Candidate, b: Actual): boolean { return (a.armorState === "vesthelm") === (b.armorState === "vesthelm"); }
function armorPresenceEqual(a: Candidate, b: Actual): boolean { return (a.armorState !== "none") === (b.armorState !== "none"); }
function utilityEqual(a: Candidate, b: Actual): boolean { return a.utility === b.utility; }
function kitEqual(a: Candidate, b: Actual): boolean { return a.kit === b.kit; }

function coreScore(candidate: Candidate, actual: Actual): number {
  return Number(modesEqual(candidate, actual)) + Number(primaryEqual(candidate, actual)) + Number(armorEqual(candidate, actual))
    + Number(utilityEqual(candidate, actual)) + Number(kitEqual(candidate, actual));
}

function severeFlags(lead: Candidate, actual: Actual, inventory: InventoryState): SevereFlags {
  const retainedFamily = family(inventory.primary);
  return {
    force_actual_eco: lead.mode === "FORCE" && actual.sourceMode === "eco",
    preserve_actual_full: lead.mode === "PRESERVE" && actual.mode === "FULL",
    full_actual_eco: lead.mode === "FULL" && actual.sourceMode === "eco",
    primary_family: !primaryEqual(lead, actual),
    spend_ge_1000: Math.abs(lead.spend - actual.spend) >= 1000,
    armor: !armorPresenceEqual(lead, actual),
    helmet: !helmetEqual(lead, actual),
    retained_weapon: (retainedFamily === "rifle" || inventory.primary === "awp") && lead.primary !== inventory.primary,
  };
}

function isSevere(flags: SevereFlags): boolean {
  return Object.values(flags).some(Boolean);
}

function discrepancyReason(candidates: readonly Candidate[], actual: Actual, flags: SevereFlags): Reason | null {
  const lead = candidates[0]!;
  const material = !modesEqual(lead, actual) || !primaryEqual(lead, actual) || !armorEqual(lead, actual)
    || !utilityEqual(lead, actual) || !kitEqual(lead, actual) || flags.spend_ge_1000;
  if (!material) return null;
  if (candidates.slice(1).some((candidate) => coreScore(candidate, actual) === 5 && Math.abs(candidate.spend - actual.spend) < 1000)) return "COVERED_ALTERNATIVE";
  if (actual.mode === "FULL" && actual.primaryFamily === "none") return "DATA_AMBIGUITY";
  if (actual.primaryFamily === "sniper" && lead.primaryFamily !== "sniper") return "UNAVAILABLE_CONTEXT";
  const onlyKit = modesEqual(lead, actual) && primaryEqual(lead, actual) && armorEqual(lead, actual) && utilityEqual(lead, actual) && !kitEqual(lead, actual) && !flags.spend_ge_1000;
  if (onlyKit) return "UNAVAILABLE_CONTEXT";
  if (modesEqual(lead, actual) && primaryEqual(lead, actual) && armorPresenceEqual(lead, actual)) return "ROBUST_GENERAL_DEFAULT";
  if (flags.force_actual_eco || flags.preserve_actual_full || flags.full_actual_eco || flags.retained_weapon) return "POLICY_MISS";
  if (!primaryEqual(lead, actual) && actual.primaryFamily !== "sniper") return "POLICY_MISS";
  if (flags.armor || (flags.spend_ge_1000 && !modesEqual(lead, actual))) return "POLICY_MISS";
  return "UNEXPLAINED";
}

function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function round4(value: number): number { return Math.round(value * 10_000) / 10_000; }
function rate(value: number, n: number): number { return n === 0 ? 0 : round4(value / n); }

class ModelMetrics {
  readonly fields = {
    mode: { exact: 0, compatible: 0 },
    primary_family: { exact: 0, compatible: 0 },
    armor_state: { exact: 0, compatible: 0 },
    armor_presence: { exact: 0, compatible: 0 },
    helmet: { exact: 0, compatible: 0 },
    utility_multiset: { exact: 0, compatible: 0 },
    kit: { exact: 0, compatible: 0 },
  };
  readonly utilityBitLead = [0, 0, 0, 0, 0];
  readonly utilityBitCompatible = [0, 0, 0, 0, 0];
  readonly spendErrors: number[] = [];
  readonly spendBestErrors: number[] = [];
  readonly modeMatrix = new Map<string, number>();
  readonly modeByActual = new Map<ActualMode, { n: number; exact: number; compatible: number }>();
  readonly offeredModes = new Map<ActualMode, number>();
  readonly severe = new Map<keyof SevereFlags | "any", number>();
  n = 0;

  add(candidates: readonly Candidate[], actual: Actual, inventory: InventoryState): SevereFlags {
    const lead = candidates[0];
    if (!lead) throw new Error("model returned no candidate");
    this.n++;
    const checks = {
      mode: modesEqual,
      primary_family: primaryEqual,
      armor_state: armorEqual,
      armor_presence: armorPresenceEqual,
      helmet: helmetEqual,
      utility_multiset: utilityEqual,
      kit: kitEqual,
    } as const;
    for (const [name, check] of Object.entries(checks) as Array<[keyof typeof this.fields, (candidate: Candidate, label: Actual) => boolean]>) {
      if (check(lead, actual)) this.fields[name].exact++;
      if (candidates.some((candidate) => check(candidate, actual))) this.fields[name].compatible++;
    }
    for (let index = 0; index < actual.utilityBits.length; index++) {
      if (lead.utilityBits[index] === actual.utilityBits[index]) this.utilityBitLead[index]!++;
      if (candidates.some((candidate) => candidate.utilityBits[index] === actual.utilityBits[index])) this.utilityBitCompatible[index]!++;
    }
    this.spendErrors.push(lead.spend - actual.spend);
    this.spendBestErrors.push(Math.min(...candidates.map((candidate) => Math.abs(candidate.spend - actual.spend))));
    const matrixKey = `${actual.mode}->${lead.mode}`;
    this.modeMatrix.set(matrixKey, (this.modeMatrix.get(matrixKey) ?? 0) + 1);
    const actualModeCell = this.modeByActual.get(actual.mode) ?? { n: 0, exact: 0, compatible: 0 };
    actualModeCell.n++;
    if (lead.mode === actual.mode) actualModeCell.exact++;
    if (candidates.some((candidate) => candidate.mode === actual.mode)) actualModeCell.compatible++;
    this.modeByActual.set(actual.mode, actualModeCell);
    for (const mode of new Set(candidates.map((candidate) => candidate.mode))) {
      this.offeredModes.set(mode, (this.offeredModes.get(mode) ?? 0) + 1);
    }
    const flags = severeFlags(lead, actual, inventory);
    let any = false;
    for (const [name, value] of Object.entries(flags) as Array<[keyof SevereFlags, boolean]>) {
      if (!value) continue;
      any = true;
      this.severe.set(name, (this.severe.get(name) ?? 0) + 1);
    }
    if (any) this.severe.set("any", (this.severe.get("any") ?? 0) + 1);
    return flags;
  }

  result() {
    const absolute = this.spendErrors.map(Math.abs);
    const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
    return {
      n: this.n,
      agreement: Object.fromEntries(Object.entries(this.fields).map(([name, value]) => [name, {
        exact_n: value.exact, exact_rate: rate(value.exact, this.n), compatible_n: value.compatible, compatible_rate: rate(value.compatible, this.n),
      }])),
      utility_feature_agreement: Object.fromEntries(["smoke", "fire", "flash1", "flash2", "he"].map((name, index) => [name, {
        exact_rate: rate(this.utilityBitLead[index]!, this.n), compatible_rate: rate(this.utilityBitCompatible[index]!, this.n),
      }])),
      spend: {
        lead_mae: round4(sum(absolute) / this.n),
        lead_median_ae: percentile(absolute, 0.5),
        lead_p90_ae: percentile(absolute, 0.9),
        lead_mean_signed: round4(sum(this.spendErrors) / this.n),
        best_set_mae: round4(sum(this.spendBestErrors) / this.n),
        best_set_median_ae: percentile(this.spendBestErrors, 0.5),
      },
      loss_next_money: {
        assumption: "same zero-kill, no-drop LOSS_NO_PLANT branch; difference is the inverse of spend difference",
        lead_mae: round4(sum(absolute) / this.n),
        lead_mean_signed_policy_minus_actual: round4(-sum(this.spendErrors) / this.n),
      },
      mode_matrix: Object.fromEntries([...this.modeMatrix].sort()),
      mode_by_actual: Object.fromEntries([...this.modeByActual].sort().map(([mode, cell]) => [mode, {
        n: cell.n, exact_n: cell.exact, exact_rate: rate(cell.exact, cell.n), compatible_n: cell.compatible, compatible_rate: rate(cell.compatible, cell.n),
      }])),
      offered_mode_coverage: Object.fromEntries([...this.offeredModes].sort().map(([mode, count]) => [mode, { states: count, rate: rate(count, this.n) }])),
      severe: Object.fromEntries([...this.severe].sort().map(([name, count]) => [name, { count, rate: rate(count, this.n) }])),
    };
  }
}

class Subgroups {
  private readonly dimensions = new Map<string, Map<string, { n: number; severe: number; policyMiss: number }>>();

  add(eligible: Eligible, severe: boolean, reason: Reason | null): void {
    const retained = family(eligible.inventory.primary) === "none" ? "empty" : "retained_primary";
    const bands = eligible.money < 2000 ? "0-1999" : eligible.money < 3000 ? "2000-2999" : eligible.money < 4000 ? "3000-3999" : "4000+";
    const values: Record<string, string> = {
      side: eligible.row.side === "t" ? "T" : "CT",
      context: eligible.context,
      side_context: `${eligible.row.side === "t" ? "T" : "CT"}:${eligible.context}`,
      money_band: bands,
      loss_index: String(eligible.row.lossIndex),
      retained_primary: retained,
    };
    for (const [dimension, value] of Object.entries(values)) {
      const cells = this.dimensions.get(dimension) ?? new Map();
      const cell = cells.get(value) ?? { n: 0, severe: 0, policyMiss: 0 };
      cell.n++;
      if (severe) cell.severe++;
      if (reason === "POLICY_MISS") cell.policyMiss++;
      cells.set(value, cell);
      this.dimensions.set(dimension, cells);
    }
  }

  result() {
    return Object.fromEntries([...this.dimensions].map(([dimension, cells]) => [dimension,
      Object.fromEntries([...cells].sort().map(([value, cell]) => [value, {
        n: cell.n, severe_n: cell.severe, severe_rate: rate(cell.severe, cell.n), policy_miss_n: cell.policyMiss, policy_miss_rate: rate(cell.policyMiss, cell.n),
      }]))
    ]));
  }
}

async function extractPrestates(rows: readonly Row[], mapsDir: string): Promise<{ values: Map<string, Prestate>; maps: number; extractionHash: string }> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) grouped.set(row.map, [...(grouped.get(row.map) ?? []), row]);
  const values = new Map<string, Prestate>();
  const hashRows: object[] = [];
  for (const [map, mapRows] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const zipped = await JSZip.loadAsync(readFileSync(resolve(mapsDir, `${map}.zip`)));
    const replayFile = zipped.file("replay.json");
    if (!replayFile) throw new Error(`missing replay.json: ${map}`);
    const replay = JSON.parse(await replayFile.async("string")) as { rounds: ReplayRound[] };
    const roundByNumber = new Map(replay.rounds.map((round) => [round.roundNumber, round]));
    for (const row of mapRows) {
      const previous = roundByNumber.get(row.roundNumber - 1);
      const track = previous?.players.find((player) => player.playerIndex === row.playerIndex);
      if (!track?.flags.length || !track.armor.length || !track.grenades.length) continue;
      const flags = track.flags.at(-1)!;
      const alive = Boolean(flags & 1);
      const value = {
        alive,
        armor: alive ? track.armor.at(-1)! : 0,
        kit: alive ? Boolean(flags & 4) : false,
        grenades: alive ? track.grenades.at(-1)! : [],
      };
      values.set(key(row), value);
      hashRows.push({ map, round: row.roundNumber, player_index: row.playerIndex, ...value });
    }
  }
  return { values, maps: grouped.size, extractionHash: sha256(JSON.stringify(hashRows)) };
}

async function extractTeamEconomies(rows: readonly Row[], mapsDir: string): Promise<Map<string, TeamEconomy>> {
  const maps = [...new Set(rows.map((row) => row.map))].sort();
  const values = new Map<string, TeamEconomy>();
  for (const map of maps) {
    const zipped = await JSZip.loadAsync(readFileSync(resolve(mapsDir, `${map}.zip`)));
    const roundsFile = zipped.file("rounds.json");
    if (!roundsFile) throw new Error(`missing rounds.json: ${map}`);
    const rounds = JSON.parse(await roundsFile.async("string")) as Array<{
      roundNumber: number;
      teamAEconomy: TeamEconomy;
      teamBEconomy: TeamEconomy;
    }>;
    for (const round of rounds) {
      values.set(`${map}:${round.roundNumber}:teamA`, round.teamAEconomy);
      values.set(`${map}:${round.roundNumber}:teamB`, round.teamBEconomy);
    }
  }
  return values;
}

function inventoryFor(row: Row, prestate: Prestate, retainedPrimary: string | null): InventoryState {
  const grenades = prestate.grenades.map((name) => {
    const item = DEMO_GRENADE[name];
    if (!item) throw new Error(`unknown retained grenade: ${name}`);
    return item;
  });
  return {
    primary: itemOf(retainedPrimary),
    secondary: itemOf(row.retainedSecondary) ?? undefined,
    armor: prestate.armor,
    hasHelmet: prestate.alive && row.retainedHelmet,
    hasDefuseKit: prestate.kit,
    grenades,
  };
}

function utilityStateIsCoherent(row: Row, prestate: Prestate, currentMoney: number): { ok: boolean; reason?: string } {
  const retained = new Map<string, number>();
  const resulting = new Map<string, number>();
  for (const item of prestate.grenades) retained.set(item, (retained.get(item) ?? 0) + 1);
  for (const item of normGrenades(row.grenades)) resulting.set(item, (resulting.get(item) ?? 0) + 1);
  if ([...retained].some(([item, count]) => (resulting.get(item) ?? 0) < count)) return { ok: false, reason: "resulting_grenade_below_retained" };
  if (prestate.kit && !row.hasDefuseKit) return { ok: false, reason: "resulting_kit_below_retained" };
  let utilityCost = 0;
  for (const [item, count] of resulting) utilityCost += Math.max(0, count - (retained.get(item) ?? 0)) * (GRENADE_PRICES[item] ?? 0);
  if (row.side === "ct" && row.hasDefuseKit && !prestate.kit) utilityCost += 400;
  const utilityBudget = currentMoney - (row.moneySpent - utilityCost);
  if (utilityBudget < 0 || utilityBudget > 16_000) return { ok: false, reason: "utility_budget_out_of_range" };
  return { ok: true };
}

function increment(counter: Map<string, number>, name: string): void {
  counter.set(name, (counter.get(name) ?? 0) + 1);
}

async function buildEligible(rows: Row[], mapsDir: string) {
  const rowByKey = new Map(rows.map((row) => [key(row), row]));
  const teamLoss = new Map<string, number>();
  const winnerByRound = new Map<string, Side>();
  for (const row of rows) teamLoss.set(`${row.map}:${row.roundNumber}:${row.side}`, row.lossIndex);
  for (const row of rows) {
    const winner: Side = row.winnerSide === "ct" ? "CT" : "T";
    const roundKey = `${row.map}:${row.roundNumber}`;
    const existing = winnerByRound.get(roundKey);
    if (existing !== undefined && existing !== winner) throw new Error(`inconsistent winner label: ${roundKey}`);
    winnerByRound.set(roundKey, winner);
  }
  const exclusions = new Map<string, number>();
  const candidates: Array<{ row: Row; money: number; context: Eligible["context"]; retainedPrimary: string | null; reset?: boolean }> = [];
  let strictRegulation = 0;
  for (const row of rows) {
    const flags = dropFlags(row);
    if (!row.overtime) {
      if (flags.gave) { increment(exclusions, "regulation_drop_gave"); continue; }
      if (flags.received) { increment(exclusions, "regulation_drop_received"); continue; }
      if (row.lossIndexAmbiguous) { increment(exclusions, "regulation_loss_index_ambiguous"); continue; }
      strictRegulation++;
      if (row.roundNumber === 1 || row.roundNumber === 13) { increment(exclusions, "regulation_pistol_round"); continue; }
      const retained = correctedRetainedPrimary(row, rowByKey);
      if (retained === "UNKNOWN") { increment(exclusions, "regulation_retained_primary_unknown"); continue; }
      candidates.push({ row, money: row.startMoney, context: row.roundNumber === 2 || row.roundNumber === 14 ? "POST_PISTOL" : "NORMAL", retainedPrimary: retained });
      continue;
    }
    const reset = (row.roundNumber - 25) % 3 === 0;
    if (!reset && (row.dropGave || row.dropReceived || flags.gave || flags.received)) { increment(exclusions, "overtime_drop_sensitive"); continue; }
    if (!reset && row.lossIndexAmbiguous) { increment(exclusions, "overtime_loss_index_ambiguous"); continue; }
    const retained = correctedRetainedPrimary(row, rowByKey);
    if (retained === "UNKNOWN") { increment(exclusions, "overtime_retained_primary_unknown"); continue; }
    candidates.push({ row, money: reset ? 10_000 : row.startMoney, context: "OVERTIME", retainedPrimary: reset ? null : retained, reset });
  }

  const needsReplay = candidates.filter((candidate) => !candidate.reset).map((candidate) => candidate.row);
  const extraction = await extractPrestates(needsReplay, mapsDir);
  const teamEconomies = await extractTeamEconomies(candidates.map((candidate) => candidate.row), mapsDir);
  const eligible: Eligible[] = [];
  for (const candidate of candidates) {
    const prestate: Prestate | undefined = candidate.reset
      ? { alive: false, armor: 0, kit: false, grenades: [] }
      : extraction.values.get(key(candidate.row));
    if (!prestate) { increment(exclusions, "predecision_replay_state_missing"); continue; }
    const coherent = utilityStateIsCoherent(candidate.row, prestate, candidate.money);
    if (!coherent.ok) { increment(exclusions, coherent.reason ?? "utility_state_ambiguous"); continue; }
    const opponentSide = candidate.row.side === "ct" ? "t" : "ct";
    const opponentLossIndex = teamLoss.get(`${candidate.row.map}:${candidate.row.roundNumber}:${opponentSide}`);
    if (opponentLossIndex === undefined) { increment(exclusions, "opponent_loss_index_missing"); continue; }
    const teamEconomy = teamEconomies.get(`${candidate.row.map}:${candidate.row.roundNumber}:${candidate.row.teamKey}`);
    if (!teamEconomy) throw new Error(`missing team economy for ${candidate.row.map}:r${candidate.row.roundNumber}:${candidate.row.teamKey}`);
    eligible.push({
      row: candidate.row,
      money: candidate.money,
      inventory: inventoryFor(candidate.row, prestate, candidate.retainedPrimary),
      opponentLossIndex,
      context: candidate.context,
      previousWinner: candidate.context === "POST_PISTOL"
        ? winnerByRound.get(`${candidate.row.map}:${candidate.row.roundNumber - 1}`) ?? "UNKNOWN"
        : "UNKNOWN",
      teamEconomy,
    });
  }
  return {
    eligible,
    audit: {
      raw_player_rows: rows.length,
      regulation_player_rows: rows.filter((row) => !row.overtime).length,
      overtime_player_rows: rows.filter((row) => row.overtime).length,
      strict_regulation_player_rows: strictRegulation,
      eligible_player_rows: eligible.length,
      eligible_regulation: eligible.filter((row) => row.context !== "OVERTIME").length,
      eligible_overtime: eligible.filter((row) => row.context === "OVERTIME").length,
      maps: new Set(eligible.map((row) => row.row.map)).size,
      exclusions: Object.fromEntries([...exclusions].sort()),
      replay_prestate: { requested_rows: needsReplay.length, extracted_rows: extraction.values.size, maps: extraction.maps, extraction_sha256: extraction.extractionHash },
    },
  };
}

function countLabels(labels: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) increment(counts, label);
  return Object.fromEntries([...counts].sort());
}

function moneyBand(money: number): string {
  return money < 2000 ? "0-1999" : money < 3000 ? "2000-2999" : money < 4000 ? "3000-3999" : money < 5000 ? "4000-4999" : "5000+";
}

function pistolOutcome(eligible: Eligible): "WIN" | "LOSS" | "UNKNOWN" {
  if (eligible.previousWinner === "UNKNOWN") return "UNKNOWN";
  return eligible.previousWinner === (eligible.row.side === "t" ? "T" : "CT") ? "WIN" : "LOSS";
}

function strategicActualMode(eligible: Eligible): ActualMode {
  if (eligible.context === "POST_PISTOL" && pistolOutcome(eligible) === "WIN") {
    if (eligible.teamEconomy !== "full") {
      throw new Error(`pistol winner conversion team economy is not full: ${eligible.row.map}:r${eligible.row.roundNumber}:${eligible.row.teamKey}=${eligible.teamEconomy}`);
    }
    return "FULL";
  }
  return actualMode(eligible.row.actionType);
}

function strategicSegment(eligible: Eligible): string {
  return eligible.context === "POST_PISTOL" ? `POST_PISTOL_${pistolOutcome(eligible)}` : eligible.context;
}

function canonicalOptions(output: ReturnType<typeof recommendPolicyV3>): string {
  return JSON.stringify(output.options.map((option) => ({
    mode: option.mode, purchases: option.purchases, bundleSpend: option.bundleSpend, alternatives: option.conditionalAlternatives.map((alternative) => alternative.purchases),
  })));
}

function recordInvariant(
  counters: Map<string, number>, cases: Map<string, CaseRecord[]>, name: string,
  eligible: Eligible, candidate: Candidate, actual: Actual,
): void {
  increment(counters, name);
  const bucket = cases.get(name) ?? [];
  if (bucket.length < 20) {
    bucket.push({
      map: eligible.row.map, round: eligible.row.roundNumber, player_index: eligible.row.playerIndex,
      side: eligible.row.side === "t" ? "T" : "CT", context: eligible.context, money: eligible.money,
      loss_index: eligible.row.lossIndex, retained_primary_family: family(eligible.inventory.primary),
      actual: { mode: actual.mode, primaryFamily: actual.primaryFamily, armorState: actual.armorState, utility: actual.utility, kit: actual.kit, spend: actual.spend },
      lead: { mode: candidate.mode, primaryFamily: candidate.primaryFamily, armorState: candidate.armorState, utility: candidate.utility, kit: candidate.kit, spend: candidate.spend },
      reason: "UNEXPLAINED", severe: severeFlags(candidate, actual, eligible.inventory),
    });
  }
  cases.set(name, bucket);
}

function checkCandidateInvariants(
  candidate: Candidate, eligible: Eligible, actual: Actual,
  counters: Map<string, number>, cases: Map<string, CaseRecord[]>, isLead: boolean,
): void {
  if (candidate.spend > eligible.money) recordInvariant(counters, cases, "over_budget", eligible, candidate, actual);
  const side: Side = eligible.row.side === "t" ? "T" : "CT";
  if (candidate.purchases.some((purchase) => !isItemLegalForSide(purchase.item, side))) recordInvariant(counters, cases, "side_illegal", eligible, candidate, actual);
  const loadout = resultingLoadout(eligible.inventory, [...candidate.purchases]);
  if (loadout.grenades.length > 4) recordInvariant(counters, cases, "grenade_slots_over_4", eligible, candidate, actual);
  if (loadout.grenades.filter((item) => item === "flash").length > 2) recordInvariant(counters, cases, "flash_over_2", eligible, candidate, actual);
  const retained = family(eligible.inventory.primary);
  if ((retained === "rifle" || eligible.inventory.primary === "awp") && loadout.primary !== eligible.inventory.primary) {
    recordInvariant(counters, cases, "retained_rifle_or_awp_downgrade", eligible, candidate, actual);
  }
  if (isLead && candidate.mode === "FORCE" && eligible.money - candidate.spend >= 1000) {
    const residual = eligible.money - candidate.spend;
    const useful: ItemId[] = [];
    if (loadout.armor === 0) useful.push("kevlar");
    else if (!loadout.hasHelmet) useful.push("kevlar_helmet");
    if (candidate.primaryFamily === "none" || candidate.primaryFamily === "other") useful.push(smgFor(side));
    if (!loadout.grenades.includes("smoke")) useful.push("smoke");
    if (!loadout.grenades.includes(side === "T" ? "molotov" : "incendiary")) useful.push(side === "T" ? "molotov" : "incendiary");
    if (!loadout.grenades.includes("flash")) useful.push("flash");
    if (!loadout.grenades.includes("he")) useful.push("he");
    const affordableUsefulUpgrade = useful.some((item) => {
      const plan = planPurchases(loadout, [{ item, quantity: 1 }], DEFAULT_RULES, side);
      return plan.isComplete && plan.totalCost > 0 && plan.totalCost <= residual;
    });
    if (affordableUsefulUpgrade) recordInvariant(counters, cases, "force_obvious_strategic_bank", eligible, candidate, actual);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const corpusBuffer = readFileSync(args.corpus);
  const corpusHash = sha256(corpusBuffer);
  if (corpusHash !== EXPECTED_CORPUS_SHA256) throw new Error(`corpus hash mismatch: ${corpusHash}`);
  const rows = JSON.parse(corpusBuffer.toString("utf8")) as Row[];
  if (rows.length !== 43_620) throw new Error(`raw row count changed: ${rows.length}`);
  const { eligible, audit } = await buildEligible(rows, args.maps);

  const v3 = new ModelMetrics();
  const naive = new ModelMetrics();
  const v2 = new ModelMetrics();
  const v3Segments = new Map<Eligible["context"], ModelMetrics>();
  const v3StrategicSegments = new Map<string, ModelMetrics>();
  const normalObservationalSemi = new ModelMetrics();
  const postPistolWinnerObservationalSemi = new ModelMetrics();
  const subgroups = new Subgroups();
  const reasons = new Map<Reason, number>();
  const material = { count: 0, unexplained: 0, policyMiss: 0 };
  const cases = new Map<Reason, CaseRecord[]>();
  const invariants = new Map<string, number>();
  const invariantCases = new Map<string, CaseRecord[]>();
  let invariantCandidates = 0;
  let declaredDefaultStates = 0;
  let opponentFallbackChanges = 0;
  const opponentStatuses = new Map<string, number>();
  let lossProjectionMismatch = 0;
  const lightDiagnostics = {
    side: [] as string[],
    context: [] as string[],
    money_band: [] as string[],
    retained_primary_family: [] as string[],
    retained_armor: [] as string[],
    resulting_primary_family: [] as string[],
    resulting_armor: [] as string[],
    spend_band: [] as string[],
    current_to_resulting_bundle: [] as string[],
  };
  const postPistolDiagnostics = {
    all: [] as string[],
    winner_team_economy: [] as string[],
    winner_observational_semi: [] as string[],
  };
  let conversionWinnerLightOutput = 0;

  for (const entry of eligible) {
    const outcome = entry.context === "POST_PISTOL" ? pistolOutcome(entry) : undefined;
    const actual = actualFrom(entry.row, strategicActualMode(entry));
    if (entry.context === "NORMAL" && entry.row.actionType === "semi") {
      const retainedArmor = armorState(entry.inventory.armor, entry.inventory.hasHelmet);
      const resultingArmor = actual.armorState;
      lightDiagnostics.side.push(entry.row.side === "t" ? "T" : "CT");
      lightDiagnostics.context.push(entry.context);
      lightDiagnostics.money_band.push(moneyBand(entry.money));
      lightDiagnostics.retained_primary_family.push(family(entry.inventory.primary));
      lightDiagnostics.retained_armor.push(retainedArmor);
      lightDiagnostics.resulting_primary_family.push(actual.primaryFamily);
      lightDiagnostics.resulting_armor.push(resultingArmor);
      lightDiagnostics.spend_band.push(actual.spend === 0 ? "0" : actual.spend <= 500 ? "1-500" : actual.spend <= 1000 ? "501-1000" : actual.spend <= 2000 ? "1001-2000" : "2000+");
      lightDiagnostics.current_to_resulting_bundle.push(`${family(entry.inventory.primary)}+${retainedArmor}->${actual.primaryFamily}+${resultingArmor}`);
    }
    if (entry.context === "POST_PISTOL") {
      postPistolDiagnostics.all.push(outcome ?? "UNKNOWN");
      if (outcome === "WIN") {
        postPistolDiagnostics.winner_team_economy.push(entry.teamEconomy);
        if (entry.row.actionType === "semi") postPistolDiagnostics.winner_observational_semi.push(entry.row.actionType);
      }
    }
    const state = stateFor(entry);
    const current = v3Candidates(state);
    if (current.output.status !== "READY" || current.candidates.length === 0) throw new Error(`V3 unavailable for eligible row ${key(entry.row)}`);
    const unknownOpponentState: PolicyV3State = { ...state, opponent: { status: "UNKNOWN", inputsAsOfSeq: 1, reason: "acceptance fallback probe" } };
    if (canonicalOptions(current.output) !== canonicalOptions(recommendPolicyV3(unknownOpponentState))) opponentFallbackChanges++;
    increment(opponentStatuses, state.opponent.status === "INFERRED" ? state.opponent.value! : "UNKNOWN");
    if (current.output.defaultOptionId !== undefined) declaredDefaultStates++;
    if (outcome === "WIN" && current.output.options.some((option) => option.mode === "LIGHT")) conversionWinnerLightOutput++;

    for (const option of current.output.options) {
      const optionCandidate = candidateFrom(option.mode, entry.inventory, option.purchases, option.bundleSpend);
      if (option.mode === "FORCE" && option.resultingInventory.armor === 0) {
        recordInvariant(invariants, invariantCases, "force_armor_zero", entry, optionCandidate, actual);
      }
      if (option.spendingGuidance.kind === "BOUNDED") {
        const protectedCapability = option.spendingGuidance.protectedCapability;
        const boundary = current.output.futureAffordability.status === "PROJECTED"
          ? current.output.futureAffordability.boundaries.find((item) => item.capability === protectedCapability)
          : undefined;
        if (!boundary || !boundary.reachableWithNoSpend || option.bundleSpend > boundary.maxSpendNow) {
          recordInvariant(invariants, invariantCases, "bounded_light_exceeds_envelope", entry, optionCandidate, actual);
        }
      }
    }
    if (entry.context === "NORMAL") {
      const side: Side = entry.row.side === "t" ? "T" : "CT";
      const lossReward = lossBonus(DEFAULT_RULES, entry.row.lossIndex);
      const expectedBoundary = (capability: "RIFLE_ARMOR" | "RIFLE_ARMOR_BASIC_UTILITY") => {
        const targetCash = price(DEFAULT_RULES, rifleFor(side)) + price(DEFAULT_RULES, "kevlar")
          + (capability === "RIFLE_ARMOR_BASIC_UTILITY" ? price(DEFAULT_RULES, "smoke") + price(DEFAULT_RULES, "flash") : 0);
        const requiredReserveNow = Math.max(0, targetCash - lossReward);
        const reachableWithNoSpend = entry.money >= requiredReserveNow;
        return { targetCash, requiredReserveNow, reachableWithNoSpend, maxSpendNow: reachableWithNoSpend ? entry.money - requiredReserveNow : 0 };
      };
      const projected = current.output.futureAffordability;
      const projectionMismatch = projected.status !== "PROJECTED" || (["RIFLE_ARMOR", "RIFLE_ARMOR_BASIC_UTILITY"] as const).some((capability) => {
        const actualBoundary = projected.status === "PROJECTED" ? projected.boundaries.find((item) => item.capability === capability) : undefined;
        const expectedBoundaryValues = expectedBoundary(capability);
        return !actualBoundary
          || actualBoundary.scenario !== "LOSS_NO_PLANT"
          || actualBoundary.targetCash !== expectedBoundaryValues.targetCash
          || actualBoundary.requiredReserveNow !== expectedBoundaryValues.requiredReserveNow
          || actualBoundary.reachableWithNoSpend !== expectedBoundaryValues.reachableWithNoSpend
          || actualBoundary.maxSpendNow !== expectedBoundaryValues.maxSpendNow;
      });
      if (projectionMismatch) recordInvariant(invariants, invariantCases, "future_affordability_projection_mismatch", entry, current.candidates[0]!, actual);
    }

    for (const [candidateIndex, candidate] of current.candidates.entries()) {
      invariantCandidates++;
      checkCandidateInvariants(candidate, entry, actual, invariants, invariantCases, candidateIndex === 0);
    }

    const v3Flags = v3.add(current.candidates, actual, entry.inventory);
    const segment = v3Segments.get(entry.context) ?? new ModelMetrics();
    segment.add(current.candidates, actual, entry.inventory);
    v3Segments.set(entry.context, segment);
    const strategic = strategicSegment(entry);
    const strategicMetrics = v3StrategicSegments.get(strategic) ?? new ModelMetrics();
    strategicMetrics.add(current.candidates, actual, entry.inventory);
    v3StrategicSegments.set(strategic, strategicMetrics);
    if (entry.context === "NORMAL" && entry.row.actionType === "semi") normalObservationalSemi.add(current.candidates, actual, entry.inventory);
    if (outcome === "WIN" && entry.row.actionType === "semi") postPistolWinnerObservationalSemi.add(current.candidates, actual, entry.inventory);
    naive.add(naiveCandidates(entry), actual, entry.inventory);
    v2.add(v2Candidates(entry), actual, entry.inventory);
    const reason = discrepancyReason(current.candidates, actual, v3Flags);
    if (reason) {
      material.count++;
      increment(reasons, reason);
      if (reason === "UNEXPLAINED") material.unexplained++;
      if (reason === "POLICY_MISS") material.policyMiss++;
      const bucket = cases.get(reason) ?? [];
      if (bucket.length < 20) {
        bucket.push({
          map: entry.row.map,
          round: entry.row.roundNumber,
          player_index: entry.row.playerIndex,
          side: entry.row.side === "t" ? "T" : "CT",
          context: entry.context,
          money: entry.money,
          loss_index: entry.row.lossIndex,
          retained_primary_family: family(entry.inventory.primary),
          actual: { mode: actual.mode, primaryFamily: actual.primaryFamily, armorState: actual.armorState, utility: actual.utility, kit: actual.kit, spend: actual.spend },
          lead: { mode: current.candidates[0]!.mode, primaryFamily: current.candidates[0]!.primaryFamily, armorState: current.candidates[0]!.armorState, utility: current.candidates[0]!.utility, kit: current.candidates[0]!.kit, spend: current.candidates[0]!.spend },
          reason,
          severe: v3Flags,
        });
      }
      cases.set(reason, bucket);
    }
    subgroups.add(entry, isSevere(v3Flags), reason);

    const lossScenario = current.output.options[0]!.trajectory.find((scenario) => scenario.id === "LOSS_NO_PLANT");
    const expected = Math.min(16_000, entry.money - current.candidates[0]!.spend + lossBonus(DEFAULT_RULES, entry.row.lossIndex));
    if (!lossScenario || lossScenario.nextMoney.min !== expected || lossScenario.nextMoney.max !== expected) lossProjectionMismatch++;
  }

  const probe = eligible.find((entry) => entry.context === "NORMAL");
  if (!probe) throw new Error("no normal-round probe state");
  const probeState = stateFor(probe);
  const pistol = recommendPolicyV3({ ...probeState, round: { ...probeState.round, context: fact("PISTOL", "probe") } });
  const unknownMoney = recommendPolicyV3({ ...probeState, player: { ...probeState.player, money: { status: "UNKNOWN", source: "probe", asOfSeq: 1, reason: "missing" } } });
  const overtime = recommendPolicyV3({ ...probeState, round: { ...probeState.round, context: fact("OVERTIME", "probe") } });
  const targeted = {
    pistol_explicitly_unsupported: pistol.status === "UNSUPPORTED_POLICY_EVIDENCE" && pistol.options.length === 0,
    required_unknown_is_not_defaulted: unknownMoney.status === "INSUFFICIENT_STATE" && unknownMoney.options.length === 0,
    overtime_has_no_normal_future_affordability: overtime.futureAffordability.status === "NOT_APPLICABLE" && overtime.futureAffordability.reason === "OVERTIME_UNSUPPORTED",
    c4_remaining_uncalibrated_unknown: unknownTiming(1_000_000n, 2_000_000n).status === "UNKNOWN",
    opponent_unknown_changes_base_recommendation_set: opponentFallbackChanges,
    loss_projection_mismatch: lossProjectionMismatch,
    post_pistol_conversion_winner_light_output: conversionWinnerLightOutput,
  };
  const invariantNames = [
    "over_budget", "side_illegal", "grenade_slots_over_4", "flash_over_2",
    "retained_rifle_or_awp_downgrade", "force_obvious_strategic_bank", "force_armor_zero",
    "bounded_light_exceeds_envelope", "future_affordability_projection_mismatch",
  ];
  const invariantResults = Object.fromEntries(invariantNames.map((name) => [name, invariants.get(name) ?? 0]));
  const blockers: Array<{ id: string; evidence: string }> = [];
  const forceBankViolations = invariants.get("force_obvious_strategic_bank") ?? 0;
  if (forceBankViolations > 0) blockers.push({
    id: "CT_FORCE_STRATEGIC_BANK",
    evidence: `${forceBankViolations} lead FORCE states leave at least $1000 while an own-state CT helmet upgrade remains affordable`,
  });
  for (const [id, evidence] of [
    ["FORCE_ARMOR_INVARIANT", `${invariants.get("force_armor_zero") ?? 0} generic FORCE options have resulting armor zero`],
    ["LIGHT_ENVELOPE", `${invariants.get("bounded_light_exceeds_envelope") ?? 0} bounded LIGHT options exceed or misreference their protected boundary`],
    ["FUTURE_AFFORDABILITY_PROJECTION", `${invariants.get("future_affordability_projection_mismatch") ?? 0} NORMAL states disagree with canonical LOSS_NO_PLANT boundaries`],
  ] as const) {
    if (evidence.startsWith("0 ")) continue;
    blockers.push({ id, evidence });
  }
  const actualLight = v3.modeByActual.get("LIGHT")?.n ?? 0;
  const offeredLight = v3.offeredModes.get("LIGHT") ?? 0;
  if (actualLight > 0 && offeredLight === 0) blockers.push({
    id: "LIGHT_MODE_UNREACHABLE",
    evidence: `${actualLight} actual LIGHT rows have zero exact and compatible coverage because LIGHT is never offered`,
  });
  const postPistol = v3Segments.get("POST_PISTOL");
  const postPistolFull = postPistol?.modeByActual.get("FULL");
  if ((postPistolFull?.n ?? 0) > 0 && (postPistolFull?.compatible ?? 0) === 0) blockers.push({
    id: "POST_PISTOL_FULL_UNREACHABLE",
    evidence: `${postPistolFull!.n} actual POST_PISTOL FULL rows have zero compatible coverage`,
  });
  if (conversionWinnerLightOutput > 0) blockers.push({
    id: "POST_PISTOL_CONVERSION_LIGHT",
    evidence: `${conversionWinnerLightOutput} pistol-winner conversion states still offer strategic LIGHT`,
  });

  const reasonResult = Object.fromEntries([...reasons].sort().map(([name, count]) => [name, { count, rate_of_material: rate(count, material.count), rate_of_eligible: rate(count, eligible.length) }]));
  for (const reason of ["COVERED_ALTERNATIVE", "UNAVAILABLE_CONTEXT", "ROBUST_GENERAL_DEFAULT", "DATA_AMBIGUITY", "POLICY_MISS", "UNEXPLAINED"] as const) {
    if (!(reason in reasonResult)) reasonResult[reason] = { count: 0, rate_of_material: 0, rate_of_eligible: 0 };
  }

  const resultWithoutHash = {
    schema_version: 3,
    baseline_policy_sha: BASELINE_POLICY_SHA,
    decision_scope: "behavioral conformance on the frozen Cologne corpus; professional behavior is not optimal-policy ground truth",
    inputs: {
      corpus_sha256: corpusHash,
      expected_corpus_sha256: EXPECTED_CORPUS_SHA256,
      corpus_contract: "IEM Cologne Major 2026 event packages; cs2-demo-format/3.0; cs2df 3.1.0; demoparser2 0.41.3",
      runtime_policy_import: "packages/economy-advisor/src/policy-v3.ts",
      production_visible_policy_fields: ["own side", "own money", "own inventory", "own loss index", "round number/context", "score", "opponent loss index"],
      tracked_history_facts_used: ["previous round winner only for POST_PISTOL; reconstructed from the immediately preceding audit round to model continuous normal-player GSI"],
      demo_label_only_fields: ["resulting spend/loadout", "replay end armor/kit/grenades", "individual player-economies action type", "rounds team economy for POST_PISTOL conversion label only"],
      forbidden_policy_fields_not_supplied: ["opponent exact money/weapons/survivors", "teammate hidden purchases", "identity/role", "map position/spawn", "future result/kills"],
    },
    eligibility: audit,
    comparison_contract: {
      mode_mapping: { eco: "PRESERVE", semi: "LIGHT", force: "FORCE", full: "FULL", post_pistol_winner: "FULL conversion override" },
      strategic_mode_label: "POST_PISTOL pistol winners use rounds.json team*Economy=full; all individual purchase fields remain player-economies labels",
      exact: "first Policy V3 option (dominant when a dominant option exists)",
      declared_default_states: declaredDefaultStates,
      declared_default_rate: rate(declaredDefaultStates, eligible.length),
      compatible: "any V3 option or its declared conditional alternative",
      actual_bundle: "resulting freeze-end bundle; click chronology is not used",
      actual_spend: "strict individual player moneySpent; drop-sensitive regulation rows excluded",
    },
    mechanical_invariants: {
      checked_recommendation_candidates: invariantCandidates,
      violations: invariantResults,
      representative_violation_cases: Object.fromEntries([...invariantCases].sort()),
      targeted,
    },
    behavioral_alignment: {
      policy_v3: v3.result(),
      policy_v3_by_context: Object.fromEntries([...v3Segments].sort().map(([context, metrics]) => [context, metrics.result()])),
      policy_v3_by_strategic_segment: Object.fromEntries([...v3StrategicSegments].sort().map(([segment, metrics]) => [segment, metrics.result()])),
      normal_observational_semi: normalObservationalSemi.result(),
      post_pistol_winner_observational_semi: postPistolWinnerObservationalSemi.result(),
      naive_affordability: naive.result(),
      v2_fixed_tier_rifle_armor: v2.result(),
    },
    discrepancy_attribution: {
      material_definition: "lead option differs in mode, primary, armor state, utility multiset, kit, or absolute spend by at least $1000",
      classification_precedence: ["COVERED_ALTERNATIVE", "DATA_AMBIGUITY", "UNAVAILABLE_CONTEXT", "ROBUST_GENERAL_DEFAULT", "POLICY_MISS", "UNEXPLAINED"],
      material_count: material.count,
      reasons: reasonResult,
      representative_cases: Object.fromEntries([...cases].sort()),
    },
    severe_subgroups: subgroups.result(),
    frozen_follow_up_diagnostics: {
      actual_light_own_state: {
        n: lightDiagnostics.side.length,
        side: countLabels(lightDiagnostics.side),
        context: countLabels(lightDiagnostics.context),
        money_band: countLabels(lightDiagnostics.money_band),
        retained_primary_family: countLabels(lightDiagnostics.retained_primary_family),
        retained_armor: countLabels(lightDiagnostics.retained_armor),
        resulting_primary_family: countLabels(lightDiagnostics.resulting_primary_family),
        resulting_armor: countLabels(lightDiagnostics.resulting_armor),
        spend_band: countLabels(lightDiagnostics.spend_band),
        current_to_resulting_bundle: countLabels(lightDiagnostics.current_to_resulting_bundle),
      },
      post_pistol_previous_winner: {
        all_post_pistol: countLabels(postPistolDiagnostics.all),
        winner_team_economy: countLabels(postPistolDiagnostics.winner_team_economy),
        winner_observational_semi: countLabels(postPistolDiagnostics.winner_observational_semi),
      },
    },
    opponent_deployment: {
      runtime_input_semantics: "direct normal-player GSI only; frozen direct-only artifact",
      runtime_class_distribution_on_eligible_states: Object.fromEntries([...opponentStatuses].sort()),
      unknown_recommendation_set_changes: opponentFallbackChanges,
      evidence_source: "frozen 5-fold match-series-held-out OOF artifact; final-fit training accuracy intentionally not reported",
      frozen_oof_direct_gsi: { auc: 0.9042, brier: 0.0967, coverage: 0.6590, selective_accuracy: 0.9566 },
    },
    acceptance_counts: { policy_miss: material.policyMiss, unexplained: material.unexplained },
    final_acceptance: {
      status: blockers.length === 0 ? "READY_FOR_FINAL_SOL_RE_AUDIT" : "FOLLOW_UP_BLOCKERS_REMAIN",
      blockers,
      reopen_economy_research_required: false,
    },
  };
  const artifactHash = sha256(JSON.stringify(resultWithoutHash));
  const result = { ...resultWithoutHash, artifact_sha256: artifactHash };
  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`wrote ${args.output}`);
  console.log(`eligible=${eligible.length} artifact_sha256=${artifactHash}`);
}

await main();
