#!/usr/bin/env python3
"""Cluster bootstrap (match-series, numpy) — economy + purchase quantities.

Run with DAK venv python (numpy):
    env -u PYTHONPATH ~/GitHub/cs2-demo-analysis-kit/python/.venv/bin/python research_bootstrap.py

B = 250, seed 42. Economy crossing uses NO spend filter; median spend uses
budget feasibility. Writes uncertainty.csv + uncertainty-summary.md.
"""
import csv, json, math, os, random, sys
from collections import defaultdict
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import build_dataset, wquant, RESULTS

STRICT, FAMILY = build_dataset()
random.seed(42)
B = 250

def group_of(m):
    return m.rsplit("-m", 1)[0]

def eff_n_vec(ws):
    s1 = ws.sum(axis=0)
    s2 = (ws * ws).sum(axis=0)
    return np.where(s2 > 0, s1 * s1 / s2, 0.0)

def probs_at(pool_money, pool_full, M, ne_t=100, h_max=500, h_min=20):
    """Vectorized local estimate at one M. Returns (p_full, ne, h)."""
    d2 = (pool_money - M) ** 2
    h = h_min
    while h <= h_max:
        w = np.exp(-d2 / (2 * h * h))
        ne = eff_n_vec(w)
        if ne >= ne_t:
            pf = float((w * pool_full).sum() / w.sum())
            return pf, float(ne), h
        h += 10
    w = np.exp(-d2 / (2 * h_max * h_max))
    ne = eff_n_vec(w)
    pf = float((w * pool_full).sum() / w.sum())
    return pf, float(ne), h_max

def scan_crossings(pool_money, pool_full, lo, hi, step, ne_t):
    """Linear scan for first full>=0.5 and full>=0.8. Returns (f50, f80)."""
    f50 = f80 = None
    for M in range(lo, hi + 1, step):
        pf, ne, h = probs_at(pool_money, pool_full, M, ne_t=ne_t)
        if ne < 20:
            continue
        if f50 is None and pf >= 0.5:
            f50 = M
        if f80 is None and pf >= 0.8:
            f80 = M
            return f50, f80
    return f50, f80

def bootstrap_ci(side, lr, quantity):
    pool_rows = [r for r in STRICT if r["correctedRetainedPrimary"] is None
                 and r["side"] == side and r["_lr"] == lr]
    if len(pool_rows) < 100:
        return None
    by_group = defaultdict(list)
    for r in pool_rows:
        by_group[group_of(r["map"])].append(r)
    gkeys = sorted(by_group)
    vals = []
    for _ in range(B):
        sample = []
        for _ in range(len(gkeys)):
            g = random.choice(gkeys)
            sample.extend(by_group[g])
        if quantity.startswith("median_spend"):
            M = int(quantity.split("_")[-1])
            feas = [r for r in sample if r["moneySpent"] <= M]
            if len(feas) < 30:
                continue
            money = np.array([r["startMoney"] for r in feas], dtype=float)
            spends = np.array([r["moneySpent"] for r in feas], dtype=float)
            pf, ne, h = probs_at(money, spends, M)  # weighted median via sort
            if ne < 20:
                continue
            # weighted median
            d2 = (money - M) ** 2
            w = np.exp(-d2 / (2 * h * h))
            order = np.argsort(spends)
            ws_s = w[order]
            acc = np.cumsum(ws_s) / ws_s.sum()
            med = float(spends[order][np.searchsorted(acc, 0.5)])
            vals.append(med)
            continue
        money = np.array([r["startMoney"] for r in sample], dtype=float)
        full = np.array([1.0 if r["actionType"] == "full" else 0.0 for r in sample], dtype=float)
        # coarse scan (step 200, N_eff=60) to localize, then fine (step 25, N_eff=100)
        c50, c80 = scan_crossings(money, full, 1000, 7600, 200, ne_t=60)
        if c50 is None:
            continue
        hi_fine = (c80 + 200) if c80 else min(7600, c50 + 600)
        f50, f80 = scan_crossings(money, full, max(1000, c50 - 200), hi_fine, 25, ne_t=100)
        if quantity == "full50" and f50 is not None:
            vals.append(f50)
        elif quantity == "full80" and f80 is not None:
            vals.append(f80)
    if len(vals) < 100:
        return None
    vals.sort()
    return vals[len(vals) // 20], vals[len(vals) // 2], vals[19 * len(vals) // 20], len(vals)

UNC = []
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        for q in ["full50", "full80", "median_spend_2500", "median_spend_4000"]:
            r = bootstrap_ci(side, lr, q)
            if r:
                UNC.append([side, lr, "none", q, r[0], r[1], r[2], r[3]])
            else:
                UNC.append([side, lr, "none", q, "", "", "", ""])
with open(f"{RESULTS}/uncertainty.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "retained_value", "quantity", "ci_low", "median", "ci_high", "n_boot"])
    w.writerows(UNC)
md = ["# Uncertainty Summary (match-series cluster bootstrap, B=250, seed 42, numpy)", ""]
for row in UNC:
    if row[4]:
        md.append("- {} lr{} {}: 90% CI {}–{} (median {}, n={})".format(
            row[0].upper(), row[1], row[3], row[4], row[6], row[5], row[7]))
    else:
        md.append("- {} lr{} {}: insufficient".format(row[0].upper(), row[1], row[3]))
open(f"{RESULTS}/uncertainty-summary.md", "w").write("\n".join(md))
print("bootstrap done: B={}, rows {}".format(B, len(UNC)))
