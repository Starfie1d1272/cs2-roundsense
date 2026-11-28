/**
 * Unified cross-event offline freeze-time decision replay benchmark.
 *
 * Uses the validated replay.json end-of-round pre-buy state recovery pipeline
 * (exact 0..100 armor, alive flag, end-of-round grenades and defuse kit,
 * utility-state coherence check, drop/pickup filtering, and SHA-256 corpus
 * digests) so any tournament map-ZIP corpus (Cologne Major 2026 development
 * set, Singapore Major 2026 Stage 1 out-of-sample test set, etc.) is evaluated
 * under identical rules and identical pre-buy states.
 *
 * Strategies evaluated on the exact same eligible player-rounds:
 *   - B0 (naive):           Current-round only, no next-round awareness, no Galil/FAMAS
 *   - B1 (standard_econ):   Fixed CS2 economy-aware heuristic (full/light/eco + Galil/FAMAS/SMG)
 *   - B2 (legacy_v3):       Pre-refactor Policy V3 loaded verbatim from git commit 036a013
 *   - Current (roundsense): Frozen unified Policy V3 (PR #17 / commit 612a1cf)
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/cross-event-replay-benchmark.ts \
 *     --event "IEM Cologne Major 2026" \
 *     --maps /path/to/maps \
 *     --out docs/data/cologne-cross-event-benchmark.json
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import {
  DEFAULT_RULES,
  type InventoryState,
  inferOpponentEconomy,
  isItemLegalForSide,
  lossBonus,
  MAX_GRENADE_CARRY,
  type PolicyV3Output,
  type PolicyV3State,
  type PurchaseItem,
  planPurchases,
  price,
  recommendPolicyV3,
  resultingLoadout,
  rifleFor,
  smgFor,
  weaponClassOf,
} from '../packages/economy-advisor/src/index.js';
import type { ItemId, Side } from '../packages/shared-types/src/index.js';

const LEGACY_V3_COMMIT = '036a013';

const DEMO_TO_ITEM: Readonly<Record<string, ItemId>> = {
  'AK-47': 'ak47',
  M4A4: 'm4a4',
  'M4A1-S': 'm4a1s',
  'Galil AR': 'galil',
  FAMAS: 'famas',
  'SG 553': 'sg553',
  AUG: 'aug',
  AWP: 'awp',
  'SSG 08': 'ssg08',
  G3SG1: 'g3sg1',
  'SCAR-20': 'scar20',
  'MAC-10': 'mac10',
  MP9: 'mp9',
  MP7: 'mp7',
  'MP5-SD': 'mp5sd',
  'UMP-45': 'ump45',
  P90: 'p90',
  'PP-Bizon': 'bizon',
  Nova: 'nova',
  XM1014: 'xm1014',
  'MAG-7': 'mag7',
  'Sawed-Off': 'sawedoff',
  M249: 'm249',
  Negev: 'negev',
  'USP-S': 'usp',
  P2000: 'p2000',
  'Glock-18': 'glock',
  P250: 'p250',
  'Tec-9': 'tec9',
  'Five-SeveN': 'fiveseven',
  'CZ75-Auto': 'cz75',
  'Dual Berettas': 'dual',
  'Desert Eagle': 'deagle',
  'R8 Revolver': 'r8',
  'Zeus x27': 'zeus',
};

const DEMO_GRENADE_TO_ITEM: Readonly<Record<string, ItemId>> = {
  'Smoke Grenade': 'smoke',
  Flashbang: 'flash',
  'HE Grenade': 'he',
  Molotov: 'molotov',
  'Incendiary Grenade': 'incendiary',
  'Decoy Grenade': 'decoy',
  flashbang: 'flash',
  hegrenade: 'he',
  smoke: 'smoke',
  flash: 'flash',
  he: 'he',
  molotov: 'molotov',
  incendiary: 'incendiary',
  decoy: 'decoy',
};

const GRENADE_PRICES: Readonly<Record<string, number>> = {
  smoke: 300,
  flash: 200,
  he: 300,
  molotov: 400,
  incendiary: 500,
  decoy: 50,
};

type WeaponFamily = 'rifle' | 'sniper' | 'smg' | 'heavy' | 'pistol_only';
type RoundContext = 'POST_PISTOL' | 'NORMAL' | 'OVERTIME';

interface RoundRecord {
  roundNumber: number;
  teamASide: 't' | 'ct';
  teamBSide: 't' | 'ct';
  teamAScoreBefore: number;
  teamBScoreBefore: number;
  winnerTeamKey: 'teamA' | 'teamB';
  winnerSide: 't' | 'ct';
}

interface PlayerEconRecord {
  roundNumber: number;
  playerIndex: number;
  startMoney: number;
  moneySpent: number;
  equipmentValue: number;
  type: string;
  hasArmor: boolean;
  hasHelmet: boolean;
  hasDefuseKit: boolean;
  primaryWeapon: string | null;
  secondaryWeapon: string | null;
  grenadeCount: number;
  grenades: string[];
}

interface ReplayTrack {
  playerIndex: number;
  flags: number[];
  armor: number[];
  grenades: string[][];
}

interface ReplayRound {
  roundNumber: number;
  players: ReplayTrack[];
}

interface Prestate {
  alive: boolean;
  armor: number;
  kit: boolean;
  grenades: ItemId[];
}

interface StrategyOption {
  mode: string;
  spend: number;
  purchases: readonly PurchaseItem[];
  primary: ItemId | null;
  primaryFamily: WeaponFamily;
  hasArmor: boolean;
  hasHelmet: boolean;
  grenadeCount: number;
  protectedNextBuy?: 'RIFLE_ARMOR' | 'RIFLE_ARMOR_BASIC_UTILITY';
  conditionalAlternatives?: ReadonlyArray<{
    spend: number;
    purchases: readonly PurchaseItem[];
  }>;
}

interface StrategyResult {
  lead: StrategyOption;
  options: readonly StrategyOption[];
}

interface SliceCounters {
  n: number;
  leadSpendAbsErr: number[];
  leadSpendSignedErr: number;
  leadWithin0: number;
  leadWithin200: number;
  leadWithin400: number;
  leadWithin800: number;
  leadWithin1000: number;
  leadWeaponFamilyMatch: number;
  leadArmorMatch: number;
  ctNormalN: number;
  ctHelmetMatch: number;
  setSpendAbsErr: number[];
  setWithin400: number;
  setWeaponFamilyMatch: number;
  optionCountSum: number;
  nonResetNormalN: number;
  leadNextFullReady: number;
  leadRifleOrSniper: number;
  leadSpendSum: number;
  actualNextFullReady: number;
  actualRifleOrSniper: number;
  actualSpendSum: number;
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function parseArgs(): { event: string; mapsDir: string; outPath: string } {
  const args = process.argv.slice(2);
  let event = 'Unknown Event';
  let mapsDir = '';
  let outPath = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--event' && args[i + 1]) event = args[++i]!;
    else if (args[i] === '--maps' && args[i + 1]) mapsDir = args[++i]!;
    else if (args[i] === '--out' && args[i + 1]) outPath = args[++i]!;
  }
  if (!mapsDir || !outPath) {
    throw new Error(
      'Usage: tsx scripts/cross-event-replay-benchmark.ts --event <name> --maps <dir> --out <json>',
    );
  }
  return { event, mapsDir: resolve(mapsDir), outPath: resolve(outPath) };
}

function itemOf(name: string | null | undefined): ItemId | null {
  if (!name) return null;
  return DEMO_TO_ITEM[name] ?? null;
}

function familyOf(item: ItemId | null | undefined): WeaponFamily {
  if (!item) return 'pistol_only';
  const cls = weaponClassOf(item);
  if (cls === 'rifle') return 'rifle';
  if (cls === 'sniper' || cls === 'awp') return 'sniper';
  if (cls === 'smg') return 'smg';
  if (cls === 'shotgun' || cls === 'mg') return 'heavy';
  return 'pistol_only';
}

function mapGrenades(names: readonly string[]): ItemId[] {
  const out: ItemId[] = [];
  for (const name of names) {
    const mapped = DEMO_GRENADE_TO_ITEM[name];
    if (mapped) out.push(mapped);
  }
  return out;
}

function estimateGearValue(inv: InventoryState): number {
  let total = 0;
  if (inv.primary) total += price(DEFAULT_RULES, inv.primary);
  if (
    inv.secondary &&
    inv.secondary !== 'glock' &&
    inv.secondary !== 'usp' &&
    inv.secondary !== 'p2000'
  ) {
    total += price(DEFAULT_RULES, inv.secondary);
  }
  if (inv.armor > 0) total += inv.hasHelmet ? 1000 : 650;
  if (inv.hasDefuseKit) total += 400;
  for (const g of inv.grenades) total += price(DEFAULT_RULES, g);
  return total;
}

function utilityStateIsCoherent(
  cur: PlayerEconRecord,
  side: Side,
  prestate: Prestate,
  money: number,
): { ok: boolean; reason?: string } {
  const retained = new Map<ItemId, number>();
  const resulting = new Map<ItemId, number>();
  for (const item of prestate.grenades) retained.set(item, (retained.get(item) ?? 0) + 1);
  const curGrenades = mapGrenades(cur.grenades);
  for (const item of curGrenades) resulting.set(item, (resulting.get(item) ?? 0) + 1);
  for (const [item, count] of retained) {
    if ((resulting.get(item) ?? 0) < count) {
      return { ok: false, reason: 'resulting_grenade_below_retained' };
    }
  }
  if (prestate.kit && !cur.hasDefuseKit) {
    return { ok: false, reason: 'resulting_kit_below_retained' };
  }
  let utilityCost = 0;
  for (const [item, count] of resulting) {
    utilityCost += Math.max(0, count - (retained.get(item) ?? 0)) * (GRENADE_PRICES[item] ?? 0);
  }
  if (side === 'CT' && cur.hasDefuseKit && !prestate.kit) utilityCost += 400;
  const utilityBudget = money - (cur.moneySpent - utilityCost);
  if (utilityBudget < 0 || utilityBudget > 16_000) {
    return { ok: false, reason: 'utility_budget_out_of_range' };
  }
  return { ok: true };
}

function toOption(
  mode: string,
  inventory: InventoryState,
  purchases: readonly PurchaseItem[],
  spend: number,
  protectedNextBuy?: 'RIFLE_ARMOR' | 'RIFLE_ARMOR_BASIC_UTILITY',
  conditionalAlternatives?: ReadonlyArray<{
    spend: number;
    purchases: readonly PurchaseItem[];
  }>,
): StrategyOption {
  const loadout = resultingLoadout(inventory, [...purchases]);
  return {
    mode,
    spend,
    purchases,
    primary: loadout.primary,
    primaryFamily: familyOf(loadout.primary),
    hasArmor: loadout.armor > 0,
    hasHelmet: loadout.hasHelmet,
    grenadeCount: loadout.grenades.length,
    protectedNextBuy,
    conditionalAlternatives,
  };
}

/**
 * B0 · Naive buy-what-you-can baseline.
 * Current-round only: no next-round economy awareness, no Galil/FAMAS, vesthelm-first.
 */
