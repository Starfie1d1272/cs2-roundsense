# Cologne Professional Purchase Policy Audit

Evidence convergence of the read-only behavioral validation of the
RoundSense economy policy against professional decisions from the frozen
IEM Cologne Major 2026 corpus. Full machine-readable metrics live in
`docs/data/cologne-policy-summary.json`; this document is the auditable
interpretation.

**Evidence language**: OBSERVED = parsed demo fields; DERIVED = derived
from demo chronology; MODEL RESULT = RoundSense replay output;
INFERENCE = analyst interpretation; UNKNOWN = not resolvable from the
corpus contract.

## Status

Recorded 2026-08-08. Read-only audit — no production policy change
resulted from it. The next-policy design derived from these findings is
`docs/economy-policy-v2-design.md`.

## Purpose

Answer: if a professional player-round's pre-decision state were given to
the current RoundSense advisor, what would it recommend; what did the
professional actually do; and where are the gaps in candidate space,
ranking, and the `nextRoundGoal` abstraction. Professional behavior is
treated as an **expert behavioral reference**, never as optimal action or
ground truth.

## Corpus provenance

- Event packages (frozen, sha256 in manifest):
  `cs2-demo-analysis-kit/fixtures/_bench/map-control-reference/events/`
  - `iem-cologne-major-2026-stage1.zip`
  - `iem-cologne-major-2026-stage2.zip`
  - `iem-cologne-major-2026-stage3.zip`
  - `iem-cologne-major-2026-playoff.zip`
- Contract: `cs2-demo-format/3.0`; exporter `cs2df 3.1.0`; parser
  `demoparser2 0.41.3` (per map manifest, verified during extraction).
- 202 maps, 43,620 player-rounds parsed. Evaluation restricted to
  **non-overtime** rounds (eligible 41,940).

## Evaluation unit

Player-round = one player in one round, at the pre-decision point (round
start cash + retained loadout from the previous round, survival-corrected
from kill ticks). Purchases are not item-level events in the v3 contract:
`player-economies.json` provides per-round spend + resulting loadout, so
purchases are DERIVED via loadout delta.

## Data quality / eligibility

- STRICT-INDIVIDUAL subset: 25,986 player-rounds — excludes overtime,
  directional drop flags (spent ≫ own loadout delta = teammate weapon buy;
  loadout gain without spend = received drop), and loss-index-ambiguous
  rounds (first loss after a win, where the win-decrement rule matters).
- Loss index: DERIVED from round wins/losses (zero-reset on win, +1 on
  loss, cap 4, half start 1); 100% coverage; ambiguous cases excluded from
  STRICT.
- Quality flags: `exact_purchase_events` NOT available; `refund_ambiguous`
  and `post_freeze_buy` UNKNOWN from the contract; `drop_sensitive`
  flagged directionally (DERIVED).
- Money p25/median/p75: $3,100 / $4,150 / $5,600.

## Current RoundSense policy under test

MODEL RESULT — the current main economy-advisor was imported directly
(not copied): fixed human-authored BundleTemplate candidate space +
inventory-aware planner (`planPurchases`, armor incremental rules, grenade
multiset) + affordability + `nextRoundGoal` + next-round money projection
+ `targetCost` heuristic ranking. The advisor does NOT learn purchases
from demos. CURRENT DEFAULT CLI goal = `rifle_armor`; the default-goal
evaluation uses exactly that.

## Current-default results

STRICT subset, default goal `rifle_armor`:

- Top-1 decision class: **55.4%**
- Top-1 primary family: **67.0%**; exact primary: **50.8%**
- Top-1 armor+helmet: **60.7%**; grenade core: **61.4%**
- Top-3 (recommended + alternatives as one candidate set): decision class
  **72.0%**; primary family **83.3%**; loadout core 27.4%
- Spend: MAE **$820**, median AE $650, p90 $1,700, mean signed −$150
  (advisor under-spends on average)

## Fixed-goal results

