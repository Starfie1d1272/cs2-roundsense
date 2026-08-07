/**
 * RoundSense P1 validator — the ONLY offline demo truth-check.
 *
 * Consumes v3 ZIPs (cs2-demo-format export) and re-runs the corpus-checked
 * invariants. This file is a DIRECT port of the verified research
 * implementation (previously packages/demo-oracle + experiments/economy-ledger):
 *
 *   L1  integer income ledger — startMoney − moneySpent reconstruction vs
 *       modeled rewards (production rules only; loss counter simulated with
 *       the count-dep provisional model, exactly as lossCountsForPackage).
 *       Rate is a summary-ledger reconciliation rate, NOT rule accuracy.
 *   L3  time_ran_out survivor invariant — surviving T gets no loss payout.
 *   L4  replay-native cash transitions — STRICT classifier (ported verbatim:
 *       unknown by default, exact actor+tick+amount, compound only on exact
 *       known-event sums, buy-window only inside confirmed buytime).
 *
 * Usage: tsx tools/validate-demo.ts <zip|dir>...
 */
import { readFileSync, readdirSync } from "node:fs";
import JSZip from "jszip";
import { decodeDelta } from "cs2-demo-format/parser";
import { DEFAULT_RULES, killReward } from "@roundsense/economy-advisor";

const RULES = DEFAULT_RULES;
const WIN_ELIM = RULES.roundRewards.winByElimination;
const WIN_BOMB = RULES.roundRewards.winByBombDetonation;
const CT_SHARED = RULES.roundRewards.ctTeamKillReward;
const PLANT_LOSS = RULES.roundRewards.plantBonusT;
const PLANT_PERSONAL = RULES.roundRewards.plantBonusPlayer;
const DEFUSE_PERSONAL = RULES.roundRewards.defuseBonusPlayer;
const TK_PENALTY = RULES.roundRewards.tkPenalty;
const BUYTIME_TICKS = 1280;

// ── loss-state primitives (ported verbatim from loss-bonus-state.ts) ─────────
const LOSS_BONUS_BASE = 1400;
const LOSS_BONUS_INCREMENT = 500;
const LOSS_BONUS_CAP = 3400;
const CAP_COUNT = 4;
const MP_STARTING_LOSSES = 1;

function winTypeOf(round: { endReason: string }): "elim" | "bomb" | "timeout" {
  if (round.endReason === "time_ran_out") return "timeout";
  if (round.endReason === "target_bombed" || round.endReason === "bomb_defused") return "bomb";
  return "elim";
}

function lossBonusPayout(count: number): number {
  return Math.min(LOSS_BONUS_CAP, LOSS_BONUS_BASE + LOSS_BONUS_INCREMENT * count);
}

/** count-dep provisional win decrement: timeout −2 (unconditional); normal
 * −1 at cap (count ≥ 4), else −2. Floor 0. (verbatim) */
function nextLossCountAfterWin(prev: number, winType: "elim" | "bomb" | "timeout"): number {
  const dec = winType === "timeout" ? 2 : prev >= CAP_COUNT ? 1 : 2;
  return Math.max(0, prev - dec);
}

function nextLossCountAfterLoss(prev: number): number {
  return Math.min(CAP_COUNT, prev + 1);
}

const isResetRound = (r: number) => r === 13 || (r >= 25 && (r - 25) % 3 === 0);

/** Simulate the loss counter across a round sequence (rounds must be
 * sorted). Returns the counter state AT THE START of each round. (verbatim) */
function simulateLossCounts(
  rounds: readonly { roundNumber: number; winnerTeamKey: string; endReason: string }[],
): Map<number, { teamA: number; teamB: number }> {
  const out = new Map<number, { teamA: number; teamB: number }>();
  let state = { teamA: MP_STARTING_LOSSES, teamB: MP_STARTING_LOSSES };
  for (const round of rounds) {
    if (isResetRound(round.roundNumber)) state = { teamA: MP_STARTING_LOSSES, teamB: MP_STARTING_LOSSES };
    out.set(round.roundNumber, { ...state });
    const wt = winTypeOf(round);
    if (round.winnerTeamKey === "teamA") {
      state.teamA = nextLossCountAfterWin(state.teamA, wt);
      state.teamB = nextLossCountAfterLoss(state.teamB);
    } else {
      state.teamB = nextLossCountAfterWin(state.teamB, wt);
      state.teamA = nextLossCountAfterLoss(state.teamA);
    }
  }
  return out;
}

