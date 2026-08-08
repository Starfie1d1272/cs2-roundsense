#!/usr/bin/env python3
"""audit_post_pistol_strategy.py — post-pistol strategy 研究消费者侧独立审计。

只读最终 CSV/MD artifacts、冻结 hash 基线、git 对象与 raw corpus 交叉重建，
不 import 任何 pp1–pp7 producer 函数（不信任其内存状态）。
不变量违反 → FAIL（exit 1），不降级为警告。

运行：
  env -u PYTHONPATH uv run --with scikit-learn --with scipy --with numpy \
      python audit_post_pistol_strategy.py
"""
import csv
import hashlib
import json
import math
import os
import re
import subprocess
import sys

import numpy as np
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
PP_DIR = os.path.join(HERE, "results", "cologne-2026", "post-pistol-strategy")
RESULTS_DIR = os.path.join(HERE, "results", "cologne-2026")
REPO = os.path.dirname(os.path.dirname(HERE))
CORPUS = os.environ.get("ROUNDSENSE_CORPUS_DIR", "/tmp/roundsense-cologne-policy")

LOSS_REWARDS = [1400, 1900, 2400, 2900, 3400]  # 游戏机制常量（research_common 冻结同值）

CHECKS = []


def check(name, ok, detail=""):
    CHECKS.append((name, bool(ok), detail))
    if not ok:
        print(f"[FAIL] {name}" + (f" — {detail}" if detail else ""))


def load_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def fv(r, col, default=None):
    v = (r.get(col) or "").strip()
    if not v:
        return default
    try:
        return float(v)
    except ValueError:
        return default


def iv(r, col, default=None):
    v = (r.get(col) or "").strip()
    if not v:
        return default
    return int(float(v))


def series_of_map(m):
    return re.sub(r"-m\d+-de_[a-z0-9_]+$", "", m)


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def git(*args):
    return subprocess.run(["git", "-C", REPO] + list(args),
                          capture_output=True, text=True)


def oof_logistic_lr(X, y, groups, max_iter=2000, seed=42):
    """与 pp3/pp7 相同的 grouped 5-fold OOF（独立实现，确定性）。"""
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import GroupKFold
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=int)
    groups = np.asarray(groups)
    oof = np.full(len(y), np.nan)
    for tr, te in GroupKFold(n_splits=5).split(X, y, groups):
        if len(np.unique(y[tr])) < 2:
            oof[te] = y[tr].mean()
            continue
        sc = StandardScaler().fit(X[tr])
        m = LogisticRegression(max_iter=max_iter, random_state=seed)
        m.fit(sc.transform(X[tr]), y[tr])
        oof[te] = m.predict_proba(sc.transform(X[te]))[:, 1]
    return oof


def auc_of(y, p):
    from sklearn.metrics import roc_auc_score
    try:
        return roc_auc_score(np.asarray(y, dtype=int), np.asarray(p, dtype=float))
    except ValueError:
        return float("nan")


def logloss_binary(y, p):
    eps = 1e-9
    y = np.asarray(y, dtype=float)
    p = np.clip(np.asarray(p, dtype=float), eps, 1 - eps)
    return -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))


# ---------------------------------------------------------------------------
# 1. ROLE METADATA
# ---------------------------------------------------------------------------
def audit_role_metadata():
    meta = load_csv(os.path.join(PP_DIR, "role-metadata.csv"))
    teams = {}
    dup = 0
    for r in meta:
        teams.setdefault(r["team"], []).append(r["player"])
    seen = set()
    for r in meta:
        k = (r["team"], r["player"])
        if k in seen:
            dup += 1
        seen.add(k)
    check("role metadata: 恰好 32 队", len(teams) == 32, f"got {len(teams)}")
    check("role metadata: 恰好 160 玩家行", len(meta) == 160, f"got {len(meta)}")
    check("role metadata: 每队 5 人", all(len(v) == 5 for v in teams.values()))
    check("role metadata: 无重复 (team, player)", dup == 0, f"dups={dup}")
    for r in meta:
        if not (r["all_star_role"] and r["ct_role"] and r["t_role"]):
            check("role metadata: 角色字段非空", False,
                  f"{r['team']}/{r['player']} missing role field")
            break

    aliases = load_csv(os.path.join(PP_DIR, "role-aliases.csv"))
    check("role aliases: 条目数 == 5", len(aliases) == 5, f"got {len(aliases)}")
    for a in aliases:
        if not a["raw_corpus_name"].strip() or not a["reason"].strip():
            check("role aliases: raw 名与 reason 非空", False, str(a))
            break
    # alias 名与 role-join-report.md 的别名段一致
    rep = open(os.path.join(PP_DIR, "role-join-report.md"), encoding="utf-8").read()
    for a in aliases:
        if a["raw_corpus_name"] not in rep:
            check("role aliases: 与 role-join-report.md 一致", False, a["raw_corpus_name"])
            break

    strict = load_csv(os.path.join(PP_DIR, "player-style-strict.csv"))
    from collections import Counter
    jm = Counter(r["role_join_method"] for r in strict)
    check("role join: unresolved == 0", jm.get("unresolved", 0) == 0, str(dict(jm)))
    check("role join: exact == 25167", jm.get("exact", 0) == 25167, str(jm.get("exact")))
    check("role join: alias-player == 432", jm.get("alias-player", 0) == 432, str(jm.get("alias-player")))
    check("role join: alias-team-only == 387", jm.get("alias-team-only", 0) == 387, str(jm.get("alias-team-only")))
    return strict