function runB0Naive(money: number, side: Side, inventory: InventoryState): StrategyResult {
  const weaponLadder: ItemId[] =
    side === 'CT' ? ['m4a1s', 'mp9', 'fiveseven'] : ['ak47', 'mac10', 'tec9'];
  const utilLadder: ItemId[] =
    side === 'CT'
      ? ['smoke', 'flash', 'he', 'incendiary', 'defuse_kit']
      : ['smoke', 'flash', 'molotov', 'he', 'flash'];

  const desired: PurchaseItem[] = [];
  if (!inventory.primary) {
    for (const w of weaponLadder) {
      const p = planPurchases(inventory, [{ item: w, quantity: 1 }], DEFAULT_RULES, side);
      if (p.isComplete && p.totalCost <= money) {
        desired.push({ item: w, quantity: 1 });
        break;
      }
    }
  }
  for (const armor of ['kevlar_helmet', 'kevlar'] as const) {
    const trial = [...desired, { item: armor, quantity: 1 }];
    const p = planPurchases(inventory, trial, DEFAULT_RULES, side);
    if (p.isComplete && p.totalCost <= money) {
      desired.push({ item: armor, quantity: 1 });
      break;
    }
  }
  let flashCount = inventory.grenades.filter((g) => g === 'flash').length;
  let totalGrenades = inventory.grenades.length;
  for (const u of utilLadder) {
    if (u !== 'defuse_kit') {
      if (totalGrenades >= MAX_GRENADE_CARRY) break;
      if (u === 'flash' && flashCount >= 2) continue;
    }
    const trial = [...desired, { item: u, quantity: 1 }];
    const p = planPurchases(inventory, trial, DEFAULT_RULES, side);
    if (p.isComplete && p.totalCost <= money) {
      desired.push({ item: u, quantity: 1 });
      if (u !== 'defuse_kit') {
        totalGrenades++;
        if (u === 'flash') flashCount++;
      }
    }
  }
  const finalPlan = planPurchases(inventory, desired, DEFAULT_RULES, side);
  const opt = toOption('NAIVE', inventory, finalPlan.purchases, finalPlan.totalCost);
  return { lead: opt, options: [opt] };
}

/**
 * B1 · Standard CS2 economy-aware heuristic baseline.
 * Fixed, transparent textbook CS2 economy rules (frozen before seeing Singapore data):
 *   - Knows full-buy floors (CT ~$4,150, T ~$4,200), next-round loss bonus, LIGHT/ECO,
 *     and standard eco-rifles (Galil / FAMAS) + SMGs (MP9 / MAC-10).
 *   - Emits one primary recommendation (strictly 1-vs-1 comparable to RoundSense lead).
 */
