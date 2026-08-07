#!/usr/bin/env python3
"""Research batch 3: team context, drop-sensitive, role ambiguity,
round/score context, feature ladder, stability, bootstrap, ambiguity
(sections 17-25)."""
import csv, json, math, os, sys
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import (load_rows, build_dataset, drop_flags, wprob, wdist,
                             wquant, weights_at, retained_pool, no_retained_pool,
                             entropy_from_counts, entropy_from_probs, RESULTS)

ROWS = load_rows()
STRICT, FAMILY = build_dataset(ROWS)
GRID = list(range(800, 7601, 50))
TYPES = ["pistol", "eco", "semi", "force", "full"]
N_CLASSES = len(TYPES)
# single source of truth for loss reward (identical to build_final_surface)
LOSS_REWARDS_FIXED = [1400, 1900, 2400, 2900, 3400]
def loss_reward_fixed(idx):
    return LOSS_REWARDS_FIXED[max(0, min(int(idx), 4))]
for _i, _e in enumerate([1400, 1900, 2400, 2900, 3400]):
    assert loss_reward_fixed(_i) == _e
assert loss_reward_fixed(0) == 1400  # idx0 spot-check

# ---------- 17. team context ----------
# build team-round aggregates from ALL rows (not just strict)
team_rows = defaultdict(list)
for r in ROWS:
    if r["overtime"]:
        continue
    team_rows[(r["map"], r["roundNumber"], r["teamKey"])].append(r)
TEAM = {}
for k, members in team_rows.items():
    TEAM[k] = {
        "total_start": sum(m["startMoney"] for m in members),
        "total_spend": sum(m["moneySpent"] for m in members),
        "rifles": sum(1 for m in members if m["primary"] in FAMILY and FAMILY[m["primary"]] == "rifle"),
        "awps": sum(1 for m in members if m["primary"] == "AWP"),
        "smgs": sum(1 for m in members if m["primary"] in FAMILY and FAMILY[m["primary"]] == "smg"),
    }