# ---------------------------------------------------------------------------
# 2. POST-PISTOL TEAM DATA
# ---------------------------------------------------------------------------
def audit_post_pistol_team_data():
    pp = load_csv(os.path.join(PP_DIR, "post-pistol-team-rounds.csv"))
    check("pp team-rounds: 恰好 404 行", len(pp) == 404, f"got {len(pp)}")
    keys = [(r["map"], r["half"]) for r in pp]
    check("pp team-rounds: (map, half) 无重复（不按 5 人乘）",
          len(set(keys)) == len(keys) == 404)
    halves = {}
    for r in pp:
        halves.setdefault(r["half"], []).append(r)
    check("pp team-rounds: half ∈ {h1,h2}", set(halves) == {"h1", "h2"})
    for h, rows in halves.items():
        expect_rn = 2 if h == "h1" else 14
        bad = [r for r in rows if int(r["post_pistol_round"]) != expect_rn]
        check(f"pp team-rounds: {h} 全部是 R{expect_rn}", not bad,
              f"{len(bad)} wrong")
        ot = [r for r in rows if str(r.get("overtime", "")).strip() == "True"]
        check(f"pp team-rounds: {h} 无 overtime", not ot)
        # 202 maps: each half has one round with two teams -> 202 rows per half
        maps_h = len({r["map"] for r in rows})
        check(f"pp team-rounds: {h} 覆盖 202 张图", maps_h == 202, f"got {maps_h}")
    sides = Counter(r["side"] for r in pp)
    check("pp team-rounds: T=205 CT=199", sides.get("t") == 205 and sides.get("ct") == 199,
          str(dict(sides)))
    check("pp team-rounds: 全部为手枪败者", all(r["pistol_outcome"] == "loss" for r in pp))
    for r in pp:
        own = iv(r, "own_survivors_pistol_end", -1)
        opp = iv(r, "opponent_survivors_pistol_end", -1)
        if not (0 <= own <= 5 and 0 <= opp <= 5):
            check("pp team-rounds: survivors ∈ [0,5]", False, f"{r['map']} {r['half']}")
            break
    bad_kills = [r for r in pp
                 if iv(r, "own_kills", -1) != 5 - iv(r, "opponent_survivors_pistol_end", -1)
                 or iv(r, "opponent_kills", -1) != 5 - iv(r, "own_survivors_pistol_end", -1)]
    check("pp team-rounds: kills = 5 - 对手存活", not bad_kills, f"{len(bad_kills)} rows")
    bad_money = []
    for r in pp:
        start = fv(r, "team_start_money", 0)
        spent = fv(r, "team_money_spent", 0)
        rem = fv(r, "team_money_remaining", None)
        ratio = fv(r, "team_spend_ratio", None)
        if rem is not None and abs(rem - (start - spent)) > 1.0:
            bad_money.append((r["map"], r["half"], "remaining"))
        if ratio is not None and start > 0 and abs(ratio - spent / start) > 1e-6:
            bad_money.append((r["map"], r["half"], "ratio"))
        if ratio is not None and not (0 <= ratio <= 1.0 + 1e-9):
            bad_money.append((r["map"], r["half"], "ratio-range"))
    check("pp team-rounds: spend/start/remaining 自洽", not bad_money, str(bad_money[:3]))
    bad_lr = [r for r in pp if iv(r, "team_loss_reward_if_current_round_lost", -1) != 2400]
    check("pp team-rounds: 手枪败者 lossReward 真 2400", not bad_lr, f"{len(bad_lr)} rows")
    # 对手（手枪胜者）R2/R14 lossIndex=0 -> lossReward 1400（机制：胜者无连败奖励）
    check("pp team-rounds: 对手（手枪胜者）lossReward == 1400",
          all(iv(r, "opponent_loss_reward", -1) == 1400 for r in pp))
    # opponent start money 为手枪胜者（> 败者，机制事实）
    winners_richer = sum(1 for r in pp
                         if fv(r, "opponent_team_start_money", 0) > fv(r, "team_start_money", 0))
    check("pp team-rounds: 对手（手枪胜者）start 高于败者（>90%）",
          winners_richer > 0.9 * len(pp), f"{winners_richer}/{len(pp)}")
    return pp


