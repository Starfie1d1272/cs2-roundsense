/**
 * Replay-native cash-transition ledger (L4).
 *
 * Extracts every observed cash change from the v3 replay money stream
 * (8 Hz columnar snapshots, delta-encoded) and classifies each transition
 * against real events from the same round. This is the direct-cash truth
 * path: `startMoney + moneySpent` summary reconstruction is NOT used here.
 *
 * Sampling reality: the stream is 8 Hz (tickStep = tickrate / 8). Events
 * landing between two frames are collapsed into the next frame's value —
 * multiple same-window events appear as ONE compound transition. We never
 * force a unique attribution: compound transitions are explained if the
 * composed events exactly account for the delta, else marked ambiguous.
 *
 * Attribution is semantic (RoundSense side). The format only tells us
 * cash changed from X to Y (see docs/experiments/loss-counter-runtime.md
 * for the format/interpretation split).
 */
import type { ParsedDemoPackage } from "./adapter.js";
import { killReward, DEFAULT_RULES } from "@roundsense/economy-advisor";
import { decodeDelta } from "cs2-demo-format/parser";

export type TransitionCategory =
  | "purchase"
  | "refund_or_sellback"
  | "kill_reward"
  | "team_kill_penalty"
  | "plant_personal"
  | "defuse_personal"
  | "ct_shared_reward"
  | "round_win_reward"
  | "loss_bonus"
  | "plant_loss_team_bonus"
  | "economy_reset"
  | "compound_transition"
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
  endTick: number;
  /** player was T in this round */
  isT: boolean;
  /** OT half opener (r25, r28, …) — cash reset is a server profile, not income */
  isOvertimeOpener: boolean;
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

/**
 * Classify a single transition against the round's real events.
 * `settlementWindow` = [endTick - 16, endTick + 400] (settlement lands at or
 * just after endTick; kill/plant rewards land at their event tick).
 */
