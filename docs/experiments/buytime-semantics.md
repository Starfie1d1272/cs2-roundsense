# Buytime Semantics Audit (2026-08-06)

Worktree: `cs2-roundsense-buytime-audit` @ `824343e` + audit commits.
Scope: does `mp_buytime=20` count from round start (H1) or from freeze end (H2)?

## Evidence grading summary

CONFIRMED (corpus replay evidence):

- Successful buys occur at least until **freezeEnd + 19.63s** in the audited
  events' replays (202 matches scanned).
- H1 ("buytime from round_start; only ~5s left after freeze") is therefore
  REJECTED for these matches.
- `cs2df` samples the game-native `m_iCashSpentThisRound` at the
  `round_freeze_end` event.
- `moneySpent` does NOT include post-freeze-end buys/refunds (42/42 samples:
  startMoney − moneySpent == replay first cash).
- Buytime-tail flows explain only 4 of 1595 nonzero residuals (stage3) —
  NOT the main residual source.

NOT CONFIRMED (still open):

- exact buytime close upper bound (no failed-buy records in demos);
- exact tick offset between the demo `round_freeze_end` event and replay
  freezeEndTick;
- whether sellback/refund decrements `m_iCashSpentThisRound`;
- whether the native field is strictly gross.

## Candidate semantics

```text
H1: buyClose = roundStart  + mp_buytime        (freeze 15s → ~5s left after freeze)
H2: buyClose = freezeEnd   + mp_buytime        (freeze 15s → ~20s left after freeze)
```

## First-hand configuration (Windows desktop, current install)

- `D:\steam\steamapps\appmanifest_730.acf` → buildid **24537688** (Counter-Strike 2)
- `game/csgo/cfg/gamemode_competitive.cfg` (local install):
  - `mp_buytime 20`, `mp_freezetime 15`, `mp_buy_anywhere 0`, `mp_startmoney 800`
- GameTracking-CS2 (SteamDatabase) commit **2e606a0bc54f619bc96689ae29cddc337cbde60a**
  (2026-08-03), `DumpSource2/convars.txt`:
  - `mp_buytime 90 (min: 0, gamedll clientdll replicated release commandline_enforced)`
    (default 90; competitive cfg overrides to 20)
  - `mp_freezetime 6 (min: 0, max: 60, …)`
- The convars.txt dump carries no help TEXT for mp_buytime; the in-game
  `help mp_buytime` text is not extractable from static files → marked
  unresolved (would require a running game).

## Corpus evidence (no recording needed)

Replay scan across **202 matches** (Cologne stage1-3 + playoff) for cash
changes after freezeEndTick with equipment-value coupling (genuine buys:
Δcash<0 & Δequip>0; sellbacks: Δcash>0 & Δequip<0), restricted to the live
phase and ≥8s after freezeEnd:

- 137 post-freeze buy/sellback events; 8-20s tail buckets:
  8-10s×33, 10-12s×27, 12-14s×12, 14-16s×9, 16-18s×5, 18-20s×3
- **Latest genuine buys:**
  - donk  (s3-r3-a2-m3 r10)  freezeEnd+19.63s, roundStart+39.63s, Δ−500
  - MAJ3R (s3-r2-w4-m1 r8)   freezeEnd+19.50s, roundStart+39.50s, Δ−200
  - magixx (qf3-m3 r37)      freezeEnd+19.38s, roundStart+39.38s, Δ−300
- Original three diagnosed samples (qf1-m2 r4, qf2-m1 r14):
  luchov freezeEnd+0.75s / meyern +1.88s / Boombl4 +0.00s and +0.25s

### Implication

- With mp_freezetime=15, H1 closes the buy window at freezeEnd+5s.
  A successful purchase at **freezeEnd+19.6s** is impossible under H1
  regardless of how the demo `startTick` is aligned → **H1 is rejected**.
- The latest observed buy (freezeEnd+19.63s) sits just under
  freezeEnd+20s = mp_buytime under H2 → **H2 is supported**;
  corpus lower bound for the buy window = freezeEnd + 19.6s.

## Caveats / unresolved

- Upper bound (first FAILED buy) is not observable in demos (no failed-buy
  events) — a controlled experiment on build 24537688 would pin the exact
  cutoff; not needed to reject H1.
- `round.startTick` in cs2-demo-format is the demo `round_start` event tick,
  whose offset from the freeze start is NOT stable (observed
  freezeEnd−start ∈ {20s, 53s} across samples) — all conclusions above rest
  on the freezeEndTick basis only.
- The exact relationship between the demo `round_freeze_end` event tick and
  `replay freezeEndTick` was not re-derived this round (both come from the
  same exporter; per-frame settle jumps land within ±1 frame of endTick).

## Conclusion

`mp_buytime=20` counts from **freeze end (H2)**, i.e. the buy window is
approximately `[freezeEnd, freezeEnd + mp_buytime]` (≈ roundStart+15s →
roundStart+35s). Evidence: configuration value (mp_buytime=20) + corpus
behaviour (buys at freezeEnd+19.4-19.6s). The in-game help text and an exact
cutoff measurement remain unresolved without a controlled experiment.

Tools: `scripts/buytime-corpus-scan.ts` (reusable; `--json` emits
per-player-per-round tail flows), `scripts/diagnose-cash-sources.ts`.