# ---------------------------------------------------------------------------
# 3. STRATEGY BRANCHES
# ---------------------------------------------------------------------------
def audit_branches(pp):
    thr = {r["side"]: r for r in load_csv(os.path.join(PP_DIR, "branch-thresholds.csv"))
           if r["side"] in ("t", "ct")}
    check("branch thresholds: t/ct 都存在", set(thr) == {"t", "ct"})
    ok_thr = True
    for side, r in thr.items():
        eco = fv(r, "threshold_eco_light", None)
        force = fv(r, "threshold_light_force", None)
        if not (eco is not None and force is not None and 0 < eco < force < 1):
            ok_thr = False
            check("branch thresholds: 0 < eco < force < 1", False, f"{side}: {eco}/{force}")
    check("branch thresholds: 确定性且有序", ok_thr)

    br = load_csv(os.path.join(PP_DIR, "post-pistol-branches.csv"))
    check("post-pistol-branches: 404 行", len(br) == 404, f"got {len(br)}")
    br_keys = [(r["map"], r["half"]) for r in br]
    check("post-pistol-branches: (map, half) 无重复", len(set(br_keys)) == 404)
    bad_branch = []
    bad_prob = []
    for r in br:
        if r["branch"] not in ("FORCE", "ECO", "LIGHT"):
            bad_branch.append(r["branch"])
        ps = sum(fv(r, c, 0) for c in ("p_force", "p_light", "p_eco"))
        if abs(ps - 1.0) > 1e-3:
            bad_prob.append((r["map"], r["half"], ps))
    check("post-pistol-branches: 每行恰好一个合法 branch", not bad_branch, str(bad_branch[:3]))
    check("post-pistol-branches: 后验概率和 == 1", not bad_prob, str(bad_prob[:3]))
    # 后验 argmax == branch 列
    bad_argmax = [r for r in br
                  if r["branch"] != max(("FORCE", "LIGHT", "ECO"),
                                        key=lambda c: fv(r, "p_" + c.lower(), 0))]
    check("post-pistol-branches: branch == 后验 argmax", not bad_argmax, f"{len(bad_argmax)} rows")
    # branches 与 team-rounds join 完整（同一 (map, half) 集合）
    pp_keys = {(r["map"], r["half"]) for r in pp}
    check("post-pistol-branches: 与 team-rounds (map, half) 完全对齐",
          set(br_keys) == pp_keys)

    dist = load_csv(os.path.join(PP_DIR, "post-pistol-branch-distribution.csv"))
    side_n = Counter(r["side"] for r in pp)
    ok_dist = True
    detail = []
    for r in dist:
        if r["branch"] in ("FORCE", "ECO", "LIGHT") and r["side"] in ("t", "ct", "all"):
            n = len(pp) if r["side"] == "all" else side_n[r["side"]]
            rate = fv(r, "rate", None)
            if rate is None or abs(rate - iv(r, "n", -1) / n) > 1e-4:
                ok_dist = False
                detail.append(f"{r['side']}|{r['branch']}")
            lo, hi = fv(r, "ci95_low", None), fv(r, "ci95_high", None)
            if lo is not None and hi is not None and not (0 <= lo <= hi <= 1):
                ok_dist = False
                detail.append(f"ci {r['side']}|{r['branch']}")
    check("branch distribution: rate == n/总 且 CI 有效", ok_dist, str(detail[:5]))
    # sensitivity 行对账（threshold ± 0.05 两分支 n 和 == 该 side 总数）
    for side, n in side_n.items():
        fplus = [r for r in dist if r["side"] == side and "threshold+0.05" in r["branch"]]
        fminus = [r for r in dist if r["side"] == side and "threshold-0.05" in r["branch"]]
        if fplus and sum(iv(r, "n", 0) for r in fplus) != n:
            check("branch sensitivity: +0.05 n 对账", False, f"{side}")
        if fminus and sum(iv(r, "n", 0) for r in fminus) != n:
            check("branch sensitivity: -0.05 n 对账", False, f"{side}")
    check("branch sensitivity: ±0.05 n 对账", True)

    mix = load_csv(os.path.join(PP_DIR, "mixture-fit.csv"))
    ok_mix = True
    bics = {}
    for r in mix:
        w = [float(x) for x in json.loads(r["weights"])]
        if abs(sum(w) - 1.0) > 1e-3:
            ok_mix = False
        bics[(r["side"], int(r["components"]))] = fv(r, "bic", 0)
    for side in ("all", "t", "ct"):
        b1, b2, b3 = (bics.get((side, c)) for c in (1, 2, 3))
        if not (b1 is not None and b2 is not None and b3 is not None and b3 < b2 < b1):
            ok_mix = False
    check("mixture: weights 求和 == 1 且 BIC 3<2<1", ok_mix)

    cov = load_csv(os.path.join(PP_DIR, "post-pistol-two-branch-coverage.csv"))
    ok_cov = True
    for r in cov:
        n = iv(r, "n", -1)
        hf, he = iv(r, "high_confidence_FORCE", 0), iv(r, "high_confidence_ECO", 0)
        light, amb = iv(r, "LIGHT", 0), iv(r, "ambiguous", 0)
        cv = fv(r, "two_branch_coverage", None)
        res = fv(r, "residual", None)
        if cv is None or abs(cv - (hf + he) / n) > 1e-3:
            ok_cov = False
        if hf + he + light + amb != n:
            ok_cov = False
        if res is None or abs(res - (light + amb) / n) > 1e-3:
            ok_cov = False
    check("two-branch coverage: 覆盖对账 + 残差对账", ok_cov)
    return br