export function classifyTransition(
  t: { tickFrom: number; tickTo: number; delta: number },
  ctx: RoundEventContext,
  settlementWindow = { from: -16, to: 400 },
): { category: TransitionCategory; confidence: Confidence; matchedEvents: string[]; ruleSource: string } {
  const midTick = Math.round((t.tickFrom + t.tickTo) / 2);
  const inSettlement = midTick >= ctx.endTick + settlementWindow.from && midTick <= ctx.endTick + settlementWindow.to;
  const d = t.delta;

  // ── negative: buy-window transactions / TK penalty ─────────────────────────
  if (d < 0) {
    // TK penalty: −300 at the teamkill tick (only if the player actually TK'd)
    if (d === -TK_PENALTY) {
      const tk = ctx.myTeamKills.find((k) => Math.abs(k.tick - midTick) <= 16);
      if (tk) return { category: "team_kill_penalty", confidence: "exact-event-match", matchedEvents: [`tk@${tk.tick}`], ruleSource: "roundRewards.tkPenalty" };
    }
    return { category: "purchase", confidence: inSettlement ? "window-compatible" : "exact-event-match", matchedEvents: ["buy-window"], ruleSource: "cash -X in buy window (item unresolved)" };
  }

  // ── positive ───────────────────────────────────────────────────────────────
  // economy reset (OT half opener): cash reset is a server/match profile,
  // not income — the caller marks OT openers in ctx.
  if (ctx.isOvertimeOpener) {
    return { category: "economy_reset", confidence: "exact-settlement", matchedEvents: ["reset"], ruleSource: "server/match profile (mp_overtime_startmoney or carry-over)" };
  }

  // kill reward: exact tick match + delta == weapon award
  const kill = ctx.kills.find((k) => k.killer !== null && Math.abs(k.tick - midTick) <= 8 && d > 0);
  if (kill) {
    try {
      const award = killReward(RULES, { weaponId: kill.weapon });
      if (d === award) {
        return { category: "kill_reward", confidence: "exact-event-match", matchedEvents: [`kill@${kill.tick}:${kill.weapon}`], ruleSource: `weapon table ${kill.weapon}=${award}` };
      }
      // compound: kill + something else in the same 8-tick window
      const rest = d - award;
      if (rest > 0) {
        return { category: "compound_transition", confidence: "ambiguous-multiple-events", matchedEvents: [`kill@${kill.tick}:${kill.weapon}(+${award})`, `+${rest} same-window`], ruleSource: `kill ${award} + ${rest}` };
      }
    } catch {
      /* unknown weapon — fall through */
    }
  }

  // plant personal: +300 at plant tick for the planter
  if (ctx.planterIndex !== null && d === PLANT_PERSONAL) {
    return { category: "plant_personal", confidence: "window-compatible", matchedEvents: ["plant"], ruleSource: "roundRewards.plantBonusPlayer" };
  }
  // defuse personal: +300 at defuse tick
  if (ctx.defuserIndex !== null && d === DEFUSE_PERSONAL) {
    return { category: "defuse_personal", confidence: "window-compatible", matchedEvents: ["defuse"], ruleSource: "roundRewards.defuseBonusPlayer" };
  }

  // ── settlement window ───────────────────────────────────────────────────────
  if (inSettlement) {
    const won = ctx.winnerTeamKey === ctx.playerTeamKey;
    const winBase = ctx.endReason === "bomb_defused" || ctx.endReason === "target_bombed" ? WIN_BOMB : WIN_ELIM;
    if (won && d === winBase) {
      return { category: "round_win_reward", confidence: "exact-settlement", matchedEvents: [`win:${ctx.endReason}`], ruleSource: `roundRewards.win* = ${winBase}` };
    }
    // win + CT shared award (CT side only)
    if (won && d === winBase + CT_SHARED * ctx.tEliminated) {
      return { category: "compound_transition", confidence: "exact-settlement", matchedEvents: [`win:${ctx.endReason}(+${winBase})`, `ct-shared ${CT_SHARED}×${ctx.tEliminated}(+${CT_SHARED * ctx.tEliminated})`], ruleSource: `win + ctTeamKillReward×tElim` };
    }
    // win + plant/defuse personal in the same 8-tick sample (defuse ends round)
    if (won && d === winBase + PLANT_PERSONAL) {
      return { category: "compound_transition", confidence: "exact-settlement", matchedEvents: [`win:${ctx.endReason}(+${winBase})`, `plant/defuse personal(+${PLANT_PERSONAL})`], ruleSource: `win + plantBonusPlayer/defuseBonusPlayer` };
    }
    // CT shared award as an INDEPENDENT jump (settled ~3.7s after endTick,
    // separate from the win/loss settlement transition)
    if (d < 1400 && d > 0 && d % CT_SHARED === 0 && d / CT_SHARED <= 8) {
      return { category: "ct_shared_reward", confidence: "exact-settlement", matchedEvents: [`ct-shared ${CT_SHARED}×${d / CT_SHARED}`], ruleSource: "roundRewards.ctTeamKillReward (independent settlement)" };
    }
    // loss bonus (dead players; T survivor gets 0 — L3 invariant)
    if (!won && LOSS_PAYOUTS.has(d)) {
      return { category: "loss_bonus", confidence: "exact-settlement", matchedEvents: [`loss:${ctx.endReason}`], ruleSource: "loss payout table (model-independent amount)" };
    }
    if (!won && d === PLANT_LOSS) {
      return { category: "plant_loss_team_bonus", confidence: "exact-settlement", matchedEvents: [`loss+plant:${ctx.endReason}`], ruleSource: "roundRewards.plantBonusT" };
    }
    if (!won && LOSS_PAYOUTS.has(d - PLANT_LOSS) && d - PLANT_LOSS >= 1400) {
      return { category: "compound_transition", confidence: "exact-settlement", matchedEvents: [`loss-payout ${d - PLANT_LOSS}`, `plant-loss ${PLANT_LOSS}`], ruleSource: "loss payout + plantBonusT" };
    }
    // loss + CT shared award (CT side receives 50×tEliminated on ANY outcome)
    if (!won && ctx.playerTeamKey !== "" && d - CT_SHARED * ctx.tEliminated >= 1400 && LOSS_PAYOUTS.has(d - CT_SHARED * ctx.tEliminated)) {
      return { category: "compound_transition", confidence: "exact-settlement", matchedEvents: [`loss-payout ${d - CT_SHARED * ctx.tEliminated}`, `ct-shared ${CT_SHARED}×${ctx.tEliminated}(+${CT_SHARED * ctx.tEliminated})`], ruleSource: "loss payout + ctTeamKillReward×tElim (any outcome)" };
    }
    if (!won && d - PLANT_LOSS - CT_SHARED * ctx.tEliminated >= 1400 && LOSS_PAYOUTS.has(d - PLANT_LOSS - CT_SHARED * ctx.tEliminated)) {
      return { category: "compound_transition", confidence: "exact-settlement", matchedEvents: [`loss-payout ${d - PLANT_LOSS - CT_SHARED * ctx.tEliminated}`, `plant-loss ${PLANT_LOSS}`, `ct-shared ${CT_SHARED}×${ctx.tEliminated}`], ruleSource: "loss payout + plantBonusT + ctTeamKillReward×tElim" };
    }
    return { category: "sampling_ambiguous", confidence: "ambiguous-multiple-events", matchedEvents: [`settlement ${d}`], ruleSource: "settlement window, amount not uniquely decomposable" };
  }

  // positive outside settlement & kills: buy-window refund / sellback
  return { category: "refund_or_sellback", confidence: "window-compatible", matchedEvents: ["buy-window +"], ruleSource: "refund/sellback (item unresolved)" };
}

