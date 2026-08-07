/**
 * Replay-native cash-transition ledger (L4) — STRICT attribution.
 *
 * Extracts every observed cash change from the v3 replay money stream
 * (8 Hz columnar snapshots, delta-encoded) and classifies each transition
 * against real events from the same round. This is the direct-cash truth
 * path: `startMoney + moneySpent` summary reconstruction is NOT used here.
 *
 * Attribution policy (review-hardened):
 *   UNKNOWN BY DEFAULT. A transition is only explained when it satisfies
 *   SUFFICIENT conditions:
 *     - exact:      actor + event tick + amount all match a real event
 *     - compound:   a SET of known events all land in the same sample
 *                   interval AND their amounts sum EXACTLY to the delta
 *     - buy-window: cash change inside the confirmed buytime window
 *                   [freezeEndTick, freezeEndTick + buytimeTicks) with
 *                   direction known; item not uniquely identified
 *   Anything else → sampling_ambiguous (settlement window, multiple
 *   candidates) or unexplained (default).
 *
 * Sampling reality: the stream is 8 Hz (tickStep = tickrate / 8). Events
 * between two frames collapse into the next frame's value. We never force
 * a unique attribution; a compound with an UNKNOWN remainder is NOT
 * explained (it stays unexplained).
 */
import type { ParsedDemoPackage } from "./adapter.js";
import { killReward, DEFAULT_RULES } from "@roundsense/economy-advisor";
import { decodeDelta } from "cs2-demo-format/parser";

export type TransitionCategory =
  | "kill_reward"
  | "team_kill_penalty"
  | "plant_personal"
  | "defuse_personal"
  | "round_win_reward"
  | "loss_bonus"
  | "plant_loss_team_bonus"
  | "ct_shared_reward"
  | "compound_exact"
  | "buy_window_transaction"
  | "sampling_ambiguous"
  | "unexplained";

export type Confidence =
  | "exact-event-match"
  | "exact-settlement"
  | "window-compatible"
  | "ambiguous-multiple-events"
  | "unresolved";

export interface CashTransition {
  match: string;
  round: number;
  playerIndex: number;
  /** inclusive tick range of the sample window holding the change */
  tickFrom: number;
  tickTo: number;
  cashBefore: number;
  cashAfter: number;
  delta: number;
  category: TransitionCategory;
  confidence: Confidence;
  matchedEvents: string[];
  ruleSource: string;
}

export interface RoundEventContext {
  roundNumber: number;
  endReason: string;
  winnerTeamKey: string;
  /** player's team key in this round ("teamA" | "teamB") */
  playerTeamKey: string;
  /** the player whose cash track is being classified */
  playerIndex: number;
  freezeEndTick: number;
  /** last frame tick of the segment (next round's freeze end) — tail buy
   * window detection */
  segmentEndTick?: number;
  endTick: number;
  /** player was T in this round */
  isT: boolean;
  /** player was dead at round end (deathTick <= endTick) */
  deadAtEnd: boolean;
  tEliminated: number;
  plantHappened: boolean;
  planterIndex: number | null;
  defuserIndex: number | null;
  /** kill events: {tick, killer, victim, weapon} of this round */
  kills: { tick: number; killer: number | null; victim: number | null; weapon: string }[];
  /** teamkills by this player: {tick, weapon} */
  myTeamKills: { tick: number; weapon: string }[];
}

const RULES = DEFAULT_RULES;

/** Loss payout table (mirrors loss-bonus-state; universal rule part). */
const LOSS_PAYOUTS = new Set([1400, 1900, 2400, 2900, 3400]);
const WIN_ELIM = RULES.roundRewards.winByElimination;
const WIN_BOMB = RULES.roundRewards.winByBombDetonation;
const CT_SHARED = RULES.roundRewards.ctTeamKillReward;
const PLANT_LOSS = RULES.roundRewards.plantBonusT;
const PLANT_PERSONAL = RULES.roundRewards.plantBonusPlayer;
const DEFUSE_PERSONAL = RULES.roundRewards.defuseBonusPlayer;
const TK_PENALTY = RULES.roundRewards.tkPenalty;
/** confirmed buytime length in ticks @64tick (mp_buytime 20 from freeze end,
 * corpus-verified H2: buys observed at freezeEnd+19.63s) */