# ---------------------------------------------------------------------------
# 4. CT SURVIVORS / T PLANT（组计数 + OOF 复现）
# ---------------------------------------------------------------------------
def audit_ct_t_studies(pp, br):
    by_key = {(r["map"], r["half"]): r for r in br}
    rows = []
    for r in pp:
        b = by_key.get((r["map"], r["half"]))
        if b is None:
            continue
        rec = dict(r)
        rec["team_spend_ratio"] = fv(r, "team_spend_ratio", 0)
        rec["team_start_money"] = fv(r, "team_start_money", 0)
        rec["pistol_bomb_planted"] = r["pistol_bomb_planted"] == "True"
        rec["branch"] = b["branch"]
        rows.append(rec)

    ct = [r for r in rows if r["side"] == "ct"]
    t = [r for r in rows if r["side"] == "t"]
    eff = load_csv(os.path.join(PP_DIR, "ct-survivor-effect.csv"))
    tpe = load_csv(os.path.join(PP_DIR, "t-plant-effect.csv"))
    ok_n = True
    for grp, total in (("T_survivors", len(ct)), ("T_survivors_band", len(ct))):
        n_sum = sum(iv(r, "n", 0) for r in eff if r["group"] == grp)
        if n_sum != total:
            ok_n = False
            check(f"ct-survivor: {grp} n 对账", False, f"{n_sum} != {total}")
    check("ct-survivor: 组计数对账 CT 199", ok_n)
    for grp, total in (("plant", len(t)), ("CT_survivors", len(t)),
                       ("plant_x_CT_survivors_band", len(t))):
        n_sum = sum(iv(r, "n", 0) for r in tpe if r["group"] == grp)
        if n_sum != total:
            check(f"t-plant: {grp} n 对账", False, f"{n_sum} != {total}")
    check("t-plant: 组计数对账 T 205", True)
    # 组内 FORCE/ECO/LIGHT rate 一致性（n*rate 与整数值在舍入内）
    ok_rate = True
    for r in eff + tpe:
        n = iv(r, "n", 0)
        for col in ("FORCE_rate", "ECO_rate", "LIGHT_rate"):
            v = fv(r, col, None)
            if v is not None and abs(round(n * v) - n * v) > max(0.5, n * 5e-4):
                ok_rate = False
    check("ct/t 组表: rate*n 与整数计数一致（舍入内）", ok_rate)

    # 模型 OOF 复现（消费者侧重建：同一 binary frame + grouped 5-fold）
    def binary_frame(rows_, side):
        return [r for r in rows_ if r["side"] == side and r["branch"] in ("FORCE", "ECO")]

    ctf = binary_frame(rows, "ct")
    yc = np.array([1 if r["branch"] == "FORCE" else 0 for r in ctf])
    gc = np.array([r["match_series"] for r in ctf])
    Xc_m = np.array([[r["team_start_money"]] for r in ctf])
    Xc_s = np.array([[r["team_start_money"], iv(r, "opponent_survivors_pistol_end", 0)]
                     for r in ctf])
    a_m = auc_of(yc, oof_logistic_lr(Xc_m, yc, gc))
    a_s = auc_of(yc, oof_logistic_lr(Xc_s, yc, gc))
    ct_md = load_csv(os.path.join(PP_DIR, "ct-survivor-model-oof.csv"))
    exp = {r["model"]: fv(r, "oof_auc", None) for r in ct_md}
    check("CT OOF 复现: n == 191 (199 - 8 LIGHT)", len(ctf) == 191, f"got {len(ctf)}")
    check("CT OOF 复现: money-only AUC", exp.get("ct_money_only") is not None
          and abs(a_m - exp["ct_money_only"]) < 0.005, f"rebuilt {a_m:.4f} vs {exp.get('ct_money_only')}")
    check("CT OOF 复现: money+survivors AUC", exp.get("ct_money_plus_T_survivors") is not None
          and abs(a_s - exp["ct_money_plus_T_survivors"]) < 0.005,
          f"rebuilt {a_s:.4f} vs {exp.get('ct_money_plus_T_survivors')}")

    tf = binary_frame(rows, "t")
    yt = np.array([1 if r["branch"] == "FORCE" else 0 for r in tf])
    gt = np.array([r["match_series"] for r in tf])
    Xt1 = np.array([[r["team_start_money"]] for r in tf])
    Xt2 = np.array([[r["team_start_money"], int(r["pistol_bomb_planted"])] for r in tf])
    Xt3 = np.array([[r["team_start_money"], int(r["pistol_bomb_planted"]),
                     iv(r, "opponent_survivors_pistol_end", 0)] for r in tf])
    at1 = auc_of(yt, oof_logistic_lr(Xt1, yt, gt))
    at2 = auc_of(yt, oof_logistic_lr(Xt2, yt, gt))
    at3 = auc_of(yt, oof_logistic_lr(Xt3, yt, gt))
    t_md = load_csv(os.path.join(PP_DIR, "t-plant-model-oof.csv"))
    texp = {r["model"]: fv(r, "oof_auc", None) for r in t_md}
    check("T OOF 复现: n == 183 (205 - 22 LIGHT)", len(tf) == 183, f"got {len(tf)}")
    check("T OOF 复现: money-only AUC", texp.get("t_money_only") is not None
          and abs(at1 - texp["t_money_only"]) < 0.005, f"{at1:.4f} vs {texp.get('t_money_only')}")
    check("T OOF 复现: money+plant AUC", texp.get("t_money_plus_plant") is not None
          and abs(at2 - texp["t_money_plus_plant"]) < 0.005, f"{at2:.4f} vs {texp.get('t_money_plus_plant')}")
    check("T OOF 复现: money+plant+survivors AUC",
          texp.get("t_money_plus_plant_plus_CT_survivors") is not None
          and abs(at3 - texp["t_money_plus_plant_plus_CT_survivors"]) < 0.005,
          f"{at3:.4f} vs {texp.get('t_money_plus_plant_plus_CT_survivors')}")
    # OOF 分组是 match-series：复现用 series 分组，能对上即证明非随机行拆分
    return rows


