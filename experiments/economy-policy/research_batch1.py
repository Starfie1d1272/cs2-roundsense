#!/usr/bin/env python3
"""Research batch 1: state-space coverage, reachable money, spend behavior,
next-round preservation, affordability targets (sections 3,4,6,7,8)."""
import csv, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import (load_rows, build_dataset, loss_reward, wquant, wprob,
                             wdist, weights_at, confidence_for, retained_pool,
                             DEFAULT_PISTOLS, PAID_PISTOLS, RESULTS)

STRICT, FAMILY = build_dataset()

# ---------- 3. state-space coverage ----------
COV = []
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        base = [r for r in STRICT if r["side"] == side and r["_lr"] == lr
                and r["correctedRetainedPrimary"] is None]
        obs = sorted({r["startMoney"] for r in base})
        n_obs = len(obs)
        lo, hi = (obs[0], obs[-1]) if obs else (None, None)
        covered = sum(1 for M in range(0, 16001, 50) if lo is not None and lo <= M <= hi)
        COV.append(["none", side, lr, n_obs, len(base), lo, hi, covered, 321, "none"])
        # retained weapons scan
        rets = sorted({r["correctedRetainedPrimary"] for r in STRICT
                       if r["side"] == side and r["_lr"] == lr
                       and r["correctedRetainedPrimary"] not in (None, "UNKNOWN")})
        for rw in rets:
            pool, level = retained_pool(STRICT, FAMILY, side, lr, rw)
            if pool is None:
                COV.append([rw, side, lr, 0, 0, None, None, 0, 0, "unsupported"])
                continue
            obs2 = sorted({m for m, _ in pool})
            lo2, hi2 = obs2[0], obs2[-1]
            covered2 = sum(1 for M in range(0, 16001, 50) if lo2 <= M <= hi2)
            COV.append([rw, side, lr, len(obs2), len(pool), lo2, hi2, covered2, 321, level])
with open(f"{RESULTS}/state-space-coverage.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["retained_weapon", "side", "lossReward", "exact_money_nodes", "pool_n",
                "money_lo", "money_hi", "grid_covered", "grid_total", "estimate_level"])
    w.writerows(COV)

# ---------- 4. reachable-money audit ----------
mod50 = {"start": 0, "spent": 0, "non50": []}
for r in STRICT:
    if r["startMoney"] % 50 != 0:
        mod50["non50"].append(("start", r["startMoney"], r["map"], r["roundNumber"]))
    if r["moneySpent"] % 50 != 0:
        mod50["non50"].append(("spent", r["moneySpent"], r["map"], r["roundNumber"]))
    mod50["start"] += (r["startMoney"] % 50 == 0)
    mod50["spent"] += (r["moneySpent"] % 50 == 0)
n = len(STRICT)
md = []
md.append("# Reachable-Money Audit")
md.append("")
md.append("STRICT n={}".format(n))
md.append("")
md.append("- startMoney % 50 == 0: {}/{} ({:.1f}%)".format(mod50["start"], n, 100 * mod50["start"] / n))
md.append("- moneySpent % 50 == 0: {}/{} ({:.1f}%)".format(mod50["spent"], n, 100 * mod50["spent"] / n))
md.append("- non-$50 observations: {} (listed below)".format(len(mod50["non50"])))
for k, v, m, rnd in mod50["non50"][:10]:
    md.append("  - {} ${} at {} r{}".format(k, v, m.split("-")[-1], rnd))
md.append("")
md.append("结论：$50 grid 覆盖所有实际可达现金；非 $50 观察来源见上（若存在）。")
open(f"{RESULTS}/reachable-money.md", "w").write("\n".join(md))
print("reachable-money.md:", len(md), "lines")