export interface LedgerStats {
  transitions: number;
  explainedExact: number;
  compoundExplained: number;
  samplingAmbiguous: number;
  unexplained: number;
  dollarWeighted: number;
  dollarUnexplained: number;
  playerRoundsWithUnexplained: number;
}

/** Aggregate L4 stats over classified transitions. */
export function summarizeLedger(rows: { category: TransitionCategory; delta: number; round: number; playerIndex: number }[]): LedgerStats {
  const s: LedgerStats = { transitions: rows.length, explainedExact: 0, compoundExplained: 0, samplingAmbiguous: 0, unexplained: 0, dollarWeighted: 0, dollarUnexplained: 0, playerRoundsWithUnexplained: 0 };
  const pr = new Set<string>();
  for (const r of rows) {
    s.dollarWeighted += Math.abs(r.delta);
    if (r.category === "kill_reward" || r.category === "plant_personal" || r.category === "defuse_personal" || r.category === "round_win_reward" || r.category === "loss_bonus" || r.category === "team_kill_penalty" || r.category === "purchase" || r.category === "refund_or_sellback" || r.category === "economy_reset" || r.category === "plant_loss_team_bonus") {
      s.explainedExact++;
    } else if (r.category === "compound_transition") {
      s.compoundExplained++;
    } else if (r.category === "sampling_ambiguous") {
      s.samplingAmbiguous++;
    } else {
      s.unexplained++;
      s.dollarUnexplained += Math.abs(r.delta);
      pr.add(`${r.round}:${r.playerIndex}`);
    }
  }
  s.playerRoundsWithUnexplained = pr.size;
  return s;
}

export function classifyTransitionsForRound(
  transitions: { tickFrom: number; tickTo: number; delta: number }[],
  ctx: RoundEventContext,
): { category: TransitionCategory; confidence: Confidence; matchedEvents: string[]; ruleSource: string }[] {
  return transitions.map((t) => {
    const r = classifyTransition(t, ctx);
    return { ...r };
  });
}

export type { ParsedDemoPackage };
