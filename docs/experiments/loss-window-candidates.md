# Strict Loss-Counter Windows (2026-08-06)

Tool: `experiments/economy-ledger/scripts/loss-window-candidates.ts`
Corpus: 202 Cologne matches with replay (stage1-3 + playoff).
Purpose: windows for future cross-validation against direct GSI/convar
reads. NO model is selected from this set; state is `indirect` (inferred
from payouts).

## Window definition

Pattern L-W-L: the losing team loses r−1 (known payout → known state),
wins r EXACTLY once (winReason = r.endReason), loses r+1 immediately.

Exclusions: second win in between (adjacency), halftime/OT crossing,
3400 cap on either payout (state not unique — count ∈ [4,∞)), player
missing, cash cap, buytime-tail buy/refund, TK, plant reward pollution,
time_ran_out loser-payout ambiguity (see below), missing replay/settlement,
non-table payouts.

## Results

- 326 candidate player-rounds; 77 unique windows (match+round).
- By win reason: elimination 169, target_bombed 112, bomb_defused 31,
  time_ran_out 14.

Decrement distribution (stateBefore → stateAfter, from payouts):

- elimination:  stateBefore 1→0 ×16, 2→1 ×79, 3→2 ×45, 0→0 ×29
- target_bombed: stateBefore 1→0 ×14, 2→1 ×48, 3→2 ×21, 0→0 ×29
- bomb_defused: stateBefore 1→0 ×7, 2→1 ×17, 3→2 ×2, 0→0 ×5
- time_ran_out: stateBefore 2→1 ×5, 3→2 ×4, 0→0 ×5

**Zero exceptions: every non-cap window shows dec = 1, every win type.
stateBefore = 0 stays 0 (floor).**

## Implications (descriptive only — no rule change this round)

- Non-cap win decrement = 1 for ALL win types (incl. time_ran_out) in
  these 77 clean windows. This contradicts the `count-dep` hypothesis
  (non-cap −2) and the `timeout-2` hypothesis, matching `standard-1`.
- The QF1-m1 r16 "count 4→2 (−2)" reading is contradicted: its true
  pre-win state is 3 (r15 loss paid 2900 → count 3), time_ran_out win −1
  → 2 → r17 loss 2400 — fully consistent with dec = 1.
- Capped state (count ≥ 4): NO window exists (3400 unidentifiable) —
  cap decrement remains open; the Windows controlled experiment must
  supply it.
- `count-dep` / `timeout-2` remain UNRESOLVED hypotheses; the 88.9-89.2%
  all-corpus hit rate is NOT evidence for them (compensation artifact
  risk, per reviewer). Do not promote anything from this file.

## New side finding (needs its own audit)

s3-r1-m1-m2 r17 (time_ran_out, CT wins): T survivor luchov received
+1400 at round end — a counter-example to the "T survivor gets no loss
bonus" rule as modeled. Time_ran_out loser-payout semantics are unsettled;
windows touching time_ran_out losses are excluded until resolved.
