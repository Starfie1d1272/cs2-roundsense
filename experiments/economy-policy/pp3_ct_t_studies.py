#!/usr/bin/env python3
"""pp3 — CT post-pistol survivor study + T post-pistol plant study.

CT study (CT lost pistol -> CT R2/R14 decision):
  - raw descriptive by T survivors 0..5 (n, FORCE/ECO/LIGHT %, spend ratio
    mean/median, cluster-bootstrap 95% CI)
  - binary FORCE-vs-ECO models: money only vs + T survivors (grouped OOF by
    match series; log loss / Brier / AUC)
  - OBSERVED ASSOCIATION only — no causal claims

T study (T lost pistol -> T R2/R14 decision):
  - raw descriptive plant vs no plant, crossed with CT survivors bands
  - binary FORCE-vs-ECO models: money only / + plant / + plant + survivors /
    + interaction (grouped OOF)

Outputs:
  ct-survivor-effect.csv, t-plant-effect.csv
  ct-survivor-model-oof.csv, t-plant-model-oof.csv
  plots/03-ct-force-vs-t-survivors.png
  plots/04-t-force-plant-vs-noplant.png
"""
import csv
import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post_pistol_common as ppc

SEED = 42
B = 1000


def load_pp_with_branches():
    with open(os.path.join(ppc.PP_DIR, "post-pistol-team-rounds.csv")) as f:
        rows = list(csv.DictReader(f))
    with open(os.path.join(ppc.PP_DIR, "post-pistol-branches.csv")) as f:
        br = {r["map"] + "|" + r["half"]: r for r in csv.DictReader(f)}
    out = []
    for r in rows:
        b = br.get(r["map"] + "|" + r["half"])
        if b is None:
            continue
        r["team_spend_ratio"] = float(r["team_spend_ratio"])
        r["team_start_money"] = float(r["team_start_money"])
        r["pistol_bomb_planted"] = (r["pistol_bomb_planted"] == "True")
        r["branch"] = b["branch"]
        r["p_force"] = float(b["p_force"])
        r["p_light"] = float(b["p_light"])
        r["p_eco"] = float(b["p_eco"])
        out.append(r)
    return out


def cluster_rate_ci(rows, mask, B=B, seed=SEED):
    """Cluster-bootstrap 95% CI of the rate of mask over match series."""
    series = np.array([r["match_series"] for r in rows])
    y = np.array([1 if m else 0 for m in mask])
    uniq = sorted(set(series))
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(B):
        picked = rng.choice(len(uniq), size=len(uniq), replace=True)
        idx = np.concatenate([np.where(series == uniq[u])[0] for u in picked])
        boots.append(y[idx].mean())
    return np.percentile(boots, [2.5, 97.5])


