# Economy Policy V2 — Evidence-Backed Design

Design document (NOT an implementation) for the next economy policy
layer, derived from the Cologne professional purchase policy audit
(`docs/cologne-purchase-policy-audit.md`, STRICT subset n=25,986).

Status: proposed architecture for review. No production code changes.

## 1. Why V2

Audit findings (MODEL RESULT on the frozen Cologne corpus):

- Default `rifle_armor` Top-1 decision class 55.4%, Top-3 72.0%.
- Candidate space: primary family 94.7% oracle-representable — GOOD.
- Ranking: 16.6% of strict rounds have a compatible candidate that the
  `targetCost` heuristic does not select — PARTIAL.
- Goal model: default goal mis-frames eco (11.3% → save), AWP (5.0% →
  rifle), force (5.0% → SMG) — DOMINANT failure for the default.
- Team-context oracle adds only ~6% conditional-entropy reduction —
  individual state is the strong signal; the drop channel (~36% of
  rounds) is unobservable via individual GSI.

V2 therefore replaces/extends ONLY the strategy-selection layer, keeping
the validated deterministic economy engine intact.

## 2. Preserved deterministic engine (untouchable in V2)

The following are rule/state-layer components and must NOT be rewritten
or replaced by any policy-learning component:

- `price()` / weapon table (pinned GameTracking source)
- `lossBonus()` / loss table
- `inventoryFrom()` / GSI live mapping (armor numeric, defusekit,
  grenade ammo_reserve multiset)
- `planPurchases()` / armor incremental rules / grenade multiset
  subtraction
- `resultingLoadout()` / `fulfillsLoadoutGoal()`
- next-round money projection (`projectNextRoundMoney`)
- affordability and `breaksGoal` gating
- C4 estimator (unrelated)

## 3. Proposed conceptual architecture

```
Live observable state (individual)
        ↓
Policy classifier / policy selector   ← NEW (V2)
        ↓
Decision intent / archetype
        ↓
Deterministic purchase planner        ← existing planPurchases
        ↓
Affordable concrete purchases
        ↓
Recommended + alternatives
```

V1 chain (goal → planner → rank) becomes (state → policy class →
planner → rank). The first version must NOT jump to state → exact item
basket (neural) — that discards the validated engine and the audit shows
a small archetype space suffices.

## 4. Reconsider nextRoundGoal — three options

Audit evidence: the default goal is the primary failure source, but no
fixed goal dominates; professional intent is a mix.

### Option A — user-selected goal only (status quo)

- Pros: zero UX change; user intent explicit.
- Cons: default `rifle_armor` mis-frames eco/force/AWP intents (audit
  channels: eco→save 11.3%, awp→rifle 5.0%, force→smg 5.0%); the audit
  shows professional intent is state-driven, not goal-driven.

### Option B — automatic policy class

System infers a policy class from live state:

```
save / eco / pistol-force / SMG / rifle / AWP
```

- Pros: directly targets the audit failure modes; state already carries
  the information (individual-view conditional entropy 1.293 bits, i.e.
  money bucket + side + loss index + retained loadout predicts class
  well); matches professional behavior distribution.
- Cons: user intent (e.g. "saving for AWP") can override state-inferred
  class; cold-start for unusual states; needs the class→planner mapping.

### Option C — hybrid

Automatic policy class by default, with explicit user overrides:
"I'm saving for AWP" / "max combat now".

- Pros: preserves the deterministic engine, fixes the default-goal
  failure, and keeps user intent as an override channel (V1 goals become
  overrides rather than the default path).
- Cons: slightly more UX surface.

**Recommendation: Option C.** The audit shows automatic class selection
is feasible from individual state (the top mismatch channels are
state-predictable), while the existing goals are still the natural
override vocabulary. Phase it: (1) ship the automatic class selector on
top of the current planner, (2) keep `rifle_armor` as the fallback class
until the selector is validated, (3) add override UI later.

## 5. Professional archetype candidate layer

The candidate layer should support a bounded set of side-aware,
inventory-aware archetypes (not one template per professional basket):

- `save` — no spend (existing)
- `eco` — pistol + light utility (existing force-deagle is the closest)
- `pistol-force` — deagle/tec9 + armor + utility (audit 13.8%)
- `smg` — SMG + kevlar (+ utility) (audit 6.6%; current half-smg)
- `rifle` — rifle + kevlar (audit helmet-skip 7.9%: rifle + kevlar
  WITHOUT helmet must remain expressible)
- `rifle+util` — rifle + kevlar/helmet + smoke + flash (audit 40.5%),
  with double-flash variant (11.3%)
- `awp` — AWP + kevlar (existing awp bundles)

Rules: archetype count stays small (~8); each archetype is a function of
(side, inventory) not a fixed basket; utility is a multiset; exact
professional baskets are evidence for tuning the archetype contents, not
new templates.

## 6. Ranking design

Compare, in order:

1. **Conditional-frequency / deterministic policy baseline** — decision
   class from (side, money bucket, loss index, retained primary/armor)
   via a frequency table built on the STRICT subset, then class→planner.
   This is implementable without new dependencies and is the audit's
   Phase 9 output shape.
2. **Interpretable statistical model** — multinomial logistic regression
   or shallow tree on the same features, if a training path is set up
   (offline, match-grouped split). sklearn is currently unavailable; that
   is not a reason to install a large ML stack now.
3. **More complex models** — future option only, gated by 1 vs 2
   evidence.

Acceptance: the deterministic frequency baseline must be measured before
any ML is considered.

## 7. Policy V2 evaluation gates

Same frozen Cologne corpus, same STRICT subset, same eligibility —
before/after replay only.

Minimum gates (engineering acceptance targets, NOT statistical claims):

| metric | current baseline | gate |
|---|---|---|
| default Top-1 decision class | 55.4% | meaningful improvement |
| default Top-3 decision class | 72.0% | no regression |
| primary-family Top-1 | 67.0% | no regression |
| spend MAE | $820 | no significant worsening |
| any-goal candidate coverage | 82.9% | no regression (archetype expansion may raise) |

If numerical thresholds are needed, they are engineering acceptance
targets, not significance conclusions.

## 8. Explicit non-goals for V2 phase 1

- No neural / end-to-end basket generation.
- No changes to the preserved engine (section 2).
- No claiming professional behavior is optimal.
- No new dependency on the Cologne corpus at runtime (offline
  calibration only).
- No attempt to model the drop channel beyond flagging it as a
  limitation.
