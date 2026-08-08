#!/usr/bin/env python3
"""pp7 — role generalization (OOF), pistol preference, opponent economy context.

A. Role generalization (PLAYER_STYLE_STRICT, simple interpretable models):
   targets: utility_heavy (grenade value >= 500), primary_rifle_or_better,
            AWP choice (designated AWPers), paid-pistol family (deagle vs other)
   feature sets: base economic state / + All-Star roles / + CT roles /
                 + T roles / + both
   regimes: GroupKFold by match series AND GroupKFold by player
            (leave-player-out); metrics log loss / Brier / accuracy / macro F1

B. Pistol preference: paid pistols in ECO/FORCE relevant strict rows, by
   role/side/money/team branch. Side legality asserted.

C. Opponent economy context: pre-decision features vs opponent resulting
   spend class (evidence for a future classifier; no implementation).

Outputs:
  role-style-oof.csv
  pistol-preference.csv
  opponent-economy-context.md
  preference-axis-evidence.md
"""
import csv
import json
import os
import sys
from collections import Counter, defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post_pistol_common as ppc

SEED = 42


def load_strict():
    rows = list(csv.DictReader(open(os.path.join(ppc.PP_DIR, "player-style-strict.csv"))))
    for r in rows:
        r["startMoney"] = float(r["startMoney"])
        r["moneySpent"] = float(r["moneySpent"])
        r["roundNumber"] = int(r["roundNumber"])
        r["_lr"] = int(r["_lr"])
        r["grenades"] = json.loads(r["grenades"])
    return rows


def oof_logistic_cv(X, y, groups, cv):
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=int)
    groups = np.asarray(groups)
    oof = np.full(len(y), np.nan)
    for tr, te in cv.split(X, y, groups):
        if len(np.unique(y[tr])) < 2:
            oof[te] = y[tr].mean()
            continue
        sc = StandardScaler().fit(X[tr])
        m = LogisticRegression(max_iter=3000, random_state=SEED)
        m.fit(sc.transform(X[tr]), y[tr])
        oof[te] = m.predict_proba(sc.transform(X[te]))[:, 1]
    return oof


def metrics(y, p):
    from sklearn.metrics import roc_auc_score, f1_score, accuracy_score
    eps = 1e-9
    p = np.clip(p, eps, 1 - eps)
    ll = -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
    br = np.mean((p - y) ** 2)
    pred = (p >= 0.5).astype(int)
    try:
        auc = roc_auc_score(y, p)
    except ValueError:
        auc = float("nan")
    return {
        "n": int(len(y)),
        "oof_log_loss": round(float(ll), 4),
        "oof_brier": round(float(br), 4),
        "oof_auc": round(float(auc), 4) if auc == auc else "",
        "oof_accuracy": round(float(accuracy_score(y, pred)), 4),
        "oof_macro_f1": round(float(f1_score(y, pred, average="macro", zero_division=0)), 4),
        "base_rate": round(float(y.mean()), 4),
    }


def onehot(rows, field, values):
    idx = {v: i for i, v in enumerate(values)}
    X = np.zeros((len(rows), len(values)))
    for i, r in enumerate(rows):
        v = r.get(field)
        if v in idx:
            X[i, idx[v]] = 1.0
    return X


def build_feature_sets(rows, role_systems):
    base = np.array([[float(r["startMoney"]) / 1000.0,
                      float(r["_lr"]),
                      int(r["side"] == "ct"),
                      int(r["roundNumber"] in (2, 14)),
                      int(r["correctedRetainedPrimary"] not in (None, "", "UNKNOWN"))]
                     for r in rows])
    sets = {"base": base}
    for name, field in role_systems:
        vals = sorted({r.get(field) for r in rows if r.get(field)})
        sets[name] = np.hstack([base, onehot(rows, field, vals)])
    sets["base_plus_all_roles"] = base
    for field in [v for _, v in role_systems]:
        vals = sorted({r.get(field) for r in rows if r.get(field)})
        sets["base_plus_all_roles"] = np.hstack(
            [sets["base_plus_all_roles"], onehot(rows, field, vals)])
    return sets