# ---------------------------------------------------------------------------
# 5. MATCHED LR2400
# ---------------------------------------------------------------------------
def audit_matched_lr2400(pp):
    m = load_csv(os.path.join(PP_DIR, "matched-lr2400-context.csv"))
    overall = {(r["side"], r["sample"]): r for r in m if r["analysis"] == "overall"}
    check("matched overall: T POST_PISTOL n==205",
          iv(overall.get(("t", "POST_PISTOL")), "n", -1) == 205)
    check("matched overall: CT POST_PISTOL n==199",
          iv(overall.get(("ct", "POST_PISTOL")), "n", -1) == 199)
    check("matched overall: T LATER_NORMAL n==157",
          iv(overall.get(("t", "LATER_NORMAL")), "n", -1) == 157)
    check("matched overall: CT LATER_NORMAL n==45",
          iv(overall.get(("ct", "LATER_NORMAL")), "n", -1) == 45)
    # POST_PISTOL 无 retained primary（定义）
    ok_noretain = True
    for r in m:
        if r["sample"] == "POST_PISTOL" and fv(r, "opp_retained_primary", None) not in (None, 0.0):
            ok_noretain = False
    check("matched: POST_PISTOL opp_retained_primary == 0", ok_noretain)
    # overall POST_PISTOL rate 与分支分布一致
    dist = {r["side"] + "|" + r["branch"]: fv(r, "rate", None)
            for r in load_csv(os.path.join(PP_DIR, "post-pistol-branch-distribution.csv"))}
    for side in ("t", "ct"):
        if abs(fv(overall[(side, "POST_PISTOL")], "force_rate", -1) - dist[side + "|FORCE"]) > 1e-4:
            check("matched overall: FORCE rate 与分支分布一致", False, side)
    check("matched overall: FORCE rate 与分支分布一致", True)
    # band 表对账：POST_PISTOL n 总和 == 404 per side；LATER_NORMAL 重建
    for side in ("t", "ct"):
        band_pp = sum(iv(r, "n", 0) for r in m
                      if r["analysis"] == "band" and r["side"] == side and r["sample"] == "POST_PISTOL")
        band_lat = sum(iv(r, "n", 0) for r in m
                       if r["analysis"] == "band" and r["side"] == side and r["sample"] == "LATER_NORMAL")
        if band_pp != len([r for r in pp if r["side"] == side]):
            check("matched band: POST_PISTOL n 对账", False, f"{side} {band_pp}")
        check(f"matched band: {side} LATER_NORMAL n 与 overall 一致",
              band_lat == iv(overall[(side, "LATER_NORMAL")], "n", -1))

    # LATER_NORMAL 独立重建：lossIndex==2、非 OT、非 R1/R2/R13/R14、零 retained primary
    raw = json.load(open(os.path.join(CORPUS, "player-rounds.json")))
    grp = {}
    for r in raw:
        grp.setdefault((r["map"], r["roundNumber"], r["teamKey"]), []).append(r)
    later = {"t": 0, "ct": 0}
    for (m_, rn, tk), players in grp.items():
        if len(players) != 5:
            continue
        if any(p["overtime"] for p in players) or any(p["lossIndexAmbiguous"] for p in players):
            continue
        if rn in (1, 2, 13, 14):
            continue
        if players[0]["lossIndex"] != 2:  # lossReward 2400
            continue
        retain = sum(1 for p in players if p["retainedPrimary"] is not None)
        if retain != 0:
            continue
        side = players[0]["side"]
        if side in later:
            later[side] += 1
    check("matched later 重建: T == 157", later["t"] == 157, f"rebuilt {later['t']}")
    check("matched later 重建: CT == 45", later["ct"] == 45, f"rebuilt {later['ct']}")
    # caliper 单调性（宽松变体样本应 ≥ 严格变体）
    for side in ("t", "ct"):
        cals = {r["band"]: iv(r, "n", 0) for r in m
                if r["analysis"] == "matched" and r["side"] == side and r["sample"] == "POST_PISTOL"}
        if not (cals.get("caliper500", 0) >= cals.get("caliper300", 0) >= cals.get("caliper150", 0)):
            check("matched caliper: 样本单调", False, f"{side} {cals}")
    check("matched caliper: 样本单调", True)