// ── L4 strict classifier (ported verbatim from replay-ledger.ts) ─────────────
interface RoundEventContext {
  roundNumber: number;
  endReason: string;
  winnerTeamKey: string;
  playerTeamKey: string;
  playerIndex: number;
  freezeEndTick: number;
  segmentEndTick?: number;
  endTick: number;
  isT: boolean;
  deadAtEnd: boolean;
  tEliminated: number;
  plantHappened: boolean;
  planterIndex: number | null;
  defuserIndex: number | null;
  kills: { tick: number; killer: number | null; victim: number | null; weapon: string }[];
  myTeamKills: { tick: number; weapon: string }[];
}

const LOSS_PAYOUTS = new Set([1400, 1900, 2400, 2900, 3400]);

function inBuyWindow(midTick: number, ctx: RoundEventContext): boolean {
  if (midTick >= ctx.freezeEndTick && midTick < ctx.freezeEndTick + BUYTIME_TICKS) return true;
  if (ctx.segmentEndTick !== undefined) {
    if (midTick >= ctx.segmentEndTick - 960 - BUYTIME_TICKS && midTick < ctx.segmentEndTick) return true;
  }
  return false;
}

function classifyTransition(
  t: { tickFrom: number; tickTo: number; delta: number },
  ctx: RoundEventContext,
): { category: string; confidence: string; matchedEvents: string[]; ruleSource: string } {
  const midTick = Math.round((t.tickFrom + t.tickTo) / 2);
  const inSettlement = midTick >= ctx.endTick - 16 && midTick <= ctx.endTick + 400;
  const d = t.delta;

  if (d < 0) {
    if (d === -TK_PENALTY) {
      const tk = ctx.myTeamKills.find((k) => Math.abs(k.tick - midTick) <= 16);
      if (tk) return { category: "team_kill_penalty", confidence: "exact-event-match", matchedEvents: [`tk@${tk.tick}`], ruleSource: "roundRewards.tkPenalty" };
    }
    if (inBuyWindow(midTick, ctx)) {
      return { category: "buy_window_transaction", confidence: "window-compatible", matchedEvents: ["buy-window -"], ruleSource: "buytime cash -X (item unresolved)" };
    }
    return { category: "unexplained", confidence: "unresolved", matchedEvents: [], ruleSource: `negative ${d} outside buytime window, no matching event` };
  }

  const myKills = ctx.kills.filter((k) => k.killer === ctx.playerIndex && Math.abs(k.tick - midTick) <= 8);
  if (myKills.length > 0) {
    let sum = 0;
    const parts: string[] = [];
    let allKnown = true;
    for (const k of myKills) {
      try {
        const award = killReward(RULES, { weaponId: k.weapon });
        sum += award;
        parts.push(`${k.weapon}@${k.tick}(+${award})`);
      } catch {
        allKnown = false;
      }
    }
    if (allKnown && d === sum) {
      if (myKills.length === 1) {
        return { category: "kill_reward", confidence: "exact-event-match", matchedEvents: [`kill:${parts[0]}`], ruleSource: `weapon table ${myKills[0]!.weapon}=${sum}` };
      }
      return { category: "compound_exact", confidence: "exact-event-match", matchedEvents: parts.map((p) => `kill:${p}`), ruleSource: `weapon table sum = ${sum}` };
    }
  }

  if (ctx.planterIndex === ctx.playerIndex && d === PLANT_PERSONAL) {
    return { category: "plant_personal", confidence: "window-compatible", matchedEvents: ["plant"], ruleSource: "roundRewards.plantBonusPlayer" };
  }
  if (ctx.defuserIndex === ctx.playerIndex && d === DEFUSE_PERSONAL) {
    return { category: "defuse_personal", confidence: "window-compatible", matchedEvents: ["defuse"], ruleSource: "roundRewards.defuseBonusPlayer" };
  }

  if (inSettlement) {
    const won = ctx.winnerTeamKey === ctx.playerTeamKey;
    const winBase = ctx.endReason === "bomb_defused" || ctx.endReason === "target_bombed" ? WIN_BOMB : WIN_ELIM;
    if (won && d === winBase) {
      return { category: "round_win_reward", confidence: "exact-settlement", matchedEvents: [`win:${ctx.endReason}`], ruleSource: `roundRewards.win* = ${winBase}` };
    }
    if (won && !ctx.isT && ctx.tEliminated > 0 && d === winBase + CT_SHARED * ctx.tEliminated) {
      return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`win:${ctx.endReason}(+${winBase})`, `ct-shared ${CT_SHARED}×${ctx.tEliminated}(+${CT_SHARED * ctx.tEliminated})`], ruleSource: `win + ctTeamKillReward×tElim` };
    }
    if (won && d === winBase + PLANT_PERSONAL) {
      return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`win:${ctx.endReason}(+${winBase})`, `plant/defuse personal(+${PLANT_PERSONAL})`], ruleSource: `win + plantBonusPlayer/defuseBonusPlayer` };
    }
    if (won) {
      const winKills = ctx.kills.filter((k) => k.killer === ctx.playerIndex && Math.abs(k.tick - midTick) <= 8);
      if (winKills.length > 0) {
        let sum = 0;
        const parts: string[] = [];
        let allKnown = true;
        for (const k of winKills) {
          try {
            const award = killReward(RULES, { weaponId: k.weapon });
            sum += award;
            parts.push(`${k.weapon}(+${award})`);
          } catch { allKnown = false; }
        }
        if (allKnown && d === winBase + sum) {
          return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`win:${ctx.endReason}(+${winBase})`, ...parts.map((p) => `kill:${p}`)], ruleSource: `win + weapon table sum=${sum}` };
        }
      }
    }
    if (!won && LOSS_PAYOUTS.has(d)) {
      return { category: "loss_bonus", confidence: "exact-settlement", matchedEvents: [`loss:${ctx.endReason}`], ruleSource: "loss payout table (model-independent amount)" };
    }
    if (!won && ctx.isT && d === PLANT_LOSS) {
      return { category: "plant_loss_team_bonus", confidence: "exact-settlement", matchedEvents: [`loss+plant:${ctx.endReason}`], ruleSource: "roundRewards.plantBonusT" };
    }
    if (!won && ctx.isT && LOSS_PAYOUTS.has(d - PLANT_LOSS) && d - PLANT_LOSS >= 1400) {
      return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`loss-payout ${d - PLANT_LOSS}`, `plant-loss ${PLANT_LOSS}`], ruleSource: "loss payout + plantBonusT" };
    }
    if (!ctx.isT && ctx.tEliminated > 0) {
      if (d === CT_SHARED * ctx.tEliminated) {
        return { category: "ct_shared_reward", confidence: "exact-settlement", matchedEvents: [`ct-shared ${CT_SHARED}×${ctx.tEliminated}`], ruleSource: "roundRewards.ctTeamKillReward (independent settlement)" };
      }
      if (!won && LOSS_PAYOUTS.has(d - CT_SHARED * ctx.tEliminated) && d - CT_SHARED * ctx.tEliminated >= 1400) {
        return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`loss-payout ${d - CT_SHARED * ctx.tEliminated}`, `ct-shared ${CT_SHARED}×${ctx.tEliminated}(+${CT_SHARED * ctx.tEliminated})`], ruleSource: "loss payout + ctTeamKillReward×tElim" };
      }
      if (!won && LOSS_PAYOUTS.has(d - PLANT_LOSS - CT_SHARED * ctx.tEliminated) && d - PLANT_LOSS - CT_SHARED * ctx.tEliminated >= 1400) {
        return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`loss-payout ${d - PLANT_LOSS - CT_SHARED * ctx.tEliminated}`, `plant-loss ${PLANT_LOSS}`, `ct-shared ${CT_SHARED}×${ctx.tEliminated}`], ruleSource: "loss payout + plantBonusT + ctTeamKillReward×tElim" };
      }
    }
    if (!won) {
      const lossKills = ctx.kills.filter((k) => k.killer === ctx.playerIndex && Math.abs(k.tick - midTick) <= 8);
      if (lossKills.length > 0) {
        let sum = 0;
        const parts: string[] = [];
        let allKnown = true;
        for (const k of lossKills) {
          try {
            const award = killReward(RULES, { weaponId: k.weapon });
            sum += award;
            parts.push(`${k.weapon}(+${award})`);
          } catch { allKnown = false; }
        }
        if (allKnown) {
          for (const payout of LOSS_PAYOUTS) {
            if (d === payout + sum) {
              return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`loss-payout ${payout}`, ...parts.map((p) => `kill:${p}`)], ruleSource: `loss payout + weapon table sum=${sum}` };
            }
          }
        }
      }
    }
    return { category: "sampling_ambiguous", confidence: "ambiguous-multiple-events", matchedEvents: [`settlement ${d}`], ruleSource: "settlement window, amount not uniquely decomposable" };
  }

  if (!ctx.isT && ctx.tEliminated > 0 && midTick >= ctx.endTick - 16 && d === CT_SHARED * ctx.tEliminated) {
    return { category: "ct_shared_reward", confidence: "exact-settlement", matchedEvents: [`ct-shared ${CT_SHARED}×${ctx.tEliminated}`], ruleSource: "roundRewards.ctTeamKillReward (independent settlement)" };
  }

  if (inBuyWindow(midTick, ctx)) {
    return { category: "buy_window_transaction", confidence: "window-compatible", matchedEvents: ["buy-window +"], ruleSource: "refund/sellback inside buytime (item unresolved)" };
  }

  return { category: "unexplained", confidence: "unresolved", matchedEvents: [], ruleSource: `positive ${d} outside settlement/buytime, no matching event` };
}

