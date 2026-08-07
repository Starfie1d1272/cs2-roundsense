#!/usr/bin/env python3
"""Research batch 3: team context, drop-sensitive, role ambiguity,
round/score context, feature ladder, stability, bootstrap, ambiguity
(sections 17-25)."""
import csv, json, math, os, sys
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import (load_rows, build_dataset, drop_flags, wprob, wdist,
                             weights_at, retained_pool, RESULTS)

ROWS = load_rows()
STRICT, FAMILY = build_dataset(ROWS)
GRID = list(range(800, 7601, 50))
TYPES = ["pistol", "eco", "semi", "force", "full"]

def entropy(dist):
    s = 0.0
    for v in dist.values():
        if v > 0:
            s -= v * math.log2(v)
    return s

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
# entropy: H(class | context)
def cond_entropy(joint, keyer):
    ctx = defaultdict(Counter)
    for (k, tkey, cls), c in joint.items():
        ctx[keyer(k, tkey)][cls] += c
    H = 0.0
    total = sum(sum(c.values()) for c in ctx.values())
    for c in ctx.values():
        nk = sum(c.values())
        H += nk / total * entropy({k2: v2 for k2, v2 in c.items()})
    return H
H_ind = cond_entropy(joint_counts, lambda k, tk: k)
H_team = cond_entropy(joint_counts, lambda k, tk: (k, tk))
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
      "普通 GSI 看不到队友经济时的信息损失 ≈ 上述差值（oracle 上限）。",
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
                    min(3400, 1400 + 500 * max(1, min(r["lossIndex"], 4))),
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
    return sum(sum(c.values()) / total * entropy(dict(c)) for c in ctx.values())
H_state = avg_entropy(state_ctx)
H_player = avg_entropy(player_ctx)
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
      "- irreducible role ambiguity ≈ {:.4f} bits (player-conditioned residual)".format(H_player),
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
      "增量信息很小——不建议仅为 round/score 增加 production 复杂度（除非后续 policy 需要）。"]
open(f"{RESULTS}/round-score-context.md", "w").write("\n".join(md))
print("20 done")

# ---------- 21/22. feature ladder ----------
# targets: format state, helmet, kit, smoke — grouped held-out log loss (match series)
def group_of(m):
    return m.rsplit("-m", 1)[0]
groups = sorted({group_of(r["map"]) for r in STRICT})
import hashlib
fold_of = {g: int(hashlib.sha256(g.encode()).hexdigest(), 16) % 5 for g in groups}

def eval_feature(feat_fn, target_fn):
    """5-fold grouped: weighted log loss per feature level."""
    ll = 0.0
    tot = 0
    for fold in range(5):
        train = [r for r in STRICT if r["correctedRetainedPrimary"] is None
                 and fold_of[group_of(r["map"])] != fold]
        test = [r for r in STRICT if r["correctedRetainedPrimary"] is None
                and fold_of[group_of(r["map"])] == fold]
        tbl = defaultdict(Counter)
        for r in train:
            tbl[feat_fn(r)][target_fn(r)] += 1
        for r in test:
            c = tbl.get(feat_fn(r))
            if not c:
                continue
            tot_n = sum(c.values())
            p = c[target_fn(r)] / tot_n
            ll += math.log2(max(p, 1e-9))
            tot += 1
    return -ll / tot if tot else float("nan")

