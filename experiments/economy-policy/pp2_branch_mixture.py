#!/usr/bin/env python3
"""pp2 — post-pistol spend-ratio mixture + branch classification.

Questions:
  - Is the team spend-ratio distribution bimodal / trimodal?
  - Where are reproducible descriptive thresholds (valley / GMM posterior)?
  - How much of professional post-pistol decisions do FORCE+ECO cover?

Outputs (results/cologne-2026/post-pistol-strategy/):
  mixture-fit.csv                      (1/2/3-component GMM, BIC, means, SD, weights)
  branch-thresholds.csv                (chosen thresholds + sensitivity ±0.05)
  post-pistol-branches.csv             (per team-round branch + posteriors)
  post-pistol-branch-distribution.csv  (rates + cluster-bootstrap 95% CI)
  post-pistol-two-branch-coverage.csv  (coverage at posterior thresholds)
  plots/01-spend-ratio-distribution.png
  plots/02-t-vs-ct-branch.png
"""
import csv
import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post_pistol_common as ppc

RNG = np.random.default_rng(42)
SEED = 42
B = 1000  # cluster bootstrap replicates


def load_pp():
    with open(os.path.join(ppc.PP_DIR, "post-pistol-team-rounds.csv")) as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["team_spend_ratio"] = float(r["team_spend_ratio"])
    return rows


def fit_gmm(x, k):
    from sklearn.mixture import GaussianMixture
    gmm = GaussianMixture(n_components=k, covariance_type="full", n_init=20,
                          random_state=SEED)
    X = x.reshape(-1, 1)
    gmm.fit(X)
    order = np.argsort(gmm.means_.ravel())
    means = gmm.means_.ravel()[order]
    sds = np.sqrt(gmm.covariances_.ravel())[order]
    wts = gmm.weights_[order]
    # posterior per component for each x
    post = gmm.predict_proba(X)[:, order]
    return gmm, means, sds, wts, post


def boundary_between(m1, s1, w1, m2, s2, w2, grid=None):
    """x where w1*N(x|m1,s1) == w2*N(x|m2,s2) between two components.

    Robust grid scan: nearest sign-change of d(x) = w1 f1 - w2 f2 to the
    midpoint of the means, restricted to [m1, m2]; fallback to argmin |d|
    when no sign change occurs inside the interval (diffuse components).
    """
    from scipy.stats import norm
    if grid is None:
        grid = np.linspace(0.0, 1.0, 2001)
    d = w1 * norm.pdf(grid, m1, s1) - w2 * norm.pdf(grid, m2, s2)
    mask = (grid >= min(m1, m2)) & (grid <= max(m1, m2))
    g = grid[mask]
    dd = d[mask]
    signs = np.sign(dd)
    idx = np.where(np.diff(signs) != 0)[0]
    if len(idx) > 0:
        mid = 0.5 * (m1 + m2)
        best = min(idx, key=lambda i: abs(0.5 * (g[i] + g[i + 1]) - mid))
        return float(0.5 * (g[best] + g[best + 1]))
    i = int(np.argmin(np.abs(dd)))
    return float(g[i])


def kde_valley(x, lo, hi, grid):
    from scipy.stats import gaussian_kde
    try:
        kde = gaussian_kde(x, bw_method="scott")
    except Exception:
        return None
    vals = kde(grid)
    mask = (grid >= lo) & (grid <= hi)
    if mask.sum() < 3:
        return None
    g = grid[mask]
    v = vals[mask]
    imin = int(np.argmin(v))
    return float(g[imin]), float(v[imin])


def cluster_ci(rows, side, keyfn, B=B, seed=SEED):
    """Cluster-bootstrap 95% CI (percentile) of a rate over match series."""
    rr = rows if side == "all" else [r for r in rows if r["side"] == side]
    series = np.array([r["match_series"] for r in rr])
    uniq = sorted(set(series))
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(B):
        picked = rng.choice(len(uniq), size=len(uniq), replace=True)
        idx = np.concatenate([np.where(series == uniq[u])[0] for u in picked])
        if len(idx) == 0:
            continue
        sub = [rr[i] for i in idx]
        boots.append(np.mean([keyfn(r) for r in sub]))
    boots = np.array(boots)
    return np.percentile(boots, [2.5, 97.5])


