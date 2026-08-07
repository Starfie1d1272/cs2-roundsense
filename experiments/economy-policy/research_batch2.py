#!/usr/bin/env python3
"""Research batch 2: exact weapons, secondary, armor/helmet, kit, utility,
retained behavior, delta-loadout, marginal priority (sections 9-16)."""
import csv, json, os, sys
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import (build_dataset, wprob, wdist, weights_at, retained_pool,
                             DEFAULT_PISTOLS, PAID_PISTOLS, RESULTS)

STRICT, FAMILY = build_dataset()
GRID = list(range(800, 7601, 50))

def none_pool(side, lr):
    return [(r["startMoney"], r) for r in STRICT if r["side"] == side
            and r["_lr"] == lr and r["correctedRetainedPrimary"] is None]

# ---------- 9. weapon choice surface (primary, per state) ----------
WCS = []
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        pool = none_pool(side, lr)
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
            pd = wdist(rows, ws, lambda r: r["primary"] or "none")
            for w, p in pd.items():
                WCS.append([side, lr, "none", M, w, round(p, 4), round(ne, 1)])
# retained weapon choice (exact retained, key weapons)
for side in ["t", "ct"]:
    for lr in [1900, 2400]:
        for rv in ["AK-47", "M4A4", "M4A1-S", "AWP", "MP9", "MAC-10"]:
            pool, level = retained_pool(STRICT, FAMILY, side, lr, rv)
            if pool is None:
                continue
            for M in [1500, 2500, 3000, 3500, 4000]:
                feas = [(m, r) for m, r in pool if r["moneySpent"] <= M]
                if len(feas) < 30:
                    continue
                ws, h, ne = weights_at(feas, M)
                if ne < 20:
                    continue
                rows = [r for _, r in feas]
                pd = wdist(rows, ws, lambda r: r["primary"] or "none")
                for w, p in pd.items():
                    WCS.append([side, lr, level, M, w, round(p, 4), round(ne, 1)])
with open(f"{RESULTS}/weapon-choice-surface.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "retained_value", "roundStartMoney", "weapon",
                "weighted_probability", "effective_n"])
    w.writerows(WCS)

# ---------- 10. secondary choice surface ----------
SCS = []
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        pool = none_pool(side, lr)
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
            sd = wdist(rows, ws, lambda r: r["secondary"] or "none")
            for w, p in sd.items():
                SCS.append([side, lr, "none", M, w, round(p, 4), round(ne, 1)])
with open(f"{RESULTS}/secondary-choice-surface.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "retained_value", "roundStartMoney", "weapon",
                "weighted_probability", "effective_n"])
    w.writerows(SCS)

# ---------- 11/12/13. armor-helmet / kit / utility surfaces ----------
AHU = []
UTIL_COMBO = Counter()
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        pool = none_pool(side, lr)
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
            AHU.append([side, lr, "none", M,
                        round(wprob(rows, ws, lambda r: bool(r["hasArmor"])), 3),
                        round(wprob(rows, ws, lambda r: bool(r["hasHelmet"])), 3),
                        round(wprob(rows, ws, lambda r: bool(r["hasHelmet"]) and bool(r["hasArmor"])), 3),
                        round(wprob(rows, ws, lambda r: bool(r["hasDefuseKit"])), 3),
                        round(wprob(rows, ws, lambda r: "smoke" in r["grenades"]), 3),
                        round(wprob(rows, ws, lambda r: r["grenades"].count("flashbang") >= 1), 3),
                        round(wprob(rows, ws, lambda r: r["grenades"].count("flashbang") >= 2), 3),
                        round(wprob(rows, ws, lambda r: "hegrenade" in r["grenades"]), 3),
                        round(wprob(rows, ws, lambda r: ("molotov" in r["grenades"]) or ("incendiary" in r["grenades"])), 3),
                        round(sum(w * len(r["grenades"]) for w, r in zip(ws, rows)) / sum(ws), 2),
                        round(ne, 1)])
            for r, w in zip(rows, ws):
                g = r["grenades"]
                combo = tuple(sorted(set(g)))
                UTIL_COMBO[combo] += w
with open(f"{RESULTS}/armor-kit-utility-surface.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "retained_value", "roundStartMoney",
                "armor_prob", "helmet_prob", "helmet_given_armor_prob", "defusekit_prob",
                "smoke_prob", "flash1plus_prob", "flash2_prob", "HE_prob", "fire_prob",
                "grenade_count_mean", "effective_n"])
    w.writerows(AHU)