def f_money(r): return (r["startMoney"] // 50,)
def f_side(r): return (r["side"], r["startMoney"] // 50)
def f_lr(r): return (r["side"], r["_lr"], r["startMoney"] // 50)
def f_ret(r): return (r["side"], r["_lr"], r["startMoney"] // 50, FAMILY.get(r["correctedRetainedPrimary"] or "none", "none"))
def f_ah(r): return (r["side"], r["_lr"], r["startMoney"] // 50, FAMILY.get(r["correctedRetainedPrimary"] or "none", "none"),
                     int(r["retainedArmor"]), int(r["retainedHelmet"]))
def f_rs(r): return (r["side"], r["_lr"], r["startMoney"] // 50, FAMILY.get(r["correctedRetainedPrimary"] or "none", "none"),
                     min(r["roundNumber"], 24) // 3)
def t_state(r): return r["actionType"]
def t_helmet(r): return int(bool(r["hasHelmet"]))
def t_kit(r): return int(bool(r["hasDefuseKit"]))
def t_smoke(r): return int("smoke" in r["grenades"])

FEATURES = [("money", f_money), ("+side", f_side), ("+lossReward", f_lr),
            ("+retained", f_ret), ("+armor/helmet", f_ah), ("+roundstage", f_rs)]
TARGETS = [("format_state", t_state), ("helmet", t_helmet), ("kit", t_kit), ("smoke", t_smoke)]
FV = []
for fname, ffn in FEATURES:
    for tname, tfn in TARGETS:
        ll = eval_feature(ffn, tfn)
        FV.append([fname, tname, round(ll, 4)])
with open(f"{RESULTS}/feature-value.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["feature_level", "target", "grouped_log_loss_bits"])
    w.writerows(FV)
md = ["# Deployable Feature Value", "",
      "5-fold match-series grouped held-out log loss (bits) per feature level / target.",
      "越低越好；差值 = 该特征的信息增益。", ""]
for row in FV:
    md.append("- {} | {}: {:.4f}".format(*row))
md.append("")
md.append("注：+armor/helmet 使用 retainedArmor/retainedHelmet（pre-decision boolean，live GSI 可得）。")
open(f"{RESULTS}/deployable-feature-value.md", "w").write("\n".join(md))
print("22 done:", FV[:4])

# ---------- 23. stability ----------
# per-fold full crossing & median spend at key states (none retained)
STAB = []
for fold in range(5):
    for side in ["t", "ct"]:
        for lr in [1400, 1900, 2400, 2900, 3400]:
            train = [r for r in STRICT if r["correctedRetainedPrimary"] is None
                     and fold_of[group_of(r["map"])] != fold]
            test = [r for r in STRICT if r["correctedRetainedPrimary"] is None
                    and fold_of[group_of(r["map"])] == fold]
            pool = [(r["startMoney"], r) for r in train if r["side"] == side and r["_lr"] == lr]
            if len(pool) < 30:
                continue
            full_cross = None
            med_spend = None
            for M in GRID:
                feas = [(m, r) for m, r in pool if r["moneySpent"] <= M]
                if len(feas) < 30:
                    continue
                ws, h, ne = weights_at(feas, M)
                if ne < 20:
                    continue
                rows = [r for _, r in feas]
                p_full = wprob(rows, ws, lambda r: r["actionType"] == "full")
                if full_cross is None and p_full >= 0.5:
                    full_cross = M
                if med_spend is None and M == 4000:
                    med_spend = wprob(rows, ws, lambda r: r["moneySpent"] <= 4350)  # proxy: prob spend<=4350
            STAB.append([fold, side, lr, full_cross, med_spend])
with open(f"{RESULTS}/stability.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["fold", "side", "lossReward", "full50_crossing", "spend_proxy_at_4000"])
    w.writerows(STAB)
md = ["# Stability Analysis", "",
      "5-fold match-series grouped; full50 crossing per fold per background.", ""]
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        vals = [r[3] for r in STAB if r[1] == side and r[2] == lr and r[3]]
        if vals:
            md.append("- {} lr{}: crossing values {} (median ${}, spread ${})".format(
                side.upper(), lr, sorted(vals), sorted(vals)[len(vals) // 2], max(vals) - min(vals)))
open(f"{RESULTS}/stability-analysis.md", "w").write("\n".join(md))
print("23 done")

# ---------- 24. cluster bootstrap ----------
import random
random.seed(42)
def bootstrap_crossing(side, lr, B=100):
    pool_rows = [r for r in STRICT if r["correctedRetainedPrimary"] is None
                 and r["side"] == side and r["_lr"] == lr]
    if len(pool_rows) < 100:
        return None
    by_group = defaultdict(list)
    for r in pool_rows:
        by_group[group_of(r["map"])].append(r)
    gkeys = sorted(by_group)
    crosses = []
    for _ in range(B):
        sample = []
        for _ in range(len(gkeys)):
            g = random.choice(gkeys)
            sample.extend(by_group[g])
        pool = [(r["startMoney"], r) for r in sample]
        cross = None
        for M in GRID:
            feas = [(m, r) for m, r in pool if r["moneySpent"] <= M]
            if len(feas) < 30:
                continue
            ws, h, ne = weights_at(feas, M)
            if ne < 20:
                continue
            rows = [r for _, r in feas]
            if wprob(rows, ws, lambda r: r["actionType"] == "full") >= 0.5:
                cross = M
                break
        if cross:
            crosses.append(cross)
    if not crosses:
        return None
    crosses.sort()
    return crosses[len(crosses) // 20], crosses[len(crosses) // 2], crosses[19 * len(crosses) // 20]
UNC = []
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        r = bootstrap_crossing(side, lr)
        if r:
            UNC.append([side, lr, "none", "full50_crossing", r[0], r[1], r[2]])
        else:
            UNC.append([side, lr, "none", "full50_crossing", "", "", ""])
with open(f"{RESULTS}/uncertainty.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "retained_value", "quantity", "ci_low", "median", "ci_high"])
    w.writerows(UNC)
md = ["# Uncertainty Summary (match-series cluster bootstrap, B=100, seed 42)", ""]
for row in UNC:
    if row[4]:
        md.append("- {} lr{} full50 crossing: 90% CI ${}–${} (median ${})".format(
            row[0].upper(), row[1], row[4], row[6], row[5]))
    else:
        md.append("- {} lr{} full50 crossing: insufficient".format(row[0].upper(), row[1]))
open(f"{RESULTS}/uncertainty-summary.md", "w").write("\n".join(md))
print("24 done")

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
            ent = entropy(dist)
            pd = wdist(rows, ws, lambda r: r["primary"] or "none")
            p_ent = entropy(pd)
            top1 = max(dist.values())
            AMB.append([side, lr, "none", M, round(ent, 3), round(p_ent, 3),
                        round(top1, 3), round(ne, 1)])
with open(f"{RESULTS}/ambiguity-map.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "retained_value", "roundStartMoney",
                "economy_entropy", "primary_entropy", "top1_rate", "effective_n"])
    w.writerows(AMB)
print("25 done — ambiguity rows:", len(AMB))