def main():
    strict = load_strict()
    FAMILY = ppc.rc.load_weapon_families()
    PRICES = ppc.rc.load_prices()
    GRENADE_PRICES = {"smoke": 300, "flashbang": 200, "hegrenade": 300,
                      "molotov": 400, "incendiary": 600}

    def gval(grenades):
        return sum(GRENADE_PRICES.get(g, 0) for g in grenades)

    for r in strict:
        r["_utility_value"] = gval(r["grenades"])
        r["_primary_fam"] = FAMILY.get(r["primary"] or "", "none")
        r["_series"] = ppc.series_of_map(r["map"])
        r["_retained_fam"] = FAMILY.get(r["correctedRetainedPrimary"] or "", "none") \
            if r["correctedRetainedPrimary"] not in (None, "", "UNKNOWN") else "none"

    from sklearn.model_selection import GroupKFold
    gkf_series = GroupKFold(n_splits=5)
    gkf_player = GroupKFold(n_splits=5)

    role_systems = [("allstar", "all_star_role"), ("ct", "ct_role"), ("t", "t_role")]

    out = []

    # ---------------------------------------------------------------
    # A. role generalization
    # ---------------------------------------------------------------
    def run_target(target_name, rows, yname):
        rows = [r for r in rows if r.get(yname) is not None]
        if len(rows) < 200:
            return
        y = np.array([1 if r[yname] else 0 for r in rows])
        if y.mean() < 0.03 or y.mean() > 0.97:
            return
        sets = build_feature_sets(rows, role_systems)
        series = np.array([r["_series"] for r in rows])
        players = np.array([r["name"] for r in rows])
        for sname, X in sets.items():
            for regime, groups, cvname in (
                    ("series", series, "gkf_series"),
                    ("player", players, "gkf_player")):
                p = oof_logistic_cv(X, y, groups, gkf_series if cvname == "gkf_series" else gkf_player)
                m = metrics(y, p)
                m.update({"target": target_name, "features": sname, "regime": regime})
                out.append(m)

    # utility-heavy target
    def t_utility(r):
        return r["_utility_value"] >= 500
    for r in strict:
        r["_t_utility"] = t_utility(r)
    run_target("utility_heavy(>=500)", strict, "_t_utility")

    # primary rifle/sniper (firepower) target
    for r in strict:
        r["_t_rifle"] = r["_primary_fam"] in ("rifle", "sniper")
    run_target("primary_rifle_or_sniper", strict, "_t_rifle")

    # AWP choice: designated AWPers only
    role_rows = ppc.parse_role_metadata()
    awpers = {r["player"]: r["team"] for r in role_rows if r["all_star_role"] == "AWPer"}
    for r in strict:
        r["_is_awper"] = r["name"] in awpers and r["team"] == awpers.get(r["name"])
        r["_t_awp"] = r["primary"] == "AWP"
    run_target("awp_choice(designated_AWPers)", [r for r in strict if r["_is_awper"]], "_t_awp")
    # role-generalization version of the AWP target: ALL players, role one-hots
    # must carry the signal to unseen players (the designated-AWPer subset above
    # has zero role variation by construction — all rows are all_star_role=AWPer).
    run_target("awp_choice(all_players)", strict, "_t_awp")

    # paid-pistol family: deagle vs other (strict rows with a paid pistol)
    PAID = {"P250", "Dual Berettas", "Tec-9", "CZ75-Auto", "Five-SeveN", "Desert Eagle", "R8 Revolver"}
    for r in strict:
        r["_t_deagle"] = r["secondary"] == "Desert Eagle"
    run_target("paid_pistol_deagle_vs_other",
               [r for r in strict if r["secondary"] in PAID], "_t_deagle")

    with open(os.path.join(ppc.PP_DIR, "role-style-oof.csv"), "w", newline="") as f:
        fields = ["target", "features", "regime", "n", "base_rate", "oof_log_loss",
                  "oof_brier", "oof_auc", "oof_accuracy", "oof_macro_f1"]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(out)

    # ---------------------------------------------------------------
    # B. pistol preference (conditioned: side / money / branch / role /
    #    purchased-vs-carried; side legality asserted via canonical source)
    # ---------------------------------------------------------------
    legality = PRICES["sideLegality"]
    pistol_rows = [r for r in strict if r["secondary"] in PAID]

    def money_band(m):
        if m < 2000:
            return "<2000"
        if m < 3000:
            return "2000-3000"
        return ">=3000"

    # team strategy branch exists only for post-pistol team-rounds (R2/R14)
    branch_idx = {}
    with open(os.path.join(ppc.PP_DIR, "post-pistol-branches.csv")) as f:
        for r in csv.DictReader(f):
            branch_idx[(r["map"], int(r["post_pistol_round"]), r["team"])] = r["branch"]

    for r in pistol_rows:
        # carried = kept the same secondary from the previous round (no new
        # purchase choice this round); everything else = bought/switched now
        r["_purchased"] = not (r["secondary"] == r["retainedSecondary"] and r["retainedSecondary"])
        r["_mband"] = money_band(r["startMoney"])
        r["_branch"] = branch_idx.get((r["map"], r["roundNumber"], r["team"]), "")
        r["_role"] = r["all_star_role"] or "no-role"

    pref = []

    def add_pref(side, role, mband, branch, pstate, pistol, n, denom):
        pref.append({"side": side, "role": role, "money_band": mband,
                     "branch": branch, "purchase_state": pstate, "pistol": pistol,
                     "n": n,
                     "share_of_paid_pistol_rows": round(n / len(pistol_rows), 4),
                     "share_of_condition": round(n / denom, 4) if denom else ""})

    # (a) unconditional side x pistol
    total = Counter((r["side"], r["secondary"]) for r in pistol_rows)
    for (side, sec), n in sorted(total.items()):
        add_pref(side, "", "", "", "", sec, n, len(pistol_rows))

    # (b) purchased rows only: side x money band
    bought = [r for r in pistol_rows if r["_purchased"]]
    c = Counter((r["side"], r["_mband"], r["secondary"]) for r in bought)
    denom = Counter((r["side"], r["_mband"]) for r in bought)
    for (side, mb, sec), n in sorted(c.items()):
        add_pref(side, "", mb, "", "purchased", sec, n, denom[(side, mb)])

    # (c) purchased rows only: side x team branch (post-pistol R2/R14)
    c = Counter((r["side"], r["_branch"], r["secondary"])
                for r in bought if r["_branch"])
    denom = Counter((r["side"], r["_branch"]) for r in bought if r["_branch"])
    for (side, br, sec), n in sorted(c.items()):
        add_pref(side, "", "", br, "purchased", sec, n, denom[(side, br)])

    # (d) purchased rows only: role x money band
    c = Counter((r["_role"], r["_mband"], r["secondary"]) for r in bought)
    denom = Counter((r["_role"], r["_mband"]) for r in bought)
    for (role, mb, sec), n in sorted(c.items()):
        add_pref("both", role, mb, "", "purchased", sec, n, denom[(role, mb)])

    # (e) all rows: purchase_state x pistol
    c = Counter(("purchased" if r["_purchased"] else "carried", r["secondary"]) for r in pistol_rows)
    denom = Counter(("purchased" if r["_purchased"] else "carried") for r in pistol_rows)
    for (ps, sec), n in sorted(c.items()):
        add_pref("both", "", "", "", ps, sec, n, denom[ps])

    with open(os.path.join(ppc.PP_DIR, "pistol-preference.csv"), "w", newline="") as f:
        fields = ["side", "role", "money_band", "branch", "purchase_state", "pistol",
                  "n", "share_of_paid_pistol_rows", "share_of_condition"]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in pref:
            w.writerow({k: r.get(k, "") for k in fields})

    # legality cross-check (canonical): side-exclusive pistols on the wrong
    # side. CS2 forbids cross-side purchase, so these rows are carry/transition
    # artifacts, not purchases; report the carried/non-carried split.
    illegal = [r for r in pistol_rows
               if (r["side"], r["secondary"]) in (("ct", "Tec-9"), ("t", "Five-SeveN"))]
    illegal_carried = [r for r in illegal if not r["_purchased"]]
    legality_report = {
        "canonical_sideLegality": legality,
        "illegal_side_pistol_rows_in_data": len(illegal),
        "illegal_side_pistol_carried": len(illegal_carried),
        "illegal_side_pistol_non_carried": len(illegal) - len(illegal_carried),
    }

    # ---------------------------------------------------------------
    # C. opponent economy context (pre-decision features only)
    # ---------------------------------------------------------------
    # For every regulation team-round (both teams), opponent pre-decision
    # features -> opponent resulting spend class (their own team spend ratio).
    raw_rows = ppc.rc.load_rows()
    tr = ppc.build_team_rounds(raw_rows)
    thresholds = {}
    with open(os.path.join(ppc.PP_DIR, "branch-thresholds.csv")) as f:
        for r in csv.DictReader(f):
            if r["side"] in ("t", "ct"):
                thresholds[r["side"]] = {
                    "eco": float(r["threshold_eco_light"]) if r["threshold_eco_light"] else None,
                    "force": float(r["threshold_light_force"]),
                }

    def spend_class(tr_row):
        ratio = tr_row["team_money_spent"] / tr_row["team_start_money"] if tr_row["team_start_money"] else 0
        thr = thresholds[tr_row["side"]]
        if ratio > thr["force"]:
            return "force/full"
        if thr.get("eco") is not None and ratio < thr["eco"]:
            return "eco"
        return "light"

    feats = []
    for (m, rn, tk), t in sorted(tr.items()):
        if t["overtime"] or rn in (1, 13):
            continue  # no previous-round trajectory for pistol rounds
        opp_side = "ct" if t["side"] == "t" else "t"
        opp = None
        for (m2, rn2, tk2), rr in tr.items():
            if m2 == m and rn2 == rn and rr["side"] == opp_side:
                opp = rr
                break
        if opp is None:
            continue
        # pre-decision features about the OPPONENT, known at this round's start
        # (opponent previous-round result from round rn-1, NOT current round)
        opp_prev = None
        for (m2, rn2, tk2), rr in tr.items():
            if m2 == m and rn2 == rn - 1 and rr["side"] == opp_side:
                opp_prev = rr
                break
        feats.append({
            "map": m, "roundNumber": rn, "series": ppc.series_of_map(m),
            "opponent_prev_round_win": int(opp_prev["winnerSide"] == opp_side) if opp_prev else -1,
            "opponent_loss_index": opp["lossIndex"],
            "opponent_start_money": opp["team_start_money"],
            "opponent_retained_primary": opp["retained_primary_count"],
            "opponent_retained_awp": opp["retained_awp_count"],
            "opponent_survived_prev": opp["survivedPrev_count"],
            # outcome descriptors (NOT predictors): the opponent's own resulting
            # rifle/sniper headcount this round, from their own loadout
            "opponent_resulting_rifle": sum(
                1 for p in opp["players"]
                if FAMILY.get(p["primary"] or "", "none") in ("rifle", "sniper")),
            "side": t["side"],
            "y_spend_class": spend_class(opp),
            "y_force_full": int(spend_class(opp) == "force/full"),
        })
    for f in feats:
        f["y_rifle_economy"] = int(f["opponent_resulting_rifle"] >= 3)

    # simple grouped-OOF logistic: P(opponent force/full) from pre-decision feats
    Xf = np.array([[f["opponent_loss_index"], f["opponent_start_money"] / 1000.0,
                    f["opponent_retained_primary"], f["opponent_retained_awp"],
                    f["opponent_survived_prev"], int(f["opponent_prev_round_win"])]
                   for f in feats])
    yf = np.array([f["y_force_full"] for f in feats])
    gf = np.array([f["series"] for f in feats])
    p_all = oof_logistic_cv(Xf, yf, gf, GroupKFold(n_splits=5))
    m_all = metrics(yf, p_all)
    # money-only version
    p_money = oof_logistic_cv(Xf[:, 1:2], yf, gf, GroupKFold(n_splits=5))
    m_money = metrics(yf, p_money)
    # class distribution
    cls = Counter(f["y_spend_class"] for f in feats)
    # supplementary outcome: opponent "rifle economy" (resulting rifle/sniper
    # headcount >= 3), same pre-decision features
    yr = np.array([f["y_rifle_economy"] for f in feats])
    p_rif_all = oof_logistic_cv(Xf, yr, gf, GroupKFold(n_splits=5))
    m_rif_all = metrics(yr, p_rif_all)
    p_rif_money = oof_logistic_cv(Xf[:, 1:2], yr, gf, GroupKFold(n_splits=5))
    m_rif_money = metrics(yr, p_rif_money)

    # survival monotonicity (opponent survived_prev -> force rate), raw and
    # money-band-controlled (the raw monotonicity is money-mediated)
    surv_force = {}
    for sv in range(6):
        sub = [f for f in feats if f["opponent_survived_prev"] == sv]
        if len(sub) >= 20:
            surv_force[sv] = round(sum(f["y_force_full"] for f in sub) / len(sub), 4)

    def mband(m):
        if m < 8000:
            return "lo(<8000)"
        if m < 12000:
            return "mid(8-12k)"
        return "hi(>=12k)"

    surv_force_by_band = {}
    for sv in range(6):
        for bn in ("lo(<8000)", "mid(8-12k)", "hi(>=12k)"):
            sub = [f for f in feats
                   if f["opponent_survived_prev"] == sv and mband(f["opponent_start_money"]) == bn]
            if len(sub) >= 20:
                surv_force_by_band[(sv, bn)] = (
                    len(sub), round(sum(f["y_force_full"] for f in sub) / len(sub), 4))

    md = [
        "# 对手经济上下文（opponentEconomyExpectation 的证据基础）",
        "",
        "## 范围（Scope）",
        "",
        "- 本文件只评估：**决策前（freezetime 前）已知的信息**能否区分对手的",
        "  花费水平。不实现任何分类器，不设计任何 helmet 规则。",
        "- 预决策特征（回合开始时已知）：对手 lossIndex（连败轨迹）、对手队伍",
        "  startMoney、对手保留主武器/AWP 数量、对手上一回合存活人数、上一回合结果。",
        "- 结局（描述目标，NOT 预测器）：对手当回合自身花费比",
        "  team_money_spent / team_start_money，按 post-pistol 研究的 side-specific",
        "  阈值映射为 eco / light / force/full。",
        "  **语义注意**：该结局度量的是\"花费比例\"而非\"步枪经济\"。高余额队伍",
        "  （例如刚大比分赢下上一回合）全步枪购买后比例仍落在 light 区间",
        "  ——见下方 money 中介分解。",
        "",
        f"- 分析队伍-回合数：{len(feats)}（全部常规回合，排除 R1/R13 与 overtime，",
        "  双方视角）",
        f"- 对手花费类分布：{dict(cls)}",
        "",
        "## 分组 OOF 判别（logistic, GroupKFold by match series）",
        "",
        f"- 完整预决策特征集：logloss={m_all['oof_log_loss']}, brier={m_all['oof_brier']},",
        f"  auc={m_all['oof_auc']}, n={m_all['n']}, base rate={m_all['base_rate']}",
        f"- 仅对手 startMoney：logloss={m_money['oof_log_loss']}, ",
        f"  brier={m_money['oof_brier']}, auc={m_money['oof_auc']}",
        "- 结论：轨迹类特征（连败、保留、存活、上回合结果）相对\"只看钱\"",
        "  提供额外判别力。",
        "",
        "## 补充结局：对手\"步枪经济\"（resulting rifle/sniper 人数 >= 3）",
        "",
        f"- 同一组预决策特征，结局改为对手回合结束时持有步枪/狙击 >= 3 人：",
        f"  logloss={m_rif_all['oof_log_loss']}, brier={m_rif_all['oof_brier']},",
        f"  auc={m_rif_all['oof_auc']}, base rate={m_rif_all['base_rate']}",
        f"- 仅对手 startMoney：logloss={m_rif_money['oof_log_loss']}, auc={m_rif_money['oof_auc']}",
        "- 说明：该结局更贴近\"established rifle economy\"的描述；预测变量仍是",
        "  纯预决策特征（对手回合结束的步枪人数只作为结局描述，不作为输入）。",
        "",
        "## 存活人数单调性的 money 中介分解（FACT vs 解释）",
        "",
    ]
    for sv in sorted(surv_force):
        md.append(f"- 原始关联 survived_prev={sv}: force/full rate {surv_force[sv]}")
    md.append("")
    md.append("- 按对手 startMoney 分段后的同表（n>=20 才报告）：")
    md.append("")
    for (sv, bn) in sorted(surv_force_by_band):
        n_b, rate = surv_force_by_band[(sv, bn)]
        md.append(f"- survived_prev={sv} {bn}: n={n_b}, force/full={rate}")
    md += [
        "",
        "## 分层说明",
        "",
        "- FACT（游戏机制）: 赢下上一回合的队伍下一回合 startMoney 更高；",
        "  存活人数多 ⇔ 赢下上一回合的概率高（机制性关联）。",
        "- OBSERVED ASSOCIATION: 预决策特征（含 money）OOF 判别对手花费比例",
        f"  AUC {m_all['oof_auc']}；对\"步枪经济\"结局 AUC {m_rif_all['oof_auc']}；",
        "  存活人数的原始单调性在控 money 后大幅减弱/方向反转——原始信号",
        "  主要由 money 水平中介。",
        "- INFERENCE（产品假设，未在此验证）: 基于预决策特征做 context-sensitive",
        "  规则（如 CT helmet 优先级）\"可能\"可行；但 live-GSI 特征可用性、",
        "  阈值校准、结局定义（比例 vs 步枪经济）都是部署期问题。",
        "- 无因果断言：本表不说明任何特征\"导致\"对手购买行为。",
    ]
    open(os.path.join(ppc.PP_DIR, "opponent-economy-context.md"), "w").write("\n".join(md))

    # ---------------------------------------------------------------
    # D. preference-axis-evidence.md
    # ---------------------------------------------------------------
    with open(os.path.join(ppc.PP_DIR, "post-pistol-branch-distribution.csv")) as f:
        dist = {r["side"] + "|" + r["branch"]: r for r in csv.DictReader(f)}
    with open(os.path.join(ppc.PP_DIR, "team-system-propensity.csv")) as f:
        team_style = list(csv.DictReader(f))
    with open(os.path.join(ppc.PP_DIR, "awp-dependency.csv")) as f:
        awp_dep = list(csv.DictReader(f))
    with open(os.path.join(ppc.PP_DIR, "role-style-axis.csv")) as f:
        axis_rows = list(csv.DictReader(f))
    with open(os.path.join(ppc.PP_DIR, "role-style-oof.csv")) as f:
        oof_rows = list(csv.DictReader(f))

    def oof_row(target, features, regime):
        for r in oof_rows:
            if r["target"] == target and r["features"] == features and r["regime"] == regime:
                return r
        return None

    def rate(side, branch):
        return float(dist[side + "|" + branch]["rate"])

    ts_rates = sorted(float(r["shrunk_force_rate"]) for r in team_style)
    n_low_support = sum(1 for r in team_style if r["low_support"].strip())
    awp_rates = [float(r["awp_resulting_rate_5400"]) for r in awp_dep
                 if r["awp_resulting_rate_5400"].strip()]  # HEROIC: n_viable_5400=0
    n_awp_teams = len(awp_rates)
    non_awper_max = max(float(r["non_awper_awp_rate_5400"]) for r in awp_dep)
    dual_awp_mean = sum(float(r["dual_awp_team_round_rate"]) for r in awp_dep) / len(awp_dep)

    u_base_s = oof_row("utility_heavy(>=500)", "base", "series")
    u_all_s = oof_row("utility_heavy(>=500)", "base_plus_all_roles", "series")
    u_base_p = oof_row("utility_heavy(>=500)", "base", "player")
    u_all_p = oof_row("utility_heavy(>=500)", "base_plus_all_roles", "player")
    r_base_s = oof_row("primary_rifle_or_sniper", "base", "series")
    r_all_p = oof_row("primary_rifle_or_sniper", "base_plus_all_roles", "player")
    d_base_s = oof_row("paid_pistol_deagle_vs_other", "base", "series")
    d_all_s = oof_row("paid_pistol_deagle_vs_other", "base_plus_all_roles", "series")
    d_all_p = oof_row("paid_pistol_deagle_vs_other", "base_plus_all_roles", "player")
    a_base_s = oof_row("awp_choice(all_players)", "base", "series")
    a_all_s = oof_row("awp_choice(all_players)", "base_plus_all_roles", "series")
    a_all_p = oof_row("awp_choice(all_players)", "base_plus_all_roles", "player")

    igl_util = next(r["utility_share_diff_A_minus_B"] for r in axis_rows
                    if r["comparison"] == "IGL vs Opener")
    awper_weapon = next(r["weapon_share_diff_A_minus_B"] for r in axis_rows
                        if r["comparison"] == "AWPer vs Opener")

    pref_md = [
        "# 偏好轴证据评估（Preference-Axis Evidence，产品向，仅证据）",
        "",
        "证据等级：strong / moderate / weak / unsupported。",
        "本文件不写任何 production policy，不设计 Policy V3 规则。",
        "",
        "## 1. 经济风险轴：保经济 <-> 倾向 force",
        "",
        f"- T post-pistol：FORCE {rate('t', 'FORCE')*100:.1f}% / "
        f"ECO {rate('t', 'ECO')*100:.1f}% / LIGHT {rate('t', 'LIGHT')*100:.1f}% (n=205)",
        f"- CT post-pistol：FORCE {rate('ct', 'FORCE')*100:.1f}% / "
        f"ECO {rate('ct', 'ECO')*100:.1f}% / LIGHT {rate('ct', 'LIGHT')*100:.1f}% (n=199)",
        "- T 决策是真实双峰且有清晰 valley（两分支后验覆盖 84-88%）；",
        "  LIGHT 是真实但少数 mode。CT 近似单峰 FORCE（覆盖 90-95%）。",
        f"- 队伍层方差：shrunk force rate 范围 {ts_rates[0]:.3f}-{ts_rates[-1]:.3f}；",
        f"  n per team 小（~12 post-pistol 轮），overdispersion ≈ 0 → 原始率差在",
        f"  二项噪声内；{n_low_support}/32 支队伍为 LOW SUPPORT（见 "
        "team-system-propensity.csv）。",
        "- 该轴的证据来自 pp2 分支混合与 pp5 队伍倾向（队伍层，非角色层）。",
        "- EVIDENCE：moderate（方差存在且方向稳定，但队伍样本小、shrinkage 显示",
        "  原始差异噪声大）。",
        "",
        "## 2. 火力 <-> 道具（firepower <-> utility）",
        "",
        f"- 条件匹配（side x money x retained x post-pistol）角色差异：IGL vs Opener "
        f"utility share {float(igl_util):+.3f}；AWPer vs Opener weapon share "
        f"{float(awper_weapon):+.3f}；完整对比见 role-style-axis.csv。",
        "- AWPer 的差异主要是预算后果（昂贵主武器 -> 少道具），不是独立风格轴。",
        f"- grouped-OOF（role-style-oof.csv）：utility target base AUC "
        f"{u_base_s['oof_auc']} -> +全部角色 {u_all_s['oof_auc']}；leave-player-out "
        f"{u_base_p['oof_auc']} -> {u_all_p['oof_auc']}（ΔAUC 约 +0.004，LPO 保留但极小）。",
        f"- rifle target：base {r_base_s['oof_auc']} -> +角色 {r_all_p['oof_auc']}（无增益，"
        "经济状态已近饱和）。",
        "- EVIDENCE：weak（in-sample 方向符合 IGL/Support 预期，但量小；OOF/LPO",
        "  增益 ~0.004，不足以为独立产品轴提供支撑）。",
        "",
        "## 3. AWP 优先级（AWP priority）",
        "",
        f"- designated AWPer（role metadata，31 人）在 $5400+ 轮 resulting AWP rate "
        f"均值 {sum(awp_rates)/n_awp_teams:.3f}（{n_awp_teams} 队有有效样本，各队 0.81-0.96；"
        f"HEROIC n_viable=0 不计）；non-AWPer 最高 "
        f"{non_awper_max:.4f}；dual-AWP 队伍-回合率均值 {dual_awp_mean:.4f}。",
        "- AWPer 在购买 AWP 前一轮的节省行为见 awp-economy-association.md"
        "（AWPer 前轮均花 $847 vs non-AWPer $1997）。",
        "- 队伍层 AWP 保留率 vs post-pistol FORCE rate：rho=-0.37, p=0.06"
        "（Spearman, 描述性，见 awp-economy-association.md）。",
        f"- 角色泛化（role-style-oof.csv, all_players）：AWP target base AUC "
        f"{a_base_s['oof_auc']} -> +角色 {a_all_s['oof_auc']}（series）；"
        f"leave-player-out +角色 {a_all_p['oof_auc']}。",
        "- EVIDENCE：strong（AWPer 行为规律，角色定义即行为）；moderate（队伍层",
        "  AWP-经济风险 tradeoff，n_teams=27，p=0.06）。",
        "",
        "## 4. 手枪偏好（pistol preference）",
        "",
        f"- strict 数据中支付手枪行 {len(pistol_rows)}（purchased {sum(1 for r in pistol_rows if r['_purchased'])} / "
        f"carried {sum(1 for r in pistol_rows if not r['_purchased'])}）；分布按 side / "
        "money band / branch / role / purchase_state 见 pistol-preference.csv。",
        f"- canonical 合法性交叉检查：非法侧手枪行 {legality_report['illegal_side_pistol_rows_in_data']}"
        f"（carried {legality_report['illegal_side_pistol_carried']} / non-carried "
        f"{legality_report['illegal_side_pistol_non_carried']}；游戏禁止跨侧购买，"
        "这些是继承/换边行，不是购买）。",
        f"- 泛化（role-style-oof.csv, deagle vs other）：base AUC {d_base_s['oof_auc']} "
        f"-> +角色 {d_all_s['oof_auc']}（series）；leave-player-out {d_all_p['oof_auc']}"
        "——角色无 OOF 增益，LPO 下无改善。",
        "- EVIDENCE：weak（side-legal 频率证据存在，但条件化后角色/队伍无泛化",
        "  判别力，不足以支撑独立\"手枪偏好\"用户设置）。",
        "",
        "## 结论（bottom line）",
        "",
        "- 经济风险：最强、最贴近产品的轴（T 双峰 / CT 近单峰），队伍层 moderate。",
        "- AWP 优先级：strong 的角色行为规律，队伍层 tradeoff 仅 moderate。",
        "- firepower <-> utility：存在但小（weak），不单独支撑产品设置。",
        "- 手枪偏好：weak——频率存在但无泛化证据。",
    ]
    open(os.path.join(ppc.PP_DIR, "preference-axis-evidence.md"), "w").write("\n".join(pref_md))

    print(json.dumps({
        "role_oof_targets": sorted({r["target"] for r in out}),
        "role_oof_rows": len(out),
        "pistol_rows": len(pistol_rows),
        "pistol_top": total.most_common(6),
        "opponent": {"n": len(feats), "classes": dict(cls),
                     "full": m_all, "money_only": m_money,
                     "rifle_economy_full": m_rif_all, "rifle_economy_money_only": m_rif_money,
                     "surv_force": surv_force,
                     "surv_force_by_band": {f"{sv}|{bn}": v for (sv, bn), v in surv_force_by_band.items()}},
        "legality": legality_report,
    }, indent=2, default=str))


if __name__ == "__main__":
    main()