# individual vs individual+team conditional entropy on format state (none retained)
H_ind = 0.0
H_team = 0.0
n = 0
ind_counts = Counter()
joint_counts = Counter()
for r in STRICT:
    if r["correctedRetainedPrimary"] is not None:
        continue
    key = (r["side"], r["_lr"], r["startMoney"] // 50)
    ind_counts[key] += 1
    t = TEAM.get((r["map"], r["roundNumber"], r["teamKey"]))
    tkey = None
    if t:
        tkey = (r["side"], r["_lr"], r["startMoney"] // 50,
                t["total_start"] // 2000, t["rifles"], t["awps"])
    joint_counts[(key, tkey if tkey else "NO_TEAM", r["actionType"])] += 1
# entropy: H(class | context) — raw counts normalized via entropy_from_counts
def cond_entropy(joint, keyer):
    ctx = defaultdict(Counter)
    for (k, tkey, cls), c in joint.items():
        ctx[keyer(k, tkey)][cls] += c
    H = 0.0
    total = sum(sum(c.values()) for c in ctx.values())
    for c in ctx.values():
        nk = sum(c.values())
        H += nk / total * entropy_from_counts(c)
    return H
H_ind = cond_entropy(joint_counts, lambda k, tk: k)
H_team = cond_entropy(joint_counts, lambda k, tk: (k, tk))
# hard invariant: entropy within [0, log2(5)]
assert 0 <= H_ind <= math.log2(N_CLASSES) + 1e-9, f"H_ind out of range: {H_ind}"
assert 0 <= H_team <= math.log2(N_CLASSES) + 1e-9, f"H_team out of range: {H_team}"
# team-round patterns
with open(f"{RESULTS}/team-round-patterns.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["map", "round", "team", "total_start", "total_spend", "rifles", "awps", "smgs"])
    for k in sorted(team_rows):
        m, rnd, team = k
        t = TEAM[k]
        w.writerow([m, rnd, team, t["total_start"], t["total_spend"], t["rifles"], t["awps"], t["smgs"]])
md = ["# Team-Context Ceiling", "",
      "format-state conditional entropy (retained=none):",
      "- individual context (side, lr, money//50): {:.4f} bits".format(H_ind),
      "- + team oracle (total start //2000, rifle count, AWP count): {:.4f} bits".format(H_team),
      "- relative reduction: {:.1f}%".format(100 * (1 - H_team / H_ind) if H_ind else 0),
      "",
      "注：team oracle 特征含本回合 resulting rifle/AWP counts（TEAM 聚合在回合结束后才",
      "完整可知）——这是 post-decision oracle ceiling，不是'缺少 teammate economy 导致",
      "X% 信息损失'的因果表述。全样本条件熵（非 held-out）。",
      "team-round-patterns.csv 含全量 team-round 聚合（含 drop 行——仅描述性）。"]
open(f"{RESULTS}/team-context-ceiling.md", "w").write("\n".join(md))
print("17 done: H_ind {:.4f} H_team {:.4f}".format(H_ind, H_team))

# ---------- 18. drop-sensitive excluded corpus ----------
DROP = []
for r in ROWS:
    if r["overtime"]:
        continue
    g, rec = drop_flags(r)
    if not (g or rec):
        continue
    DROP.append(r)
with open(f"{RESULTS}/drop-sensitive-states.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["map", "round", "side", "startMoney", "moneySpent", "lossReward",
                "retainedPrimary", "primary", "drop_type"])
    for r in DROP:
        g, rec = drop_flags(r)
        w.writerow([r["map"], r["roundNumber"], r["side"], r["startMoney"], r["moneySpent"],
                    LOSS_REWARDS_FIXED[max(0, min(int(r["lossIndex"]), 4))],
                    r["retainedPrimary"], r["primary"], "gave" if g else "received"])
from collections import Counter as C
drop_by_money = C(r["startMoney"] // 500 for r in DROP)
drop_weapons = C()
for r in DROP:
    g, rec = drop_flags(r)
    w = r["retainedPrimary"] or r["primary"]
    if w:
        drop_weapons[(w, FAMILY.get(w, "other"), "gave" if g else "received")] += 1
md = ["# Drop-Sensitive Analysis", "",
      "excluded drop rows: {} (gave / received 见 CSV)".format(len(DROP)), "",
      "## 按现金档（$500 桶，仅展示）"]
for k in sorted(drop_by_money):
    md.append("- ${}-{}: {}".format(k * 500, k * 500 + 499, drop_by_money[k]))
md.append("")
md.append("## 涉及武器（retained/resulting，top）")
for (w, fam, dt), c in drop_weapons.most_common(12):
    md.append("- {} ({}) {}: {}".format(w, fam, dt, c))
md.append("")
md.append("普通玩家 GSI 看不到队友交易：上述状态中个人推荐需保守（drop 通道不可见）。")
open(f"{RESULTS}/drop-sensitive-analysis.md", "w").write("\n".join(md))
print("18 done: drop rows", len(DROP))

# ---------- 19. role ambiguity ----------
# player-conditioned vs state-conditioned entropy on format state
player_ctx = defaultdict(Counter)
state_ctx = defaultdict(Counter)
for r in STRICT:
    if r["correctedRetainedPrimary"] is not None:
        continue
    player_ctx[(r["name"], r["side"], r["_lr"], r["startMoney"] // 50)][r["actionType"]] += 1
    state_ctx[(r["side"], r["_lr"], r["startMoney"] // 50)][r["actionType"]] += 1
def avg_entropy(ctx):
    total = sum(sum(c.values()) for c in ctx.values())
    return sum(sum(c.values()) / total * entropy_from_counts(c) for c in ctx.values())
H_state = avg_entropy(state_ctx)
H_player = avg_entropy(player_ctx)
assert 0 <= H_state <= math.log2(N_CLASSES) + 1e-9
assert 0 <= H_player <= math.log2(N_CLASSES) + 1e-9
# AWP/utility usage rate per player
player_awp = Counter()
player_util = Counter()
player_n = Counter()
for r in STRICT:
    player_n[r["name"]] += 1
    player_awp[r["name"]] += (r["primary"] == "AWP")
    player_util[r["name"]] += (len(r["grenades"]) >= 2)
md = ["# Role Ambiguity", "",
      "- state-conditioned entropy: {:.4f} bits".format(H_state),
      "- +player identity entropy: {:.4f} bits".format(H_player),
      "- in-sample player-conditioned residual entropy ≈ {:.4f} bits（全样本条件熵，非 held-out；".format(H_player),
      "  OOF 泛化能力未单独评估）",
      "",
      "AWP/utility usage per player（自动统计，不贴角色标签）:"]
for name, n in player_n.most_common(20):
    md.append("- {}: n={} awp={:.0%} util2+={:.0%}".format(
        name, n, player_awp[name] / n, player_util[name] / n))
open(f"{RESULTS}/role-ambiguity.md", "w").write("\n".join(md))
print("19 done")

# ---------- 20. round/score context ----------
# incremental entropy: + roundNumber, + score differential
ctx_rn = defaultdict(Counter)
ctx_sc = defaultdict(Counter)
for r in STRICT:
    if r["correctedRetainedPrimary"] is not None:
        continue
    diff = r["scoreCT"] - r["scoreT"]
    if r["side"] == "t":
        diff = -diff
    ctx_rn[(r["side"], r["_lr"], r["startMoney"] // 50, min(r["roundNumber"], 24) // 3)][r["actionType"]] += 1
    ctx_sc[(r["side"], r["_lr"], r["startMoney"] // 50, max(-6, min(6, diff)))][r["actionType"]] += 1
H_rn = avg_entropy(ctx_rn)
H_sc = avg_entropy(ctx_sc)
md = ["# Round/Score Context", "",
      "- baseline (side,lr,money): {:.4f} bits".format(H_ind),
      "- +round stage (//3): {:.4f} bits (Δ {:.3f})".format(H_rn, H_ind - H_rn),
      "- +score diff (clamped ±6): {:.4f} bits (Δ {:.3f})".format(H_sc, H_ind - H_sc),
      "",
      "解读（两层证据）:",
      "- in-sample conditional entropy 有明显下降（Δ 0.18–0.21 bits）；",
      "- 但 grouped OOF feature ladder 中 B5 +roundstage 对 format-state log loss 无改善",
      "  （B4 0.8456 → B5 0.8619 bits，见 feature-value.csv）。",
      "因此当前没有 held-out 证据支持为 production 增加 round/score complexity。"]
open(f"{RESULTS}/round-score-context.md", "w").write("\n".join(md))
print("20 done")

# ---------- 21/22. feature ladder ----------
# SAME row universe for every level: STRICT, correctedRetainedPrimary != UNKNOWN
# (retained=none is a LEGAL category — not a filter). Nested feature sets.
# Uniform backoff: if a level-k cell has < MIN_CELL counts, fall back to the
# level-(k-1) cell (prefix) — never zero probability for unseen cells.
import hashlib
def group_of(m):
    return m.rsplit("-m", 1)[0]
groups = sorted({group_of(r["map"]) for r in STRICT})
fold_of = {g: int(hashlib.sha256(g.encode()).hexdigest(), 16) % 5 for g in groups}
UNIVERSE = [r for r in STRICT if r["correctedRetainedPrimary"] != "UNKNOWN"]
MIN_CELL = 20

def ret_family(r):
    w = r["correctedRetainedPrimary"]
    return FAMILY.get(w, "none") if w else "none"

# nested feature levels (each includes the previous)
LEVELS = [
    ("B0 money", lambda r: (r["startMoney"] // 50,)),
    ("B1 +side", lambda r: (r["side"], r["startMoney"] // 50)),
    ("B2 +lossReward", lambda r: (r["side"], loss_reward_fixed(r["lossIndex"]), r["startMoney"] // 50)),
    ("B3 +retained family", lambda r: (r["side"], loss_reward_fixed(r["lossIndex"]), r["startMoney"] // 50, ret_family(r))),
    ("B4 +pre-decision armor/helmet", lambda r: (r["side"], loss_reward_fixed(r["lossIndex"]), r["startMoney"] // 50, ret_family(r),
                                                 int(bool(r["retainedArmor"])), int(bool(r["retainedHelmet"])))),
    ("B5 +roundstage", lambda r: (r["side"], loss_reward_fixed(r["lossIndex"]), r["startMoney"] // 50, ret_family(r),
                                  int(bool(r["retainedArmor"])), int(bool(r["retainedHelmet"])),
                                  min(r["roundNumber"], 24) // 3)),
]
TARGETS = [("format_state", lambda r: r["actionType"]),
           ("helmet", lambda r: int(bool(r["hasHelmet"]))),
           ("kit", lambda r: int(bool(r["hasDefuseKit"]))),
           ("smoke", lambda r: int("smoke" in r["grenades"]))]

def evaluate_level(level_idx, feat_fn, target_fn):
    """5-fold grouped OOF log loss with nested backoff to lower levels."""
    ll = 0.0
    covered = 0
    tot = 0
    for fold in range(5):
        train = [r for r in UNIVERSE if fold_of[group_of(r["map"])] != fold]
        test = [r for r in UNIVERSE if fold_of[group_of(r["map"])] == fold]
        tables = []  # tables[k]: Counter of (level-k key, class)
        for k in range(level_idx + 1):
            tbl = defaultdict(Counter)
            for r in train:
                tbl[LEVELS[k][1](r)][target_fn(r)] += 1
            tables.append(tbl)
        for r in test:
            label = target_fn(r)
            p = None
            for k in range(level_idx, -1, -1):
                c = tables[k].get(LEVELS[k][1](r))
                if c and sum(c.values()) >= MIN_CELL:
                    p = c[label] / sum(c.values())
                    break
            if p is None:
                continue  # even global-level cell insufficient (rare)
            ll += math.log2(max(p, 1e-9))
            covered += 1
            tot += 1
    return (-ll / tot if tot else float("nan")), covered / len(UNIVERSE)

FV = []
for lvl_idx, (lname, lfn) in enumerate(LEVELS):
    # hard assert: this feature has real variation in the row universe
    n_cats = len({lfn(r) for r in UNIVERSE})
    assert n_cats > 1, f"feature level {lname} has no variation ({n_cats} category)"
    for tname, tfn in TARGETS:
        ll, cov = evaluate_level(lvl_idx, lfn, tfn)
        FV.append([lname, tname, round(ll, 4), round(cov, 4)])
with open(f"{RESULTS}/feature-value.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["feature_level", "target", "grouped_oof_log_loss_bits", "coverage"])
    w.writerows(FV)
# deltas + relative information gain vs B0 baseline
md = ["# Deployable Feature Value", "",
      "Same row universe (STRICT, retained!=UNKNOWN; retained=none is a legal category).",
      "5-fold match-series grouped OOF log loss (bits), nested backoff (min cell 20).",
      "越低越好；Δ = 该特征的信息增益；relative information gain = 1 - H_level / H_B0.",
      "", "| level | target | OOF log loss | Δ vs prev | rel. info gain vs B0 | coverage |", "|---|---|---|---|---|---|"]
prev = {}
for lvl_idx in range(len(LEVELS)):
    for tname, _ in TARGETS:
        row = next(r for r in FV if r[0] == LEVELS[lvl_idx][0] and r[1] == tname)
        d = "" if lvl_idx == 0 else round(row[2] - prev[tname], 4)
        gain = "" if lvl_idx == 0 else round(1 - row[2] / prev[tname], 4) if prev[tname] else ""
        md.append("| {} | {} | {:.4f} | {} | {} | {:.2f} |".format(
            row[0], row[1], row[2], d, gain, row[3]))
        prev[tname] = row[2]
md.append("")
md.append("注：B4 使用 retainedArmor/retainedHelmet（pre-decision boolean，live GSI 可得）；")
md.append("B3 的 retained family 包含 none 类别（不是过滤）。")
open(f"{RESULTS}/deployable-feature-value.md", "w").write("\n".join(md))
print("22 done:", [r for r in FV if r[1] == "format_state"])

# ---------- 23. stability ----------
# Economy estimator: NO spend filter (format economy state).
# Purchase estimator: budget feasibility (moneySpent <= M) — separate.
ECON_STAB = []  # per fold: full50/full80 crossing from economy estimator
PUR_STAB = []   # per fold: median spend at key M (feasibility)
for fold in range(5):
    for side in ["t", "ct"]:
        for lr in [1400, 1900, 2400, 2900, 3400]:
            train = [r for r in STRICT if r["correctedRetainedPrimary"] is None
                     and fold_of[group_of(r["map"])] != fold
                     and r["side"] == side and loss_reward_fixed(r["lossIndex"]) == lr]
            if len(train) < 30:
                continue
            pool = [(r["startMoney"], r) for r in train]
            full50 = full80 = None
            for M in GRID:
                ws, h, ne = weights_at(pool, M)  # NO spend filter
                if ne < 20:
                    continue
                rows = [r for _, r in pool]
                p_full = wprob(rows, ws, lambda r: r["actionType"] == "full")
                if full50 is None and p_full >= 0.5:
                    full50 = M
                if full80 is None and p_full >= 0.8:
                    full80 = M
            ECON_STAB.append([fold, side, lr, full50, full80])
            # purchase stability: feasibility pool, median spend at key money
            med_spend = None
            for M in [2500, 4000]:
                feas = [(m, r) for m, r in pool if r["moneySpent"] <= M]
                if len(feas) < 30:
                    continue
                ws, h, ne = weights_at(feas, M)
                if ne < 20:
                    continue
                rows = [r for _, r in feas]
                med_spend = wquant([r["moneySpent"] for r in rows], ws, 0.5)
                PUR_STAB.append([fold, side, lr, M, med_spend])
with open(f"{RESULTS}/stability.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["fold", "side", "lossReward", "full50_crossing", "full80_crossing", "kind"])
    for row in ECON_STAB:
        w.writerow(row + ["economy"])
    for row in PUR_STAB:
        w.writerow([row[0], row[1], row[2], row[3], row[4], "purchase_median_spend"])
md = ["# Stability Analysis", "",
      "5-fold match-series grouped; economy estimator has NO spend filter;",
      "purchase median spend uses budget feasibility.", ""]
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        vals = [r[3] for r in ECON_STAB if r[1] == side and r[2] == lr and r[3]]
        if vals:
            vals.sort()
            md.append("- {} lr{}: full50 crossing values {} (median ${}, spread ${})".format(
                side.upper(), lr, vals, vals[len(vals) // 2], vals[-1] - vals[0]))
open(f"{RESULTS}/stability-analysis.md", "w").write("\n".join(md))
print("23 done")

# ---------- 24. cluster bootstrap — moved to research_bootstrap.py (numpy,
# DAK venv) for performance. See that script; B=250, seed 42. ----------
print("24 skipped (research_bootstrap.py)")

# ---------- 25. ambiguity map ----------
AMB = []
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        pool = [(r["startMoney"], r) for r in STRICT if r["correctedRetainedPrimary"] is None
                and r["side"] == side and r["_lr"] == lr]
        if len(pool) < 30:
            continue
        for M in GRID:
            feas = [(m, r) for m, r in pool if r["moneySpent"] <= M]
            if len(feas) < 30:
                continue
            ws, h, ne = weights_at(feas, M)
            if ne < 20:
                continue
            rows = [r for _, r in feas]
            dist = wdist(rows, ws, lambda r: r["actionType"])
            ent = entropy_from_probs(dist.values())
            pd = wdist(rows, ws, lambda r: r["primary"] or "none")
            p_ent = entropy_from_probs(pd.values())
            top1 = max(dist.values())
            AMB.append([side, lr, "none", M, round(ent, 3), round(p_ent, 3),
                        round(top1, 3), round(ne, 1)])
with open(f"{RESULTS}/ambiguity-map.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "retained_value", "roundStartMoney",
                "economy_entropy", "primary_entropy", "top1_rate", "effective_n"])
    w.writerows(AMB)
print("25 done — ambiguity rows:", len(AMB))
