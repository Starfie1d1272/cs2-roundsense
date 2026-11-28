/**
 * Reproducible offline freeze-time decision replay benchmark on IEM Cologne Major 2026.
 *
 * Compares:
 *   1. Naive buy-what-you-can baseline (no next-round economy awareness, always buys highest affordable weapon)
 *   2. RoundSense unified Policy V3 (normal-player GSI inputs only)
 * against actual pro freeze-time purchases across 202 tournament maps (both fresh-buy and retained-gear rounds).
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/cologne-replay-benchmark.ts \
 *     --maps /path/to/cologne/maps \
 *     --out docs/data/cologne-replay-benchmark.json
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import {
  DEFAULT_RULES,
  isItemLegalForSide,
  MAX_GRENADE_CARRY,
  planPurchases,
  recommendPolicyV3,
  resultingLoadout,
  rifleFor,
  smgFor,
  type InventoryState,
  type PolicyV3State,
  type PurchaseItem,
} from '../packages/economy-advisor/src/index.js';
import type { ItemId, Side } from '../packages/shared-types/src/index.js';

const DEMO_TO_ITEM: Readonly<Record<string, ItemId>> = {
  'AK-47': 'ak47',
  M4A4: 'm4a4',
  'M4A1-S': 'm4a1s',
  'Galil AR': 'galil',
  FAMAS: 'famas',
  'SG 553': 'sg553',
  AUG: 'aug',
  'SSG 08': 'ssg08',
  AWP: 'awp',
  'SCAR-20': 'scar20',
  G3SG1: 'g3sg1',
  'MAC-10': 'mac10',
  MP9: 'mp9',
  MP7: 'mp7',
  'MP5-SD': 'mp5sd',
  'UMP-45': 'ump45',
  P90: 'p90',
  'PP-Bizon': 'bizon',
  Nova: 'nova',
  XM1014: 'xm1014',
  'Sawed-Off': 'sawedoff',
  'MAG-7': 'mag7',
  M249: 'm249',
  Negev: 'negev',
  'Glock-18': 'glock',
  'USP-S': 'usp',
  P2000: 'p2000',
  'Dual Berettas': 'dual',
  'Tec-9': 'tec9',
  'CZ75-Auto': 'cz75',
  'Five-SeveN': 'fiveseven',
  'Desert Eagle': 'deagle',
  'R8 Revolver': 'r8',
};

const DEMO_NADE: Readonly<Record<string, ItemId>> = {
  flashbang: 'flash',
  smoke: 'smoke',
  hegrenade: 'he',
  molotov: 'molotov',
  incendiary: 'incendiary',
  decoy: 'decoy',
};

function weaponFamily(item: ItemId | null | undefined): string {
  if (!item) return 'none';
  if (['ak47', 'm4a4', 'm4a1s', 'aug', 'sg553'].includes(item)) return 'main_rifle';
  if (['galil', 'famas'].includes(item)) return 'eco_rifle';
  if (item === 'awp') return 'awp';
  if (['mp9', 'mac10', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon'].includes(item)) return 'smg';
  return 'other';
}

function compact(items: readonly ItemId[]): PurchaseItem[] {
  const m = new Map<ItemId, number>();
  for (const item of items) m.set(item, (m.get(item) ?? 0) + 1);
  return [...m].map(([item, quantity]) => ({ item, quantity }));
}

/**
 * Simple buy-what-you-can baseline: always buys the highest affordable weapon + vesthelm
 * (falling back to kevlar) + greedy utility, with no next-round economy awareness.
 */