| goal | Top1 class | Top1 fam | Top1 exact | Top3 class | Top3 fam |
|---|---|---|---|---|---|
| rifle_armor | 55.4% | 67.0% | 50.8% | 72.0% | 83.3% |
| rifle_util | 58.8% | 81.2% | 65.3% | 68.5% | 79.8% |
| awp | 18.4% | 44.4% | 43.4% | 60.3% | 18.2% |
| max_combat_now | 55.8% | 79.9% | 67.5% | 65.2% | 73.7% |

rifle_util has the best primary-family agreement; a fixed awp goal is
only meaningful on dedicated AWP states (most rounds are not AWP rounds).

## Candidate-space coverage

- Any-goal ORACLE (upper bound, NOT deployable — must never be reported
  as product accuracy): professional decision class representable by at
  least one goal's candidates **82.9%**; primary family **94.7%**.
- Default-goal top-3 representability: 72.0%.
- Candidate failures: 7,280 strict rounds (28.0%) — the unrepresentable
  residue is utility-mix and armor-priority variants inside the rifle
  family (e.g. rifle + smoke + 2 flash + HE is not a single candidate),
  not missing weapon categories.

## Ranking diagnostics

Ranking failures (class present in candidates but not Top-1): 4,302
(16.6%) under the default goal. Mismatch directions (OBSERVED pro →
MODEL rs):

| direction | rate |
|---|---|
| pro eco → rs save | 11.3% |
| pro save → rs smg | 6.0% |
| pro eco → rs smg | 5.8% |
| pro awp → rs rifle | 5.0% |
| pro force → rs smg | 5.0% |
| pro smg → rs rifle | 3.9% |
| pro force → rs rifle | 2.3% |
| pro eco → rs rifle | 2.0% |
| pro rifle → rs smg | 1.9% |
| pro save → rs rifle | 0.7% |

Dominant channels: pro-eco → rs-save (advisor over-conservative on low
money), pro-save/eco → rs-smg (half-smg candidate steals low-money
recommendations), pro-awp → rs-rifle (goal abstraction, not ranking: no
AWP candidate exists under `rifle_armor`).

## Goal-model diagnostics

The default `rifle_armor` goal is the dominant single failure. Pro-AWP
rounds (5.0%) cannot be recommended under it; low-money eco intent is
framed as save; force intent is framed as half-SMG. Fixed-goal replay
shows no single goal dominates — `rifle_util` is closest on primary
family, but every fixed goal under-frames some professional intent.
`nextRoundGoal` is a user-intent abstraction with no professional ground
truth; the audit treats it as fixed input, and the gap it leaves is the
largest controllable lever.

## Spend diagnostics

MAE $820; median AE by segment (default goal): money 2000–2999 $1,000,
1000–1999 $902, CT $878, loss_2 $1,011, retained_AWP $1,872 (worst),
retained_rifle $707 (best), money 0–999 $640. Mean signed error −$150
matches the eco→save direction.

## Professional purchase archetypes

STRICT, OBSERVED frequencies:

| archetype | definition | count | rate |
|---|---|---|---|
| rifle + smoke + flash | rifle primary, ≥1 smoke + ≥1 flash | 10,519 | 40.5% |
| pistol force | no rifle/smg/awp, spent ≥ forceMin | 3,579 | 13.8% |
| rifle + double flash | rifle primary, ≥2 flash | 2,930 | 11.3% |
| helmet skip | rifle + kevlar, no helmet | 2,047 | 7.9% |
| SMG + utility | SMG primary + any util | 1,530 | 5.9% |
| rifle without armor | rifle primary, no armor | 83 | 0.3% |

Current candidate coverage: rifle+smoke+flash is expressible
(rifle-helmet-util / rifle-util-full); double-flash, helmet-skip and
SMG+utility have no dedicated candidate; pistol-force is partially
expressed by force-deagle.

## Individual vs team-context analysis