# ---------------------------------------------------------------------------
# 6. TEAM STYLE
# ---------------------------------------------------------------------------
def audit_team_style(pp):
    ts = load_csv(os.path.join(PP_DIR, "team-system-propensity.csv"))
    check("team style: 32 队", len(ts) == 32, f"got {len(ts)}")
    n_tot = sum(iv(r, "n", 0) for r in ts)
    n_t = sum(iv(r, "n_t", 0) for r in ts)
    n_ct = sum(iv(r, "n_ct", 0) for r in ts)
    check("team style: n 总和 == 404", n_tot == 404, str(n_tot))
    check("team style: n_t 总和 == 205 / n_ct == 199", n_t == 205 and n_ct == 199,
          f"{n_t}/{n_ct}")
    check("team style: n == n_t + n_ct",
          all(iv(r, "n", 0) == iv(r, "n_t", 0) + iv(r, "n_ct", 0) for r in ts))
    # 每队 raw_force_rate 从 post-pistol-team-rounds 重算对账（pp5 定义：
    # T+CT 混合，全部 post-pistol 轮中 FORCE 占比）
    team_force = Counter()
    team_n = Counter()
    br_by_key = {(r["map"], r["half"]): r["branch"]
                 for r in load_csv(os.path.join(PP_DIR, "post-pistol-branches.csv"))}
    for r in pp:
        team_n[r["team"]] += 1
        if br_by_key.get((r["map"], r["half"])) == "FORCE":
            team_force[r["team"]] += 1
    ok_team = True
    for r in ts:
        raw = fv(r, "raw_force_rate", None)
        if team_n.get(r["team"], 0) == 0:
            continue
        rebuilt = team_force.get(r["team"], 0) / team_n[r["team"]]
        if raw is None or abs(raw - rebuilt) > 1e-4:
            ok_team = False
            check("team style: raw_force_rate 重算对账", False, r["team"])
            break
        shr = fv(r, "shrunk_force_rate", None)
        lo, hi = fv(r, "ci95_low", None), fv(r, "ci95_high", None)
        if shr is not None and not (0 <= shr <= 1):
            ok_team = False
        if lo is not None and hi is not None and not (lo <= hi):
            ok_team = False
        if r["low_support"].strip() not in ("", "LOW SUPPORT"):
            ok_team = False
    check("team style: raw 率对账 + shrinkage/CI 字段有效", ok_team)


# ---------------------------------------------------------------------------
# 7. AWP
# ---------------------------------------------------------------------------
def audit_awp():
    awp = load_csv(os.path.join(PP_DIR, "awp-dependency.csv"))
    meta = load_csv(os.path.join(PP_DIR, "role-metadata.csv"))
    awpers_by_team = {}
    for r in meta:
        if r["all_star_role"] == "AWPer":
            awpers_by_team.setdefault(r["team"], []).append(r["player"])
    check("awp: 32 队", len(awp) == 32, f"got {len(awp)}")
    ok = True
    for r in awp:
        team = r["team"]
        awper = r["designated_awper"].strip()
        meta_awper = awpers_by_team.get(team, [])
        if meta_awper:
            if awper != meta_awper[0]:
                ok = False
                check("awp: designated AWPer 来自 metadata（无 result-based relabel）",
                      False, f"{team}: {awper} vs {meta_awper}")
        else:
            if awper != "":
                ok = False
                check("awp: 无 metadata AWPer 的队伍应为空", False, team)
        for col in ("awp_resulting_rate_5400", "awp_acquired_rate_5400",
                    "awp_retained_rate_5400", "awp_resulting_rate_4000",
                    "non_awper_awp_rate_5400", "dual_awp_team_round_rate",
                    "post_pistol_force_rate"):
            v = fv(r, col, None)
            if v is not None and not (0 <= v <= 1):
                ok = False
                check("awp: rate 有界 [0,1]", False, f"{team} {col}={v}")
        if not r["awp_resulting_rate_5400"].strip() and iv(r, "n_viable_5400", -1) != 0:
            ok = False
            check("awp: 空 rate ⟺ n_viable_5400 == 0", False, team)
        if r["awp_resulting_rate_5400"].strip() and iv(r, "n_viable_5400", 0) <= 0:
            ok = False
            check("awp: 非空 rate 有正分母", False, team)
    check("awp: 角色来源 + rate 有界 + 分母报告", ok)