function naiveBuy(
  side: Side,
  inventory: InventoryState,
  money: number,
): {
  spend: number;
  primary: ItemId | null;
  hasHelmet: boolean;
  nadeCount: number;
  summary: string;
} {
  const pistol: ItemId = side === 'T' ? 'tec9' : 'fiveseven';
  const weaponLadder: ItemId[] = [rifleFor(side), smgFor(side), pistol];
  let bestPurchases: PurchaseItem[] = [];
  let bestSpend = 0;

  for (const weapon of weaponLadder) {
    for (const armor of ['kevlar_helmet', 'kevlar'] as const) {
      const core = planPurchases(inventory, compact([weapon, armor]), DEFAULT_RULES, side);
      if (core.isComplete && core.totalCost <= money) {
        const items: ItemId[] = [weapon, armor];
        let spend = core.totalCost;
        let purchases = core.purchases;
        const nades: ItemId[] =
          side === 'CT'
            ? ['smoke', 'incendiary', 'he', 'flash']
            : ['smoke', 'molotov', 'flash', 'he'];
        for (const n of nades) {
          const next = planPurchases(inventory, compact([...items, n]), DEFAULT_RULES, side);
          const nextOut = resultingLoadout(inventory, next.purchases);
          if (
            next.isComplete &&
            next.totalCost <= money &&
            nextOut.grenades.length <= MAX_GRENADE_CARRY
          ) {
            items.push(n);
            spend = next.totalCost;
            purchases = next.purchases;
          }
        }
        bestPurchases = purchases;
        bestSpend = spend;
        const out = resultingLoadout(inventory, bestPurchases);
        return {
          spend: bestSpend,
          primary: out.primary,
          hasHelmet: out.hasHelmet,
          nadeCount: out.grenades.length,
          summary: bestPurchases
            .map((p) => (p.quantity > 1 ? `${p.item}x${p.quantity}` : p.item))
            .join('+'),
        };
      }
    }
  }
  const out = resultingLoadout(inventory, bestPurchases);
  return {
    spend: bestSpend,
    primary: out.primary,
    hasHelmet: out.hasHelmet,
    nadeCount: out.grenades.length,
    summary: 'hold',
  };
}

interface BucketMetrics {
  n: number;
  spendAbsErr: number;
  exact: number;
  within200: number;
  within400: number;
  within800: number;
  within1000: number;
  setWithin400: number;
  weaponFamMatch: number;
  helmetMatch: number;
  nadeCountAbsErr: number;
  totalOptions: number;
  overBudget: number;
  illegalItem: number;
  overNadeCap: number;
  duplicateOptions: number;
}

function createBucket(): BucketMetrics {
  return {
    n: 0,
    spendAbsErr: 0,
    exact: 0,
    within200: 0,
    within400: 0,
    within800: 0,
    within1000: 0,
    setWithin400: 0,
    weaponFamMatch: 0,
    helmetMatch: 0,
    nadeCountAbsErr: 0,
    totalOptions: 0,
    overBudget: 0,
    illegalItem: 0,
    overNadeCap: 0,
    duplicateOptions: 0,
  };
}

function recordPrimary(
  b: BucketMetrics,
  actualSpend: number,
  actualPrimary: ItemId | null,
  actualHelmet: boolean,
  actualNades: number,
  predSpend: number,
  predPrimary: ItemId | null,
  predHelmet: boolean,
  predNades: number,
  setWithin400: boolean,
  optionCount: number,
) {
  b.n += 1;
  const err = Math.abs(predSpend - actualSpend);
  b.spendAbsErr += err;
  if (err === 0) b.exact += 1;
  if (err <= 200) b.within200 += 1;
  if (err <= 400) b.within400 += 1;
  if (err <= 800) b.within800 += 1;
  if (err <= 1000) b.within1000 += 1;
  if (setWithin400) b.setWithin400 += 1;
  if (weaponFamily(predPrimary) === weaponFamily(actualPrimary)) b.weaponFamMatch += 1;
  if (predHelmet === actualHelmet) b.helmetMatch += 1;
  b.nadeCountAbsErr += Math.abs(predNades - actualNades);
  b.totalOptions += optionCount;
}

