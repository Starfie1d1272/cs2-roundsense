# Replay Cash-Source Diagnosis (2026-08-06)

Bounded, one-shot diagnosis. No rules were changed; the loss-bonus state
machine was NOT modified. Tool: `scripts/diagnose-cash-sources.ts`.

## Method

For a chosen round, replay segment `[freezeEndTick(r), startTick(r+1))` is
decoded per player (money/equipValue/hp, delta streams). Every nonzero cash
jump is printed with tick, phase (live / round_end / post), events (kills,
plant, defuse, round_end within ±1 frame), equipment-value delta, and
cross-referenced field-by-field with `player-economies.json`
(startMoney(r), moneySpent(r), startMoney(r+1)).

Three representative samples:

1. `qf1-m2` r4 — the −200/+200 pair (luchov p5, meyern p6)
2. `qf2-m1` r14 — a typical −500 residual (Boombl4 p2)
3. `qf1-m1` r17 — loss immediately after a `time_ran_out` win (luchov p0)

## Evidence

### Sample 1 — qf1-m2 r4 (ct_win, CT=teamB wins, tElim=5)

luchov p5 (CT): startMoney(r4)=3800, moneySpent(r4)=1100, startMoney(r5)=6000

- replay firstCash = 2700 = 3800 − 1100 → buy-phase net outflow BEFORE
  freezeEndTick matches moneySpent exactly (diff = 0)
- replay lastCash = 6000 = startMoney(r5) → diff = 0
- tick 23230 [live] 2700 → 2500 (−200), equipΔ +200 → **buy in the buytime
  tail (after freezeEndTick; buytime 20s > freezetime 15s) — NOT in moneySpent**
- tick 24814 +3250 (win) | tick 25110 +250 (**team award 250 = 5×50, exact**)

meyern p6 (CT): startMoney(r4)=5800, moneySpent(r4)=2000, startMoney(r5)=8700

- firstCash 3800 = 5800 − 2000 (diff 0); lastCash 8700 = startMoney(r5) (diff 0)
- tick 23302 [live] 3800 → 4000 (+200) → **sellback/refund in the buytime
  tail — NOT in moneySpent**
- tick 24590 +600 (mp7 kill), tick 24814 +3850 (= 3250 + 600 second kill),
  tick 25110 +250 (**same-frame team award 250 — identical to luchov**)

### Sample 2 — qf2-m1 r14 (target_bombed, CT=teamA loses, tElim=1)

Boombl4 p2 (CT): startMoney(r14)=2050, moneySpent(r14)=1500, startMoney(r15)=2500

- firstCash 550 = 2050 − 1500 (diff 0); lastCash 2500 = startMoney(r15) (diff 0)
- tick 102419 [live] −300 (equipΔ +300) and tick 102435 [live] −200
  (equipΔ +200) → **buytime-tail buys of 300 + 200 = 500 NOT in moneySpent**
- tick 111739 +2400 (**loss payout 2400 = count 2, standard model exact**)
- tick 112035 +50 (**team award 50 = 1×50, exact**)
- income-diff = 2500 − 2050 + 1500 = 1950 vs true income 2400+50 = 2450
  → residual −500 == the 500 of unrecorded buytime-tail buys

### Sample 3 — qf1-m1 r17 (target_bombed, T wins; CT=teamA loses; r16 was
time_ran_out CT win)

luchov p0 (CT): startMoney(r17)=3950, moneySpent(r17)=1500, startMoney(r18)=5250

- firstCash 2450 = 3950 − 1500 (diff 0); lastCash 5250 = startMoney(r18) (diff 0)
- tick 155993 +300 (m4a1 kill)
- tick 160521 +2400 (**loss payout 2400 = count 2 after the time_ran_out win
  at r16 — direct per-frame confirmation of the −2 decrement; a −1 model
  would have paid 2900**)
- tick 160825 +100 (**team award 100 = 2×50, exact**)

## Answers

1. **replay cash at r+1 start == startMoney(r+1)?** — YES, diff = 0 in all
   four player-rounds (6000/6000, 8700/8700, 2500/2500, 5250/5250).
2. **replay buy-phase net outflow == moneySpent(r)?** — Only up to
   freezeEndTick. Buytime is 20s but the recorded window ends at freezetime
   (15s); purchases and sellbacks in the remaining ~5s tail are absent from
   moneySpent (luchov −200, meyern +200, Boombl4 −500).
3. **Unified $250 team award?** — YES. Both players receive +250 on the same
   tick (25110); sample 2 +50 (tElim=1), sample 3 +100 (tElim=2). The
   team-award count is exactly 50 × tEliminated; there is NO口径 problem.
4. **Where does ±200 first appear?** — luchov tick 23230 (−200 buy),
   meyern tick 23302 (+200 sellback), Boombl4 tick 102419+102435 (−500
   buys). All inside the buytime tail, all absent from moneySpent.
5. **Player-to-player misattribution (one +, one −)?** — NO. Each deviation
   is that player's own buytime-tail cash flow vs the moneySpent window;
   there is no cross-player transfer.
6. **Classification** — `summary-data limitation` of `player-economies`
   `moneySpent`: the aggregation window (freezetime, 15s) is narrower than
   the real buy window (buytime, 20s). Not a game-rule issue, not a replay
   issue, not an exporter/parser bug (every field matches replay exactly
   within its window). Residuals equal to ±(buytime-tail net outflow) —
   observed as −200/−500 and +200 — must NOT be used to infer game rules.

## Side finding (already-flagged item, now with per-frame evidence)

The time_ran_out win decrement: sample 3 shows the round after a
time_ran_out win paying 2400 (count 2) in the raw replay settlement,
consistent with the count-dependent / timeout −2 hypothesis. This remains a
hypothesis (no convar exposes it); it is NOT promoted to a rule here.

## Still indistinguishable

- Sellback vs refund vs buy of a dropped/re-bought item: equipΔ shows
  inventory value change but not item identity (weapon dict index available
  but not itemized per jump in this run).
- Whether `moneySpent` counts purchases at exactly the buytime cutoff
  (20s) or at freezeEndTick (15s) is inferred from the data, not from code.