# ---------------------------------------------------------------------------
# 8. PLAYER ROLE STYLE（strict 清洗 + LPO 泄漏复现）
# ---------------------------------------------------------------------------
def audit_player_role_style(strict):
    check("player-style: 25,986 行", len(strict) == 25986, f"got {len(strict)}")
    ot = sum(1 for r in strict if (r.get("overtime") or "").strip() == "True")
    check("player-style: 无 overtime 行", ot == 0, str(ot))
    # strict 排除 drop_gave/drop_received/lossIndexAmbiguous 无列 → 由 pp1 过滤；
    # 这里验证 overtime 全 False 且队伍/角色字段完整
    norole = sum(1 for r in strict
                 if r["role_join_method"] not in ("exact", "alias-player", "alias-team-only"))
    check("player-style: role_join_method 合法", norole == 0, str(norole))
    # LPO 无同 player 泄漏：用 base 特征复现 deagle target 的 player-regime OOF AUC
    PAID = {"P250", "Dual Berettas", "Tec-9", "CZ75-Auto", "Five-SeveN", "Desert Eagle", "R8 Revolver"}
    sub = [r for r in strict if r["secondary"] in PAID]
    X = np.array([[float(r["startMoney"]) / 1000.0, int(r["_lr"]),
                   int(r["side"] == "ct"), int(int(r["roundNumber"]) in (2, 14)),
                   int((r["correctedRetainedPrimary"] or "").strip() not in ("", "UNKNOWN"))]
                  for r in sub])
    y = np.array([1 if r["secondary"] == "Desert Eagle" else 0 for r in sub])
    players = np.array([r["name"] for r in sub])
    series = np.array([series_of_map(r["map"]) for r in sub])
    a_series = auc_of(y, oof_logistic_lr(X, y, series, max_iter=3000))
    a_player = auc_of(y, oof_logistic_lr(X, y, players, max_iter=3000))
    oof = load_csv(os.path.join(PP_DIR, "role-style-oof.csv"))
    got = {(r["target"], r["features"], r["regime"]): fv(r, "oof_auc", None) for r in oof}
    check("role OOF 复现: deagle base series AUC",
          got.get(("paid_pistol_deagle_vs_other", "base", "series")) is not None
          and abs(a_series - got[("paid_pistol_deagle_vs_other", "base", "series")]) < 0.005,
          f"rebuilt {a_series:.4f}")
    check("role OOF 复现: deagle base player(LPO) AUC（无同 player 泄漏）",
          got.get(("paid_pistol_deagle_vs_other", "base", "player")) is not None
          and abs(a_player - got[("paid_pistol_deagle_vs_other", "base", "player")]) < 0.005,
          f"rebuilt {a_player:.4f}")
    # pistol-preference 对账：无条件表 (a)（无 role/mband/branch/purchase_state 的行）
    pref = load_csv(os.path.join(PP_DIR, "pistol-preference.csv"))
    n_uncond = sum(iv(r, "n", 0) for r in pref
                   if not (r["role"] or r["money_band"] or r["branch"] or r["purchase_state"]))
    check("pistol-preference: 无条件表 n 总和 == 5686", n_uncond == 5686, str(n_uncond))
    # (a) 无条件 side x pistol 行与 strict 重算一致
    tot_a = Counter((r["side"], r["secondary"]) for r in sub)
    for row in pref:
        if not row["role"] and not row["money_band"] and not row["branch"] and not row["purchase_state"]:
            if iv(row, "n", -1) != tot_a.get((row["side"], row["pistol"]), -1):
                check("pistol-preference: 无条件表对账", False,
                      f"{row['side']}|{row['pistol']}")
    check("pistol-preference: 无条件表与 strict 重算一致", True)