function summarize(b: BucketMetrics) {
  const pct = (v: number) => Number(((v / Math.max(1, b.n)) * 100).toFixed(1));
  return {
    n: b.n,
    primarySpendMae: Math.round(b.spendAbsErr / Math.max(1, b.n)),
    primaryErrorCoveragePct: {
      exact: pct(b.exact),
      within200: pct(b.within200),
      within400: pct(b.within400),
      within800: pct(b.within800),
      within1000: pct(b.within1000),
    },
    setWithin400Pct: pct(b.setWithin400),
    weaponFamilyMatchPct: pct(b.weaponFamMatch),
    helmetMatchPct: pct(b.helmetMatch),
    utilityCountMae: Number((b.nadeCountAbsErr / Math.max(1, b.n)).toFixed(2)),
    avgOptions: Number((b.totalOptions / Math.max(1, b.n)).toFixed(2)),
    mechanicalViolations: {
      overBudget: b.overBudget,
      illegalItem: b.illegalItem,
      overNadeCap: b.overNadeCap,
      duplicateOptions: b.duplicateOptions,
    },
  };
}

interface RealCase {
  category: string;
  map: string;
  roundNumber: number;
  player: string;
  side: Side;
  startMoney: number;
  retained: string;
  proActual: { spend: number; primary: string; helmet: boolean; nades: number };
  roundSense: { mode: string; spend: number; purchases: string; optionCount: number };
  naive: { spend: number; summary: string };
}

function parseArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1]! : fallback;
}

const mapsDir = resolve(
  parseArg(
    '--maps',
    '/Users/starfie1d/GitHub/cs2-demo-analysis-kit/fixtures/_bench/map-control-reference/maps',
  ),
);
const outPath = resolve(parseArg('--out', 'docs/data/cologne-replay-benchmark.json'));

const files = readdirSync(mapsDir)
  .filter((f) => f.endsWith('.zip'))
  .sort();

const rsAll = createBucket();
const rsCt = createBucket();
const rsT = createBucket();
const rsFresh = createBucket();
const rsRetained = createBucket();

const naiveAll = createBucket();
const naiveCt = createBucket();
const naiveT = createBucket();
const naiveFresh = createBucket();
const naiveRetained = createBucket();

const cases: Record<string, RealCase | null> = {
  t_galil_over_bare_ak: null,
  ct_utility_over_helmet: null,
  ct_light_save_discipline: null,
  retained_gear_topup: null,
  honest_divergence_eco_force: null,
};

