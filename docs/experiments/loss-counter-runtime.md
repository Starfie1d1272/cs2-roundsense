# Loss-Counter Runtime Protocol (pending Windows execution)

Status: NOT executed. This protocol is the only surviving loss-counter
experiment document; it will be merged into the evidence base and deleted
after the Windows run.

Goal: confirm the win decrement with DIRECT observations (GSI
`map.team_ct/team_t.consecutive_round_losses` + real loss payouts) on a
controlled local server, resolving what corpus replay windows cannot:

- non-cap internal decrement (corpus derivation: prevTier+1−nextTier = 2
  for all non-cap win types incl. time_ran_out — derived, unconfirmed)
- capped-state (count ≥ 4) decrement (no corpus window exists)
- whether time_ran_out differs
- server-override effects (mp_starting_losses / mp_buytime)

## Corpus context (already established, do not re-derive)

- 202 replay matches scanned; 77 clean L-W-L windows; observed
  payout-tier drop across any single non-cap win = 1 (all win types
  identical); candidate internal decrement = 2 (interpretation B).
- 3400-cap payouts are unidentifiable — capped decrement has ZERO corpus
  evidence.
- GSI field and game netvar (`CCSGameRules.m_iNumConsecutiveCTLoses` /
  `m_iNumConsecutiveTerroristLoses`, GameTracking-CS2 2e606a0b) are
  declared but runtime-unverified on build 24537688.

## Matrix

initialState 1/2/3/4 × win reason elimination/time_ran_out/bomb_defused/
target_bombed. Each cell: `mp_restartgame 1` (full reset — money AND
counters) → lose N rounds to state → win EXACTLY once → lose once →
record → dump convars.

Output per cell:

| initialState | winReason | directStateBefore | directStateAfter | nextLossPayout |
| -----------: | --------- | ----------------: | ---------------: | -------------: |

## Kit (configs, recorder, automation)

- `experiments/economy-ledger/runtime-audit/server.cfg` — mp_startmoney 0 /
  mp_maxmoney 65535 (no cash cap), mp_starting_losses 1,
  mp_consecutive_loss_aversion 1, mp_consecutive_loss_max 4, halftime/OT/
  clinch disabled, mp_playercashawards 1, mp_teamcashawards 1,
  mp_freezetime 15, mp_buytime 20.
- `experiments/economy-ledger/runtime-audit/gamestate_integration_roundsense_lossbonus.cfg` —
  copy to `<cs2>/game/csgo/cfg/` BEFORE launching; restart the game; the
  console load command is unverified (check `find gamestate_integration`).
- `experiments/economy-ledger/runtime-audit/payload-recorder.py` — raw
  payload NDJSON recorder (auth stripped).
- `experiments/economy-ledger/runtime-audit/client-auto.cfg` — demo
  recording + cell hooks + bot/side control (bot_quota_mode fill, bot_stop,
  jointeam, 5v5 preservation — no shorthanded/takeover/auto-balance).
- Also capture `help mp_buytime` / `help mp_starting_losses` text (missing
  from static files).

## Post-run

- Extract: round start / freeze end / round end ticks, GSI consecutive
  state, next loss payout, actual convar values.
- Merge conclusions into docs/assumptions.md + packages/demo-oracle/src/
  loss-bonus-state.ts; delete this protocol and the runtime-audit kit.
