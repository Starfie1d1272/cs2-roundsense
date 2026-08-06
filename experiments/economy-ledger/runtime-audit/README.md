# Loss-Counter Runtime Audit Protocol (Windows, NOT executed this round)

Purpose: pin the loss-bonus win decrement with DIRECT observations
(GSI `consecutive_round_losses` + real loss payouts) on a controlled local
server, resolving what corpus replay windows cannot:

- internal win decrement (corpus derivation: prevTier+1−nextTier = 2 for
  all non-cap win types incl. time_ran_out — needs direct confirmation)
- capped-state (count ≥ 4) win decrement (NO corpus window exists)
- whether `time_ran_out` differs from other win types
- whether `mp_starting_losses`/`mp_buytime` server overrides change anything

## Matrix

initialState: 1, 2, 3, 4 (set by losing N rounds from a restart; cap at 4)
win reason (execute exactly once, then lose once):
  elimination / time_ran_out / bomb_defused / target_bombed

For each (initialState, winReason):  mp_restartgame 1 → lose to state →
win once → lose once → record → dump convars.

## Per-run output table (to be filled during the run)

| initialState | winReason | directStateBefore | directStateAfter | nextLossPayout |
| -----------: | --------- | ----------------: | ---------------: | -------------: |

`directStateBefore/After` come from GSI `map.team_ct/team_t.
consecutive_round_losses` (if the build sends it) or the demo netvar
fallback; `nextLossPayout` from the demo/replay settlement. Every cell
also records the convar dump (`find mp_starting_losses; find
mp_consecutive_loss; find mp_buytime; find cash_team_loser_bonus`).

## Files

- `gamestate_integration_roundsense_lossbonus.cfg` — GSI config. Copy to
  `<cs2>/game/csgo/cfg/` BEFORE launching the game, then (re)start the
  game. The console load command is NOT verified on build 24537688 —
  check `find gamestate_integration` first; do not assume it exists.
- `payload-recorder.py` — raw payload recorder (NDJSON, one JSON per line,
  auth stripped)
- `server.cfg` — mp_startmoney 0 / mp_maxmoney 65535 (no cash cap!),
  mp_starting_losses 1, mp_consecutive_loss_aversion 1,
  mp_consecutive_loss_max 4, mp_halftime 0, mp_overtime_enable 0,
  mp_match_can_clinch 0, mp_playercashawards 1, mp_teamcashawards 1,
  mp_freezetime 15, mp_buytime 20, mp_buy_anywhere 1
- `client-auto.cfg` — demo recording + cell automation hooks

## Execution steps (when approved to run)

1. Copy the GSI cfg into `<cs2>/game/csgo/cfg/`; restart the game;
   start `payload-recorder.py` on the Windows box.
2. Launch CS2 local server:
   `cs2.exe -insecure -novid -console +map de_dust2 +exec server.cfg`
3. `record buytest` in console; `sv_cheats 1`.
4. For each cell:
   a. `mp_restartgame 1` (full reset — money AND loss counters; a fresh
      `record` segment per cell or rely on GSI timestamps)
   b. lose N rounds to reach initialState (do nothing; die to CT/T)
   c. execute the target win EXACTLY once:
      - elimination: kill all 5 opponents (sv_cheats: `ent_fire` or
        normal combat; verify all 5 died before round end)
      - time_ran_out: as T never plant; timer runs out (CT wins)
      - bomb_defused: T plants, CT defuses
      - target_bombed: T plants, bomb explodes
   d. lose the NEXT round once (do nothing)
   e. dump convars; record GSI states + payout
5. `stop` recording; run extraction (payout from demo settlement; states
   from GSI payloads; demo netvar fallback try
   `m_iNumConsecutiveCTLoses` / `m_iNumConsecutiveTerroristLoses` via
   demoparser2 `parse_ticks` — UNVERIFIED whether the demo stream
   serializes game-rules props).

## Bots (the matrix needs a 5v5 with controllable results)

- `bot_quota_mode fill` + `bot_add_ct` / `bot_add_t` until 5v5, or set
  `bot_quota 10; bot_quota_mode fill`.
- `bot_stop 1` freezes bots between actions; `bot_stop 0` resumes.
- Join the side you want to execute the win on:
  `jointeam ct` / `jointeam t` (spectator first: `jointeam spectate`).
- Forced results with cheats: `bot_kill` (kills a bot), `ent_fire` for
  plants/defuses (`ent_fire planted_c4 use` by the carrier, etc.), or use
  real movement + `bot_stop 0` for a normal elimination.
- Avoid: BOT takeover on disconnect (don't disconnect; stay in the match),
  shorthanded awards (keep 5v5 at all times — `mp_autoteambalance 0`,
  `mp_limitteams 0`, never let a player drop mid-cell), auto-balance
  (disabled), warmup ending mid-cell (`mp_warmup_end` before cells).
- After each cell: `mp_restartgame 1` resets bots/money/counters.

## Notes

- GSI field: `map.team_ct/team_t.consecutive_round_losses` — declared in
  Valve's GSI docs and all third-party SDKs; whether build 24537688 sends
  it is UNVERIFIED — the recorder logs whatever arrives.
- With startmoney 0 and controlled losses, the demo settlement payouts are
  directly readable and unambiguous (no 3400-cap ambiguity in non-cap
  cells; the cap cell checks the GSI counter directly).
- Do NOT run until the user approves starting CS2.
