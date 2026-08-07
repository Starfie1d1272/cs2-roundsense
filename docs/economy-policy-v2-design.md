# Economy Policy V2 — Design (Final)

> **Evidence snapshot:** `research/economy-policy @ 0875db9` (read-only evidence source)
> **Branch:** `feat/economy-policy-v2` (from `main @ 37a9756`)
>
> This document SUPERSEDES the earlier research-stage design. The old
> six-class target, money-bucket policy, 55.4% Top-1 selector and ~6% team
> oracle claims were research-stage artifacts and are NOT design inputs here.

## 1. Product principles

RoundSense is a read-only helper for ordinary players. Two strict layers:

- **FACT** — objective, computable, explainable (current money, loss reward,
  next-round projections via the deterministic projection engine).
- **ADVICE** — purchase advice carrying human policy judgement (this V2).

Professional behavior data is **professional behavioral evidence**, not
optimal truth. V2 does **not** predict professional eco/semi/force/full
labels.

## 2. Policy output

`PolicyDecision` (packages/economy-advisor/src/policy-v2.ts):

- `displayTag`: SAVE | LIGHT | SMG | RIFLE | AWP — a UX label, not a taxonomy
- `spendCeiling`, `primaryIntent` (keep_current/none/paid_pistol/smg/
  budget_rifle/rifle/awp), `armorIntent`, `utilityIntent`
  (smoke/flashes 0-2/HE/fire), `defuseKit`, `confidence`
  (high/medium/low), `reasons`, concrete `purchases` + `totalCost`
  (incremental, inventory-aware), and `projection`
  (lossNoMoreSpend / lossAfterRecommendation / T plant branch).

## 3. Policy input

`PolicyInput`: side, lossReward (1400..3400), roundStartMoney (external —
DecisionAnchor interface reserved, not wired to live GSI this round),
roundStartMoneyConfidence (exact/estimated/unavailable), currentMoney,
currentInventory, override (auto/save/rifle/awp/max_combat),
ctRiflePreference (m4a4 default — backward compatible).

`NextRoundGoal` mapping: rifle_armor/rifle_util → rifle, awp → awp,
max_combat_now → max_combat.

## 4. Decision anchor

V2 is a **round decision policy**, not a per-GSI-tick re-decision. Concept:

```
freeze-time start → DecisionAnchor → PolicyDecision
```

After the player starts buying, keep the round decision and recompute the
remaining purchases from current inventory/money. Live anchor integration is
deferred (Windows runtime validation pending). The API takes
`roundStartMoney` externally.

## 5. Strong-buy gate (evidence anchor, human-calibrated)

Professional full-buy ≥ 50% is NOT the default threshold (conservative by
design). The auto policy uses **professional full ≥ 80%** as the strong-buy
gate, extracted mechanically from `economy-reference-surface.csv`
(OBSERVED/INTERPOLATED region, retained=none):

| side | lr1400 | lr1900 | lr2400 | lr2900 | lr3400 |
|---|---|---|---|---|---|
| T | $3,950 | $4,100 | $4,150 | $4,000 | $4,400 |
| CT | $4,050 | $4,100 | $4,250 | $4,100 | $4,450 |

`STRONG_BUY_GATES` in policy-v2.ts carries source commit + artifact comments.

## 6. Next-round preservation

Baseline target (canonical `price()` — never hand-written constants):
T: AK-47 + kevlar + smoke + flash; CT: preferred M4 + kevlar + smoke + flash.

```
nextLossNoSpend = clamp(roundStartMoney + lossReward)
preservationBudget = max(0, nextLossNoSpend - baselineCost)
```

Default gating always uses **plain loss**; the T plant +$600 branch is
display-only and never widens the preservation budget (conservative policy).

## 7. No-retained automatic policy

- At/above strong-buy gate → RIFLE: main rifle (T: AK, CT: ctRiflePreference)
  + armor + utility, filled to the fullest within current cash.
- Below gate → `spendCeiling = min(currentMoney, preservationBudget)`, choose
  the highest fully-affordable combat tier (mandatory core must be complete —
  never "Galil without armor"):
  1. budget rifle + armor (T: Galil, CT: FAMAS)
  2. side SMG + armor (T: MAC-10, CT: MP9)
  3. side paid pistol + armor (T: Tec-9, CT: Five-SeveN)
  4. P250 / light utility
  5. save

