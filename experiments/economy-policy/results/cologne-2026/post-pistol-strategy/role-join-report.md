# Role Join Report (post-pistol strategy research)

- metadata: `/Users/starfie1d/GitHub/cs2-roundsense/experiments/economy-policy/metadata/player-roles.md` (SHA256 `58e5aea75e0799844ec037fee9e7d081518ff86ee280dbe8c22a592e698664cc`) — verbatim copy of /Users/starfie1d/Downloads/hltv-cologne-major/player-roles.md
- parse timestamp: 2026-08-08T00:07:40.236475+00:00
- metadata rows: 160 (32 teams x 5 players hard-checked)
- corpus maps: 202, series: 106 (106/106 in spec.json)
- team resolution: 343 exact-5 rosters, 61 alias-team rosters, 0 ambiguous, 0 unmatched

## Join method on PLAYER_STYLE_STRICT

- exact (5/5 roster, player name exact normalized): 25167
- alias-player (roster 4/5 + explicit player alias): 432
- alias-team-only (roster 4/5, alias player has no metadata row): 387
- unresolved: 0

## Aliases (explicit, see role-aliases.csv)

- `FL4MUS` -> `(no metadata player)` (23 team-roster occurrences) — roster change: s1ren listed in infographic, FL4MUS played the demos
- `Techno4K` -> `Techno` (13 team-roster occurrences) — name variant: demo 'techno4k' vs infographic 'Techno'
- `susp` -> `(no metadata player)` (6 team-roster occurrences) — roster change: susp played demos, not in infographic roster
- `v$m` -> `vsm` (8 team-roster occurrences) — stylized name: demo 'v$m' vs infographic 'vsm'
- `venomzera` -> `ven0mzera` (11 team-roster occurrences) — character variant: demo 'venomzera' vs infographic 'ven0mzera' (0/o)

## Method

- join key: `team + exact normalized player name` (NFC, casefold, strip spaces).
- no fuzzy/similarity matching anywhere; 4/5-roster matches require the other 4 names to be exact.
- All-Star and CT/T role systems kept separate (no merging, no AWP responsibility inference).
- `AWPer / AWPer` in the infographic is a copy of the un-differentiated AWPer label; no primary/secondary AWP inference is made.

## Known limitation

- players with `alias-team-only` (FL4MUS/BetBoom, susp/Aurora) have NULL role fields and are excluded from role-conditioned analysis (they stay in team-level analysis).