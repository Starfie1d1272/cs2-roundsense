# Runtime checks (Windows, pending)

Only two items remain that need a live Windows CS2 session. Nothing else
blocks the P0 advisor loop (GSI already provides `player_state.money`).

## 1. GSI consecutive_round_losses availability

`map.team_ct/t.consecutive_round_losses` is declared optional in the GSI
schema. If present on the current build (24537688), the advisor gets a real
lossStreak input; if absent, fall back to lossStreak=1 + manual note.

Check: `apps/gsi-recorder` (already records GSI) — look for
`consecutive_round_losses` in recorded NDJSON during any competitive match.

## 2. C4 real-game timer + latency

`c4-estimator` uses fuse 41000 ms (corpus-observed demo semantics). Real
game shows 40 s; measure end-to-end latency from `planted` payload to local
display, and confirm the displayed timer countdown vs actual detonation.

Check: record a match with a planted bomb via `apps/gsi-recorder`; compare
`round.bomb === "planted"` timestamps against local clock.

## (Dropped) Loss-counter runtime experiment

The Windows controlled experiment (startmoney 0 / maxmoney 65535 matrix,
GSI cfg `gamestate_integration_roundsense_lossbonus.cfg`) is superseded for
P0: the advisor needs lossStreak for projection, and if GSI provides
`consecutive_round_losses` (check #1) no simulation is needed. The win
decrement question remains an open research item with no product impact
until GSI proves lossStreak unavailable.