Deagle is NOT an auto default (proficiency variance) — reserved for future
preference/manual bundle.

## 8. Retained primary policy (canonical classes)

Weapon class comes from the canonical weapon metadata (weaponClassOf) — the
SG553/AUG missing-rifle bug is fixed. Retained rifle/AWP/other → keep_current
(armor/smoke/flash priority; never auto re-buy same-class primary). Retained
SMG → keep (conservative: drop/team channel invisible) unless override
rifle/max_combat. Retained strong primary gets a kevlar core exception above
preservationBudget (protecting owned gear).

## 9. Armor / helmet / CT kit / utility

- Mandatory core: weapon + kevlar for rifle/budget-rifle/SMG/AWP/paid-pistol
  force tiers.
- T helmet: higher priority (after weapon+kevlar, before smoke); never break
  weapon+kevlar affordability for helmet.
- CT helmet: lower priority (weapon → kevlar → smoke → kit → flash → helmet);
  no "CT doesn't need helmet" claim — just default priority.
- CT kit: not forced in eco/light cores; after weapon+kevlar+smoke in
  strong-buy / retained-strong states if affordable; T always false.
- Utility priority: T smoke → flash1 → (helmet) → fire → flash2 → HE;
  CT smoke → kit → flash1 → helmet → HE → incendiary → flash2. Grenade slots
  ≤ 4 and flash ≤ 2 enforced inventory-aware; items fitted within spendCeiling.

## 10. AWP policy (human decision)

Auto NEVER guides non-AWP players to AWP (role/proficiency variance). AWP
path only for retained AWP or override=awp. awp override: AWP+kevlar if
affordable; else preserve so plain-loss next round reaches AWP+kevlar.

## 11. Overrides

- save: spendCeiling = 0, purchases = [] (FACT projections still shown).
- rifle: explicit rifle intent, main → budget fallback, full cash.
- max_combat: no preservation guard, maximize current-round combat; still
  side-legal, inventory-aware, within cash, grenade-legal, no duplicate
  primary without replacement semantics.

## 12. Confidence

- high: roundStartMoney exact + standard inventory.
- medium: estimated anchor, or within ±$200 of strong gate.
- low: anchor unavailable → affordability-only fallback on current money,
  reason `missing_round_start_anchor` — never masquerades as a full V2
  decision.

## 13. Projection

All money projections go through the existing deterministic projection
engine (projectNextRoundMoney); policy never re-implements reward formulas.

## 14. Explicitly excluded from V2

Round stage, score diff, team oracle, player identity (research: in-sample
entropy drops but grouped-OOF feature ladder shows no B5 roundstage
improvement). No runtime research tables / sklearn / 19MB artifacts — runtime
is small deterministic constants + canonical prices + code.

## 15. Planner capability fixes (P0/P1)

- weapon family from canonical metadata (SG553/AUG = rifle; SSG08 = sniper ≠
  rifle).
- defuse_kit: consume/cost/resultingLoadout/inventory-aware semantics.
- side legality enforced (T/CT bans), generic paid-pistol handling
  (Tec-9/Five-SeveN/P250/...), Galil/FAMAS/M4A1-S/molotov/incendiary
  supported via canonical metadata — minimal refactor, no advisor rewrite.

## 16. Validation

- Test matrix: threshold (gate ±50), preservation, legality, retained
  inventory, armor semantics ($350 upgrade only for armor=100+no-helmet),
  overrides, CT kit, anchor confidence, projections, determinism.
- Property sweep: money $0–16000 step $50 × T/CT × 5 lossReward × 9
  inventories × 5 overrides — cost ≤ money, side legality, no duplicate
  primary, grenade legality, projection bounds, save=0, T kit=false, plant
  branch display-only, determinism (all pass).
- Offline replay: professional supported review-table states → descriptive
  comparison + divergence report (experiments/economy-policy/results/
  policy-v2-review/) — no automatic tuning.

## 17. Out of scope this round

Live GSI DecisionAnchor runtime, overlay, Windows packaging. Live anchor is a
separate validation stage.
