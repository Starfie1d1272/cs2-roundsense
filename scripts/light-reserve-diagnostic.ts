/**
 * Narrow offline diagnostic for the LIGHT reserve-target hypothesis.
 *
 * This script reuses the frozen Policy V3 corpus, strict eligibility, and
 * replay pre-state contract. Demo fields remain offline observations: no
 * output from this script is loaded by production policy.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import JSZip from "jszip";
import {
  DEFAULT_RULES,
  lossBonus,
  price,
  recommendPolicyV3,
  rifleFor,
  weaponClassOf,
  type InventoryState,
  type PolicyV3State,
} from "../packages/economy-advisor/src/index.js";
import type { ItemId, RoundType, Side } from "../packages/shared-types/src/index.js";

const EXPECTED_CORPUS_SHA256 = "33f29c35fb124a4e45d38a00be8f389d32403c0762576b607db7a9a37fe0d9e6";
const BASELINE_SHA = "584ec5ce91c6d1bf8d138783a42d137fe7276a47";
const DEFAULT_CORPUS = "/tmp/roundsense-cologne-policy/player-rounds.json";
const DEFAULT_MAPS = "/tmp/roundsense-cologne-policy/maps";
const DEFAULT_OUTPUT = "experiments/policy-v3/results/light-reserve-diagnostic.json";
const EXPECTED_RAW_ROWS = 43_620;
const EXPECTED_ELIGIBLE_ROWS = 23_552;
const EXPECTED_LIGHT_ROWS = 2_330;

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
  // Frozen replay-coherence contract from policy-v3-final-acceptance.ts.
  // Purchase-capability interpretation below reads current canonical prices.
  smoke: 300, flashbang: 200, hegrenade: 300, molotov: 400, incendiary: 600, decoy: 50,
};

type ActualMode = "FULL" | "FORCE" | "LIGHT" | "PRESERVE";
type Context = "POST_PISTOL" | "NORMAL" | "OVERTIME";
type PrimaryFamily = "rifle" | "sniper" | "smg" | "heavy" | "none" | "other";
type ArmorState = "none" | "kevlar" | "vesthelm";

interface Row {
  map: string;
  roundNumber: number;
  playerIndex: number;
  side: "ct" | "t";
  scoreCT: number;
  scoreT: number;
  overtime: boolean;
  winnerSide: "ct" | "t";
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
  retainedHelmet: boolean;
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
  context: Context;
  previousWinner: Side | "UNKNOWN";
}

interface DiagnosticRow {
  map: string;
  round: number;
  player_index: number;
  side: Side;
  context: Context;
  current_money: number;
  actual_spend: number;
  residual_cash: number;
  loss_index: number;
  loss_reward: number;
  next_cash_loss_no_plant: number;
  next_cash_loss_with_plant: number | null;
  retained_primary: boolean;
  retained_primary_family: PrimaryFamily;
  retained_armor: boolean;
  retained_armor_state: ArmorState;
  resulting_primary_family: PrimaryFamily;
  resulting_armor: boolean;
  resulting_armor_state: ArmorState;
  resulting_secondary_class: "default" | "paid" | "none" | "other";
}

function parseArgs(): { corpus: string; maps: string; output: string } {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("usage: tsx scripts/light-reserve-diagnostic.ts [--corpus PATH] [--maps-dir PATH] [--output PATH]");
    }
    values.set(key, value);
  }
  return {
    corpus: resolve(values.get("--corpus") ?? DEFAULT_CORPUS),
    maps: resolve(values.get("--maps-dir") ?? DEFAULT_MAPS),
    output: resolve(values.get("--output") ?? DEFAULT_OUTPUT),
  };
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function key(row: Pick<Row, "map" | "roundNumber" | "playerIndex">): string {
  return `${row.map}:${row.roundNumber}:${row.playerIndex}`;
}

function increment(counter: Map<string, number>, name: string): void {
  counter.set(name, (counter.get(name) ?? 0) + 1);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function rate(count: number, n: number): number {
  return n === 0 ? 0 : round4(count / n);
}

function normGrenades(value: string | string[]): string[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error("invalid grenade multiset");
  return parsed;
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

function primaryFamily(name: string | ItemId | null | undefined): PrimaryFamily {
  if (!name) return "none";
  const item = name in DEMO_TO_ITEM ? DEMO_TO_ITEM[name]! : name as ItemId;
  const family = weaponClassOf(item);
  if (family === "rifle") return "rifle";
  if (family === "sniper" || family === "awp") return "sniper";
  if (family === "smg") return "smg";
  if (family === "shotgun" || family === "mg") return "heavy";
  return "other";
}

function armorState(armor: number | boolean, helmet: boolean): ArmorState {
  const present = typeof armor === "number" ? armor > 0 : armor;
  return !present ? "none" : helmet ? "vesthelm" : "kevlar";
}

function secondaryClass(name: string | null): DiagnosticRow["resulting_secondary_class"] {
  if (name === null) return "none";
  if (["Glock-18", "USP-S", "P2000"].includes(name)) return "default";
  if (["P250", "Dual Berettas", "Tec-9", "CZ75-Auto", "Five-SeveN", "Desert Eagle", "R8 Revolver"].includes(name)) return "paid";
  return "other";
}

function actualMode(type: RoundType): ActualMode {
  if (type === "full") return "FULL";
  if (type === "force") return "FORCE";
  if (type === "semi") return "LIGHT";
  return "PRESERVE";
}

function fact<T>(value: T, source: string) {
  return { status: "OBSERVED" as const, value, source, asOfSeq: 1 };
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
  return { values, maps: grouped.size, extractionHash: stableHash(hashRows) };
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

async function buildEligible(rows: Row[], mapsDir: string) {
  const rowByKey = new Map(rows.map((row) => [key(row), row]));
  const teamLoss = new Map<string, number>();
  const winnerByRound = new Map<string, Side>();
  for (const row of rows) teamLoss.set(`${row.map}:${row.roundNumber}:${row.side}`, row.lossIndex);
  for (const row of rows) winnerByRound.set(`${row.map}:${row.roundNumber}`, row.winnerSide === "ct" ? "CT" : "T");
  const exclusions = new Map<string, number>();
  const exclusionByKey = new Map<string, string>();
  const exclude = (row: Row, reason: string) => {
    increment(exclusions, reason);
    exclusionByKey.set(key(row), reason);
  };
  const candidates: Array<{ row: Row; money: number; context: Context; retainedPrimary: string | null; reset?: boolean }> = [];
  let strictRegulation = 0;
  for (const row of rows) {
    const flags = dropFlags(row);
    if (!row.overtime) {
      if (flags.gave) { exclude(row, "regulation_drop_gave"); continue; }
      if (flags.received) { exclude(row, "regulation_drop_received"); continue; }
      if (row.lossIndexAmbiguous) { exclude(row, "regulation_loss_index_ambiguous"); continue; }
      strictRegulation++;
      if (row.roundNumber === 1 || row.roundNumber === 13) { exclude(row, "regulation_pistol_round"); continue; }
      const retained = correctedRetainedPrimary(row, rowByKey);
      if (retained === "UNKNOWN") { exclude(row, "regulation_retained_primary_unknown"); continue; }
      candidates.push({ row, money: row.startMoney, context: row.roundNumber === 2 || row.roundNumber === 14 ? "POST_PISTOL" : "NORMAL", retainedPrimary: retained });
      continue;
    }
    const reset = (row.roundNumber - 25) % 3 === 0;
    if (!reset && (row.dropGave || row.dropReceived || flags.gave || flags.received)) { exclude(row, "overtime_drop_sensitive"); continue; }
    if (!reset && row.lossIndexAmbiguous) { exclude(row, "overtime_loss_index_ambiguous"); continue; }
    const retained = correctedRetainedPrimary(row, rowByKey);
    if (retained === "UNKNOWN") { exclude(row, "overtime_retained_primary_unknown"); continue; }
    candidates.push({ row, money: reset ? 10_000 : row.startMoney, context: "OVERTIME", retainedPrimary: reset ? null : retained, reset });
  }
  const needsReplay = candidates.filter((candidate) => !candidate.reset).map((candidate) => candidate.row);
  const extraction = await extractPrestates(needsReplay, mapsDir);
  const eligible: Eligible[] = [];
  for (const candidate of candidates) {
    const prestate = candidate.reset
      ? { alive: false, armor: 0, kit: false, grenades: [] }
      : extraction.values.get(key(candidate.row));
    if (!prestate) { exclude(candidate.row, "predecision_replay_state_missing"); continue; }
    const coherent = utilityStateIsCoherent(candidate.row, prestate, candidate.money);
    if (!coherent.ok) { exclude(candidate.row, coherent.reason ?? "utility_state_ambiguous"); continue; }
    const opponentSide = candidate.row.side === "ct" ? "t" : "ct";
    const opponentLossIndex = teamLoss.get(`${candidate.row.map}:${candidate.row.roundNumber}:${opponentSide}`);
    if (opponentLossIndex === undefined) { exclude(candidate.row, "opponent_loss_index_missing"); continue; }
    eligible.push({
      row: candidate.row,
      money: candidate.money,
      inventory: inventoryFor(candidate.row, prestate, candidate.retainedPrimary),
      opponentLossIndex,
      context: candidate.context,
      previousWinner: candidate.context === "POST_PISTOL"
        ? winnerByRound.get(`${candidate.row.map}:${candidate.row.roundNumber - 1}`) ?? "UNKNOWN"
        : "UNKNOWN",
    });
  }
  return {
    eligible,
    exclusionByKey,
    audit: {
      raw_player_rows: rows.length,
      regulation_player_rows: rows.filter((row) => !row.overtime).length,
      overtime_player_rows: rows.filter((row) => row.overtime).length,
      strict_regulation_player_rows: strictRegulation,
      eligible_player_rows: eligible.length,
      eligible_regulation: eligible.filter((entry) => entry.context !== "OVERTIME").length,
      eligible_overtime: eligible.filter((entry) => entry.context === "OVERTIME").length,
      maps: new Set(eligible.map((entry) => entry.row.map)).size,
      exclusions: Object.fromEntries([...exclusions].sort()),
      replay_prestate: {
        requested_rows: needsReplay.length,
        extracted_rows: extraction.values.size,
        maps: extraction.maps,
        extraction_sha256: extraction.extractionHash,
      },
    },
  };
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

function shortestInterval(values: readonly number[], fraction: number): { low: number; high: number; width: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const count = Math.max(1, Math.ceil(sorted.length * fraction));
  let best = { low: sorted[0]!, high: sorted[count - 1]!, width: sorted[count - 1]! - sorted[0]! };
  for (let start = 1; start + count <= sorted.length; start++) {
    const low = sorted[start]!;
    const high = sorted[start + count - 1]!;
    if (high - low < best.width) best = { low, high, width: high - low };
  }
  return best;
}

function countDistribution(values: readonly string[]): Record<string, { n: number; rate: number }> {
  const counts = new Map<string, number>();
  for (const value of values) increment(counts, value);
  return Object.fromEntries([...counts].sort().map(([value, n]) => [value, { n, rate: rate(n, values.length) }]));
}

function moneyDistribution(values: readonly number[]) {
  const p25 = percentile(values, 0.25);
  const med = percentile(values, 0.5);
  const p75 = percentile(values, 0.75);
  const exact = new Map<string, number>();
  const bands = new Map<string, number>();
  for (const value of values) {
    increment(exact, String(value));
    const low = Math.floor(value / 500) * 500;
    increment(bands, `${low}-${low + 499}`);
  }
  const deviations = med === null ? [] : values.map((value) => Math.abs(value - med));
  const topExact = [...exact].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0])).slice(0, 12);
  const bandRows = [...bands].map(([band, n]) => ({ band, low: Number(band.split("-")[0]), n }));
  bandRows.sort((a, b) => b.n - a.n || a.low - b.low);
  return {
    n: values.length,
    min: values.length ? Math.min(...values) : null,
    p25,
    median: med,
    p75,
    max: values.length ? Math.max(...values) : null,
    iqr: p25 === null || p75 === null ? null : p75 - p25,
    median_absolute_deviation: percentile(deviations, 0.5),
    shortest_50pct_interval: shortestInterval(values, 0.5),
    shortest_75pct_interval: shortestInterval(values, 0.75),
    top_exact_amounts: Object.fromEntries(topExact.map(([amount, n]) => [amount, { n, rate: rate(n, values.length) }])),
    common_500_bands: Object.fromEntries(bandRows.slice(0, 10).map(({ band, n }) => [band, { n, rate: rate(n, values.length) }])),
  };
}

function compactMoneyDistribution(values: readonly number[]) {
  const distribution = moneyDistribution(values);
  return {
    n: distribution.n,
    min: distribution.min,
    p25: distribution.p25,
    median: distribution.median,
    p75: distribution.p75,
    max: distribution.max,
    iqr: distribution.iqr,
    median_absolute_deviation: distribution.median_absolute_deviation,
    shortest_50pct_interval: distribution.shortest_50pct_interval,
    shortest_75pct_interval: distribution.shortest_75pct_interval,
  };
}

function summarize(rows: readonly DiagnosticRow[]) {
  return {
    n: rows.length,
    current_money: moneyDistribution(rows.map((row) => row.current_money)),
    actual_spend: moneyDistribution(rows.map((row) => row.actual_spend)),
    residual_cash: moneyDistribution(rows.map((row) => row.residual_cash)),
    next_cash_loss_no_plant: moneyDistribution(rows.map((row) => row.next_cash_loss_no_plant)),
  };
}

function compactSummary(rows: readonly DiagnosticRow[]) {
  return {
    n: rows.length,
    current_money: compactMoneyDistribution(rows.map((row) => row.current_money)),
    actual_spend: compactMoneyDistribution(rows.map((row) => row.actual_spend)),
    residual_cash: compactMoneyDistribution(rows.map((row) => row.residual_cash)),
    next_cash_loss_no_plant: compactMoneyDistribution(rows.map((row) => row.next_cash_loss_no_plant)),
  };
}

function subgroup(rows: readonly DiagnosticRow[], keyOf: (row: DiagnosticRow) => string) {
  const groups = new Map<string, DiagnosticRow[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return Object.fromEntries([...groups].sort().map(([name, group]) => [name, compactSummary(group)]));
}

function dispersionComparison(rows: readonly DiagnosticRow[]) {
  const residual = compactMoneyDistribution(rows.map((row) => row.residual_cash));
  const next = compactMoneyDistribution(rows.map((row) => row.next_cash_loss_no_plant));
  const reduction = (before: number | null, after: number | null) => before === null || after === null || before === 0 ? null : round4((before - after) / before);
  return {
    n: rows.length,
    residual_cash: residual,
    next_cash_loss_no_plant: next,
    relative_iqr_reduction: reduction(residual.iqr, next.iqr),
    relative_mad_reduction: reduction(residual.median_absolute_deviation, next.median_absolute_deviation),
    relative_shortest_50pct_width_reduction: reduction(residual.shortest_50pct_interval?.width ?? null, next.shortest_50pct_interval?.width ?? null),
  };
}

function ranks(values: readonly number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const result = new Array<number>(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end]!.value === sorted[start]!.value) end++;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index++) result[sorted[index]!.index] = averageRank;
    start = end;
  }
  return result;
}

function pearson(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index++) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta * leftDelta;
    rightSquares += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator === 0 ? null : round4(numerator / denominator);
}

function rewardAssociation(rows: readonly DiagnosticRow[]) {
  const rewardRanks = ranks(rows.map((row) => row.loss_reward));
  return {
    n: rows.length,
    spearman_loss_reward_vs_residual_cash: pearson(rewardRanks, ranks(rows.map((row) => row.residual_cash))),
    spearman_loss_reward_vs_next_cash: pearson(rewardRanks, ranks(rows.map((row) => row.next_cash_loss_no_plant))),
    hypothesis_pattern: "reserve-target compensation predicts a negative reward-vs-residual association and a weaker reward-vs-next-cash association",
  };
}

function diagnosticRow(entry: Eligible): DiagnosticRow {
  const side: Side = entry.row.side === "t" ? "T" : "CT";
  const residual = entry.money - entry.row.moneySpent;
  const reward = lossBonus(DEFAULT_RULES, entry.row.lossIndex);
  const retainedArmorState = armorState(entry.inventory.armor, entry.inventory.hasHelmet);
  const resultingArmorState = armorState(entry.row.hasArmor, entry.row.hasHelmet);
  return {
    map: entry.row.map,
    round: entry.row.roundNumber,
    player_index: entry.row.playerIndex,
    side,
    context: entry.context,
    current_money: entry.money,
    actual_spend: entry.row.moneySpent,
    residual_cash: residual,
    loss_index: entry.row.lossIndex,
    loss_reward: reward,
    next_cash_loss_no_plant: residual + reward,
    next_cash_loss_with_plant: side === "T" ? residual + reward + DEFAULT_RULES.roundRewards.plantBonusT : null,
    retained_primary: primaryFamily(entry.inventory.primary) !== "none",
    retained_primary_family: primaryFamily(entry.inventory.primary),
    retained_armor: retainedArmorState !== "none",
    retained_armor_state: retainedArmorState,
    resulting_primary_family: primaryFamily(entry.row.primary),
    resulting_armor: resultingArmorState !== "none",
    resulting_armor_state: resultingArmorState,
    resulting_secondary_class: secondaryClass(entry.row.secondary),
  };
}

function subtype(row: DiagnosticRow): string {
  if (row.retained_primary) return "retained_primary_top_up";
  if (row.resulting_primary_family === "none") return "no_primary_pistol_utility_or_armor";
  if (row.resulting_primary_family === "smg" && row.resulting_armor) return "new_smg_plus_armor";
  return "other_new_primary_bundle";
}

function stateFor(entry: Eligible): PolicyV3State {
  const side: Side = entry.row.side === "t" ? "T" : "CT";
  const opponentSide: Side = side === "T" ? "CT" : "T";
  const ownLoss = fact(entry.row.lossIndex, "own loss index");
  const opponentLoss = fact(entry.opponentLossIndex, "opponent loss index");
  return {
    round: {
      number: fact(entry.row.roundNumber, "round number"),
      phase: fact("freezetime", "round phase"),
      side: fact(side, "own side"),
      score: fact({ ct: entry.row.scoreCT, t: entry.row.scoreT }, "score"),
      context: fact(entry.context, "round context"),
    },
    player: { money: fact(entry.money, "own money"), lossIndex: ownLoss, inventory: fact(entry.inventory, "own inventory") },
    teamLoss: side === "CT" ? { ct: ownLoss, t: opponentLoss } : { ct: opponentLoss, t: ownLoss },
    history: entry.context === "POST_PISTOL"
      ? {
          integrity: "COMPLETE",
          previousRounds: [{
            roundNumber: entry.row.roundNumber - 1,
            winner: entry.previousWinner === "UNKNOWN"
              ? { status: "UNKNOWN", source: "previous winner", asOfSeq: 1, reason: "unavailable" }
              : fact(entry.previousWinner, "previous winner"),
            planted: { status: "UNKNOWN", source: "unused", asOfSeq: 1, reason: "not used" },
          }],
        }
      : { integrity: "COMPLETE", previousRounds: [] },
    opponent: { status: "UNKNOWN", inputsAsOfSeq: 1, reason: "base recommendation is opponent-independent" },
    preference: { source: "DEFAULT", awpPriority: "NEUTRAL" },
  };
}

function syntheticState(side: Side, money: number): PolicyV3State {
  const ownLoss = fact(2, "probe own loss index");
  const opponentLoss = fact(2, "probe opponent loss index");
  return {
    round: {
      number: fact(5, "probe round"), phase: fact("freezetime", "probe phase"), side: fact(side, "probe side"),
      score: fact({ ct: 2, t: 2 }, "probe score"), context: fact("NORMAL", "probe context"),
    },
    player: {
      money: fact(money, "probe money"), lossIndex: ownLoss,
      inventory: fact({ primary: null, armor: 0, hasHelmet: false, hasDefuseKit: false, grenades: [] }, "probe empty inventory"),
    },
    teamLoss: side === "CT" ? { ct: ownLoss, t: opponentLoss } : { ct: opponentLoss, t: ownLoss },
    history: { integrity: "COMPLETE", previousRounds: [] },
    opponent: { status: "UNKNOWN", inputsAsOfSeq: 1, reason: "probe" },
    preference: { source: "DEFAULT", awpPriority: "NEUTRAL" },
  };
}

function forceArmorAudit(eligible: readonly Eligible[]) {
  const candidates: Array<Record<string, unknown>> = [];
  let forceOfferedStates = 0;
  let forceNoArmorStates = 0;
  let forceNoArmorExplicitAwpStates = 0;
  let forceNoArmorNonAwpStates = 0;
  for (const entry of eligible) {
    const output = recommendPolicyV3(stateFor(entry));
    const force = output.options.find((option) => option.mode === "FORCE");
    if (!force) continue;
    forceOfferedStates++;
    if (force.resultingInventory.armor > 0) continue;
    forceNoArmorStates++;
    if (force.resultingInventory.primary === "awp") {
      forceNoArmorExplicitAwpStates++;
      continue;
    }
    forceNoArmorNonAwpStates++;
    if (candidates.length < 20) {
      candidates.push({
        map: entry.row.map,
        round: entry.row.roundNumber,
        player_index: entry.row.playerIndex,
        side: entry.row.side === "t" ? "T" : "CT",
        money: entry.money,
        retained_primary_family: primaryFamily(entry.inventory.primary),
        spend: force.spend,
        resulting_primary_family: primaryFamily(force.resultingInventory.primary),
        resulting_armor: force.resultingInventory.armor,
        option_id: force.id,
      });
    }
  }
  const actualForce = eligible.filter((entry) => actualMode(entry.row.actionType) === "FORCE");
  const actualNoArmor = actualForce.filter((entry) => !entry.row.hasArmor);
  const actualNoArmorExplicitAwp = actualNoArmor.filter((entry) => entry.row.primary === "AWP");
  const actualNoArmorNonAwp = actualNoArmor.filter((entry) => entry.row.primary !== "AWP");
  const probeRows = (["T", "CT"] as const).map((side) => {
    const money = price(DEFAULT_RULES, rifleFor(side));
    const option = recommendPolicyV3(syntheticState(side, money)).options.find((candidate) => candidate.mode === "FORCE");
    return {
      side,
      money,
      option_present: option !== undefined,
      spend: option?.spend ?? null,
      resulting_primary_family: option ? primaryFamily(option.resultingInventory.primary) : null,
      resulting_armor: option?.resultingInventory.armor ?? null,
      non_awp_no_armor_violation: option !== undefined && option.resultingInventory.primary !== "awp" && option.resultingInventory.armor === 0,
    };
  });
  return {
    invariant: "FORCE => armor > 0 except explicit AWP-no-armor path",
    production_reachable: probeRows.some((row) => row.non_awp_no_armor_violation),
    canonical_empty_inventory_probes: probeRows,
    major_policy_candidates: {
      eligible_states: eligible.length,
      force_offered_states: forceOfferedStates,
      force_resulting_armor_zero_states: forceNoArmorStates,
      rate_of_force_offered_states: rate(forceNoArmorStates, forceOfferedStates),
      explicit_awp_no_armor_states: forceNoArmorExplicitAwpStates,
      non_awp_no_armor_violation_states: forceNoArmorNonAwpStates,
      non_awp_no_armor_violation_rate_of_force_offered_states: rate(forceNoArmorNonAwpStates, forceOfferedStates),
      representative_cases: candidates,
    },
    major_actual_force: {
      n: actualForce.length,
      resulting_armor_zero_n: actualNoArmor.length,
      resulting_armor_zero_rate: rate(actualNoArmor.length, actualForce.length),
      explicit_awp_no_armor_n: actualNoArmorExplicitAwp.length,
      non_awp_no_armor_n: actualNoArmorNonAwp.length,
      non_awp_no_armor_rate: rate(actualNoArmorNonAwp.length, actualForce.length),
      representative_non_awp_cases: actualNoArmorNonAwp.slice(0, 20).map((entry) => ({
        map: entry.row.map, round: entry.row.roundNumber, player_index: entry.row.playerIndex,
        side: entry.row.side === "t" ? "T" : "CT", money: entry.money, spend: entry.row.moneySpent,
        resulting_primary: entry.row.primary,
        resulting_primary_family: primaryFamily(entry.row.primary),
      })),
    },
  };
}

function purchaseCapabilities(rows: readonly DiagnosticRow[]) {
  const result: Record<string, unknown> = {};
  for (const side of ["T", "CT"] as const) {
    const rifle = rifleFor(side);
    const definitions = {
      rifle_plus_kevlar: price(DEFAULT_RULES, rifle) + price(DEFAULT_RULES, "kevlar"),
      rifle_plus_vesthelm: price(DEFAULT_RULES, rifle) + price(DEFAULT_RULES, "kevlar_helmet"),
      rifle_plus_kevlar_basic_utility: price(DEFAULT_RULES, rifle) + price(DEFAULT_RULES, "kevlar") + price(DEFAULT_RULES, "smoke") + price(DEFAULT_RULES, "flash"),
      awp_plus_kevlar: price(DEFAULT_RULES, "awp") + price(DEFAULT_RULES, "kevlar"),
    };
    const sideRows = rows.filter((row) => row.side === side);
    result[side] = {
      canonical_rifle: rifle,
      thresholds: definitions,
      light_next_loss_affordability: Object.fromEntries(Object.entries(definitions).map(([name, cost]) => {
        const n = sideRows.filter((row) => row.next_cash_loss_no_plant >= cost).length;
        return [name, { n, rate: rate(n, sideRows.length) }];
      })),
    };
  }
  return result;
}

function nextRoundAudit(
  lightEntries: readonly Eligible[],
  rows: readonly Row[],
  eligible: readonly Eligible[],
  exclusionByKey: ReadonlyMap<string, string>,
) {
  const rawByKey = new Map(rows.map((row) => [key(row), row]));
  const eligibleByKey = new Map(eligible.map((entry) => [key(entry.row), entry]));
  const exclusions = new Map<string, number>();
  const linked: Array<{ current: Eligible; next: Eligible; outcome: "WIN" | "LOSS" }> = [];
  for (const current of lightEntries) {
    const nextKey = `${current.row.map}:${current.row.roundNumber + 1}:${current.row.playerIndex}`;
    const rawNext = rawByKey.get(nextKey);
    if (!rawNext) { increment(exclusions, "no_next_player_round_same_map"); continue; }
    const currentFlags = dropFlags(current.row);
    const nextFlags = dropFlags(rawNext);
    if (current.row.dropGave || current.row.dropReceived || currentFlags.gave || currentFlags.received
      || rawNext.dropGave || rawNext.dropReceived || nextFlags.gave || nextFlags.received) {
      increment(exclusions, "current_or_next_drop_transfer_sensitive");
      continue;
    }
    if (current.row.lossIndexAmbiguous || rawNext.lossIndexAmbiguous) {
      increment(exclusions, "current_or_next_loss_index_ambiguous");
      continue;
    }
    const next = eligibleByKey.get(nextKey);
    if (!next) {
      increment(exclusions, exclusionByKey.get(nextKey) ?? "next_not_strict_eligible");
      continue;
    }
    linked.push({ current, next, outcome: current.row.winnerSide === current.row.side ? "WIN" : "LOSS" });
  }
  const loss = linked.filter((entry) => entry.outcome === "LOSS");
  const win = linked.filter((entry) => entry.outcome === "WIN");
  const nextMode = (entries: readonly typeof linked[number][]) => countDistribution(entries.map((entry) => actualMode(entry.next.row.actionType)));
  const nextPrimary = (entries: readonly typeof linked[number][]) => countDistribution(entries.map((entry) => primaryFamily(entry.next.row.primary)));
  const nextArmor = (entries: readonly typeof linked[number][]) => countDistribution(entries.map((entry) => armorState(entry.next.row.hasArmor, entry.next.row.hasHelmet)));
  const strictFullRifleArmor = loss.filter((entry) => actualMode(entry.next.row.actionType) === "FULL"
    && primaryFamily(entry.next.row.primary) === "rifle" && entry.next.row.hasArmor).length;
  const fullBuyLike = loss.filter((entry) => actualMode(entry.next.row.actionType) === "FULL"
    && ["rifle", "sniper"].includes(primaryFamily(entry.next.row.primary)) && entry.next.row.hasArmor).length;
  const rifleArmor = loss.filter((entry) => primaryFamily(entry.next.row.primary) === "rifle" && entry.next.row.hasArmor).length;
  return {
    all_light: lightEntries.length,
    linked_unambiguous: linked.length,
    linked_rate: rate(linked.length, lightEntries.length),
    exclusions: Object.fromEntries([...exclusions].sort()),
    linked_by_current_outcome: {
      WIN: { n: win.length, next_actual_mode: nextMode(win) },
      LOSS: { n: loss.length, next_actual_mode: nextMode(loss) },
    },
    loss_only_next_state: {
      n: loss.length,
      actual_mode: nextMode(loss),
      resulting_primary_family: nextPrimary(loss),
      resulting_armor: nextArmor(loss),
      actual_full_n: loss.filter((entry) => actualMode(entry.next.row.actionType) === "FULL").length,
      rifle_plus_armor_n: rifleArmor,
      rifle_plus_armor_rate: rate(rifleArmor, loss.length),
      strict_full_rifle_plus_armor_n: strictFullRifleArmor,
      strict_full_rifle_plus_armor_rate: rate(strictFullRifleArmor, loss.length),
      full_buy_like_n: fullBuyLike,
      full_buy_like_rate: rate(fullBuyLike, loss.length),
      definitions: {
        strict_full_rifle_plus_armor: "next actual mode FULL and resulting rifle with armor",
        full_buy_like: "next actual mode FULL and resulting rifle or sniper with armor",
      },
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const corpusBuffer = readFileSync(args.corpus);
  const corpusHash = sha256(corpusBuffer);
  if (corpusHash !== EXPECTED_CORPUS_SHA256) throw new Error(`corpus hash mismatch: ${corpusHash}`);
  const rows = JSON.parse(corpusBuffer.toString("utf8")) as Row[];
  if (rows.length !== EXPECTED_RAW_ROWS) throw new Error(`raw row count changed: ${rows.length}`);
  const { eligible, exclusionByKey, audit } = await buildEligible(rows, args.maps);
  if (eligible.length !== EXPECTED_ELIGIBLE_ROWS) throw new Error(`eligible count changed: ${eligible.length}`);
  const diagnosticRows = eligible.map(diagnosticRow);
  const lightEntries = eligible.filter((entry) => actualMode(entry.row.actionType) === "LIGHT");
  const lightRows = lightEntries.map(diagnosticRow);
  if (lightRows.length !== EXPECTED_LIGHT_ROWS) throw new Error(`actual LIGHT count changed: ${lightRows.length}`);

  const lossTiers = subgroup(lightRows, (row) => `index_${row.loss_index}_reward_${row.loss_reward}`);
  const tierMedians = Object.entries(lossTiers).map(([tier, summary]) => ({
    tier,
    reward: Number(tier.match(/reward_(\d+)/)?.[1]),
    residual_median: summary.residual_cash.median,
    next_median: summary.next_cash_loss_no_plant.median,
  })).sort((a, b) => a.reward - b.reward);
  const adjacentTierChanges = tierMedians.slice(1).map((current, index) => {
    const previous = tierMedians[index]!;
    return {
      from_reward: previous.reward,
      to_reward: current.reward,
      reward_delta: current.reward - previous.reward,
      residual_median_delta: current.residual_median! - previous.residual_median!,
      next_median_delta: current.next_median! - previous.next_median!,
    };
  });

  const actualModeByKey = new Map(eligible.map((entry) => [key(entry.row), actualMode(entry.row.actionType)]));
  const modeComparison = Object.fromEntries((["FORCE", "LIGHT", "PRESERVE"] as const).map((mode) => {
    const modeRows = diagnosticRows.filter((row) => actualModeByKey.get(`${row.map}:${row.round}:${row.player_index}`) === mode);
    return [mode, {
      overall: compactSummary(modeRows),
      by_side: subgroup(modeRows, (row) => row.side),
    }];
  }));

  const tPlantRows = lightRows.filter((row) => row.side === "T");
  const resultWithoutHash = {
    schema_version: 1,
    baseline_sha: BASELINE_SHA,
    scope: "offline LIGHT reserve / next-round-money diagnostic; no production policy input or modification",
    inputs: {
      corpus_sha256: corpusHash,
      expected_corpus_sha256: EXPECTED_CORPUS_SHA256,
      corpus_contract: "frozen IEM Cologne Major 2026 player-round table and replay pre-state packages",
      canonical_rules: DEFAULT_RULES.ruleSetId,
      main_scenario: "LOSS_NO_PLANT; N = current money - actual spend + current loss reward",
      secondary_t_plant_scenario: "N_plant = N + $600; hypothetical comparison only",
    },
    eligibility: audit,
    requested_light_fields: {
      computed_rows: lightRows.length,
      canonical_row_sha256: stableHash(lightRows),
      fields: Object.keys(lightRows[0]!),
      note: "row-level values are deterministically recomputed from the frozen corpus; artifact stays aggregate-only",
    },
    actual_light: {
      overall: summarize(lightRows),
      categorical: {
        side: countDistribution(lightRows.map((row) => row.side)),
        context: countDistribution(lightRows.map((row) => row.context)),
        loss_index_and_reward: countDistribution(lightRows.map((row) => `index_${row.loss_index}_reward_${row.loss_reward}`)),
        retained_primary: countDistribution(lightRows.map((row) => row.retained_primary ? "yes" : "no")),
        retained_armor: countDistribution(lightRows.map((row) => row.retained_armor ? "yes" : "no")),
        resulting_primary_family: countDistribution(lightRows.map((row) => row.resulting_primary_family)),
        resulting_armor: countDistribution(lightRows.map((row) => row.resulting_armor_state)),
        resulting_primary_and_armor: countDistribution(lightRows.map((row) => `${row.resulting_primary_family}+${row.resulting_armor_state}`)),
      },
      subgroup_distributions: {
        side: subgroup(lightRows, (row) => row.side),
        context: subgroup(lightRows, (row) => row.context),
        loss_index_and_reward: lossTiers,
        side_by_loss_index_and_reward: subgroup(lightRows, (row) => `${row.side}:index_${row.loss_index}_reward_${row.loss_reward}`),
        context_by_loss_index_and_reward: subgroup(lightRows, (row) => `${row.context}:index_${row.loss_index}_reward_${row.loss_reward}`),
        retained_primary: subgroup(lightRows, (row) => row.retained_primary ? "yes" : "no"),
        retained_armor: subgroup(lightRows, (row) => row.retained_armor ? "yes" : "no"),
      },
      reserve_adjustment_by_loss_reward: {
        tier_medians: tierMedians,
        adjacent_tier_changes: adjacentTierChanges,
        rank_association: {
          overall: rewardAssociation(lightRows),
          by_side: Object.fromEntries((["T", "CT"] as const).map((side) => [side, rewardAssociation(lightRows.filter((row) => row.side === side))])),
          by_context: Object.fromEntries((["NORMAL", "POST_PISTOL"] as const).map((context) => [context, rewardAssociation(lightRows.filter((row) => row.context === context))])),
        },
      },
      concentration: {
        overall: dispersionComparison(lightRows),
        by_side: Object.fromEntries((["T", "CT"] as const).map((side) => [side, dispersionComparison(lightRows.filter((row) => row.side === side))])),
        by_context: Object.fromEntries((["NORMAL", "POST_PISTOL", "OVERTIME"] as const).map((context) => [context, dispersionComparison(lightRows.filter((row) => row.context === context))])),
      },
      t_plant_secondary_comparison: {
        n: tPlantRows.length,
        loss_no_plant: moneyDistribution(tPlantRows.map((row) => row.next_cash_loss_no_plant)),
        loss_with_plant: moneyDistribution(tPlantRows.map((row) => row.next_cash_loss_with_plant!)),
      },
    },
    purchase_capability_interpretation: purchaseCapabilities(lightRows),
    mode_contrast: modeComparison,
    next_round_linkage: nextRoundAudit(lightEntries, rows, eligible, exclusionByKey),
    light_subtypes: {
      definition: {
        retained_primary_top_up: "retained primary exists, regardless of resulting family",
        no_primary_pistol_utility_or_armor: "no retained primary and no resulting primary; secondary/utility/armor may change",
        new_smg_plus_armor: "no retained primary; resulting SMG with armor",
        other_new_primary_bundle: "no retained primary; any other resulting primary bundle",
      },
      counts: countDistribution(lightRows.map(subtype)),
      distributions: subgroup(lightRows, subtype),
      no_primary_no_resulting_primary_secondary: countDistribution(lightRows.filter((row) => subtype(row) === "no_primary_pistol_utility_or_armor").map((row) => row.resulting_secondary_class)),
    },
    force_armor_invariant_audit: forceArmorAudit(eligible),
    hypothesis_assessment: {
      verdict: "NOT_SUPPORTED",
      architecture_decision_ready: true,
      decision: "Do not replace LIGHT with a single reserveTarget formula from this corpus. Keep future affordability as explicit trajectory context; separately revisit the fixed SMG-plus-armor bundle and enforce the FORCE armor invariant in a later implementation round.",
      primary_reasons: [
        "LOSS_NO_PLANT next cash is less concentrated than residual cash overall and on both sides.",
        "Residual medians do not fall by approximately $500 when loss reward rises by $500; next-cash medians instead move materially with reward tier.",
        "LIGHT has materially different POST_PISTOL, no-primary, new-SMG, other-primary, and retained-primary structures rather than one stable target.",
      ],
      qualifying_observations: [
        "Retained-primary and retained-armor aggregates share a $4700 next-cash median with their non-retained counterparts.",
        "Among conservatively linked LIGHT losses, 87.96% are actual FULL next round and 83.84% are strict FULL rifle-plus-armor states; this is observational and does not establish the reserve mechanism.",
      ],
    },
  };
  const artifactHash = stableHash(resultWithoutHash);
  const result = { ...resultWithoutHash, artifact_sha256: artifactHash };
  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`eligible=${eligible.length} actual_light=${lightRows.length} artifact_sha256=${artifactHash}`);
}

await main();
