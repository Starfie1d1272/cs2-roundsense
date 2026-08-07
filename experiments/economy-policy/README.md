# RoundSense Final Professional Economy Analysis Pipeline

Reproducible offline analysis producing professional economy & purchase
reference surfaces for the Cologne Major 2026 frozen corpus.

**This is reference evidence, not the RoundSense recommendation policy.**
Next stage (policy distillation) combines this evidence with deterministic
CS2 economy rules and human policy judgement.

## Stages

```bash
# 1. build surfaces (corpus read-only)
python3 build_final_surface.py                 # -> results/cologne-2026/

# 2. plots (needs matplotlib — DAK venv has it)
env -u PYTHONPATH ~/GitHub/cs2-demo-analysis-kit/python/.venv/bin/python \
    plot_final_surface.py

# 3. audit gate (A..Q invariants)
python3 audit_final_surface.py                 # -> audit-report.txt, non-zero exit on failure

# 4. research batches (need canonical prices exported first)
pnpm exec tsx export_prices.ts                 # -> results/cologne-2026/_prices.json
python3 research_batch1.py                     # coverage / reachable-money / spend / preservation
python3 research_batch2.py                     # weapons / secondary / armor-kit-utility / retained / delta / marginal
python3 research_batch3.py                     # team / drop / role / round-score / feature ladder / stability / bootstrap / ambiguity
env -u PYTHONPATH ~/GitHub/cs2-demo-analysis-kit/python/.venv/bin/python research_batch4.py   # representation benchmark (sklearn)
python3 research_batch5.py                     # purchase-cost / affordability / policy-review-table
pnpm exec tsx v1_gap.ts                        # V1 gap (runs production advisor read-only)
python3 make_cards.py make_v1gap.py make_feature_value.py make_final_report.py
```

## Data contract

- Corpus: `player-rounds.json` (IEM Cologne Major 2026 event packages,
  cs2-demo-format/3.0, cs2df 3.1.0) — read-only.
- STRICT: not overtime, not drop_gave, not drop_received, not
  lossIndexAmbiguous → **25,986 rows** (hard assert).
- `roundStartMoney` = player-economies.startMoney. Distinct from
  `moneySpent` and freeze-end resulting loadout.
- `lossReward` = LOSS_REWARDS[clamp(lossIndex,0,4)] =
  [1400, 1900, 2400, 2900, 3400] (asserted 0..4).
- `correctedRetainedPrimary`: round 13 → None; transfer-like (prev
  resulting primary non-empty, current empty, spent $200–800) → UNKNOWN;
  else retainedPrimary. UNKNOWN never enters retained estimators.
- Grenades normalized once (JSON strings parsed); hard asserts: count
  0–4, flash ≤ 2.
- Weapon taxonomy: parsed from
  `cs2-demo-analysis-kit/packages/presentation/src/weapons.ts`
  (canonical display-name source with family groups). SSG 08 is sniper,
  never rifle. No hand-written weapon sets in this pipeline.

## Estimators

- Economy reference: adaptive Gaussian kernel along roundStartMoney,
  target N_eff = 100, h ∈ [$20, $500]. No spend filter (target = format
  economy state).
- Purchase/loadout: **budget feasibility first** — pool filtered to
  `moneySpent <= M`, then bandwidth re-selected on the feasible pool,
  then N_eff re-checked (N_eff < 20 → LOW_SUPPORT). Never borrow
  unaffordable behavior.
- Confidence: OBSERVED (exact_n>0) / INTERPOLATED (hull, nearest ≤ $200) /
  INTERPOLATED_WIDE (hull, nearest > $200) / EXTRAPOLATED (outside hull) /
  LOW_SUPPORT (N_eff < 20).
- Retained hierarchy: exact weapon → same-weapon family →
  **unsupported** (never no-retained fallback).

## Invariants (audit gate A..Q)

STRICT count; lossReward table; all five lossRewards present; pistol +
corrected-retained long gun = 0; no UNKNOWN in retained pools; grenade
bounds; economy probs sum ≈ 1; spend quantile order incl. p90 ≤ M;
probabilities ∈ [0,1]; T defusekit = 0; flash2 ≤ flash1plus; primary /
secondary marginals sum ≈ 1; loadout dedupe + topK/residual exact +
descending; no retained→none semantic fallback; dynamic row counts;
10 plots + overview with unsupported zones never connected.

## Output layout

Generated artifacts live in `results/cologne-2026/` (committed — 19 MB
total, each file < 10 MB): core surfaces, research CSVs, 10+1 curve PNGs,
policy-review-table.csv, policy-review-atlas.md, FINAL-POLICY-RESEARCH.md.
Raw corpus (43,620 rows JSON) is NOT committed — regenerate via
`build_final_surface.py` from the frozen event packages.

## Interpretation discipline

- Economy reference surface = professional behavior description.
- Purchase/loadout surface = feasibility-conditioned professional
  behavior description.
- Neither is automatically "optimal play".
