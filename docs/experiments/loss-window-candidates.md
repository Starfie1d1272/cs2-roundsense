# Strict Loss-Counter Windows (2026-08-06, interpretation-corrected)

Tool: `experiments/economy-ledger/scripts/loss-window-candidates.ts`
Corpus: 202 Cologne matches with replay (stage1-3 + playoff).
Purpose: windows for future cross-validation against direct GSI/convar
reads. NO model is selected from this set.

## Terminology (corrected)

Payout tiers are OBSERVED ladder indices, NOT internal counter values:

```text
previousLossPayoutTier = (previousLossPayout − 1400) / 500
nextLossPayoutTier     = (nextLossPayout − 1400) / 500
observedPayoutTierDrop = previousLossPayoutTier − nextLossPayoutTier
```

The internal counter at win start is `previousLossPayoutTier + 1` ONLY
under the documented update order (loss → counter+1, win → counter−d,
half start 1). The internal decrement candidate is therefore:

```text
candidateInternalWinDecrement = previousLossPayoutTier + 1 − nextLossPayoutTier
```

This is `derived_under_documented_update_order` — NOT direct observation.
Terms like `stateBeforeWin` / `winDecrement` must not be used unless the
counter was read from GSI/netvar.

## Window definition

Pattern L-W-L: the losing team loses r−1 (known payout → known tier),
wins r EXACTLY once (winReason = r.endReason), loses r+1 immediately.

Exclusions: second win in between, halftime/OT crossing, 3400 cap on
either payout, player missing, cash cap, buytime-tail buy/refund, TK,
plant reward pollution, time_ran_out loser-payout ambiguity, missing
replay/settlement, non-table payouts.

## Results

326 candidate player-rounds; 77 unique windows (match+round).
By win reason: elimination 169, target_bombed 112, bomb_defused 31,
time_ran_out 14.

### Interpretation A — observed payout-tier transition

- elimination:  prevTier 0→0 ×29, 1→0 ×16, 2→1 ×79, 3→2 ×45
- target_bombed: prevTier 0→0 ×29, 1→0 ×14, 2→1 ×48, 3→2 ×21
- bomb_defused: prevTier 0→0 ×5, 1→0 ×7, 2→1 ×17, 3→2 ×2
- time_ran_out: prevTier 0→0 ×5, 2→1 ×5, 3→2 ×4

Every non-cap window shows `observedPayoutTierDrop = 1`; no difference
across win types; capped windows remain unidentifiable. This is ALL the
data directly proves.

### Interpretation B — candidate internal decrement (derived)

`candidateInternalWinDecrement = prevTier + 1 − nextTier`:

- elimination / target_bombed / bomb_defused: prevTier 1/2/3 → **2** (×16+79+45, ×14+48+21, ×7+17+2); prevTier 0 → 1 (floor, uninformative)
- time_ran_out: prevTier 2/3 → **2** (×5, ×4); prevTier 0 → 1

So under the documented update order the candidate internal decrement is
**2 for every non-cap win type including time_ran_out** — consistent with
the count-dep hypothesis' non-cap branch. Still derived; only direct
GSI/netvar reads can confirm.

## QF1-m1 r16 (time_ran_out win) — corrected reading

```text
r15 loss payout tier = 3
r17 loss payout tier = 2
observed payout-tier drop across the intervening timeout win = 1

若失败后 counter 增加 1，则 r16 进入胜利时的候选内部状态为 4，
随后到 2 对应候选 decrement 2。只有直接 GSI/netvar 才能区分实际状态时序。
```

The earlier "pre-win state is 3" phrasing was dropped: tier 3 + the
documented +1 update gives candidate internal state 4 at win start.

## Still valid conclusions

- time_ran_out shows NO difference from other win types in the observable
  payout-tier transition;
- 3400 cap payouts still cannot be uniquely identified (capped interval
  [4, ∞)); cap windows remain absent from this set;
- all-corpus diff=0 rates are NOT proof of any state machine.

## time_ran_out T-survivor note (corrected — the +1400 was NOT an anomaly)

The previously flagged "counter-example" (s3-r1-m1-m2 r17, T survivor
luchov +1400) is a FALSE ALARM: luchov was DEAD at settlement
(hp=0 at endTick, deathTick < endTick). The +1400 is the normal loss
payout for a dead T. Full audit (261 time_ran_out rounds, 1305 T rows):
surviving T players get 0 loss payout (338/359 exactly 0; the 21 nonzero
jumps are kill rewards 100/300 or the plant reward 300 —
`cash_player_bomb_planted 300`), dead T players get the full table ladder
(1400/1900/2400/2900/3400). "T survivor gets no loss bonus" stands with
zero counter-examples.