def oof_logistic(X, y, groups, model_extra=None):
    """Grouped 5-fold OOF by match series. Returns (oof_probs, oof_y, idx)."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import GroupKFold
    gkf = GroupKFold(n_splits=5)
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=int)
    groups = np.asarray(groups)
    oof = np.full(len(y), np.nan)
    for tr, te in gkf.split(X, y, groups):
        sc = StandardScaler().fit(X[tr])
        Xtr, Xte = sc.transform(X[tr]), sc.transform(X[te])
        m = LogisticRegression(max_iter=2000, random_state=SEED)
        m.fit(Xtr, y[tr])
        oof[te] = m.predict_proba(Xte)[:, 1]
    return oof


def report_metrics(name, y, p):
    ll = ppc.logloss_binary(y, p)
    br = ppc.brier_binary(y, p)
    from sklearn.metrics import roc_auc_score
    auc = roc_auc_score(y, p)
    return {"model": name, "n": int(len(y)), "oof_log_loss": round(ll, 4),
            "oof_brier": round(br, 4), "oof_auc": round(auc, 4)}


def binary_frame(rows, side):
    """FORCE=1 vs ECO=0; LIGHT excluded (not forced into binary)."""
    return [r for r in rows if r["side"] == side and r["branch"] in ("FORCE", "ECO")]


def main():
    rows = load_pp_with_branches()

    # =================================================================
    # CT STUDY
    # =================================================================
    ct_rows = [r for r in rows if r["side"] == "ct"]
    out = []
    for surv in range(6):
        sub = [r for r in ct_rows if int(r["opponent_survivors_pistol_end"]) == surv]
        if not sub:
            continue
        ratios = np.array([r["team_spend_ratio"] for r in sub])
        force_ci = cluster_rate_ci(sub, [r["branch"] == "FORCE" for r in sub])
        eco_ci = cluster_rate_ci(sub, [r["branch"] == "ECO" for r in sub])
        light_ci = cluster_rate_ci(sub, [r["branch"] == "LIGHT" for r in sub])
        out.append({
            "side": "ct", "group": "T_survivors", "value": surv, "n": len(sub),
            "FORCE_rate": round(sum(r["branch"] == "FORCE" for r in sub) / len(sub), 4),
            "FORCE_ci95": f"[{force_ci[0]:.3f},{force_ci[1]:.3f}]",
            "ECO_rate": round(sum(r["branch"] == "ECO" for r in sub) / len(sub), 4),
            "ECO_ci95": f"[{eco_ci[0]:.3f},{eco_ci[1]:.3f}]",
            "LIGHT_rate": round(sum(r["branch"] == "LIGHT" for r in sub) / len(sub), 4),
            "LIGHT_ci95": f"[{light_ci[0]:.3f},{light_ci[1]:.3f}]",
            "mean_spend_ratio": round(float(ratios.mean()), 4),
            "median_spend_ratio": round(float(np.median(ratios)), 4),
        })
    # banded version (0-1, 2-3, 4-5)
    for lo, hi in ((0, 1), (2, 3), (4, 5)):
        sub = [r for r in ct_rows if lo <= int(r["opponent_survivors_pistol_end"]) <= hi]
        if not sub:
            continue
        ratios = np.array([r["team_spend_ratio"] for r in sub])
        force_ci = cluster_rate_ci(sub, [r["branch"] == "FORCE" for r in sub])
        out.append({
            "side": "ct", "group": "T_survivors_band", "value": f"{lo}-{hi}",
            "n": len(sub),
            "FORCE_rate": round(sum(r["branch"] == "FORCE" for r in sub) / len(sub), 4),
            "FORCE_ci95": f"[{force_ci[0]:.3f},{force_ci[1]:.3f}]",
            "ECO_rate": round(sum(r["branch"] == "ECO" for r in sub) / len(sub), 4),
            "ECO_ci95": "",
            "LIGHT_rate": round(sum(r["branch"] == "LIGHT" for r in sub) / len(sub), 4),
            "LIGHT_ci95": "",
            "mean_spend_ratio": round(float(ratios.mean()), 4),
            "median_spend_ratio": round(float(np.median(ratios)), 4),
        })
    with open(os.path.join(ppc.PP_DIR, "ct-survivor-effect.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)

    # binary models: FORCE vs ECO (LIGHT excluded)
    frame = binary_frame(ct_rows, "ct")
    X_money = np.array([[r["team_start_money"]] for r in frame])
    X_surv = np.array([[r["team_start_money"],
                        int(r["opponent_survivors_pistol_end"])] for r in frame])
    y = np.array([1 if r["branch"] == "FORCE" else 0 for r in frame])
    groups = np.array([r["match_series"] for r in frame])
    p_money = oof_logistic(X_money, y, groups)
    p_surv = oof_logistic(X_surv, y, groups)
    oof_rows = [report_metrics("ct_money_only", y, p_money),
                report_metrics("ct_money_plus_T_survivors", y, p_surv)]
    # full-data coefficients (descriptive, not OOF)
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    sc = StandardScaler().fit(X_surv)
    m = LogisticRegression(max_iter=2000, random_state=SEED).fit(sc.transform(X_surv), y)
    # survivors coefficient on raw scale (fit raw, no scaling) for interpretability
    m_raw = LogisticRegression(max_iter=2000, random_state=SEED).fit(X_surv, y)
    oof_rows[1]["coef_money_std"] = round(float(m.coef_[0][0]), 4)
    oof_rows[1]["coef_survivors_std"] = round(float(m.coef_[0][1]), 4)
    oof_rows[1]["coef_survivors_raw_per_unit"] = round(float(m_raw.coef_[0][1]), 4)
    # monotonic trend: Spearman rho of force rate vs survivors (cell-level)
    cell_rates = []
    for surv in range(6):
        sub = [r for r in frame if int(r["opponent_survivors_pistol_end"]) == surv]
        if len(sub) >= 3:
            cell_rates.append((surv, sum(r["branch"] == "FORCE" for r in sub) / len(sub)))
    from scipy.stats import spearmanr
    if len(cell_rates) >= 3:
        rho, pval = spearmanr([c[0] for c in cell_rates], [c[1] for c in cell_rates])
        oof_rows[1]["force_rate_vs_survivors_spearman_rho"] = round(float(rho), 4)
        oof_rows[1]["force_rate_vs_survivors_p"] = round(float(pval), 4)
    ct_oof_fields = sorted({k for r in oof_rows for k in r})
    with open(os.path.join(ppc.PP_DIR, "ct-survivor-model-oof.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=ct_oof_fields)
        w.writeheader()
        w.writerows(oof_rows)

    # =================================================================
    # T STUDY
    # =================================================================
    t_rows = [r for r in rows if r["side"] == "t"]
    tout = []
    for plant in (False, True):
        sub = [r for r in t_rows if r["pistol_bomb_planted"] == plant]
        if not sub:
            continue
        ratios = np.array([r["team_spend_ratio"] for r in sub])
        force_ci = cluster_rate_ci(sub, [r["branch"] == "FORCE" for r in sub])
        tout.append({
            "side": "t", "group": "plant", "value": int(plant), "n": len(sub),
            "FORCE_rate": round(sum(r["branch"] == "FORCE" for r in sub) / len(sub), 4),
            "FORCE_ci95": f"[{force_ci[0]:.3f},{force_ci[1]:.3f}]",
            "ECO_rate": round(sum(r["branch"] == "ECO" for r in sub) / len(sub), 4),
            "ECO_ci95": "",
            "LIGHT_rate": round(sum(r["branch"] == "LIGHT" for r in sub) / len(sub), 4),
            "LIGHT_ci95": "",
            "mean_spend_ratio": round(float(ratios.mean()), 4),
            "median_spend_ratio": round(float(np.median(ratios)), 4),
        })
    # plant x CT survivors bands
    for lo, hi in ((0, 1), (2, 3), (4, 5)):
        for plant in (False, True):
            sub = [r for r in t_rows
                   if r["pistol_bomb_planted"] == plant
                   and lo <= int(r["opponent_survivors_pistol_end"]) <= hi]
            if not sub:
                continue
            ratios = np.array([r["team_spend_ratio"] for r in sub])
            tout.append({
                "side": "t", "group": "plant_x_CT_survivors_band",
                "value": f"{int(plant)}:{lo}-{hi}", "n": len(sub),
                "FORCE_rate": round(sum(r["branch"] == "FORCE" for r in sub) / len(sub), 4),
                "FORCE_ci95": "",
                "ECO_rate": round(sum(r["branch"] == "ECO" for r in sub) / len(sub), 4),
                "ECO_ci95": "",
                "LIGHT_rate": round(sum(r["branch"] == "LIGHT" for r in sub) / len(sub), 4),
                "LIGHT_ci95": "",
                "mean_spend_ratio": round(float(ratios.mean()), 4),
                "median_spend_ratio": round(float(np.median(ratios)), 4),
            })
    # raw 0..5 CT survivors cells (plant aggregated)
    for surv in range(6):
        sub = [r for r in t_rows if int(r["opponent_survivors_pistol_end"]) == surv]
        if not sub:
            continue
        ratios = np.array([r["team_spend_ratio"] for r in sub])
        force_ci = cluster_rate_ci(sub, [r["branch"] == "FORCE" for r in sub])
        tout.append({
            "side": "t", "group": "CT_survivors", "value": surv, "n": len(sub),
            "FORCE_rate": round(sum(r["branch"] == "FORCE" for r in sub) / len(sub), 4),
            "FORCE_ci95": f"[{force_ci[0]:.3f},{force_ci[1]:.3f}]",
            "ECO_rate": round(sum(r["branch"] == "ECO" for r in sub) / len(sub), 4),
            "ECO_ci95": "",
            "LIGHT_rate": round(sum(r["branch"] == "LIGHT" for r in sub) / len(sub), 4),
            "LIGHT_ci95": "",
            "mean_spend_ratio": round(float(ratios.mean()), 4),
            "median_spend_ratio": round(float(np.median(ratios)), 4),
        })
    with open(os.path.join(ppc.PP_DIR, "t-plant-effect.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(tout[0].keys()))
        w.writeheader()
        w.writerows(tout)

    # T models
    tframe = binary_frame(t_rows, "t")
    X1 = np.array([[r["team_start_money"]] for r in tframe])
    X2 = np.array([[r["team_start_money"],
                    int(r["pistol_bomb_planted"])] for r in tframe])
    X3 = np.array([[r["team_start_money"], int(r["pistol_bomb_planted"]),
                    int(r["opponent_survivors_pistol_end"])] for r in tframe])
    X4 = np.array([[r["team_start_money"], int(r["pistol_bomb_planted"]),
                    int(r["opponent_survivors_pistol_end"]),
                    int(r["pistol_bomb_planted"]) * int(r["opponent_survivors_pistol_end"])]
                   for r in tframe])
    yt = np.array([1 if r["branch"] == "FORCE" else 0 for r in tframe])
    gt = np.array([r["match_series"] for r in tframe])
    toof = [
        report_metrics("t_money_only", yt, oof_logistic(X1, yt, gt)),
        report_metrics("t_money_plus_plant", yt, oof_logistic(X2, yt, gt)),
        report_metrics("t_money_plus_plant_plus_CT_survivors", yt, oof_logistic(X3, yt, gt)),
        report_metrics("t_full_interaction", yt, oof_logistic(X4, yt, gt)),
    ]
    m_full = LogisticRegression(max_iter=2000, random_state=SEED).fit(X4, yt)
    toof[3]["coef_money_raw"] = round(float(m_full.coef_[0][0]), 6)
    toof[3]["coef_plant_raw"] = round(float(m_full.coef_[0][1]), 4)
    toof[3]["coef_ct_survivors_raw"] = round(float(m_full.coef_[0][2]), 4)
    toof[3]["coef_plant_x_survivors_raw"] = round(float(m_full.coef_[0][3]), 4)
    t_oof_fields = sorted({k for r in toof for k in r})
    with open(os.path.join(ppc.PP_DIR, "t-plant-model-oof.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=t_oof_fields)
        w.writeheader()
        w.writerows(toof)

    # =================================================================
    # plots
    # =================================================================
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    # 03: CT force rate vs T survivors
    fig, ax = plt.subplots(figsize=(6.5, 4.2))
    xs = []
    ys = []
    yerrs = []
    for surv in range(6):
        sub = [r for r in ct_rows if int(r["opponent_survivors_pistol_end"]) == surv]
        if len(sub) < 3:
            continue
        rate = sum(r["branch"] == "FORCE" for r in sub) / len(sub)
        ci = cluster_rate_ci(sub, [r["branch"] == "FORCE" for r in sub])
        xs.append(surv)
        ys.append(rate)
        yerrs.append([[rate - ci[0]], [ci[1] - rate]])
    ax.errorbar(xs, ys, yerr=np.array(yerrs).squeeze(-1).T if yerrs else None,
                fmt="o-", capsize=4, color="#4c72b0")
    for i, (x, y) in enumerate(zip(xs, ys)):
        n = sum(1 for r in ct_rows if int(r["opponent_survivors_pistol_end"]) == x)
        ax.annotate(f"n={n}", (x, y), textcoords="offset points",
                    xytext=(0, 7), ha="center", fontsize=8)
    ax.set_xlabel("T survivors at pistol end (opponent)")
    ax.set_ylabel("CT FORCE rate (post-pistol)")
    ax.set_xticks(range(6))
    ax.set_ylim(0, 1.05)
    ax.set_title("CT post-pistol FORCE rate vs T survivors (95% cluster CI)")
    fig.tight_layout()
    fig.savefig(os.path.join(ppc.PLOT_DIR, "03-ct-force-vs-t-survivors.png"), dpi=150)
    plt.close(fig)

    # 04: T force rate plant vs no-plant
    fig, ax = plt.subplots(figsize=(6.5, 4.2))
    labels = []
    rates = []
    cis = []
    for plant in (False, True):
        sub = [r for r in t_rows if r["pistol_bomb_planted"] == plant]
        labels.append("planted" if plant else "no plant")
        rates.append(sum(r["branch"] == "FORCE" for r in sub) / len(sub))
        ci = cluster_rate_ci(sub, [r["branch"] == "FORCE" for r in sub])
        cis.append([rates[-1] - ci[0], ci[1] - rates[-1]])
    ax.bar(labels, rates, yerr=np.array(cis).T, capsize=5, color=["#4c72b0", "#dd8452"],
           width=0.5)
    for i, lab in enumerate(labels):
        sub = [r for r in t_rows if r["pistol_bomb_planted"] == (lab == "planted")]
        ax.text(i, rates[i] + 0.04, f"n={len(sub)}", ha="center")
    ax.set_ylabel("T FORCE rate (post-pistol)")
    ax.set_ylim(0, 0.9)
    ax.set_title("T post-pistol FORCE rate: plant vs no plant (95% cluster CI)")
    fig.tight_layout()
    fig.savefig(os.path.join(ppc.PLOT_DIR, "04-t-force-plant-vs-noplant.png"), dpi=150)
    plt.close(fig)

    print(json.dumps({
        "ct_study": {
            "n": len(ct_rows), "binary_n": len(frame),
            "models": oof_rows,
        },
        "t_study": {
            "n": len(t_rows), "binary_n": len(tframe),
            "models": toof,
        },
    }, indent=2, default=float))


if __name__ == "__main__":
    main()