function runB1StandardEcon(
  money: number,
  side: Side,
  inventory: InventoryState,
  lossIndex: number,
  context: RoundContext,
  pistolWinner: boolean | null,
): StrategyResult {
  const mainRifle = rifleFor(side);
  const ecoRifle: ItemId = side === 'CT' ? 'famas' : 'galil';
  const smg = smgFor(side);
  const pistol: ItemId = side === 'CT' ? 'fiveseven' : 'tec9';
  const fire: ItemId = side === 'CT' ? 'incendiary' : 'molotov';

  const buyWithBudget = (
    budget: number,
    weaponCandidates: readonly ItemId[],
    preferHelmet: boolean,
    utilityOrder: readonly ItemId[],
  ): { purchases: PurchaseItem[]; totalCost: number } => {
    const desired: PurchaseItem[] = [];
    if (!inventory.primary) {
      for (const w of weaponCandidates) {
        const armorPref: ItemId = preferHelmet ? 'kevlar_helmet' : 'kevlar';
        const trial = [
          { item: w, quantity: 1 },
          { item: armorPref, quantity: 1 },
        ];
        const plan = planPurchases(inventory, trial, DEFAULT_RULES, side);
        if (plan.isComplete && plan.totalCost <= budget) {
          desired.push({ item: w, quantity: 1 });
          break;
        }
      }
      if (desired.length === 0) {
        for (const w of weaponCandidates) {
          const plan = planPurchases(inventory, [{ item: w, quantity: 1 }], DEFAULT_RULES, side);
          if (plan.isComplete && plan.totalCost <= budget) {
            desired.push({ item: w, quantity: 1 });
            break;
          }
        }
      }
    }
    const armorOrder: ItemId[] = preferHelmet
      ? ['kevlar_helmet', 'kevlar']
      : ['kevlar', 'kevlar_helmet'];
    for (const a of armorOrder) {
      const trial = [...desired, { item: a, quantity: 1 }];
      const plan = planPurchases(inventory, trial, DEFAULT_RULES, side);
      if (plan.isComplete && plan.totalCost <= budget) {
        desired.push({ item: a, quantity: 1 });
        break;
      }
    }
    let curPlan = planPurchases(inventory, desired, DEFAULT_RULES, side);
    let loadout = resultingLoadout(inventory, curPlan.purchases);
    for (const u of utilityOrder) {
      if (u !== 'defuse_kit') {
        if (loadout.grenades.length >= MAX_GRENADE_CARRY) break;
        if (u === 'flash' && loadout.grenades.filter((g) => g === 'flash').length >= 2) continue;
        if (u !== 'flash' && loadout.grenades.includes(u)) continue;
      } else if (loadout.hasDefuseKit) {
        continue;
      }
      const trial = [...desired, { item: u, quantity: 1 }];
      const plan = planPurchases(inventory, trial, DEFAULT_RULES, side);
      if (plan.isComplete && plan.totalCost <= budget) {
        desired.push({ item: u, quantity: 1 });
        curPlan = plan;
        loadout = resultingLoadout(inventory, curPlan.purchases);
      }
    }
    if (!loadout.hasHelmet && loadout.armor > 0) {
      const trial = [...desired, { item: 'kevlar_helmet' as ItemId, quantity: 1 }];
      const plan = planPurchases(inventory, trial, DEFAULT_RULES, side);
      if (plan.isComplete && plan.totalCost <= budget) {
        curPlan = plan;
      }
    }
    return { purchases: curPlan.purchases, totalCost: curPlan.totalCost };
  };

  if (context === 'POST_PISTOL' && pistolWinner === true) {
    const plan = buyWithBudget(money, [smg, ecoRifle, mainRifle], true, [
      'smoke',
      'flash',
      'he',
      fire,
      'defuse_kit',
    ]);
    const opt = toOption('FULL', inventory, plan.purchases, plan.totalCost);
    return { lead: opt, options: [opt] };
  }

  const fullFloor = side === 'CT' ? 4150 : 4200;
  const fullUtilityOrder: ItemId[] =
    side === 'CT'
      ? ['smoke', 'flash', 'he', 'incendiary', 'defuse_kit', 'flash']
      : ['smoke', 'molotov', 'flash', 'he', 'flash'];
  const retainedStrong =
    inventory.primary !== null &&
    (familyOf(inventory.primary) === 'rifle' || familyOf(inventory.primary) === 'sniper');

  const rifleNeed = retainedStrong
    ? 0
    : planPurchases(
        inventory,
        [
          { item: mainRifle, quantity: 1 },
          { item: side === 'CT' ? 'kevlar' : 'kevlar_helmet', quantity: 1 },
        ],
        DEFAULT_RULES,
        side,
      ).totalCost;

  if (retainedStrong || money >= rifleNeed) {
    const useEcoRifle = !retainedStrong && side === 'T' && money < rifleNeed + 400;
    const weapons: ItemId[] = useEcoRifle ? [ecoRifle, mainRifle, smg] : [mainRifle, ecoRifle, smg];
    const plan = buyWithBudget(money, weapons, side === 'T', fullUtilityOrder);
    const opt = toOption('FULL', inventory, plan.purchases, plan.totalCost);
    return { lead: opt, options: [opt] };
  }

  if (context === 'OVERTIME') {
    const plan = buyWithBudget(money, [mainRifle, ecoRifle, smg, pistol], true, fullUtilityOrder);
    const opt = toOption('FORCE', inventory, plan.purchases, plan.totalCost);
    return { lead: opt, options: [opt] };
  }

  const nextLoss = lossBonus(DEFAULT_RULES, lossIndex);
  const maxSpendForNextFull = money + nextLoss - fullFloor;

  if (maxSpendForNextFull >= 0 && context !== 'POST_PISTOL') {
    if (maxSpendForNextFull < 300) {
      const opt = toOption('PRESERVE', inventory, [], 0);
      return { lead: opt, options: [opt] };
    }
    const plan = buyWithBudget(maxSpendForNextFull, [smg, pistol, 'p250'], false, [
      'flash',
      'smoke',
      'he',
    ]);
    const opt = toOption(
      plan.totalCost === 0 ? 'PRESERVE' : 'LIGHT',
      inventory,
      plan.purchases,
      plan.totalCost,
    );
    return { lead: opt, options: [opt] };
  }

  if (context === 'POST_PISTOL' && pistolWinner === false) {
    if (maxSpendForNextFull >= 300) {
      const plan = buyWithBudget(maxSpendForNextFull, [pistol, 'p250'], false, ['flash', 'smoke']);
      const opt = toOption(
        plan.totalCost === 0 ? 'PRESERVE' : 'LIGHT',
        inventory,
        plan.purchases,
        plan.totalCost,
      );
      return { lead: opt, options: [opt] };
    }
    const opt = toOption('PRESERVE', inventory, [], 0);
    return { lead: opt, options: [opt] };
  }

  const plan = buyWithBudget(money, [ecoRifle, smg, pistol, 'p250'], side === 'T', [
    'smoke',
    'flash',
    'he',
    fire,
  ]);
  const opt = toOption(
    plan.totalCost === 0 ? 'PRESERVE' : 'FORCE',
    inventory,
    plan.purchases,
    plan.totalCost,
  );
  return { lead: opt, options: [opt] };
}