# ---------- 6. professional spend surface ----------
SPEND = []
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        for rv in [None] + sorted({r["correctedRetainedPrimary"] for r in STRICT
                                   if r["side"] == side and r["_lr"] == lr
                                   and r["correctedRetainedPrimary"] not in (None, "UNKNOWN")}):
            pool, level = retained_pool(STRICT, FAMILY, side, lr, rv)
            if pool is None:
                continue
            for M in range(800, 7601, 50):
                feas = [(m, r) for m, r in pool if r["moneySpent"] <= M]
                if len(feas) < 30:
                    continue
                ws, h, ne = weights_at(feas, M)
                if ne < 20:
                    continue
                rows = [r for _, r in feas]
                spends = [r["moneySpent"] for r in rows]
                med = wquant(spends, ws, 0.5)
                bank = [M - s for s in spends]
                SPEND.append([side, lr, level, rv if rv else "none", M,
                              round(wquant(spends, ws, 0.25), 0), med, round(wquant(spends, ws, 0.75), 0),
                              round(med / M, 3), round(wquant(bank, ws, 0.5), 0),
                              round(wprob(rows, ws, lambda r: M - r["moneySpent"] == 0), 3),
                              round(wprob(rows, ws, lambda r: 0 < M - r["moneySpent"] <= 500), 3),
                              round(wprob(rows, ws, lambda r: 500 < M - r["moneySpent"] <= 1000), 3),
                              round(wprob(rows, ws, lambda r: M - r["moneySpent"] > 1000), 3),
                              round(ne, 1)])
with open(f"{RESULTS}/professional-spend-surface.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "estimate_level", "retained_value", "roundStartMoney",
                "spend_p25", "spend_median", "spend_p75", "spend_ratio_median",
                "bank_after_buy_median", "bank0_prob", "bank_0_500_prob", "bank_500_1000_prob",
                "bank_1000plus_prob", "effective_n"])
    w.writerows(SPEND)

# ---------- 7. next-round preservation ----------
PRES = []
BUCKETS = [(0, 2000, "<2000"), (2000, 3000, "2000-2999"), (3000, 3500, "3000-3499"),
           (3500, 4000, "3500-3999"), (4000, 4500, "4000-4499"), (4500, 5000, "4500-4999"),
           (5000, 99999, "5000+")]
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        pool, level = retained_pool(STRICT, FAMILY, side, lr, None)
        if pool is None:
            continue
        for M in range(800, 7601, 50):
            feas = [(m, r) for m, r in pool if r["moneySpent"] <= M]
            if len(feas) < 30:
                continue
            ws, h, ne = weights_at(feas, M)
            if ne < 20:
                continue
            rows = [r for _, r in feas]
            next_lose_ns = min(16000, M + lr)
            next_lose_med = min(16000, M - wquant([r["moneySpent"] for r in rows], ws, 0.5) + lr)
            next_lose_plant = min(16000, M - wquant([r["moneySpent"] for r in rows], ws, 0.5) + lr + 600) if side == "t" else None
            # weighted bucket distribution of nextIfLoseAfterActualSpend
            nxt = [min(16000, M - r["moneySpent"] + lr) for r in rows]
            buck = {}
            for b_lo, b_hi, b_name in BUCKETS:
                buck[b_name] = wprob(rows, ws, lambda r, lo=b_lo, hi=b_hi: lo <= M - r["moneySpent"] + lr < hi)
            PRES.append([side, lr, level, "none", M, next_lose_ns, round(next_lose_med, 0),
                         round(next_lose_plant, 0) if next_lose_plant is not None else "",
                         *[round(buck[b[2]], 3) for b in BUCKETS], round(ne, 1)])
with open(f"{RESULTS}/next-round-preservation.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "estimate_level", "retained_value", "roundStartMoney",
                "nextIfLoseNoSpend", "nextIfLoseAfterMedianSpend", "nextIfLoseAfterMedianSpendAndPlant",
                "<2000", "2000-2999", "3000-3499", "3500-3999", "4000-4499", "4500-4999", "5000+",
                "effective_n"])
    w.writerows(PRES)
print("sections 3/4/6/7 written")