def main():
    os.makedirs(ppc.PLOT_DIR, exist_ok=True)
    rows = load_pp()
    all_x = np.array([r["team_spend_ratio"] for r in rows])
    groups = {"all": rows,
              "t": [r for r in rows if r["side"] == "t"],
              "ct": [r for r in rows if r["side"] == "ct"]}

    # ---------------------------------------------------------------
    # 1. GMM 1/2/3 components, BIC (ALL/T/CT)
    # ---------------------------------------------------------------
    fits = {}
    mixture_rows = []
    for side, rr in groups.items():
        x = np.array([r["team_spend_ratio"] for r in rr])
        for k in (1, 2, 3):
            gmm, means, sds, wts, post = fit_gmm(x, k)
            bic = gmm.bic(x.reshape(-1, 1))
            fits[(side, k)] = (gmm, means, sds, wts, post)
            mixture_rows.append({
                "side": side, "components": k, "n": len(x),
                "bic": round(bic, 1),
                "means": json.dumps([round(float(m), 4) for m in means]),
                "sds": json.dumps([round(float(s), 4) for s in sds]),
                "weights": json.dumps([round(float(w), 4) for w in wts]),
            })
    with open(os.path.join(ppc.PP_DIR, "mixture-fit.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(mixture_rows[0].keys()))
        w.writeheader()
        w.writerows(mixture_rows)

    # ---------------------------------------------------------------
    # 2. descriptive thresholds from the 3-component fit (side-specific)
    #    ECO < b_lo < LIGHT < b_hi < FORCE ; if light weight < 5% or
    #    boundaries invalid -> 2-branch single threshold.
    # ---------------------------------------------------------------
    grid = np.linspace(0.0, 1.0, 401)
    threshold_rows = []
    branch_rows = []
    all_copies = None
    # side-specific passes classify the real rows; the "all" pass runs on
    # shallow copies so it cannot clobber side-specific classifications.
    for side in ("t", "ct", "all"):
        rr = groups[side]
        if side == "all":
            rr = [dict(r) for r in rows]
            all_copies = rr
        x = np.array([r["team_spend_ratio"] for r in rr])
        gmm, means, sds, wts, post = fits[(side, 3)]
        # posterior-crossing boundaries between adjacent components
        boundaries = []
        for i in range(2):
            b = boundary_between(means[i], sds[i], wts[i],
                                 means[i + 1], sds[i + 1], wts[i + 1])
            boundaries.append(b)
        # KDE valley between eco and force means (descriptive cross-check)
        valley = kde_valley(x, boundaries[0] - 0.1, boundaries[1] + 0.1, grid) \
            if len(boundaries) == 2 else None
        light_weight = wts[1] if len(wts) == 3 else 0.0
        if len(wts) == 3 and light_weight >= 0.05 and boundaries[0] < boundaries[1] \
                and means[1] > boundaries[0] + 0.02:
            b_lo, b_hi = boundaries[0], boundaries[1]
            branches = 3
        else:
            # collapse to 2 branches at the force/eco boundary (outermost)
            if means[0] < 0.5:
                b_hi = boundaries[0] if len(boundaries) else 0.5
                b_lo = None
            else:
                b_lo = None
                b_hi = boundaries[-1] if boundaries else 0.5
            branches = 2
        # classify
        for idx, (r, xi) in enumerate(zip(rr, x)):
            if branches == 3:
                p_eco = post[idx][0]
                p_light = post[idx][1]
                p_force = post[idx][2]
                branch = "FORCE" if xi > b_hi else ("ECO" if xi < b_lo else "LIGHT")
            else:
                p_eco = 1.0 if xi <= b_hi else 0.0
                p_light = 0.0
                p_force = 1.0 - p_eco
                branch = "FORCE" if xi > b_hi else "ECO"
            r["_branch"] = branch
            r["_p_force"] = p_force
            r["_p_light"] = p_light
            r["_p_eco"] = p_eco
            if side == "all":
                r["_all_pass"] = True
            branch_rows.append(r)
        threshold_rows.append({
            "side": side, "n": len(rr), "branches": branches,
            "threshold_eco_light": round(b_lo, 4) if b_lo is not None else "",
            "threshold_light_force": round(b_hi, 4) if b_hi is not None else "",
            "light_component_weight": round(light_weight, 4),
            "kde_valley_x": round(valley[0], 4) if valley else "",
            "kde_valley_density": round(valley[1], 6) if valley else "",
            "component_means": json.dumps([round(float(m), 4) for m in means]),
            "component_sds": json.dumps([round(float(s), 4) for s in sds]),
        })

    # sensitivity: thresholds ±0.05
    for side in ("t", "ct"):
        thr = next(t for t in threshold_rows if t["side"] == side)
        base = thr["threshold_light_force"]
        if base == "":
            continue
        for delta in (-0.05, 0.05):
            thr_sens = float(base) + delta
            for r in groups[side]:
                r[f"_branch_d{delta:+.2f}"] = ("FORCE" if r["team_spend_ratio"] > thr_sens
                                               else "ECO")
    with open(os.path.join(ppc.PP_DIR, "branch-thresholds.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(threshold_rows[0].keys()))
        w.writeheader()
        w.writerows(threshold_rows)

    # write per-team-round branch assignments
    with open(os.path.join(ppc.PP_DIR, "post-pistol-branches.csv"), "w", newline="") as f:
        fields = ["match_series", "map", "half", "post_pistol_round", "team", "side",
                  "team_spend_ratio", "team_start_money", "team_money_spent",
                  "branch", "p_force", "p_light", "p_eco"]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in branch_rows:
            if r.get("_all_pass"):
                continue
            w.writerow({k: r.get(k) for k in fields} |
                       {"branch": r["_branch"], "p_force": r["_p_force"],
                        "p_light": r["_p_light"], "p_eco": r["_p_eco"]})

    # ---------------------------------------------------------------
    # 3. branch distribution (rates + cluster-bootstrap CI, B=1000)
    # ---------------------------------------------------------------
    dist_rows = []
    for side in ("all", "t", "ct"):
        rr = groups[side] if side != "all" else all_copies
        for br in ("FORCE", "LIGHT", "ECO"):
            sub = [r for r in rr if r["_branch"] == br]
            ci = cluster_ci(rr, side, lambda r: r["_branch"] == br, B=B) if len(sub) > 0 else (0, 0)
            dist_rows.append({
                "side": side, "branch": br, "n": len(sub),
                "rate": round(len(sub) / len(rr), 4),
                "ci95_low": round(ci[0], 4), "ci95_high": round(ci[1], 4),
            })
    # threshold sensitivity rows
    for side in ("t", "ct"):
        rr = groups[side]
        for delta in (-0.05, 0.05):
            key = f"_branch_d{delta:+.2f}"
            for br in ("FORCE", "ECO"):
                n = sum(1 for r in rr if r[key] == br)
                dist_rows.append({
                    "side": side, "branch": f"{br} (threshold{delta:+.2f})",
                    "n": n, "rate": round(n / len(rr), 4),
                    "ci95_low": "", "ci95_high": "",
                })
    with open(os.path.join(ppc.PP_DIR, "post-pistol-branch-distribution.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(dist_rows[0].keys()))
        w.writeheader()
        w.writerows(dist_rows)

    # ---------------------------------------------------------------
    # 4. two-branch coverage at posterior thresholds
    # ---------------------------------------------------------------
    cov_rows = []
    for side in ("all", "t", "ct"):
        rr = groups[side] if side != "all" else all_copies
        for tau in (0.7, 0.8, 0.9):
            n_hi_force = sum(1 for r in rr if r["_branch"] == "FORCE" and r["_p_force"] >= tau)
            n_hi_eco = sum(1 for r in rr if r["_branch"] == "ECO" and r["_p_eco"] >= tau)
            n_light = sum(1 for r in rr if r["_branch"] == "LIGHT")
            n_amb = len(rr) - n_hi_force - n_hi_eco - n_light
            cov_rows.append({
                "side": side, "posterior_threshold": tau,
                "n": len(rr),
                "high_confidence_FORCE": n_hi_force,
                "high_confidence_ECO": n_hi_eco,
                "two_branch_coverage": round((n_hi_force + n_hi_eco) / len(rr), 4),
                "LIGHT": n_light,
                "ambiguous": n_amb,
                "residual": round((n_light + n_amb) / len(rr), 4),
            })
    with open(os.path.join(ppc.PP_DIR, "post-pistol-two-branch-coverage.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(cov_rows[0].keys()))
        w.writeheader()
        w.writerows(cov_rows)

    # ---------------------------------------------------------------
    # 5. plots
    # ---------------------------------------------------------------
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.stats import gaussian_kde

    fig, axes = plt.subplots(1, 3, figsize=(15, 4.2), sharey=True)
    for ax, side in zip(axes, ("all", "t", "ct")):
        x = np.array([r["team_spend_ratio"] for r in groups[side]])
        ax.hist(x, bins=np.arange(0, 1.01, 0.05), density=True, alpha=0.45,
                color="#4c72b0", label=f"n={len(x)}")
        try:
            kde = gaussian_kde(x, bw_method=0.05)
            xs = np.linspace(-0.02, 1.02, 400)
            ax.plot(xs, kde(xs), color="#c44e52", lw=1.8, label="KDE")
        except Exception:
            pass
        # component curves
        gmm, means, sds, wts, _ = fits[(side, 3)]
        xs = np.linspace(-0.05, 1.05, 400)
        from scipy.stats import norm
        for m, s, w in zip(means, sds, wts):
            ax.plot(xs, w * norm.pdf(xs, m, s), "--", color="#55a868",
                    alpha=0.8, lw=1.2)
        thr = next(t for t in threshold_rows if t["side"] == side)
        for col, val in (("ECO|LIGHT", thr["threshold_eco_light"]),
                         ("LIGHT|FORCE", thr["threshold_light_force"])):
            if val != "":
                ax.axvline(float(val), color="black", ls=":", lw=1.2)
                ax.text(float(val), ax.get_ylim()[1] * 0.97, col, rotation=90,
                        ha="right", va="top", fontsize=7)
        ax.set_title(f"{side.upper()} (n={len(x)})")
        ax.set_xlabel("team spend ratio")
        ax.set_xlim(-0.02, 1.02)
        ax.legend(fontsize=8)
    axes[0].set_ylabel("density")
    fig.suptitle("Post-pistol losing team: spend ratio distribution (GMM-3 components)")
    fig.tight_layout()
    fig.savefig(os.path.join(ppc.PLOT_DIR, "01-spend-ratio-distribution.png"), dpi=150)
    plt.close(fig)

    # T vs CT branch distribution
    fig, ax = plt.subplots(figsize=(6.5, 4.2))
    sides = ("t", "ct")
    branches = ("ECO", "LIGHT", "FORCE")
    colors = {"ECO": "#dd8452", "LIGHT": "#8172b3", "FORCE": "#4c72b0"}
    xpos = np.arange(len(sides))
    bottom = np.zeros(len(sides))
    for br in branches:
        vals = []
        for side in sides:
            rr = groups[side]
            vals.append(sum(1 for r in rr if r["_branch"] == br) / len(rr))
        ax.bar(xpos, vals, bottom=bottom, color=colors[br], label=br, width=0.5)
        bottom += np.array(vals)
    for i, side in enumerate(sides):
        rr = groups[side]
        ax.text(i, 1.02, f"n={len(rr)}", ha="center")
    ax.set_xticks(xpos)
    ax.set_xticklabels([s.upper() for s in sides])
    ax.set_ylim(0, 1.1)
    ax.set_ylabel("share of post-pistol decisions")
    ax.legend()
    ax.set_title("Post-pistol branch distribution: T vs CT")
    fig.tight_layout()
    fig.savefig(os.path.join(ppc.PLOT_DIR, "02-t-vs-ct-branch.png"), dpi=150)
    plt.close(fig)

    # ---------------------------------------------------------------
    # console summary
    # ---------------------------------------------------------------
    print(json.dumps({
        "n": {s: len(groups[s]) for s in groups},
        "mixture_bic": {f"{s}-{k}": fits[(s, k)][0].bic(
            np.array([r["team_spend_ratio"] for r in groups[s]]).reshape(-1, 1))
            for s in ("all", "t", "ct") for k in (1, 2, 3)},
        "thresholds": [{k: v for k, v in t.items() if k in (
            "side", "branches", "threshold_eco_light", "threshold_light_force",
            "light_component_weight")} for t in threshold_rows],
        "branch_rates": [r for r in dist_rows if r["ci95_low"] != ""],
    }, indent=2, default=float))


if __name__ == "__main__":
    main()