function wrapPolicyV3Output(out: PolicyV3Output, inventory: InventoryState): StrategyResult {
  const opts = out.options.map((o) =>
    toOption(
      o.mode,
      inventory,
      o.purchases,
      o.bundleSpend,
      o.spendingGuidance.kind === 'BOUNDED' ? o.spendingGuidance.protectedCapability : undefined,
      o.conditionalAlternatives.map((alt) => ({
        spend: alt.bundleSpend,
        purchases: alt.purchases,
      })),
    ),
  );
  if (opts.length === 0) {
    const empty = toOption('PRESERVE', inventory, [], 0);
    return { lead: empty, options: [empty] };
  }
  return { lead: opts[0]!, options: opts };
}

const FROZEN_POLICY_COMMIT = 'dc1c84a';

function verifyFrozenPolicyIntegrity(): { headCommit: string; matchesFrozenCommit: boolean } {
  const headCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const diff = execFileSync(
    'git',
    ['diff', FROZEN_POLICY_COMMIT, '--', 'packages/economy-advisor/src'],
    { encoding: 'utf8' },
  ).trim();
  if (diff.length > 0) {
    throw new Error(
      `Production packages/economy-advisor/src diverged from frozen commit ${FROZEN_POLICY_COMMIT}`,
    );
  }
  return { headCommit, matchesFrozenCommit: true };
}

async function loadLegacyPolicyV3(): Promise<{
  recommend: (state: PolicyV3State) => PolicyV3Output;
  cleanup: () => void;
}> {
  const tmpDir = resolve('packages/economy-advisor/.tmp-legacy-036a013');
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const files = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', `${LEGACY_V3_COMMIT}:packages/economy-advisor/src`],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && !f.endsWith('.test.ts'));
  for (const f of files) {
    const content = execFileSync(
      'git',
      ['show', `${LEGACY_V3_COMMIT}:packages/economy-advisor/src/${f}`],
      { encoding: 'utf8' },
    );
    const out = join(tmpDir, f);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, content, 'utf8');
  }
  const mod = (await import(pathToFileURL(join(tmpDir, 'policy-v3.ts')).href)) as {
    recommendPolicyV3: (state: PolicyV3State) => PolicyV3Output;
  };
  return {
    recommend: mod.recommendPolicyV3,
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
  };
}

function emptySlice(): SliceCounters {
  return {
    n: 0,
    leadSpendAbsErr: [],
    leadSpendSignedErr: 0,
    leadWithin0: 0,
    leadWithin200: 0,
    leadWithin400: 0,
    leadWithin800: 0,
    leadWithin1000: 0,
    leadWeaponFamilyMatch: 0,
    leadArmorMatch: 0,
    ctNormalN: 0,
    ctHelmetMatch: 0,
    setSpendAbsErr: [],
    setWithin400: 0,
    setWeaponFamilyMatch: 0,
    optionCountSum: 0,
    nonResetNormalN: 0,
    leadNextFullReady: 0,
    leadRifleOrSniper: 0,
    leadSpendSum: 0,
    actualNextFullReady: 0,
    actualRifleOrSniper: 0,
    actualSpendSum: 0,
  };
}