tot_u = sum(UTIL_COMBO.values())
with open(f"{RESULTS}/utility-combinations.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["combination", "weighted_count", "rate"])
    for combo, c in UTIL_COMBO.most_common(30):
        w.writerow(["+".join(combo) if combo else "none", round(c, 1), round(c / tot_u, 4)])

# ---------- 14. marginal priority ----------
MP = []
for side in ["t", "ct"]:
    for lr in [1900, 2400]:
        pool = none_pool(side, lr)
        if len(pool) < 30:
            continue
        for M in [2000, 2500, 3000, 3500]:
            items = {}
            for delta in [0, 50, 100, 300]:
                MM = M + delta
                feas = [(m, r) for m, r in pool if r["moneySpent"] <= MM]
                if len(feas) < 30:
                    continue
                ws, h, ne = weights_at(feas, MM)
                if ne < 20:
                    continue
                rows = [r for _, r in feas]
                items[delta] = {
                    "primary_rifle": wprob(rows, ws, lambda r: (r["primary"] or "none") in FAMILY and FAMILY[r["primary"]] == "rifle"),
                    "helmet": wprob(rows, ws, lambda r: bool(r["hasHelmet"])),
                    "kit": wprob(rows, ws, lambda r: bool(r["hasDefuseKit"])),
                    "smoke": wprob(rows, ws, lambda r: "smoke" in r["grenades"]),
                    "flash1": wprob(rows, ws, lambda r: r["grenades"].count("flashbang") >= 1),
                    "flash2": wprob(rows, ws, lambda r: r["grenades"].count("flashbang") >= 2),
                    "HE": wprob(rows, ws, lambda r: "hegrenade" in r["grenades"]),
                    "fire": wprob(rows, ws, lambda r: ("molotov" in r["grenades"]) or ("incendiary" in r["grenades"])),
                    "paid_pistol": wprob(rows, ws, lambda r: r["secondary"] in PAID_PISTOLS),
                }
            for item in ["primary_rifle", "helmet", "kit", "smoke", "flash1", "flash2", "HE", "fire", "paid_pistol"]:
                MP.append([side, lr, "none", M, item,
                           round(items[0][item], 3),
                           round(items[50][item] - items[0][item], 3),
                           round(items[100][item] - items[0][item], 3),
                           round(items[300][item] - items[0][item], 3)])
with open(f"{RESULTS}/marginal-priority.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "retained_value", "roundStartMoney", "item",
                "p_at_M", "delta_50", "delta_100", "delta_300"])
    w.writerows(MP)

# ---------- 15. retained behavior ----------
RB = []
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        for rv in sorted({r["correctedRetainedPrimary"] for r in STRICT
                          if r["side"] == side and r["_lr"] == lr
                          and r["correctedRetainedPrimary"] not in (None, "UNKNOWN")}):
            pool, level = retained_pool(STRICT, FAMILY, side, lr, rv)
            if pool is None:
                continue
            rows = [r for _, r in pool]
            stays = wprob(rows, [1.0] * len(rows), lambda r: r["primary"] == rv)
            no_prim = wprob(rows, [1.0] * len(rows), lambda r: r["primary"] is None)
            upgr = 1 - stays - no_prim
            RB.append([side, lr, rv, level, len(rows),
                       round(stays, 3), round(no_prim, 3), round(upgr, 3),
                       round(wprob(rows, [1.0] * len(rows), lambda r: bool(r["hasArmor"])), 3),
                       round(wprob(rows, [1.0] * len(rows), lambda r: bool(r["hasHelmet"])), 3),
                       round(wprob(rows, [1.0] * len(rows), lambda r: bool(r["hasDefuseKit"])), 3),
                       round(wprob(rows, [1.0] * len(rows), lambda r: "smoke" in r["grenades"]), 3),
                       round(sum(len(r["grenades"]) for r in rows) / len(rows), 2)])
with open(f"{RESULTS}/retained-behavior.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "retained_weapon", "estimate_level", "n",
                "stays_same_primary", "no_primary", "upgraded_replaced",
                "armor_prob", "helmet_prob", "kit_prob", "smoke_prob", "grenade_count_mean"])
    w.writerows(RB)

# ---------- 16. delta-loadout coverage ----------
# schema check: which start/retained fields exist for delta reconstruction
sample = STRICT[0]
fields = sorted(sample.keys())
start_fields = [f for f in fields if "retained" in f or f == "survivedPrev"]
delta_md = ["# Loadout-Delta Coverage", "",
            "## Schema check (STRICT sample row)", ""]
for f in start_fields:
    delta_md.append("- {}: {}".format(f, type(sample.get(f)).__name__))
delta_md.append("")
delta_md.append("可重建的 delta：retained（上一回合 freeze loadout）→ resulting（本回合 freeze loadout）的 exact 差异。")
delta_md.append("不可重建：retained armor 无数值（boolean retainedArmor 存在）、无购买顺序、无回合中 drop。")
open(f"{RESULTS}/loadout-delta-coverage.md", "w").write("\n".join(delta_md))

# delta-loadout rows: retained primary -> resulting primary change patterns
DELTA = Counter()
for r in STRICT:
    if r["correctedRetainedPrimary"] in (None, "UNKNOWN"):
        continue
    DELTA[(r["correctedRetainedPrimary"], r["primary"] or "none")] += 1
with open(f"{RESULTS}/loadout-delta.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["retained_primary", "resulting_primary", "n", "rate_of_retained"])
    tot_r = Counter(r["correctedRetainedPrimary"] for r in STRICT
                    if r["correctedRetainedPrimary"] not in (None, "UNKNOWN"))
    for (ret, res), n in DELTA.most_common(40):
        w.writerow([ret, res, n, round(n / tot_r[ret], 4)])
print("batch2 done: weapon/secondary/armor-kit-utility/marginal/retained/delta written")