for (const f of files) {
  const zip = await JSZip.loadAsync(readFileSync(join(mapsDir, f)));
  const players = JSON.parse(await zip.file('players.json')!.async('string')) as Array<{
    name: string;
    teamKey: string;
  }>;
  const rounds = JSON.parse(await zip.file('rounds.json')!.async('string')) as Array<any>;
  const pe = JSON.parse(await zip.file('player-economies.json')!.async('string')) as Array<any>;
  const kills = JSON.parse(await zip.file('kills.json')!.async('string')) as Array<any>;

  const rInfo = new Map<number, any>();
  for (const r of rounds) rInfo.set(r.roundNumber, r);
  const died = new Set<string>();
  for (const k of kills) {
    if (k.roundNumber != null && k.victimIndex != null)
      died.add(`${k.roundNumber}:${k.victimIndex}`);
  }

  const lossIdx = new Map<string, number>();
  for (const [start, end] of [
    [1, 12],
    [13, 24],
  ] as const) {
    const streak = { CT: 1, T: 1 };
    for (let rn = start; rn <= end; rn++) {
      const r = rInfo.get(rn);
      if (!r) break;
      lossIdx.set(`${rn}:CT`, streak.CT);
      lossIdx.set(`${rn}:T`, streak.T);
      const w = (r.winnerSide || '').toUpperCase();
      if (w === 'CT') {
        streak.CT = Math.max(0, streak.CT - 1);
        streak.T = Math.min(4, streak.T + 1);
      } else if (w === 'T') {
        streak.T = Math.max(0, streak.T - 1);
        streak.CT = Math.min(4, streak.CT + 1);
      }
    }
  }

  const peMap = new Map<string, any>();
  for (const row of pe) peMap.set(`${row.roundNumber}:${row.playerIndex}`, row);

  const mapName =
    f
      .replace(/\.zip$/, '')
      .split('-')
      .at(-1) ?? f;

  for (const row of pe) {
    const rn: number = row.roundNumber;
    if (rn === 1 || rn === 13 || rn > 24) continue;
    const r = rInfo.get(rn);
    if (!r) continue;
    const pInfo = players[row.playerIndex];
    if (!pInfo) continue;
    const side: Side | null =
      pInfo.teamKey === 'teamA'
        ? (r.teamASide.toUpperCase() as Side)
        : pInfo.teamKey === 'teamB'
          ? (r.teamBSide.toUpperCase() as Side)
          : null;
    if (!side) continue;

    const prevDied = died.has(`${rn - 1}:${row.playerIndex}`);
    const prevRow = peMap.get(`${rn - 1}:${row.playerIndex}`);

    let inv: InventoryState;
    if (prevDied) {
      // Fresh-buy: exclude drop distortion
      if (Math.abs(row.equipmentValue - 200 - row.moneySpent) > 250) continue;
      inv = { primary: null, armor: 0, hasHelmet: false, hasDefuseKit: false, grenades: [] };
    } else if (prevRow) {
      // Retained-gear round: reconstruct pre-buy inventory from previous round end state
      const prevPrim = prevRow.primaryWeapon ? (DEMO_TO_ITEM[prevRow.primaryWeapon] ?? null) : null;
      const prevNades = ((prevRow.grenades || []) as string[])
        .map((g) => DEMO_NADE[g.toLowerCase()])
        .filter((x): x is ItemId => Boolean(x));
      // Exclude obvious dropped weapons given/received
      if (prevRow.equipmentValue + row.moneySpent - row.equipmentValue > 1200) continue;
      inv = {
        primary: prevPrim,
        armor: prevRow.hasArmor ? 100 : 0,
        hasHelmet: Boolean(prevRow.hasHelmet),
        hasDefuseKit: Boolean(prevRow.hasDefuseKit),
        grenades: prevNades.slice(0, MAX_GRENADE_CARRY),
      };
    } else {
      continue;
    }

    const context = rn === 2 || rn === 14 ? 'POST_PISTOL' : 'NORMAL';
    const prevR = rInfo.get(rn - 1);
    const prevWinner = prevR?.winnerSide ? (prevR.winnerSide.toUpperCase() as Side) : undefined;
    const li = lossIdx.get(`${rn}:${side}`) ?? 1;

    const state: PolicyV3State = {
      round: {
        number: { status: 'OBSERVED', value: rn, source: 'demo', asOfSeq: rn },
        phase: { status: 'OBSERVED', value: 'freezetime', source: 'demo', asOfSeq: rn },
        side: { status: 'OBSERVED', value: side, source: 'demo', asOfSeq: rn },
        score: {
          status: 'OBSERVED',
          value: {
            ct: r.teamASide === 'ct' ? r.teamAScoreBefore : r.teamBScoreBefore,
            t: r.teamASide === 't' ? r.teamAScoreBefore : r.teamBScoreBefore,
          },
          source: 'demo',
          asOfSeq: rn,
        },
        context: { status: 'OBSERVED', value: context, source: 'demo', asOfSeq: rn },
      },
      player: {
        money: { status: 'OBSERVED', value: row.startMoney, source: 'demo', asOfSeq: rn },
        lossIndex: { status: 'TRACKED', value: li, source: 'demo', asOfSeq: rn },
        inventory: { status: 'OBSERVED', value: inv, source: 'demo', asOfSeq: rn },
      },
      teamLoss: {
        ct: { status: 'TRACKED', value: lossIdx.get(`${rn}:CT`) ?? 1, source: 'demo', asOfSeq: rn },
        t: { status: 'TRACKED', value: lossIdx.get(`${rn}:T`) ?? 1, source: 'demo', asOfSeq: rn },
      },
      history: {
        integrity: prevWinner ? 'COMPLETE' : 'PARTIAL',
        previousRounds: prevWinner
          ? [
              {
                roundNumber: rn - 1,
                winner: { status: 'OBSERVED', value: prevWinner, source: 'demo', asOfSeq: rn },
                planted: { status: 'OBSERVED', value: false, source: 'demo', asOfSeq: rn },
              },
            ]
          : [],
      },
      opponent: { status: 'UNKNOWN', inputsAsOfSeq: rn, reason: 'normal GSI' },
      preference: { source: 'DEFAULT', awpPriority: 'NEUTRAL' },
    };

    const out = recommendPolicyV3(state);
    if (out.status !== 'READY' || out.options.length === 0) continue;

    const actualPrimary = row.primaryWeapon ? (DEMO_TO_ITEM[row.primaryWeapon] ?? null) : null;
    const actualNades = ((row.grenades || []) as string[])
      .map((g) => DEMO_NADE[g.toLowerCase()])
      .filter(Boolean).length;
    const actualHelmet = Boolean(row.hasHelmet);

    // Mechanical checks on all RoundSense options
    const sigs = new Set<string>();
    const hasFull = out.options.some((o) => o.mode === 'FULL');
    for (const opt of out.options) {
      if (opt.bundleSpend > row.startMoney) rsAll.overBudget += 1;
      if (
        opt.resultingInventory.grenades.length > MAX_GRENADE_CARRY ||
        opt.resultingInventory.grenades.filter((g) => g === 'flash').length > 2
      ) {
        rsAll.overNadeCap += 1;
      }
      for (const p of opt.purchases) {
        if (!isItemLegalForSide(p.item, side)) rsAll.illegalItem += 1;
      }
      const sig = [...opt.purchases]
        .sort((a, b) => a.item.localeCompare(b.item))
        .map((p) => `${p.item}:${p.quantity}`)
        .join(',');
      if (sigs.has(sig) && !(opt.mode === 'PRESERVE' && hasFull)) rsAll.duplicateOptions += 1;
      sigs.add(sig);
    }

    const rsPrimary = out.options[0]!;
    const rsSetWithin400 = out.options.some((o) => Math.abs(o.bundleSpend - row.moneySpent) <= 400);
    const nv = naiveBuy(side, inv, row.startMoney);

    const recordBoth = (rsB: BucketMetrics, nvB: BucketMetrics) => {
      recordPrimary(
        rsB,
        row.moneySpent,
        actualPrimary,
        actualHelmet,
        actualNades,
        rsPrimary.bundleSpend,
        rsPrimary.resultingInventory.primary,
        rsPrimary.resultingInventory.hasHelmet,
        rsPrimary.resultingInventory.grenades.length,
        rsSetWithin400,
        out.options.length,
      );
      recordPrimary(
        nvB,
        row.moneySpent,
        actualPrimary,
        actualHelmet,
        actualNades,
        nv.spend,
        nv.primary,
        nv.hasHelmet,
        nv.nadeCount,
        Math.abs(nv.spend - row.moneySpent) <= 400,
        1,
      );
    };

    recordBoth(rsAll, naiveAll);
    if (side === 'CT') recordBoth(rsCt, naiveCt);
    else recordBoth(rsT, naiveT);
    if (prevDied) recordBoth(rsFresh, naiveFresh);
    else recordBoth(rsRetained, naiveRetained);

    // Collect 5 representative real pro round cases (including 1 honest divergence)
    const fmtPurchases = (ps: readonly PurchaseItem[]) =>
      ps.map((p) => (p.quantity > 1 ? `${p.item}x${p.quantity}` : p.item)).join('+') || 'hold';
    const makeCase = (category: string): RealCase => ({
      category,
      map: mapName,
      roundNumber: rn,
      player: pInfo.name,
      side,
      startMoney: row.startMoney,
      retained: prevDied
        ? 'empty'
        : `${inv.primary ?? 'none'}+${inv.hasHelmet ? 'VH' : inv.armor > 0 ? 'K' : 'noArmor'}`,
      proActual: {
        spend: row.moneySpent,
        primary: row.primaryWeapon ?? row.secondaryWeapon ?? 'default',
        helmet: actualHelmet,
        nades: actualNades,
      },
      roundSense: {
        mode: rsPrimary.mode,
        spend: rsPrimary.bundleSpend,
        purchases: fmtPurchases(rsPrimary.purchases),
        optionCount: out.options.length,
      },
      naive: { spend: nv.spend, summary: nv.summary },
    });

    if (
      !cases.t_galil_over_bare_ak &&
      prevDied &&
      context === 'NORMAL' &&
      side === 'T' &&
      row.startMoney >= 3800 &&
      row.startMoney <= 4100 &&
      actualPrimary === 'galil' &&
      rsPrimary.resultingInventory.primary === 'galil' &&
      nv.primary === 'ak47' &&
      Math.abs(rsPrimary.bundleSpend - row.moneySpent) <= 200
    ) {
      cases.t_galil_over_bare_ak = makeCase('T Galil+道具 优于裸 AK');
    }

    if (
      !cases.ct_utility_over_helmet &&
      prevDied &&
      context === 'NORMAL' &&
      side === 'CT' &&
      row.startMoney >= 4600 &&
      row.startMoney <= 4850 &&
      (actualPrimary === 'm4a1s' || actualPrimary === 'm4a4') &&
      !actualHelmet &&
      actualNades >= 3 &&
      !rsPrimary.resultingInventory.hasHelmet &&
      nv.hasHelmet &&
      Math.abs(rsPrimary.bundleSpend - row.moneySpent) <= 200
    ) {
      cases.ct_utility_over_helmet = makeCase('CT 常规局道具优先于头盔');
    }

    if (
      !cases.ct_light_save_discipline &&
      prevDied &&
      context === 'NORMAL' &&
      side === 'CT' &&
      row.startMoney >= 2200 &&
      row.startMoney <= 3200 &&
      row.moneySpent > 0 &&
      row.moneySpent <= 1300 &&
      rsPrimary.mode === 'LIGHT' &&
      Math.abs(rsPrimary.bundleSpend - row.moneySpent) <= 200 &&
      nv.spend >= 2000
    ) {
      cases.ct_light_save_discipline = makeCase('半起保下局经济 vs 简单策略无脑花光');
    }

    if (
      !cases.retained_gear_topup &&
      !prevDied &&
      context === 'NORMAL' &&
      side === 'CT' &&
      (inv.primary === 'm4a1s' || inv.primary === 'm4a4') &&
      inv.armor > 0 &&
      !inv.hasHelmet &&
      row.startMoney >= 3500 &&
      row.startMoney <= 5000 &&
      rsPrimary.mode === 'FULL' &&
      Math.abs(rsPrimary.bundleSpend - row.moneySpent) <= 200
    ) {
      cases.retained_gear_topup = makeCase('保枪增量补齐装备');
    }

    if (
      !cases.honest_divergence_eco_force &&
      prevDied &&
      context === 'NORMAL' &&
      side === 'T' &&
      row.startMoney >= 3000 &&
      row.startMoney <= 3600 &&
      row.moneySpent <= 200 &&
      rsPrimary.mode === 'FORCE' &&
      rsPrimary.bundleSpend >= 2800
    ) {
      cases.honest_divergence_eco_force = makeCase('真实差异案例：队伍协同 ECO vs 单人可见信息');
    }
  }
}

const report = {
  corpus: 'IEM Cologne Major 2026 (202 maps, cs2df v3.1.0 / demoparser2 0.41.3)',
  methodology:
    'Offline freeze-time replay using normal-player GSI observable fields only (excludes pistol rounds, overtime, and weapon-drop outliers). Historical replay validation on the study corpus, not an out-of-sample win-rate proof.',
  mapsEvaluated: files.length,
  subsets: {
    all: { roundSense: summarize(rsAll), naive: summarize(naiveAll) },
    ct: { roundSense: summarize(rsCt), naive: summarize(naiveCt) },
    t: { roundSense: summarize(rsT), naive: summarize(naiveT) },
    freshBuy: { roundSense: summarize(rsFresh), naive: summarize(naiveFresh) },
    retainedGear: { roundSense: summarize(rsRetained), naive: summarize(naiveRetained) },
  },
  realCases: Object.values(cases).filter((c): c is RealCase => c !== null),
};

writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
