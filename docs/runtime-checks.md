# Runtime observations (Windows build 14174, 2026-08-07)

Controlled single-session observation (`roundsense-economy-runtime-20260807.ndjson`,
84 payloads, bot match, CT side). Findings below are OBSERVED — do not
upgrade beyond their evidence scope.

## 1. GSI consecutive_round_losses — OBSERVED (availability + 2 clean discriminator samples)

`map.team_ct/t.consecutive_round_losses` is sent on every in-game payload
(40/41), all phases. Semantics observed:

- loss → +1 per consecutive loss (1→2→3 across r3/r4/r5)
- win → `max(0, lCT−2)` style decrement observed twice (3→1, 1→0)
- payout discrimination (clean losses, no buys/kills):
  - GSI index 1 → actual clean-loss payout **$1900** = lossBonus(1)
  - GSI index 2 → actual clean-loss payout **$2400** = lossBonus(2)
- indices 0/3/4 and the capped state (lCT=4) were NOT payout-verified in a
  controlled runtime — the direct-GSI mapping is NOT falsified by these two
  samples, but is not fully proven either.

Product usage: lossStreak = GSI value as `lossBonus()` index stays valid.

## 2. C4 receive-to-receive intervals — OBSERVED (4 samples, samples only)

first planted → first exploded, monotonic receive timestamps:

```text
round0  39378.6 ms
round1  39493.7 ms
round3  38559.8 ms
round4  39043.0 ms
min 38559.8  median 39378.6  max 39493.7  mean 39118.8
```

Samples only — `C4_FUSE_RULES.fuseMs` stays 41000 (corpus-observed). The
~39.1s mean includes both directions of GSI push latency; no 40 vs 41
decision from this.

## 3. Inventory representation — OBSERVED

- kevlar: `player.state.armor` 0→100 on buy; **never** in `player.weapons`; $650.
- helmet upgrade (vesthelm) from existing armor: `player.state.helmet`
  false→true; **never** in `player.weapons`; money delta **−$350**
  (= price(kevlar_helmet) − price(kevlar)).
- defuse kit: **`player.state.defusekit = true`** (boolean, added to the GSI
  schema); `player.weapons` carries no entry; money delta −$400.
- smoke: `weapon_smokegrenade` type=Grenade state=active `ammo_reserve=1`; −$300.
- flash ×1: `weapon_flashbang` type=Grenade `ammo_reserve=1`; −$200.
- flash ×2: the SAME single `weapon_flashbang` entry with `ammo_reserve=2`
  (no second entry, no quantity field); −$200 each.
- weapons entries carry `paintkit`, `ammo_clip/ammo_reserve/ammo_clip_max`;
  gun state includes `reloading`.

## (Dropped) Loss-counter runtime experiment

The Windows controlled experiment (startmoney 0 / maxmoney 65535 matrix)
is superseded: GSI provides `consecutive_round_losses` (see #1) and the
advisor uses it directly. The win-transition decrement shape and capped
state remain open research items with no product impact while the GSI
index itself is used.
