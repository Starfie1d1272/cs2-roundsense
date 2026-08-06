# Loss-Counter Runtime Audit Protocol (Windows, NOT executed this round)

Purpose: pin the loss-bonus win decrement with DIRECT observations
(GSI `consecutive_round_losses` + real loss payouts) on a controlled local
server, resolving what corpus replay windows cannot:

- non-cap win decrement (candidate-set says −1 for all win types; count-dep
  says −2 — conflict to settle)
- capped-state (count ≥ 4) win decrement (NO corpus window exists: 3400
  payouts are unidentifiable)
- whether `time_ran_out` differs
- whether `mp_starting_losses`/`mp_buytime` server overrides change anything

## Matrix

initialState: 1, 2, 3, 4 (set by losing N rounds; cap at 4)
win reason (execute exactly once, then lose once):
  elimination / time_ran_out / bomb_defused / target_bombed

For each (initialState, winReason):  win once → lose once → record.

## Per-run output table (to be filled during the run)

| initialState | winReason | directStateBefore | directStateAfter | nextLossPayout |
| -----------: | --------- | ----------------: | ---------------: | -------------: |

## Files

- `gsi.cfg`           — GSI config (game state integration)
- `payload-recorder.py` — raw payload recorder (writes NDJSON, one JSON per line)
- `server.cfg`        — local server: mp_freezetime 15, mp_buytime 20 (H2 confirmed),
                        mp_startmoney 16000, mp_maxmoney 16000, mp_buy_anywhere 1,
                        mp_roundtime 5, mp_maxrounds 60, sv_cheats 1
- `client-auto.cfg`   — demo recording + round automation hooks
- `extract.py`        — auto-extract: round start / freeze end / round end ticks,
                        GSI consecutive loss state, next loss payout, live convar dump

## Execution steps (when approved to run)

1. Copy `gsi.cfg` to `.../game/csgo/cfg/`; `payload-recorder.py` on the Windows box.
2. Launch CS2 local server:
   `cs2.exe -insecure -novid -console +map de_dust2 +exec server.cfg`
3. `record buytest` in console; start payload recorder.
4. For each cell: lose N rounds to reach initialState, execute the target
   win exactly once (no second win in between), then lose once.
   - elimination win: kill all 5 opponents (or bot_stop + kill)
   - time_ran_out win: T does nothing, timer runs out (CT wins)
   - bomb_defused: T plants, CT defuses
   - target_bombed: T plants, bomb explodes
5. `stop` recording; run `extract.py buytest.dem payloads.ndjson` →
   fills the output table with direct GSI states and demo payouts.
6. `help mp_buytime; find mp_buytime; help mp_starting_losses` → capture
   convar help text (missing from static files).

## Notes

- GSI field: `map.team_ct/team_t.consecutive_round_losses` — declared in
  Valve's GSI docs and all third-party SDKs; whether the current build
  (24537688) actually sends it is UNVERIFIED — the recorder logs whatever
  arrives; if absent, the demo settlement + payout path still yields
  direct states (both payouts are table values with controlled initial
  state, so no inference ambiguity).
- Demo netvar fallback: `CCSGameRules.m_iNumConsecutiveCTLoses` /
  `m_iNumConsecutiveTerroristLoses` (GameTracking-CS2 2e606a0b schemas) —
  try demoparser2 `parse_ticks` with these prop names on the recorded demo;
  unverified whether the demo stream serializes game-rules props.
- Do NOT run until the user approves starting CS2.