Conditional entropy of the decision class: individual money-bucket view
1.293 bits → with oracle team-total-money view 1.215 bits (−6.0%,
DERIVED). Interpretation: under this discrete conditioning and feature
representation, oracle team context adds limited extra information —
individual state already explains most observed purchase-class variation.
Caveat: ~36% of all player-rounds carry directional team weapon-transfer
activity (9,842 gave / 5,103 received in the non-strict subset), a
channel individual GSI cannot observe.

## Drop limitation

The strict subset removes drop-flagged rounds; the drop channel itself is
a product limitation: a normal-player live product cannot replicate
professional team economy coordination through individual GSI.

## Representative mismatch cases

From `docs/data` casebook (default goal; win/loss deliberately not used
to judge correctness):

| match | r | player | side | money | pro action | pro class | rs rec | rs class |
|---|---|---|---|---|---|---|---|---|
| qf1-m1 dust2 | 1 | HUASOPEEK | t | $800 | pistol $650 | eco | save $0 | save |
| qf1-m1 dust2 | 1 | FalleN | ct | $800 | pistol $300 | eco | save $0 | save |
| qf1-m1 dust2 | 2 | KSCERATO | ct | $1,950 | force $1,800 | force | half-smg $1,900 | smg |
| qf1-m1 dust2 | 2 | molodoy | ct | $2,100 | force $2,000 + SSG 08 | rifle | half-smg $1,900 | smg |
| qf1-m1 dust2 | 2 | max | t | $3,550 | force $3,250 + MAC-10 | smg | rifle-kevlar $3,350 | rifle |
| qf1-m1 dust2 | 3 | YEKINDAR | ct | $2,450 | eco $500 | eco | half-smg $1,900 | smg |
| qf1-m1 dust2 | 3 | KSCERATO | ct | $2,550 | semi $300 | eco | half-smg $1,250 | smg |

Mismatch categories: low-money intent (eco→save), force mis-framed as
SMG, SMG mis-framed as rifle, eco mis-framed as SMG.

## Interpretation

Candidate space: GOOD on primary family (94.7% oracle), PARTIAL on exact
loadouts (utility-mix variants). Ranking: PARTIAL (16.6% class-present-
but-not-selected; Top-3 72.0% vs Top-1 55.4%). Goal model: the primary
issue for the default configuration. Information ceiling: individual
state is strong; team oracle adds ~6% entropy reduction; drop channel
unobservable.

## Product implications

1. Do not treat professional behavior as optimal — it is a behavioral
   reference for candidate/ranking calibration.
2. Candidate expansion (utility archetypes) is low-risk and expected to
   close most of the 28% candidate-failure gap.
3. Ranking calibration (decision-class targets, match-grouped) should
   follow candidate expansion; ML is deferred until a simple
   conditional-frequency baseline is measured.
4. nextRoundGoal redesign (auto policy class or hybrid) is the largest
   lever but touches product semantics — design in
   `docs/economy-policy-v2-design.md`, not here.

## Explicit non-claims

- Professional purchase behavior is NOT optimal/ground-truth.
- Any-goal oracle coverage (82.9% / 94.7%) is NOT deployable accuracy.
- Match outcome was NOT used to judge purchase correctness.
- Loss-index zero-reset model is DERIVED; win-adjacent rounds excluded.
- sklearn baselines were NOT run (dependency unavailable at audit time);
  only conditional frequencies (pure Python) were produced.

## Reproduction provenance

- Extractor: per-map parse of the frozen event packages (rounds.json,
  player-economies.json, kills.json, players.json, manifest.json).
- Replay: current main `economy-advisor` imported directly, four goals ×
  (recommended + up to 2 alternatives) per player-round.
- Metrics: `docs/data/cologne-policy-summary.json` (aggregates only).
- Raw intermediates (43,620-row player-round table, full replay output)
  are intentionally NOT committed; they were regenerated in /tmp during
  the audit and can be regenerated from the frozen corpus.