# ---------------------------------------------------------------------------
# 9. OPPONENT ECONOMY（源码扫描 + 独立重建）
# ---------------------------------------------------------------------------
def audit_opponent_economy():
    src = open(os.path.join(HERE, "pp7_opponent_preference.py"), encoding="utf-8").read()
    # predictor 定义扫描：Xf 只用预决策字段
    xf_block = src.split("Xf = np.array(")[1].split("])")[0]
    pred_fields = re.findall(r'f\["([a-z_0-9]+)"\]', xf_block)
    allowed = {"opponent_loss_index", "opponent_start_money", "opponent_retained_primary",
               "opponent_retained_awp", "opponent_survived_prev", "opponent_prev_round_win"}
    bad = [p for p in pred_fields if p not in allowed]
    check("opponent economy: predictor 仅预决策字段", not bad, str(bad))
    if "opponent_resulting_rifle" in pred_fields:
        check("opponent economy: resulting rifle 未作 predictor", False)
    # outcome 字段只出现在 y 定义中
    y_block = src.split("yf = np.array(")[1].split("])")[0]
    y_fields = re.findall(r'f\["([a-z_0-9]+)"\]', y_block)
    check("opponent economy: 结局只用 y_force_full", y_fields == ["y_force_full"], str(y_fields))
    # 前一轮结果取自 rn-1（opp_prev），非当前回合
    if "opp_prev[\"winnerSide\"]" not in src or "rn - 1" not in src:
        check("opponent economy: 前轮结果用 rn-1", False)
    else:
        check("opponent economy: 前轮结果用 rn-1", True)

    # 独立重建 feats 计数与类分布
    raw = json.load(open(os.path.join(CORPUS, "player-rounds.json")))
    grp = {}
    for r in raw:
        grp.setdefault((r["map"], r["roundNumber"], r["teamKey"]), []).append(r)
    tr = {}
    for (m_, rn, tk), players in grp.items():
        tr[(m_, rn, tk)] = {
            "map": m_, "roundNumber": rn, "side": players[0]["side"],
            "overtime": any(p["overtime"] for p in players),
            "winnerSide": players[0]["winnerSide"],
            "lossIndex": players[0]["lossIndex"],
            "team_start_money": sum(p["startMoney"] for p in players),
            "team_money_spent": sum(p["moneySpent"] for p in players),
        }
    thr = {}
    for r in load_csv(os.path.join(PP_DIR, "branch-thresholds.csv")):
        if r["side"] in ("t", "ct"):
            thr[r["side"]] = {"eco": fv(r, "threshold_eco_light", 0),
                              "force": fv(r, "threshold_light_force", 1)}

    def spend_class(t):
        ratio = t["team_money_spent"] / t["team_start_money"] if t["team_start_money"] else 0
        th = thr[t["side"]]
        if ratio > th["force"]:
            return "force/full"
        if ratio < th["eco"]:
            return "eco"
        return "light"

    cnt = Counter()
    n_feats = 0
    for (m_, rn, tk), t in sorted(tr.items()):
        if t["overtime"] or rn in (1, 13):
            continue
        opp = None
        for (m2, rn2, tk2), rr in tr.items():
            if m2 == m_ and rn2 == rn and rr["side"] != t["side"]:
                opp = rr
                break
        if opp is None:
            continue
        cnt[spend_class(opp)] += 1
        n_feats += 1
    check("opponent economy 重建: n == 7580", n_feats == 7580, str(n_feats))
    check("opponent economy 重建: 类分布 eco/light/force",
          cnt == Counter({"force/full": 2779, "eco": 918, "light": 3883}), str(dict(cnt)))


# ---------------------------------------------------------------------------
# 10. PRODUCTION / FROZEN CORE
# ---------------------------------------------------------------------------
def audit_production_core():
    d = git("diff", "0875db9", "--", "packages/", "apps/")
    check("production: 0875db9 以来 packages/ apps/ 无改动", d.stdout.strip() == "",
          (d.stdout or d.stderr)[:200])
    base = json.load(open(os.path.join(HERE, "metadata", "frozen-core-sha256-0875db9.json")))
    ok = True
    for f, hs in base.items():
        p = os.path.join(RESULTS_DIR, f)
        blob = git("show", f"0875db9:experiments/economy-policy/results/cologne-2026/{f}")
        blob_sha = sha256_bytes(blob.stdout.encode("utf-8"))
        wt_sha = sha256_bytes(open(p, "rb").read())
        if blob.returncode != 0 or blob_sha != hs["repo_blob_sha256_0875db9"]:
            ok = False
            check("frozen core: blob hash 与基线一致", False, f)
        if wt_sha != hs["working_tree_sha256"]:
            ok = False
            check("frozen core: 工作树 hash 与基线一致", False, f)
        if blob_sha != wt_sha:
            ok = False
            check("frozen core: 工作树 == 0875db9 blob", False, f)
    check("frozen core: 6 个 artifact 内容与 0875db9 基线 6/6 一致", ok)
    d2 = git("diff", "0875db9", "--",
             "experiments/economy-policy/results/cologne-2026/_core-sha256.json")
    check("frozen core: 旧 _core-sha256.json 未被修改", d2.stdout.strip() == "")


def main():
    print("=" * 64)
    print("AUDIT POST-PISTOL STRATEGY (consumer-side, artifacts only)")
    print("=" * 64)
    strict = audit_role_metadata()
    pp = audit_post_pistol_team_data()
    br = audit_branches(pp)
    audit_ct_t_studies(pp, br)
    audit_matched_lr2400(pp)
    audit_team_style(pp)
    audit_awp()
    audit_player_role_style(strict)
    audit_opponent_economy()
    audit_production_core()

    fails = [c for c in CHECKS if not c[1]]
    print()
    print(f"checks: {len(CHECKS)}  pass: {len(CHECKS) - len(fails)}  fail: {len(fails)}")
    if fails:
        print("FAILED CHECKS:")
        for name, _, detail in fails:
            print(f"  - {name}" + (f" — {detail}" if detail else ""))
        print("RESULT: FAIL")
        report_path = os.path.join(PP_DIR, "audit-post-pistol-report.txt")
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(f"RESULT: FAIL ({len(fails)}/{len(CHECKS)} failed)\n")
            for name, _, detail in CHECKS:
                f.write(f"[{'PASS' if _ else 'FAIL'}] {name}"
                        + (f" — {detail}" if detail else "") + "\n")
        sys.exit(1)
    else:
        print("RESULT: PASS")
        report_path = os.path.join(PP_DIR, "audit-post-pistol-report.txt")
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(f"RESULT: PASS ({len(CHECKS)} checks)\n")
            for name, ok, detail in CHECKS:
                f.write(f"[PASS] {name}" + (f" — {detail}" if detail else "") + "\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