export const BUYTIME_TICKS = 1280;

/** Extract per-frame cash transitions from a delta-encoded money track.
 * `startTick` is the first frame's tick; every frame is `tickStep` apart. */
export function extractTransitions(
  moneyTrack: readonly number[],
  startTick: number,
  tickStep: number,
): { tickFrom: number; tickTo: number; cashBefore: number; cashAfter: number; delta: number }[] {
  const out: { tickFrom: number; tickTo: number; cashBefore: number; cashAfter: number; delta: number }[] = [];
  for (let f = 0; f < moneyTrack.length - 1; f++) {
    const before = moneyTrack[f]!;
    const after = moneyTrack[f + 1]!;
    if (before === after) continue;
    out.push({
      tickFrom: startTick + f * tickStep,
      tickTo: startTick + (f + 1) * tickStep,
      cashBefore: before,
      cashAfter: after,
      delta: after - before,
    });
  }
  return out;
}

/** In the confirmed buytime window? [freezeEndTick, freezeEndTick + BUYTIME_TICKS)
 * OR the next round's freeze zone at the segment tail (segment ends at the
 * next round's freeze end; its buytime purchases/refunds land here). */
function inBuyWindow(midTick: number, ctx: RoundEventContext): boolean {
  if (midTick >= ctx.freezeEndTick && midTick < ctx.freezeEndTick + BUYTIME_TICKS) return true;
  if (ctx.segmentEndTick !== undefined) {
    // next round's freeze occupies the last freezetime ticks of this segment
    // (mp_freezetime 15 → 960 ticks @64); its buytime window is the tail
    if (midTick >= ctx.segmentEndTick - 960 - BUYTIME_TICKS && midTick < ctx.segmentEndTick) return true;
  }
  return false;
}

/**
 * STRICT classifier. Unknown by default; only sufficient conditions upgrade.
 * Settlement window = [endTick - 16, endTick + 400] (settlement lands at or
 * just after endTick; CT shared award lands ~3.7s later — still inside).
 */
