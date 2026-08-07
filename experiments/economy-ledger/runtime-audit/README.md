# runtime-audit kit

Configs and scripts for the pending Windows loss-counter controlled
experiment. Protocol, matrix, and execution steps:
[docs/experiments/loss-counter-runtime.md](../../../docs/experiments/loss-counter-runtime.md)

- `server.cfg` — controlled-server convar setup (no cash cap, counters on)
- `gamestate_integration_roundsense_lossbonus.cfg` — GSI config (copy to
  game cfg dir before launch, then restart the game)
- `payload-recorder.py` — raw GSI payload recorder (NDJSON, auth stripped)
- `client-auto.cfg` — demo recording + matrix-cell automation hooks

NOT executed yet. Do not run until the user approves starting CS2.
