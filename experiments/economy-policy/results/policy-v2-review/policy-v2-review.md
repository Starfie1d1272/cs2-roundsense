# Policy V2 Offline Replay — Descriptive Comparison

> Professional evidence source: research/economy-policy @ 0875db9 (policy-review-table.csv, supported states only).
> Policy: human-designed V2 (this branch). DESCRIPTIVE COMPARISON — no automatic tuning.

states replayed: 2105

## Overall spend vs professional distribution

- below professional p25: 7%
- within p25–p75: 31%
- above professional p75: 62%

## By side

- T: below p25 7% · within 27% · above p75 66% (n=1012)
- CT: below p25 8% · within 34% · above p75 59% (n=1093)

## By lossReward

- lr1400: below p25 6% · within 21% · above p75 73% (n=754)
- lr1900: below p25 20% · within 52% · above p75 28% (n=464)
- lr2400: below p25 1% · within 26% · above p75 73% (n=445)
- lr2900: below p25 2% · within 39% · above p75 59% (n=156)
- lr3400: below p25 1% · within 24% · above p75 75% (n=286)

## By retained state

- none: below p25 16% · within 43% · above p75 41% (n=812)
- AK-47: below p25 0% · within 21% · above p75 78% (n=308)
- AWP: below p25 1% · within 13% · above p75 85% (n=137)
- M4A1-S: below p25 1% · within 25% · above p75 74% (n=317)
- M4A4: below p25 2% · within 24% · above p75 74% (n=319)
- MAC-10: below p25 2% · within 28% · above p75 70% (n=104)
- MP9: below p25 2% · within 26% · above p75 72% (n=108)

## Chosen primary professional support

- high professional support (≥20%): 0%
- low support (<20%): 24%
- absent from professional top3: 15%
- keep_current (n/a): 61%

## Intentional divergences (human policy)

- Conservative strong-buy gate (pro full≥80%) — below gate we prefer preservation over blind force.
- AWP auto-disabled: auto never guides non-AWP players to AWP (proficiency divergence).
- Retained SMG not auto-replaced (drop/team channel invisible).
- CT helmet lower priority than smoke/kit (no enemy weapon context).
- Deagle not an auto paid pistol.

## Top 30 divergence states (|policy cost − pro median|)

| side | lr | money | retained | tag | policy $ | pro p25/med/p75 | band | primary (pro support) |
|---|---|---|---|---|---|---|---|---|
| CT | 1400 | 3400 | none | SAVE | 500 | 2550/3300/3350 | below_p25 | none (absent) |
| CT | 1400 | 3950 | none | LIGHT | 1150 | 3850/3900/3900 | below_p25 | Five-SeveN (absent) |
| CT | 1400 | 6000 | AK-47 | RIFLE | 3350 | 300/600/800 | above_p75 | keep_current (n/a) |
| CT | 1400 | 3750 | none | LIGHT | 950 | 3550/3650/3750 | below_p25 | P250 (absent) |
| CT | 1400 | 3550 | none | SAVE | 800 | 3350/3450/3550 | below_p25 | none (absent) |
| CT | 1400 | 6000 | AWP | AWP | 3350 | 400/700/850 | above_p75 | keep_current (n/a) |
| CT | 1400 | 3600 | none | LIGHT | 950 | 3450/3550/3550 | below_p25 | P250 (absent) |
| CT | 1400 | 3650 | none | LIGHT | 950 | 3500/3550/3550 | below_p25 | P250 (absent) |
| CT | 1400 | 3700 | none | LIGHT | 950 | 3500/3550/3550 | below_p25 | P250 (absent) |
| CT | 1400 | 3900 | none | LIGHT | 1150 | 3550/3750/3900 | below_p25 | Five-SeveN (absent) |
| T | 1400 | 3300 | none | SAVE | 700 | 3150/3250/3300 | below_p25 | none (absent) |
| T | 1400 | 3350 | none | SAVE | 700 | 3200/3250/3300 | below_p25 | none (absent) |
| T | 1400 | 3550 | none | LIGHT | 950 | 3250/3500/3500 | below_p25 | P250 (absent) |
| T | 1400 | 3750 | none | LIGHT | 1150 | 3500/3700/3700 | below_p25 | Tec-9 (absent) |
| CT | 1400 | 3450 | none | SAVE | 800 | 3200/3350/3450 | below_p25 | none (absent) |
| CT | 1400 | 3500 | none | SAVE | 800 | 3300/3350/3450 | below_p25 | none (absent) |
| CT | 1400 | 3800 | none | LIGHT | 1150 | 3550/3700/3750 | below_p25 | Five-SeveN (absent) |
| CT | 1400 | 3850 | none | LIGHT | 1150 | 3550/3700/3750 | below_p25 | Five-SeveN (absent) |
| CT | 1400 | 4000 | none | LIGHT | 1350 | 3850/3900/3900 | below_p25 | Five-SeveN (absent) |
| CT | 1400 | 6000 | M4A1-S | RIFLE | 3350 | 500/800/800 | above_p75 | keep_current (n/a) |
| CT | 1400 | 6000 | M4A4 | RIFLE | 3350 | 500/800/800 | above_p75 | keep_current (n/a) |
| CT | 3400 | 4000 | AK-47 | RIFLE | 3350 | 300/800/1550 | above_p75 | keep_current (n/a) |
| CT | 3400 | 4050 | AK-47 | RIFLE | 3350 | 300/800/1550 | above_p75 | keep_current (n/a) |
| CT | 3400 | 4000 | M4A1-S | RIFLE | 3350 | 300/800/1550 | above_p75 | keep_current (n/a) |
| CT | 3400 | 4050 | M4A1-S | RIFLE | 3350 | 300/800/1550 | above_p75 | keep_current (n/a) |
| CT | 3400 | 4000 | M4A4 | RIFLE | 3350 | 300/800/1550 | above_p75 | keep_current (n/a) |
| CT | 3400 | 4050 | M4A4 | RIFLE | 3350 | 300/800/1550 | above_p75 | keep_current (n/a) |
| T | 1400 | 3500 | none | LIGHT | 950 | 3250/3450/3500 | below_p25 | P250 (absent) |
| T | 1400 | 3700 | none | LIGHT | 1150 | 3350/3650/3700 | below_p25 | Tec-9 (absent) |
| T | 1400 | 3250 | none | SAVE | 700 | 3100/3150/3250 | below_p25 | none (absent) |

## Answering the review questions (observation only)

- Where is the conservative policy deliberately cheaper than pros? Below-gate states where preservationBudget < tier core (we save instead of force).
- Where does it value the current round more? strong-buy states spend to full rifle+armor+util within cash; max_combat override explicitly.
- AWP auto-disabled divergence: professional AWP probability in non-AWP states is untouched — auto keeps those states rifle/light.
- Retained-SMG no-replace divergence: professional may swap SMG→rifle at higher money; V2 keeps SMG (drop channel invisible).

## Limitations

- Comparison uses professional conditional behavior; professional ≠ optimal.
- policy spend is incremental (current inventory); professional spend is per-round observed — retained states are not directly comparable in level.