export function classifyTransition(
  t: { tickFrom: number; tickTo: number; delta: number },
  ctx: RoundEventContext,
): { category: TransitionCategory; confidence: Confidence; matchedEvents: string[]; ruleSource: string } {
  const midTick = Math.round((t.tickFrom + t.tickTo) / 2);
  const inSettlement = midTick >= ctx.endTick - 16 && midTick <= ctx.endTick + 400;
  const d = t.delta;

  // ── NEGATIVE ───────────────────────────────────────────────────────────────
  if (d < 0) {
    // TK penalty: exact actor (this player's own teamkill) + tick + amount
    if (d === -TK_PENALTY) {
      const tk = ctx.myTeamKills.find((k) => Math.abs(k.tick - midTick) <= 16);
      if (tk) return { category: "team_kill_penalty", confidence: "exact-event-match", matchedEvents: [`tk@${tk.tick}`], ruleSource: "roundRewards.tkPenalty" };
    }
    // buy-window cash transaction (direction known, item unresolved) — ONLY
    // inside the confirmed buytime window
    if (inBuyWindow(midTick, ctx)) {
      return { category: "buy_window_transaction", confidence: "window-compatible", matchedEvents: ["buy-window -"], ruleSource: "buytime cash -X (item unresolved)" };
    }
    return { category: "unexplained", confidence: "unresolved", matchedEvents: [], ruleSource: `negative ${d} outside buytime window, no matching event` };
  }

  // ── POSITIVE ───────────────────────────────────────────────────────────────
  // kill rewards: EXACT actor (this player) + tick; ALL of this player's
  // kills in the sample window sum exactly to the delta (multi-kill windows
  // collapse in the 8 Hz stream).
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
    // kill(s) nearby but amount ≠ sum: NOT attributed (no guesswork)
  }

  // plant personal: EXACT actor + amount (tick is the plant event tick;
  // reward may land in a later sample — window-compatible on tick)
  if (ctx.planterIndex === ctx.playerIndex && d === PLANT_PERSONAL) {
    return { category: "plant_personal", confidence: "window-compatible", matchedEvents: ["plant"], ruleSource: "roundRewards.plantBonusPlayer" };
  }
  // defuse personal: EXACT actor + amount
  if (ctx.defuserIndex === ctx.playerIndex && d === DEFUSE_PERSONAL) {
    return { category: "defuse_personal", confidence: "window-compatible", matchedEvents: ["defuse"], ruleSource: "roundRewards.defuseBonusPlayer" };
  }

  // ── settlement window ───────────────────────────────────────────────────────
  if (inSettlement) {
    const won = ctx.winnerTeamKey === ctx.playerTeamKey;
    const winBase = ctx.endReason === "bomb_defused" || ctx.endReason === "target_bombed" ? WIN_BOMB : WIN_ELIM;
    if (won && d === winBase) {
      return { category: "round_win_reward", confidence: "exact-settlement", matchedEvents: [`win:${ctx.endReason}`], ruleSource: `roundRewards.win* = ${winBase}` };
    }
    // compound_exact: win + CT shared (CT side only, exact tEliminated)
    if (won && !ctx.isT && ctx.tEliminated > 0 && d === winBase + CT_SHARED * ctx.tEliminated) {
      return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`win:${ctx.endReason}(+${winBase})`, `ct-shared ${CT_SHARED}×${ctx.tEliminated}(+${CT_SHARED * ctx.tEliminated})`], ruleSource: `win + ctTeamKillReward×tElim` };
    }
    // compound_exact: win + plant/defuse personal in the same sample (defuse ends round)
    if (won && d === winBase + PLANT_PERSONAL) {
      return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`win:${ctx.endReason}(+${winBase})`, `plant/defuse personal(+${PLANT_PERSONAL})`], ruleSource: `win + plantBonusPlayer/defuseBonusPlayer` };
    }
    // compound_exact: win + own kill rewards in the same sample (final kills
    // land at/near endTick) — ALL own kills in window must sum exactly
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
    // loss bonus: EXACT payout-table amount (dead players; T survivor gets 0 — L3)
    if (!won && LOSS_PAYOUTS.has(d)) {
      return { category: "loss_bonus", confidence: "exact-settlement", matchedEvents: [`loss:${ctx.endReason}`], ruleSource: "loss payout table (model-independent amount)" };
    }
    // plant-loss team bonus (T side lost with a plant)
    if (!won && ctx.isT && d === PLANT_LOSS) {
      return { category: "plant_loss_team_bonus", confidence: "exact-settlement", matchedEvents: [`loss+plant:${ctx.endReason}`], ruleSource: "roundRewards.plantBonusT" };
    }
    // compound_exact: loss payout + plant-loss
    if (!won && ctx.isT && LOSS_PAYOUTS.has(d - PLANT_LOSS) && d - PLANT_LOSS >= 1400) {
      return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`loss-payout ${d - PLANT_LOSS}`, `plant-loss ${PLANT_LOSS}`], ruleSource: "loss payout + plantBonusT" };
    }
    // CT shared award: CT side ONLY + EXACT 50×tEliminated + tEliminated > 0.
    // Independent jump AFTER endTick (regular ~3.7s; half/OT-end can be
    // longer) — no upper bound on the delay, only amount/actor/side match.
    if (!ctx.isT && ctx.tEliminated > 0 && midTick >= ctx.endTick - 16) {
      if (d === CT_SHARED * ctx.tEliminated) {
        return { category: "ct_shared_reward", confidence: "exact-settlement", matchedEvents: [`ct-shared ${CT_SHARED}×${ctx.tEliminated}`], ruleSource: "roundRewards.ctTeamKillReward (independent settlement)" };
      }
      // compound_exact: loss payout + CT shared (any outcome for CT)
      if (!won && LOSS_PAYOUTS.has(d - CT_SHARED * ctx.tEliminated) && d - CT_SHARED * ctx.tEliminated >= 1400) {
        return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`loss-payout ${d - CT_SHARED * ctx.tEliminated}`, `ct-shared ${CT_SHARED}×${ctx.tEliminated}(+${CT_SHARED * ctx.tEliminated})`], ruleSource: "loss payout + ctTeamKillReward×tElim" };
      }
      if (!won && LOSS_PAYOUTS.has(d - PLANT_LOSS - CT_SHARED * ctx.tEliminated) && d - PLANT_LOSS - CT_SHARED * ctx.tEliminated >= 1400) {
        return { category: "compound_exact", confidence: "exact-settlement", matchedEvents: [`loss-payout ${d - PLANT_LOSS - CT_SHARED * ctx.tEliminated}`, `plant-loss ${PLANT_LOSS}`, `ct-shared ${CT_SHARED}×${ctx.tEliminated}`], ruleSource: "loss payout + plantBonusT + ctTeamKillReward×tElim" };
      }
    }
    // compound_exact: loss payout + OWN kill rewards in the same sample
    // (final kills land at/near endTick) — ALL own kills must sum exactly
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

  // ── CT shared award (AFTER settlement, any delay): CT side ONLY + EXACT
  // 50×tEliminated + tEliminated > 0. Independent jump; half/OT-end delays
  // can exceed the settlement window, so this is checked after it.
  if (!ctx.isT && ctx.tEliminated > 0 && midTick >= ctx.endTick - 16 && d === CT_SHARED * ctx.tEliminated) {
    return { category: "ct_shared_reward", confidence: "exact-settlement", matchedEvents: [`ct-shared ${CT_SHARED}×${ctx.tEliminated}`], ruleSource: "roundRewards.ctTeamKillReward (independent settlement)" };
  }

  // buy-window positive: refund/sellback INSIDE the confirmed buytime window
  if (inBuyWindow(midTick, ctx)) {
    return { category: "buy_window_transaction", confidence: "window-compatible", matchedEvents: ["buy-window +"], ruleSource: "refund/sellback inside buytime (item unresolved)" };
  }

  // everything else: UNKNOWN
  return { category: "unexplained", confidence: "unresolved", matchedEvents: [], ruleSource: `positive ${d} outside settlement/buytime, no matching event` };
}