// ── ZIP loading ──────────────────────────────────────────────────────────────
async function loadZip(path: string) {
  const z = await JSZip.loadAsync(readFileSync(path));
  const j = async (name: string) => JSON.parse(await z.file(name)!.async("string"));
  const has = (name: string) => !!z.file(name);
  return {
    manifest: await j("manifest.json"),
    rounds: await j("rounds.json"),
    players: await j("players.json"),
    kills: has("kills.json") ? await j("kills.json") : [],
    bombs: has("bombs.json") ? await j("bombs.json") : [],
    playerEconomies: has("player-economies.json") ? await j("player-economies.json") : [],
    replay: has("replay.json") ? JSON.parse((await z.file("replay.json")!.async("string")).replace(/NaN/g, "null")) : null,
  };
}

async function loadDir(path: string) {
  const out: { name: string; pkg: Awaited<ReturnType<typeof loadZip>> }[] = [];
  for (const f of readdirSync(path).filter((x) => x.endsWith(".zip"))) {
    try {
      out.push({ name: f, pkg: await loadZip(`${path}/${f}`) });
    } catch (e) {
      console.error(`✗ ${f}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  return out;
}

interface Stats {
  matches: number;
  samples: number;
  exact: number;
  cappedExcluded: number;
  contaminated: number;
  tSurvivor: { checked: number; violations: number };
  l4: { transitions: number; explainedExact: number; compoundExact: number; buyWindowTransactions: number; samplingAmbiguous: number; unexplained: number; dollarWeighted: number; dollarUnexplained: number; playerRoundsWithUnexplained: number; perCategory: Record<string, number> };
  unknownWeapons: Map<string, number>;
  l1NonzeroReplayClean: number;
  l1NonzeroReplayDirty: number;
  l1NonzeroNoReplay: number;
  otByOpener: Record<number, string>;
}

type Pkg = Awaited<ReturnType<typeof loadZip>>;

function analyze(pkg: Pkg, s: Stats): void {
  s.matches++;
  const { rounds, players, kills, bombs, playerEconomies, replay } = pkg;
  const teamByPlayer = new Map<number, string>();
  players.forEach((p: { teamKey: string }, i: number) => teamByPlayer.set(i, p.teamKey));
  const roundByNumber = new Map(rounds.map((r: { roundNumber: number }) => [r.roundNumber, r]));
  const killsByRound = new Map<number, { tick: number; killerIndex: number | null; victimIndex: number | null; weapon: string; roundNumber: number }[]>();
  for (const k of kills) {
    const rn = (k as { roundNumber: number }).roundNumber;
    if (!killsByRound.has(rn)) killsByRound.set(rn, []);
    killsByRound.get(rn)!.push(k);
  }
  const bombsByRound = new Map<number, { tick: number; type: string; actorIndex: number | null; roundNumber: number }[]>();
  for (const b of bombs) {
    const rn = (b as { roundNumber: number }).roundNumber;
    if (!bombsByRound.has(rn)) bombsByRound.set(rn, []);
    bombsByRound.get(rn)!.push(b);
  }
  const deathTickByRound = new Map<number, Map<number, number>>();
  for (const k of kills) {
    const rn = (k as { roundNumber: number }).roundNumber;
    const v = (k as { victimIndex: number | null }).victimIndex;
    const t = (k as { tick: number }).tick;
    if (v === null) continue;
    let m = deathTickByRound.get(rn);
    if (!m) { m = new Map(); deathTickByRound.set(rn, m); }
    const cur = m.get(v);
    if (cur === undefined || t > cur) m.set(v, t);
  }
  const economiesByRound = new Map<number, Map<number, { startMoney: number; moneySpent: number }>>();
  for (const e of playerEconomies) {
    const rn = (e as { roundNumber: number }).roundNumber;
    if (!economiesByRound.has(rn)) economiesByRound.set(rn, new Map());
    economiesByRound.get(rn)!.set((e as { playerIndex: number }).playerIndex, { startMoney: (e as { startMoney: number }).startMoney, moneySpent: (e as { moneySpent: number }).moneySpent });
  }
  const lossSim = simulateLossCounts(rounds);
  const stdLossCountAt = (roundNumber: number, teamKey: string): number => {
    const row = lossSim.get(roundNumber);
    if (!row) return 1;
    return teamKey === "teamA" ? row.teamA : row.teamB;
  };

  // OT opener cash profile (server/match profile, NOT universal rule)
  {
    const otByRound = new Map<number, Set<number>>();
    for (const row of playerEconomies) {
      if (row.roundNumber >= 25 && (row.roundNumber - 25) % 3 === 0) {
        let set = otByRound.get(row.roundNumber);
        if (!set) { set = new Set(); otByRound.set(row.roundNumber, set); }
        set.add(row.startMoney);
      }
    }
    for (const [rn, vals] of otByRound) {
      const uniform = vals.size === 1;
      const first = [...vals][0];
      if (uniform && first === 10000) s.otByOpener[rn] = "reset10000";
      else if (uniform) s.otByOpener[rn] = `uniform-${first}`;
      else s.otByOpener[rn] = "non-uniform";
    }
  }

  // per-(round,player) L4 flags for the L1-nonzero decomposition
  const l4Flags = new Map<string, { unexplained: boolean; ambiguous: boolean }>();

  for (const round of rounds) {
    const r = (round as { roundNumber: number }).roundNumber;
    if (r < 2 || isResetRound(r)) continue;
    const prev = roundByNumber.get(r - 1) as { endReason: string; winnerTeamKey: string; endTick: number; teamASide: string; teamBSide: string } | undefined;
    const prevE = economiesByRound.get(r - 1);
    const curE = economiesByRound.get(r);
    if (!prev || !prevE || !curE) continue;
    const prevKills = killsByRound.get(r - 1) ?? [];
    const tTeamKey = prev.teamASide === "t" ? "teamA" : "teamB";
    const tEliminatedPrev = prevKills.filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKey).length;
    const prevBombs = bombsByRound.get(r - 1) ?? [];
    const plantPrev = prevBombs.find((b) => b.type === "planted") ?? null;
    const prevDeadSet = new Set<number>();
    for (const k of prevKills) if (k.victimIndex !== null) prevDeadSet.add(k.victimIndex);

    for (const [pi, cur] of curE) {
      const pre = prevE.get(pi);
      if (!pre) continue;
      const teamKey = teamByPlayer.get(pi);
      if (!teamKey) continue;
      const prevSide = teamKey === "teamA" ? prev.teamASide : prev.teamBSide;
      const isCt = prevSide === "ct" || prevSide === "CT";
      const isT2 = prevSide === "t" || prevSide === "T";
      void isCt;
      const income = cur.startMoney - pre.startMoney + pre.moneySpent;
      const wonPrev = prev.winnerTeamKey === teamKey;

      let prevTkCount = 0;
      let killRewardTotal = 0;
      let unknownKillCount = 0;
      for (const k of prevKills) {
        if (k.killerIndex !== pi || k.victimIndex === pi) continue;
        if (k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === teamKey) { prevTkCount++; continue; }
        try {
          killRewardTotal += killReward(RULES, { weaponId: k.weapon });
        } catch {
          unknownKillCount++;
          s.unknownWeapons.set(k.weapon, (s.unknownWeapons.get(k.weapon) ?? 0) + 1);
        }
      }

      let modeled = 0;
      if (isCt) modeled += CT_SHARED * tEliminatedPrev;
      if (wonPrev) {
        modeled += prev.endReason === "bomb_defused" || prev.endReason === "target_bombed" ? WIN_BOMB : WIN_ELIM;
      } else if (prev.endReason === "time_ran_out" && isT2 && !prevDeadSet.has(pi)) {
        modeled += 0; // surviving T on timeout: no loss payout (L3 invariant)
      } else {
        modeled += lossBonusPayout(stdLossCountAt(r - 1, teamKey));
        if (isT2 && plantPrev) modeled += PLANT_LOSS;
      }
      modeled += killRewardTotal;
      modeled -= TK_PENALTY * prevTkCount;
      if (plantPrev?.actorIndex === pi) modeled += PLANT_PERSONAL;
      if (prevBombs.find((b) => b.type === "defused")?.actorIndex === pi) modeled += DEFUSE_PERSONAL;

      const residual = income - modeled;
      // cash-cap truncation: if the round start is at the cap AND income is
      // below modeled, the ledger difference is invalid (income truncated by
      // the cap) — exclude from the L1 denominator (verbatim from the
      // verified validator)
      if (cur.startMoney >= 16000 && income < modeled) { s.cappedExcluded++; continue; }
      if (unknownKillCount > 0) { s.contaminated++; continue; }
      s.samples++;
      if (residual === 0) {
        s.exact++;
      } else if (replay) {
        const flag = l4FlagFor(replay, r - 1, pi, teamKey, prev, prevKills, prevBombs, teamByPlayer, deathTickByRound.get(r - 1));
        if (flag === null) s.l1NonzeroNoReplay++;
        else if (flag.dirty) s.l1NonzeroReplayDirty++;
        else s.l1NonzeroReplayClean++;
      } else {
        s.l1NonzeroNoReplay++;
      }
    }
  }

  // ── L3: time_ran_out surviving T gets no loss payout ───────────────────────
  if (replay) {
    for (const round of rounds) {
      const rn = (round as { roundNumber: number }).roundNumber;
      if ((round as { endReason: string }).endReason !== "time_ran_out") continue;
      const tTeamKey = (round as { teamASide: string }).teamASide === "t" ? "teamA" : "teamB";
      const rr = replay.rounds.find((x) => x.roundNumber === rn);
      if (!rr) continue;
      const deaths = deathTickByRound.get(rn) ?? new Map();
      const endTick = (round as { endTick: number }).endTick;
      for (const track of rr.players) {
        const pi = track.playerIndex;
        if (teamByPlayer.get(pi) !== tTeamKey) continue;
        const deathTick = deaths.get(pi) ?? null;
        if (deathTick !== null && deathTick <= endTick) continue;
        const m = decodeDelta(track.money);
        const step = rr.tickStep ?? 8;
        const start = rr.startTick ?? 0;
        let maxJump = 0;
        for (let f = 0; f < m.length - 1; f++) {
          const tick = start + f * step;
          if (tick < endTick - 16 || tick > endTick + 400) continue;
          const d = m[f + 1]! - m[f]!;
          if (d > maxJump) maxJump = d;
        }
        s.tSurvivor.checked++;
        if (maxJump >= 1400) s.tSurvivor.violations++;
      }
    }
  }

  // ── L4 pass: INDEPENDENT — every replay round, every player track ─────────
  if (replay) {
    for (const rr of replay.rounds) {
      const rn = rr.roundNumber;
      const round = roundByNumber.get(rn) as { endReason: string; winnerTeamKey: string; endTick: number; teamASide: string; teamBSide: string } | undefined;
      if (!round) continue;
      const rKills = killsByRound.get(rn) ?? [];
      const rBombs = bombsByRound.get(rn) ?? [];
      const plant = rBombs.find((b) => b.type === "planted") ?? null;
      const defuse = rBombs.find((b) => b.type === "defused") ?? null;
      const tTeamKey = round.teamASide === "t" ? "teamA" : "teamB";
      const tEliminated = rKills.filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKey).length;
      const deaths = deathTickByRound.get(rn) ?? new Map();

      for (const track of rr.players) {
        const pi = track.playerIndex;
        const teamKey = teamByPlayer.get(pi);
        if (!teamKey) continue;
        const side = (teamKey === "teamA" ? round.teamASide : round.teamBSide) as "CT" | "T";
        const deathTick = deaths.get(pi) ?? null;
        const ctx: RoundEventContext = {
          roundNumber: rn,
          endReason: round.endReason,
          winnerTeamKey: round.winnerTeamKey,
          playerTeamKey: teamKey,
          playerIndex: pi,
          freezeEndTick: rr.startTick,
          segmentEndTick: rr.startTick + ((rr.frameCount ?? 1) - 1) * rr.tickStep,
          endTick: round.endTick,
          isT: side === "T" || side === "t",
          deadAtEnd: deathTick !== null && deathTick <= round.endTick,
          tEliminated,
          plantHappened: plant !== null,
          planterIndex: plant?.actorIndex ?? null,
          defuserIndex: defuse?.actorIndex ?? null,
          kills: rKills.map((k) => ({ tick: k.tick, killer: k.killerIndex, victim: k.victimIndex, weapon: k.weapon })),
          myTeamKills: rKills.filter((k) => k.killerIndex === pi && k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === teamKey).map((k) => ({ tick: k.tick, weapon: k.weapon })),
        };
        const money = decodeDelta(track.money);
        if (money.length < 2) continue;
        let flagU = false;
        let flagA = false;
        for (let f = 0; f < money.length - 1; f++) {
          if (money[f + 1] === money[f]) continue;
          const cls = classifyTransition({ tickFrom: rr.startTick + f * rr.tickStep, tickTo: rr.startTick + (f + 1) * rr.tickStep, delta: money[f + 1]! - money[f]! }, ctx);
          s.l4.transitions++;
          s.l4.perCategory[cls.category] = (s.l4.perCategory[cls.category] ?? 0) + 1;
          s.l4.dollarWeighted += Math.abs(money[f + 1]! - money[f]!);
          switch (cls.category) {
            case "unexplained":
              s.l4.unexplained++;
              s.l4.dollarUnexplained += Math.abs(money[f + 1]! - money[f]!);
              flagU = true;
              break;
            case "sampling_ambiguous":
              s.l4.samplingAmbiguous++;
              flagA = true;
              break;
            case "compound_exact":
              s.l4.compoundExact++;
              break;
            case "buy_window_transaction":
              s.l4.buyWindowTransactions++;
              break;
            default:
              s.l4.explainedExact++;
          }
        }
        if (flagU) s.l4.playerRoundsWithUnexplained++;
        l4Flags.set(`${rn}:${pi}`, { unexplained: flagU, ambiguous: flagA });
      }
    }
  }
}

function buildCtxForFlag(
  rn: number, pi: number, teamKey: string,
  prev: { endReason: string; winnerTeamKey: string; endTick: number; teamASide: string; teamBSide: string },
  prevKills: { tick: number; killerIndex: number | null; victimIndex: number | null; weapon: string }[],
  prevBombs: { tick: number; type: string; actorIndex: number | null }[],
  teamByPlayer: Map<number, string>,
  deaths: Map<number, number> | undefined,
  rr: { tickStep: number; startTick: number; frameCount?: number },
): RoundEventContext {
  const tTeamKey = prev.teamASide === "t" ? "teamA" : "teamB";
  const tEliminated = prevKills.filter((k) => k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === tTeamKey).length;
  const plant = prevBombs.find((b) => b.type === "planted") ?? null;
  const defuse = prevBombs.find((b) => b.type === "defused") ?? null;
  const side = (teamKey === "teamA" ? prev.teamASide : prev.teamBSide) as "CT" | "T";
  const deathTick = deaths?.get(pi) ?? null;
  return {
    roundNumber: rn,
    endReason: prev.endReason,
    winnerTeamKey: prev.winnerTeamKey,
    playerTeamKey: teamKey,
    playerIndex: pi,
    freezeEndTick: rr.startTick,
    segmentEndTick: rr.startTick + ((rr.frameCount ?? 1) - 1) * rr.tickStep,
    endTick: prev.endTick,
    isT: side === "T" || side === "t",
    deadAtEnd: deathTick !== null && deathTick <= prev.endTick,
    tEliminated,
    plantHappened: plant !== null,
    planterIndex: plant?.actorIndex ?? null,
    defuserIndex: defuse?.actorIndex ?? null,
    kills: prevKills.map((k) => ({ tick: k.tick, killer: k.killerIndex, victim: k.victimIndex, weapon: k.weapon })),
    myTeamKills: prevKills.filter((k) => k.killerIndex === pi && k.victimIndex !== null && teamByPlayer.get(k.victimIndex) === teamKey).map((k) => ({ tick: k.tick, weapon: k.weapon })),
  };
}

function l4FlagFor(
  replay: Pkg["replay"],
  rn: number, pi: number, teamKey: string,
  prev: { endReason: string; winnerTeamKey: string; endTick: number; teamASide: string; teamBSide: string },
  prevKills: { tick: number; killerIndex: number | null; victimIndex: number | null; weapon: string }[],
  prevBombs: { tick: number; type: string; actorIndex: number | null }[],
  teamByPlayer: Map<number, string>,
  deaths: Map<number, number> | undefined,
): { dirty: boolean } | null {
  if (!replay) return null;
  const rr = replay.rounds.find((x) => x.roundNumber === rn);
  const track = rr?.players.find((t) => t.playerIndex === pi);
  if (!track || !rr) return null;
  const ctx = buildCtxForFlag(rn, pi, teamKey, prev, prevKills, prevBombs, teamByPlayer, deaths, rr);
  const money = decodeDelta(track.money);
  if (money.length < 2) return { dirty: false };
  let dirty = false;
  for (let f = 0; f < money.length - 1; f++) {
    if (money[f + 1] === money[f]) continue;
    const cat = classifyTransition({ tickFrom: rr.startTick + f * rr.tickStep, tickTo: rr.startTick + (f + 1) * rr.tickStep, delta: money[f + 1]! - money[f]! }, ctx).category;
    if (cat === "unexplained" || cat === "sampling_ambiguous") dirty = true;
  }
  return { dirty };
}

function report(s: Stats): void {
  console.log(`matches=${s.matches} samples=${s.samples}`);
  console.log(`L1 summary-ledger diff=0: ${s.exact}/${s.samples} (${s.samples ? ((100 * s.exact) / s.samples).toFixed(1) : "0"}%) [capped excluded=${s.cappedExcluded} contaminated=${s.contaminated}]`);
  console.log(`L1-nonzero decomp: replayClean=${s.l1NonzeroReplayClean} replayDirty=${s.l1NonzeroReplayDirty} noReplay=${s.l1NonzeroNoReplay}`);
  console.log(`L3 T-survivor: checked=${s.tSurvivor.checked} violations=${s.tSurvivor.violations}`);
  const t = s.l4.transitions;
  if (t > 0) {
    const pct = (n: number) => `${n} (${((100 * n) / t).toFixed(1)}%)`;
    console.log(`L4 cash transitions: ${t} exact=${pct(s.l4.explainedExact)} compoundExact=${pct(s.l4.compoundExact)} buyWindow=${pct(s.l4.buyWindowTransactions)} samplingAmbiguous=${pct(s.l4.samplingAmbiguous)} unexplained=${pct(s.l4.unexplained)}`);
    console.log(`L4 \$weighted=\$${s.l4.dollarWeighted} \$unexplained=\$${s.l4.dollarUnexplained} playerRoundsWithUnexplained=${s.l4.playerRoundsWithUnexplained}`);
    console.log(`L4 strict explainability (exact+compoundExact) = ${((100 * (s.l4.explainedExact + s.l4.compoundExact)) / t).toFixed(1)}%; with buy-window = ${((100 * (s.l4.explainedExact + s.l4.compoundExact + s.l4.buyWindowTransactions)) / t).toFixed(1)}%`);
  } else {
    console.log("L4 cash transitions: 0 (no replay in input)");
  }
  const ot = Object.entries(s.otByOpener).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (ot.length) console.log(`OT openers: ${ot.map(([rn, v]) => `r${rn}=${v}`).join(", ")}`);
  if (s.unknownWeapons.size) {
    console.log(`UNKNOWN-WEAPONS: ${[...s.unknownWeapons.entries()].map(([w, c]) => `${w}×${c}`).join(", ")}`);
  } else {
    console.log("UNKNOWN-WEAPONS: none");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const files: string[] = [];
  const dirs: string[] = [];
  for (const arg of args) {
    if (arg.endsWith(".zip")) files.push(arg);
    else dirs.push(arg);
  }
  if (files.length === 0 && dirs.length === 0) {
    console.error("usage: tsx tools/validate-demo.ts <zip|dir>...");
    process.exit(1);
  }
  const s: Stats = {
    matches: 0, samples: 0, exact: 0, cappedExcluded: 0, contaminated: 0,
    tSurvivor: { checked: 0, violations: 0 },
    l4: { transitions: 0, explainedExact: 0, compoundExact: 0, buyWindowTransactions: 0, samplingAmbiguous: 0, unexplained: 0, dollarWeighted: 0, dollarUnexplained: 0, playerRoundsWithUnexplained: 0, perCategory: {} },
    unknownWeapons: new Map(),
    l1NonzeroReplayClean: 0, l1NonzeroReplayDirty: 0, l1NonzeroNoReplay: 0,
    otByOpener: {},
  };
  let loadErrors = 0;
  for (const f of files) {
    try { analyze(await loadZip(f), s); } catch (e) { loadErrors++; console.error(`✗ ${f}: ${(e as Error).message.slice(0, 100)}`); }
  }
  for (const d of dirs) {
    for (const { name, pkg } of await loadDir(d)) {
      try { analyze(pkg, s); } catch (e) { loadErrors++; console.error(`✗ ${name}: ${(e as Error).message.slice(0, 100)}`); }
    }
  }
  report(s);
  if (loadErrors > 0) process.exit(1);
}

void main();
