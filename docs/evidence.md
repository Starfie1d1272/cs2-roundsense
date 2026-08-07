# Economic evidence (final research conclusions)

All long-term findings from the demo-economy research phase. Numbers are
reproducible via `pnpm validate` (`tools/validate-demo.ts`); the corpus
itself is NOT in the repo. Git history preserves the full research process.

## Verified

- Weapon prices/kill awards: generated from pinned GameTracking-CS2
  `2e606a0b` (`packages/economy-advisor/rules/weapons.v2026-08-06.json`);
  22 knife/bayonet event names auto-derived from `CSWeaponNameID.h`
  (fixture: `fixtures/csweaponnameid/knife-ids.txt`; upgrade the GameTracking
  revision → diff the fixture → completeness test fails until regenerated).
  Full corpus: 0 unknown kill weapons.
- Win rewards: elimination 3250 / bomb 3500 (bomb_defused, target_bombed).
- Loss payouts: `min(3400, 1400 + 500×count)`; `mp_starting_losses=1` →
  first loss of a half pays 1900. Loss counter resets: half r13, OT every 3
  rounds (r25, r28, …). Win decrement model is PROVISIONAL (count-dep used
  in validation; unresolved, see runtime-checks).
- Plant: team +600 on T loss with plant; planter personal +300. Defuser +300.
- CT shared team award: every CT +50 per T eliminated, paid on ANY round
  outcome, as an INDEPENDENT settlement jump after endTick (regular ~3.7s;
  half/OT-end delays longer).
- time_ran_out loss: surviving T gets NO loss payout (354 corpus samples,
  0 violations; the +1400 "counter-example" was a dead T's normal payout).
- moneySpent (`m_iCashSpentThisRound` sampled at round_freeze_end) is a
  freeze-end snapshot — it does NOT include buytime-tail purchases/refunds,
  so it is unsuitable as a full-round spending ledger. ±200/±300/±500 L1
  residual peaks are buy-window purchase/refund transitions visible in the
  replay cash stream.
- Replay-native ledger (Cologne 202 matches, 93,506 cash transitions,
  STRICT attribution — exact actor+tick+amount or exact known-event sums):
  95.2% exact, 4.6% buy-window (direction known, item unresolved), 0.1%
  sampling-ambiguous, 0.02% (20) unexplained (kills.json attribution gaps,
  an unknown −50 mechanism). L1-nonzero decomposition: 3613 summary-field
  limitation / 32 replay-dirty / 0 no-replay.
- L1 = summary-ledger exact reconciliation rate (90.6%), NOT rule accuracy.

## Server profile (do NOT infer from universal rules)

- OT start money is configurable (`mp_overtime_startmoney` game default
  10000; FACEIT default 10000 with 12500/13000/16000 options; BLAST 2026 MR3
  with 12500). Cologne corpus: odd-order OT openers (r25/r31/r37/r43) carry
  over, even-order (r28/r34/r40/r46) reset to 10000 — 100% consistent, 0
  exceptions. start_balance matches replay first-cash semantics (the pattern
  is real server behavior, not a field artifact), but the mechanism is not
  inferred. Live advisor: read `player_state.money`; never preset OT money.

## Not researched further (stopping rule)

- The 20 unexplained transitions: kept unexplained, no rule invented. Only
  revisited if they would change live purchase advice.
- Cologne OT alternating pattern: one minimal semantic check done (above);
  no deeper mechanism work.