export interface LedgerStats {
  transitions: number;
  explainedExact: number;
  compoundExact: number;
  buyWindowTransactions: number;
  samplingAmbiguous: number;
  unexplained: number;
  dollarWeighted: number;
  dollarUnexplained: number;
  playerRoundsWithUnexplained: number;
}

/** Aggregate L4 stats over classified transitions (STRICT counting:
 * exact/compound only count when exactly attributed; buy-window transactions
 * are NOT "exact" — they are direction-known window transactions). */
export function summarizeLedger(rows: { category: TransitionCategory; delta: number; round: number; playerIndex: number }[]): LedgerStats {
  const s: LedgerStats = { transitions: rows.length, explainedExact: 0, compoundExact: 0, buyWindowTransactions: 0, samplingAmbiguous: 0, unexplained: 0, dollarWeighted: 0, dollarUnexplained: 0, playerRoundsWithUnexplained: 0 };
  const pr = new Set<string>();
  for (const r of rows) {
    s.dollarWeighted += Math.abs(r.delta);
    switch (r.category) {
      case "kill_reward":
      case "team_kill_penalty":
      case "plant_personal":
      case "defuse_personal":
      case "round_win_reward":
      case "loss_bonus":
      case "plant_loss_team_bonus":
      case "ct_shared_reward":
        s.explainedExact++;
        break;
      case "compound_exact":
        s.compoundExact++;
        break;
      case "buy_window_transaction":
        s.buyWindowTransactions++;
        break;
      case "sampling_ambiguous":
        s.samplingAmbiguous++;
        break;
      case "unexplained":
        s.unexplained++;
        s.dollarUnexplained += Math.abs(r.delta);
        pr.add(`${r.round}:${r.playerIndex}`);
        break;
    }
  }
  s.playerRoundsWithUnexplained = pr.size;
  return s;
}

export type { ParsedDemoPackage };