function recordSlice(
  s: SliceCounters,
  res: StrategyResult,
  actual: {
    spend: number;
    primaryFamily: WeaponFamily;
    hasArmor: boolean;
    hasHelmet: boolean;
    side: Side;
    context: RoundContext;
    money: number;
    lossIndex: number;
    isResetRound: boolean;
  },
): void {
  s.n++;
  s.optionCountSum += res.options.length;
  const leadDiff = res.lead.spend - actual.spend;
  const leadAbs = Math.abs(leadDiff);
  s.leadSpendAbsErr.push(leadAbs);
  s.leadSpendSignedErr += leadDiff;
  if (leadAbs === 0) s.leadWithin0++;
  if (leadAbs <= 200) s.leadWithin200++;
  if (leadAbs <= 400) s.leadWithin400++;
  if (leadAbs <= 800) s.leadWithin800++;
  if (leadAbs <= 1000) s.leadWithin1000++;
  if (res.lead.primaryFamily === actual.primaryFamily) s.leadWeaponFamilyMatch++;
  if (res.lead.hasArmor === actual.hasArmor && res.lead.hasHelmet === actual.hasHelmet) {
    s.leadArmorMatch++;
  }
  if (actual.side === 'CT' && actual.context === 'NORMAL') {
    s.ctNormalN++;
    if (res.lead.hasHelmet === actual.hasHelmet) s.ctHelmetMatch++;
  }
  const bestSetAbs = Math.min(...res.options.map((o) => Math.abs(o.spend - actual.spend)));
  s.setSpendAbsErr.push(bestSetAbs);
  if (bestSetAbs <= 400) s.setWithin400++;
  if (res.options.some((o) => o.primaryFamily === actual.primaryFamily)) s.setWeaponFamilyMatch++;
  if (actual.context === 'NORMAL' && !actual.isResetRound) {
    s.nonResetNormalN++;
    const reward = lossBonus(DEFAULT_RULES, actual.lossIndex);
    const floor = actual.side === 'CT' ? 4050 : 4200;
    s.leadSpendSum += res.lead.spend;
    s.actualSpendSum += actual.spend;
    if (actual.money - res.lead.spend + reward >= floor) s.leadNextFullReady++;
    if (actual.money - actual.spend + reward >= floor) s.actualNextFullReady++;
    if (res.lead.primaryFamily === 'rifle' || res.lead.primaryFamily === 'sniper')
      s.leadRifleOrSniper++;
    if (actual.primaryFamily === 'rifle' || actual.primaryFamily === 'sniper')
      s.actualRifleOrSniper++;
  }
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

function summarizeSlice(s: SliceCounters) {
  const pct = (c: number, denom = s.n) => (denom === 0 ? 0 : Math.round((c / denom) * 1000) / 10);
  const mean = (arr: readonly number[]) =>
    arr.length === 0 ? 0 : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  return {
    n: s.n,
    avgOptions: s.n === 0 ? 0 : Math.round((s.optionCountSum / s.n) * 100) / 100,
    lead: {
      spendMae: mean(s.leadSpendAbsErr),
      spendMedianAe: percentile(s.leadSpendAbsErr, 0.5),
      spendSignedMean: s.n === 0 ? 0 : Math.round(s.leadSpendSignedErr / s.n),
      within0Pct: pct(s.leadWithin0),
      within200Pct: pct(s.leadWithin200),
      within400Pct: pct(s.leadWithin400),
      within800Pct: pct(s.leadWithin800),
      within1000Pct: pct(s.leadWithin1000),
      weaponFamilyMatchPct: pct(s.leadWeaponFamilyMatch),
      armorMatchPct: pct(s.leadArmorMatch),
      ctNormalHelmetMatchPct: pct(s.ctHelmetMatch, s.ctNormalN),
    },
    optionSet: {
      spendMae: mean(s.setSpendAbsErr),
      within400Pct: pct(s.setWithin400),
      weaponFamilyMatchPct: pct(s.setWeaponFamilyMatch),
    },
    continuityNonResetNormal: {
      n: s.nonResetNormalN,
      leadNextFullReadyPct: pct(s.leadNextFullReady, s.nonResetNormalN),
      leadRifleOrSniperPct: pct(s.leadRifleOrSniper, s.nonResetNormalN),
      leadAvgSpend: s.nonResetNormalN === 0 ? 0 : Math.round(s.leadSpendSum / s.nonResetNormalN),
      proActualNextFullReadyPct: pct(s.actualNextFullReady, s.nonResetNormalN),
      proActualRifleOrSniperPct: pct(s.actualRifleOrSniper, s.nonResetNormalN),
      proActualAvgSpend:
        s.nonResetNormalN === 0 ? 0 : Math.round(s.actualSpendSum / s.nonResetNormalN),
    },
  };
}

function auditMechanicalInvariants(
  violations: Record<string, number>,
  res: StrategyResult,
  money: number,
  side: Side,
  inventory: InventoryState,
  lossIndex: number,
  context: RoundContext,
): void {
  const seen = new Set<string>();
  const retainedFam = familyOf(inventory.primary);
  const nextLoss = lossBonus(DEFAULT_RULES, lossIndex);

  for (const opt of res.options) {
    if (opt.spend > money) violations.over_budget++;
    if (opt.purchases.some((p) => !isItemLegalForSide(p.item, side))) violations.side_illegal++;
    const loadout = resultingLoadout(inventory, [...opt.purchases]);
    if (loadout.grenades.length > 4) violations.grenade_slots_over_4++;
    if (loadout.grenades.filter((g) => g === 'flash').length > 2) violations.flash_over_2++;
    if (loadout.grenades.filter((g) => g === 'molotov' || g === 'incendiary').length > 1)
      violations.fire_grenade_over_1++;
    if (
      (retainedFam === 'rifle' || inventory.primary === 'awp') &&
      loadout.primary !== inventory.primary
    ) {
      violations.retained_rifle_or_awp_downgrade++;
    }
    const sig = JSON.stringify(opt.purchases.map((p) => `${p.item}:${p.quantity}`).sort());
    if (seen.has(sig)) violations.duplicate_option++;
    seen.add(sig);

    if (opt.mode === 'LIGHT' && opt.protectedNextBuy && context === 'NORMAL') {
      const targetFloor =
        opt.protectedNextBuy === 'RIFLE_ARMOR_BASIC_UTILITY'
          ? side === 'CT'
            ? 4050
            : 4200
          : side === 'CT'
            ? 3550
            : 3700;
      if (money - opt.spend + nextLoss < targetFloor) {
        violations.light_breaks_protected_next_buy++;
      }
    }

    for (const alt of opt.conditionalAlternatives ?? []) {
      if (alt.spend > money) violations.conditional_alt_over_budget++;
      if (alt.purchases.some((p) => !isItemLegalForSide(p.item, side))) {
        violations.conditional_alt_illegal_or_overcap++;
      }
      const altLoadout = resultingLoadout(inventory, [...alt.purchases]);
      if (
        altLoadout.grenades.length > 4 ||
        altLoadout.grenades.filter((g) => g === 'flash').length > 2 ||
        altLoadout.grenades.filter((g) => g === 'molotov' || g === 'incendiary').length > 1
      ) {
        violations.conditional_alt_illegal_or_overcap++;
      }
      if (opt.mode === 'LIGHT' && opt.protectedNextBuy && context === 'NORMAL') {
        const targetFloor =
          opt.protectedNextBuy === 'RIFLE_ARMOR_BASIC_UTILITY'
            ? side === 'CT'
              ? 4050
              : 4200
            : side === 'CT'
              ? 3550
              : 3700;
        if (money - alt.spend + nextLoss < targetFloor) {
          violations.conditional_alt_breaks_light_floor++;
        }
      }
    }
  }
}

async function main() {
  const { event, mapsDir, outPath } = parseArgs();
  const integrity = verifyFrozenPolicyIntegrity();
  const legacy = await loadLegacyPolicyV3();
  const recommendLegacyV3 = legacy.recommend;
  try {
    const zipFiles = readdirSync(mapsDir)
      .filter((f) => f.endsWith('.zip'))
      .sort();
    if (zipFiles.length === 0) throw new Error(`No .zip files found in ${mapsDir}`);

    const manifestEntries: string[] = [];
    const prestateHashRows: string[] = [];
    const exclusions: Record<string, number> = {};
    const incExcl = (k: string) => {
      exclusions[k] = (exclusions[k] ?? 0) + 1;
    };

    type StratKey = 'B0_naive' | 'B1_standard_econ' | 'B2_legacy_v3' | 'Current_roundsense';
    const stratKeys: StratKey[] = [
      'B0_naive',
      'B1_standard_econ',
      'B2_legacy_v3',
      'Current_roundsense',
    ];
    const sliceNames = [
      'all',
      'freshBuy',
      'retainedGear',
      'ct',
      't',
      'normal',
      'postPistol',
      'overtime',
    ] as const;
    type SliceName = (typeof sliceNames)[number];

    const metrics = Object.fromEntries(
      stratKeys.map((k) => [
        k,
        Object.fromEntries(sliceNames.map((s) => [s, emptySlice()])) as Record<
          SliceName,
          SliceCounters
        >,
      ]),
    ) as Record<StratKey, Record<SliceName, SliceCounters>>;

    const makeViolationBucket = () => ({
      over_budget: 0,
      side_illegal: 0,
      grenade_slots_over_4: 0,
      flash_over_2: 0,
      fire_grenade_over_1: 0,
      retained_rifle_or_awp_downgrade: 0,
      duplicate_option: 0,
      light_breaks_protected_next_buy: 0,
      conditional_alt_over_budget: 0,
      conditional_alt_illegal_or_overcap: 0,
      conditional_alt_breaks_light_floor: 0,
    });
    const violations: Record<'B2_legacy_v3' | 'Current_roundsense', Record<string, number>> = {
      B2_legacy_v3: makeViolationBucket(),
      Current_roundsense: makeViolationBucket(),
    };

    const priceChecks = {
      akVesthelmOnly: { expected: 3700, matched: 0, total: 0 },
      m4a1sKevlarOnly: { expected: 3550, matched: 0, total: 0 },
      galilVesthelmOnly: { expected: 2800, matched: 0, total: 0 },
      mp9VesthelmOnly: { expected: 2250, matched: 0, total: 0 },
    };

    const habits = {
      ctNormal4550_4899: { n: 0, withFire: 0, withSmoke: 0, withHelmet: 0 },
      tNormal3700Plus: { n: 0, withVesthelm: 0, withKevlarOnly: 0 },
      tMid3700_4150: {
        n: 0,
        galilVesthelmUtil: 0,
        bareAkVesthelm: 0,
        akWithUtil: 0,
      },
      ctLow2000_3400: { n: 0, mp9: 0, famas: 0 },
      tFourthNade: { n: 0, hasHe: 0, hasTwoFlash: 0 },
      midMoney2000_3400: { n: 0, protectsNextFull: 0 },
      retainedPrimary: { n: 0, keptWithoutRebuy: 0 },
    };

    let rawPlayerRows = 0;
    let eligibleRows = 0;
    let freshBuyRows = 0;
    let retainedGearRows = 0;

    for (const file of zipFiles) {
      const buf = readFileSync(join(mapsDir, file));
      manifestEntries.push(`${file}:${sha256(buf)}`);
      const zip = await JSZip.loadAsync(buf);
      const roundsFile = zip.file('rounds.json');
      const econFile = zip.file('player-economies.json');
      const replayFile = zip.file('replay.json');
      if (!roundsFile || !econFile || !replayFile) continue;

      const rounds = JSON.parse(await roundsFile.async('string')) as RoundRecord[];
      const economies = JSON.parse(await econFile.async('string')) as PlayerEconRecord[];
      const replay = JSON.parse(await replayFile.async('string')) as {
        rounds: ReplayRound[];
      };

      const roundByNum = new Map(rounds.map((r) => [r.roundNumber, r]));
      const replayByNum = new Map(replay.rounds.map((r) => [r.roundNumber, r]));
      const econByRoundPlayer = new Map<string, PlayerEconRecord>();
      for (const e of economies) econByRoundPlayer.set(`${e.roundNumber}:${e.playerIndex}`, e);

      // Corpus limitation #1: rounds.json does not expose the engine's internal loss-bonus
      // counter directly, so we reconstruct it using standard MR12 win (-1) / loss (+1) stepping.
      const teamLoss = new Map<string, number>();
      let lossA = 1;
      let lossB = 1;
      for (const r of [...rounds].sort((a, b) => a.roundNumber - b.roundNumber)) {
        if (r.roundNumber === 1 || r.roundNumber === 13) {
          lossA = 1;
          lossB = 1;
        } else if (r.roundNumber > 24 && (r.roundNumber - 25) % 3 === 0) {
          lossA = 0;
          lossB = 0;
        }
        teamLoss.set(`${r.roundNumber}:teamA`, lossA);
        teamLoss.set(`${r.roundNumber}:teamB`, lossB);
        if (r.winnerTeamKey === 'teamA') {
          lossA = Math.max(0, lossA - 1);
          lossB = Math.min(4, lossB + 1);
        } else {
          lossB = Math.max(0, lossB - 1);
          lossA = Math.min(4, lossA + 1);
        }
      }

      const playersFile = zip.file('players.json');
      const playerTeam = new Map<number, 'teamA' | 'teamB'>();
      if (playersFile) {
        const players = JSON.parse(await playersFile.async('string')) as Array<{
          playerIndex?: number;
          index?: number;
          teamKey?: 'teamA' | 'teamB';
        }>;
        for (let idx = 0; idx < players.length; idx++) {
          const p = players[idx]!;
          const pi = p.playerIndex ?? p.index ?? idx;
          if (p.teamKey === 'teamA' || p.teamKey === 'teamB') playerTeam.set(pi, p.teamKey);
        }
      }

      for (const cur of economies) {
        rawPlayerRows++;
        const rInfo = roundByNum.get(cur.roundNumber);
        if (!rInfo) {
          incExcl('missing_round_info');
          continue;
        }
        const overtime = cur.roundNumber > 24;
        if (cur.roundNumber === 1 || cur.roundNumber === 13) {
          incExcl('pistol_round');
          continue;
        }
        const teamKey =
          playerTeam.get(cur.playerIndex) ?? (cur.playerIndex < 5 ? 'teamA' : 'teamB');
        const sideStr = teamKey === 'teamA' ? rInfo.teamASide : rInfo.teamBSide;
        const side: Side = sideStr === 'ct' ? 'CT' : 'T';
        const oppTeamKey = teamKey === 'teamA' ? 'teamB' : 'teamA';
        const lossIndex = teamLoss.get(`${cur.roundNumber}:${teamKey}`) ?? 1;
        const oppLossIndex = teamLoss.get(`${cur.roundNumber}:${oppTeamKey}`) ?? 1;

        const isOtReset = overtime && (cur.roundNumber - 25) % 3 === 0;
        const context: RoundContext = overtime
          ? 'OVERTIME'
          : cur.roundNumber === 2 || cur.roundNumber === 14
            ? 'POST_PISTOL'
            : 'NORMAL';

        let prestate: Prestate;
        let retainedPrimary: ItemId | null = null;
        let retainedSecondary: ItemId | undefined;
        let retainedHelmet = false;

        if (isOtReset) {
          prestate = { alive: false, armor: 0, kit: false, grenades: [] };
        } else {
          const prevReplay = replayByNum.get(cur.roundNumber - 1);
          const track = prevReplay?.players.find((p) => p.playerIndex === cur.playerIndex);
          if (!track?.flags.length || !track.armor.length || !track.grenades.length) {
            incExcl('predecision_replay_state_missing');
            continue;
          }
          const flags = track.flags.at(-1)!;
          const alive = Boolean(flags & 1);
          const prevEcon = econByRoundPlayer.get(`${cur.roundNumber - 1}:${cur.playerIndex}`);
          prestate = {
            alive,
            armor: alive ? track.armor.at(-1)! : 0,
            kit: alive ? Boolean(flags & 4) : false,
            grenades: alive ? mapGrenades(track.grenades.at(-1)!) : [],
          };
          // Corpus limitation #2: replay.json tracks only the active held weapon at round end
          // rather than full inventory, so retained primary/secondary/helmet fall back to the
          // prior round's freeze-time snapshot (large pickup jumps are filtered by >$800 delta).
          if (alive && prevEcon) {
            retainedPrimary = itemOf(prevEcon.primaryWeapon);
            retainedSecondary = itemOf(prevEcon.secondaryWeapon) ?? undefined;
            retainedHelmet = prevEcon.hasHelmet;
          }
          if (
            alive &&
            retainedPrimary &&
            cur.primaryWeapon === null &&
            cur.moneySpent >= 200 &&
            cur.moneySpent <= 800
          ) {
            incExcl('retained_primary_unknown');
            continue;
          }
        }

        const money = isOtReset ? 10_000 : cur.startMoney;
        if (money < 0 || money > 16_000 || cur.moneySpent < 0 || cur.moneySpent > money) {
          incExcl('money_out_of_range');
          continue;
        }

        const coherent = utilityStateIsCoherent(cur, side, prestate, money);
        if (!coherent.ok) {
          incExcl(coherent.reason ?? 'utility_state_ambiguous');
          continue;
        }

        const inventory: InventoryState = {
          primary: retainedPrimary,
          secondary: retainedSecondary,
          armor: prestate.armor,
          hasHelmet: prestate.alive && retainedHelmet,
          hasDefuseKit: prestate.kit,
          grenades: prestate.grenades,
        };

        const curPrimary = itemOf(cur.primaryWeapon);
        const curGrenades = mapGrenades(cur.grenades);
        const resultingInv: InventoryState = {
          primary: curPrimary,
          secondary: itemOf(cur.secondaryWeapon) ?? undefined,
          armor: cur.hasArmor ? 100 : 0,
          hasHelmet: cur.hasHelmet,
          hasDefuseKit: cur.hasDefuseKit,
          grenades: curGrenades,
        };

        const estRetained = estimateGearValue(inventory);
        const estResulting = estimateGearValue(resultingInv);
        const newValue = Math.max(0, estResulting - estRetained);
        if (!isOtReset) {
          if (cur.moneySpent > newValue + 800) {
            incExcl('drop_gave');
            continue;
          }
          if (newValue > cur.moneySpent + 800) {
            incExcl('drop_received');
            continue;
          }
        }

        eligibleRows++;
        const isFresh =
          inventory.primary === null &&
          inventory.armor === 0 &&
          !inventory.hasDefuseKit &&
          inventory.grenades.length === 0;
        if (isFresh) freshBuyRows++;
        else retainedGearRows++;

        if (!isOtReset) {
          prestateHashRows.push(
            [
              file,
              cur.roundNumber,
              cur.playerIndex,
              Number(prestate.alive),
              prestate.armor,
              Number(prestate.kit),
              prestate.grenades.join(','),
            ].join(':'),
          );
        }

        if (isFresh && curGrenades.length === 0 && !cur.hasDefuseKit) {
          const defaultSec =
            cur.secondaryWeapon === 'Glock-18' ||
            cur.secondaryWeapon === 'USP-S' ||
            cur.secondaryWeapon === 'P2000' ||
            cur.secondaryWeapon === null;
          if (defaultSec) {
            if (curPrimary === 'ak47' && cur.hasArmor && cur.hasHelmet) {
              priceChecks.akVesthelmOnly.total++;
              if (cur.moneySpent === 3700) priceChecks.akVesthelmOnly.matched++;
            } else if (curPrimary === 'm4a1s' && cur.hasArmor && !cur.hasHelmet) {
              priceChecks.m4a1sKevlarOnly.total++;
              if (cur.moneySpent === 3550) priceChecks.m4a1sKevlarOnly.matched++;
            } else if (curPrimary === 'galil' && cur.hasArmor && cur.hasHelmet) {
              priceChecks.galilVesthelmOnly.total++;
              if (cur.moneySpent === 2800) priceChecks.galilVesthelmOnly.matched++;
            } else if (curPrimary === 'mp9' && cur.hasArmor && cur.hasHelmet) {
              priceChecks.mp9VesthelmOnly.total++;
              if (cur.moneySpent === 2250) priceChecks.mp9VesthelmOnly.matched++;
            }
          }
        }

        if (isFresh && context === 'NORMAL') {
          if (side === 'CT' && money >= 4550 && money <= 4899) {
            habits.ctNormal4550_4899.n++;
            if (curGrenades.includes('incendiary')) habits.ctNormal4550_4899.withFire++;
            if (curGrenades.includes('smoke')) habits.ctNormal4550_4899.withSmoke++;
            if (cur.hasHelmet) habits.ctNormal4550_4899.withHelmet++;
          }
          if (side === 'T' && money >= 3700) {
            habits.tNormal3700Plus.n++;
            if (cur.hasHelmet) habits.tNormal3700Plus.withVesthelm++;
            else if (cur.hasArmor) habits.tNormal3700Plus.withKevlarOnly++;
          }
          if (side === 'T' && money >= 3700 && money <= 4150) {
            habits.tMid3700_4150.n++;
            if (curPrimary === 'galil' && cur.hasHelmet && curGrenades.length >= 2) {
              habits.tMid3700_4150.galilVesthelmUtil++;
            } else if (curPrimary === 'ak47' && cur.hasHelmet && curGrenades.length === 0) {
              habits.tMid3700_4150.bareAkVesthelm++;
            } else if (curPrimary === 'ak47' && curGrenades.length >= 1) {
              habits.tMid3700_4150.akWithUtil++;
            }
          }
          if (side === 'CT' && money >= 2000 && money <= 3400) {
            habits.ctLow2000_3400.n++;
            if (curPrimary === 'mp9') habits.ctLow2000_3400.mp9++;
            if (curPrimary === 'famas') habits.ctLow2000_3400.famas++;
          }
          if (side === 'T' && curGrenades.length >= 4) {
            habits.tFourthNade.n++;
            if (curGrenades.includes('he')) habits.tFourthNade.hasHe++;
            if (curGrenades.filter((g) => g === 'flash').length >= 2)
              habits.tFourthNade.hasTwoFlash++;
          }
          if (money >= 2000 && money <= 3400) {
            habits.midMoney2000_3400.n++;
            const nextLoss = lossBonus(DEFAULT_RULES, lossIndex);
            const nextFloor = side === 'CT' ? 4050 : 4200;
            if (money - cur.moneySpent + nextLoss >= nextFloor) {
              habits.midMoney2000_3400.protectsNextFull++;
            }
          }
        }
        if (
          inventory.primary &&
          (familyOf(inventory.primary) === 'rifle' || familyOf(inventory.primary) === 'smg')
        ) {
          habits.retainedPrimary.n++;
          if (curPrimary === inventory.primary) habits.retainedPrimary.keptWithoutRebuy++;
        }

        const prevRound = roundByNum.get(cur.roundNumber - 1);
        const pistolWinner =
          context === 'POST_PISTOL' && prevRound ? prevRound.winnerTeamKey === teamKey : null;
        const score =
          rInfo.teamASide === 'ct'
            ? { ct: rInfo.teamAScoreBefore, t: rInfo.teamBScoreBefore }
            : { ct: rInfo.teamBScoreBefore, t: rInfo.teamAScoreBefore };
        const obs = <T>(value: T, source: string) => ({
          status: 'OBSERVED' as const,
          value,
          source,
          asOfSeq: 1,
        });
        const opponentSide: Side = side === 'CT' ? 'T' : 'CT';
        const ownLossFact = obs(
          Math.max(0, Math.min(4, lossIndex)),
          'own consecutive_round_losses',
        );
        const oppLossFact = obs(
          Math.max(0, Math.min(4, oppLossIndex)),
          'opponent consecutive_round_losses',
        );
        const opponent = inferOpponentEconomy({
          asOfSeq: 1,
          opponentSide: obs(opponentSide, 'opponent side inferred from player.team'),
          roundNumber: obs(cur.roundNumber, 'map.round'),
          score: obs(score, 'map.team_*.score'),
          opponentLossIndex: oppLossFact,
        });

        const state: PolicyV3State = {
          round: {
            number: obs(cur.roundNumber, 'map.round'),
            phase: obs('freezetime', 'round.phase'),
            side: obs(side, 'player.team'),
            score: obs(score, 'map.team_*.score'),
            context: obs(context, 'map.round'),
          },
          player: {
            money: obs(money, 'player.state.money'),
            lossIndex: ownLossFact,
            inventory: obs(inventory, 'player.state + player.weapons'),
          },
          teamLoss:
            side === 'CT'
              ? { ct: ownLossFact, t: oppLossFact }
              : { ct: oppLossFact, t: ownLossFact },
          history:
            context === 'POST_PISTOL' && prevRound
              ? {
                  integrity: 'COMPLETE',
                  previousRounds: [
                    {
                      roundNumber: cur.roundNumber - 1,
                      winner: obs(prevRound.winnerSide === 'ct' ? 'CT' : 'T', 'prior-round winner'),
                      planted: {
                        status: 'UNKNOWN',
                        source: 'replay',
                        asOfSeq: 1,
                      },
                    },
                  ],
                }
              : { integrity: 'COMPLETE', previousRounds: [] },
          opponent,
          preference: { source: 'DEFAULT', awpPriority: 'NEUTRAL' },
        };

        const b0 = runB0Naive(money, side, inventory);
        const b1 = runB1StandardEcon(money, side, inventory, lossIndex, context, pistolWinner);
        const b2 = wrapPolicyV3Output(recommendLegacyV3(state), inventory);
        const current = wrapPolicyV3Output(recommendPolicyV3(state), inventory);

        auditMechanicalInvariants(
          violations.B2_legacy_v3,
          b2,
          money,
          side,
          inventory,
          lossIndex,
          context,
        );
        auditMechanicalInvariants(
          violations.Current_roundsense,
          current,
          money,
          side,
          inventory,
          lossIndex,
          context,
        );

        const oppScore = side === 'CT' ? score.t : score.ct;
        const isResetRound =
          cur.roundNumber === 12 ||
          cur.roundNumber === 24 ||
          (cur.roundNumber > 24 && (cur.roundNumber - 24) % 3 === 0) ||
          (context === 'NORMAL' && oppScore >= 12);
        const actual = {
          spend: cur.moneySpent,
          primaryFamily: familyOf(curPrimary),
          hasArmor: cur.hasArmor,
          hasHelmet: cur.hasHelmet,
          side,
          context,
          money,
          lossIndex,
          isResetRound,
        };

        const targetSlices: SliceName[] = [
          'all',
          isFresh ? 'freshBuy' : 'retainedGear',
          side === 'CT' ? 'ct' : 't',
          context === 'NORMAL' ? 'normal' : context === 'POST_PISTOL' ? 'postPistol' : 'overtime',
        ];

        const resultsByStrat: Record<StratKey, StrategyResult> = {
          B0_naive: b0,
          B1_standard_econ: b1,
          B2_legacy_v3: b2,
          Current_roundsense: current,
        };

        for (const sk of stratKeys) {
          for (const sl of targetSlices) {
            recordSlice(metrics[sk][sl], resultsByStrat[sk], actual);
          }
        }
      }
    }

    const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);
    const report = {
      event,
      generatedAt: new Date().toISOString(),
      methodology: {
        pipeline:
          'replay.json end-of-round state recovery + utility coherence + drop/pickup exclusion',
        frozenCurrentPolicyCommit: 'dc1c84a',
        legacyPolicyCommit: LEGACY_V3_COMMIT,
        corpusMaps: zipFiles.length,
        corpusManifestSha256: sha256(manifestEntries.join('\n')),
        replayPrestateSha256: sha256(prestateHashRows.sort().join('\n')),
      },
      eligibilityAudit: {
        rawPlayerRows,
        eligibleRows,
        freshBuyRows,
        retainedGearRows,
        exclusions,
      },
      economyRuleSanity: Object.fromEntries(
        Object.entries(priceChecks).map(([k, v]) => [
          k,
          { ...v, matchRatePct: pct(v.matched, v.total) },
        ]),
      ),
      mechanicalViolations: {
        B2_legacy_v3: {
          total: Object.values(violations.B2_legacy_v3).reduce((a, b) => a + b, 0),
          breakdown: violations.B2_legacy_v3,
        },
        Current_roundsense: {
          total: Object.values(violations.Current_roundsense).reduce((a, b) => a + b, 0),
          breakdown: violations.Current_roundsense,
        },
      },
      strategies: Object.fromEntries(
        stratKeys.map((sk) => [
          sk,
          Object.fromEntries(sliceNames.map((sl) => [sl, summarizeSlice(metrics[sk][sl])])),
        ]),
      ),
      proBuyingHabits: {
        ctNormal4550_4899_utilVsHelmet: {
          n: habits.ctNormal4550_4899.n,
          firePct: pct(habits.ctNormal4550_4899.withFire, habits.ctNormal4550_4899.n),
          smokePct: pct(habits.ctNormal4550_4899.withSmoke, habits.ctNormal4550_4899.n),
          helmetPct: pct(habits.ctNormal4550_4899.withHelmet, habits.ctNormal4550_4899.n),
        },
        tNormal3700Plus_vesthelmPriority: {
          n: habits.tNormal3700Plus.n,
          vesthelmPct: pct(habits.tNormal3700Plus.withVesthelm, habits.tNormal3700Plus.n),
          kevlarOnlyPct: pct(habits.tNormal3700Plus.withKevlarOnly, habits.tNormal3700Plus.n),
        },
        tMid3700_4150_galilUtilVsBareAk: {
          n: habits.tMid3700_4150.n,
          galilVesthelmUtilPct: pct(habits.tMid3700_4150.galilVesthelmUtil, habits.tMid3700_4150.n),
          bareAkVesthelmPct: pct(habits.tMid3700_4150.bareAkVesthelm, habits.tMid3700_4150.n),
          akWithUtilPct: pct(habits.tMid3700_4150.akWithUtil, habits.tMid3700_4150.n),
        },
        ctLow2000_3400_mp9VsFamas: {
          n: habits.ctLow2000_3400.n,
          mp9Pct: pct(habits.ctLow2000_3400.mp9, habits.ctLow2000_3400.n),
          famasPct: pct(habits.ctLow2000_3400.famas, habits.ctLow2000_3400.n),
        },
        tFourthNade_heVsDoubleFlash: {
          n: habits.tFourthNade.n,
          hePct: pct(habits.tFourthNade.hasHe, habits.tFourthNade.n),
          doubleFlashPct: pct(habits.tFourthNade.hasTwoFlash, habits.tFourthNade.n),
        },
        midMoney2000_3400_nextFullProtection: {
          n: habits.midMoney2000_3400.n,
          protectsNextFullPct: pct(
            habits.midMoney2000_3400.protectsNextFull,
            habits.midMoney2000_3400.n,
          ),
        },
        retainedPrimary_keepRate: {
          n: habits.retainedPrimary.n,
          keptWithoutRebuyPct: pct(
            habits.retainedPrimary.keptWithoutRebuy,
            habits.retainedPrimary.n,
          ),
        },
      },
    };

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(
      '[' +
        event +
        '] maps=' +
        zipFiles.length +
        ' eligible=' +
        eligibleRows +
        ' (fresh=' +
        freshBuyRows +
        ', retained=' +
        retainedGearRows +
        ')',
    );
    console.log(
      '  manifest_sha256=' + report.methodology.corpusManifestSha256.slice(0, 16) + '...',
    );
    console.log('  violations:', JSON.stringify(report.mechanicalViolations));
    for (const sl of ['all', 'freshBuy', 'retainedGear'] as const) {
      console.log(`  === ${sl} ===`);
      for (const sk of stratKeys) {
        const m = report.strategies[sk][sl];
        console.log(
          '    ' +
            sk.padEnd(20) +
            ' leadMAE=$' +
            String(m.lead.spendMae).padEnd(4) +
            ' fam=' +
            String(m.lead.weaponFamilyMatchPct).padEnd(5) +
            '% <=400=' +
            String(m.lead.within400Pct).padEnd(5) +
            '% ctHelm=' +
            String(m.lead.ctNormalHelmetMatchPct).padEnd(5) +
            '% | set<=400=' +
            String(m.optionSet.within400Pct).padEnd(5) +
            '% avgOpt=' +
            m.avgOptions,
        );
      }
    }
  } finally {
    legacy.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
