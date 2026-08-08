#!/usr/bin/env python3
"""pp6 — role / player-style analysis (firepower vs utility axis).

PLAYER_STYLE_STRICT rows with role join. Economic state is conditioned /
controlled: side, lossReward, roundStartMoney band, retained family,
team strategy branch, post-pistol flag.

Outputs:
  role-style-summary.csv    (per role group x condition: primary class rates,
                             armor/helmet/kit, grenade counts, utility value,
                             moneySpent)
  role-style-axis.csv       (weapon_share / utility_share per role, within
                             matched conditions, with cluster-bootstrap CI)
  plots/07-role-firepower-vs-utility.png
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


def load_strict():
    rows = list(csv.DictReader(open(os.path.join(ppc.PP_DIR, "player-style-strict.csv"))))
    for r in rows:
        r["startMoney"] = float(r["startMoney"])
        r["moneySpent"] = float(r["moneySpent"])
        r["equipmentValue"] = float(r["equipmentValue"])
        r["roundNumber"] = int(r["roundNumber"])
        r["_lr"] = int(r["_lr"])
        r["grenades"] = json.loads(r["grenades"])
        r["retainedGrenades"] = json.loads(r["retainedGrenades"])
    return rows


def load_prices():
    return ppc.rc.load_prices()


def prices_of(PRICES):
    """canonical price lookup: weaponPrices keyed by weapon id; chain
    displayNameToItem -> itemToWeapon -> weaponPrices (frozen canonical)."""
    wp = PRICES["weaponPrices"]
    itw = PRICES["itemToWeapon"]
    disp = PRICES["itemToDisplay"]
    rev = {v: k for k, v in disp.items()}  # display -> item id
    def price(display):
        if not display:
            return 0
        it = rev.get(display)
        wid = itw.get(it)
        return int(wp.get(wid, 0)) if wid else 0
    return price


GRENADE_PRICES = {"smoke": 300, "flashbang": 200, "hegrenade": 300,
                  "molotov": 400, "incendiary": 600}


def grenade_value(grenades):
    return sum(GRENADE_PRICES.get(g, 0) for g in grenades)


def team_branch_of(r, thresholds):
    """Branch for the player's team-round from team spend ratio (side-specific
    thresholds from pp2)."""
    ratio = r["_team_spent"] / r["_team_start"] if r["_team_start"] else 0
    thr = thresholds[r["side"]]
    if ratio > thr["force"]:
        return "FORCE"
    if thr.get("eco") is not None and ratio < thr["eco"]:
        return "ECO"
    return "LIGHT"


def cluster_diff_ci(rows_a, rows_b, keyfn, B=B, seed=SEED):
    """Cluster-bootstrap 95% CI for mean(keyfn(a)) - mean(keyfn(b)) over the
    union of match series (both samples share the same event)."""
    def series_of(r):
        return ppc.series_of_map(r["map"])
    uniq = sorted({series_of(r) for r in rows_a + rows_b})
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(B):
        picked = rng.choice(len(uniq), size=len(uniq), replace=True)
        ia = []
        ib = []
        for u in picked:
            ia += [i for i, r in enumerate(rows_a) if series_of(r) == uniq[u]]
            ib += [i for i, r in enumerate(rows_b) if series_of(r) == uniq[u]]
        if not ia or not ib:
            continue
        va = np.mean([keyfn(rows_a[i]) for i in ia])
        vb = np.mean([keyfn(rows_b[i]) for i in ib])
        boots.append(va - vb)
    boots = np.array(boots)
    return np.percentile(boots, [2.5, 97.5])


def main():
    strict = load_strict()
    PRICES = load_prices()
    price = prices_of(PRICES)
    FAMILY = ppc.rc.load_weapon_families()

    # thresholds for team branch (all regulation team-rounds)
    thresholds = {}
    with open(os.path.join(ppc.PP_DIR, "branch-thresholds.csv")) as f:
        for r in csv.DictReader(f):
            if r["side"] in ("t", "ct"):
                thresholds[r["side"]] = {
                    "eco": float(r["threshold_eco_light"]) if r["threshold_eco_light"] else None,
                    "force": float(r["threshold_light_force"]),
                }

    # team-round aggregates for every regulation round (for branch + controls)
    raw_rows = ppc.rc.load_rows()
    tr = ppc.build_team_rounds(raw_rows)
    team_agg = {}
    for (m, rn, tk), t in tr.items():
        team_agg[(m, rn, tk)] = t
    for r in strict:
        agg = team_agg.get((r["map"], r["roundNumber"], r["teamKey"]))
        if agg is None:
            r["_team_start"] = 0
            r["_team_spent"] = 0
            r["_branch"] = ""
        else:
            r["_team_start"] = agg["team_start_money"]
            r["_team_spent"] = agg["team_money_spent"]
            r["_branch"] = team_branch_of(r, thresholds) if agg["team_start_money"] > 0 else ""
        r["_post_pistol"] = r["roundNumber"] in (2, 14)
        r["_retained_family"] = FAMILY.get(r["correctedRetainedPrimary"] or "", "none") \
            if r["correctedRetainedPrimary"] not in (None, "", "UNKNOWN") else "none"
        r["_primary_price"] = price(r["primary"])
        r["_utility_value"] = grenade_value(r["grenades"])
        r["_grenade_count"] = len(r["grenades"])
        r["_smoke"] = r["grenades"].count("smoke")
        r["_flash"] = r["grenades"].count("flashbang")
        r["_he"] = r["grenades"].count("hegrenade")
        r["_fire"] = r["grenades"].count("molotov") + r["grenades"].count("incendiary")

    # condition definition: (side, money band, retained family, post-pistol)
    def money_band(m):
        if m < 2000:
            return "m<2000"
        if m < 3000:
            return "m2000-3000"
        if m < 4500:
            return "m3000-4500"
        return "m>=4500"

    for r in strict:
        r["_cond"] = (r["side"], money_band(r["startMoney"]), r["_retained_family"],
                      r["_post_pistol"])

    # ---------------------------------------------------------------
    # 1. role-style-summary.csv
    # ---------------------------------------------------------------
    role_groups = {
        "allstar_IGL": ("all_star_role", ["IGL"]),
        "allstar_AWPer": ("all_star_role", ["AWPer"]),
        "allstar_Opener": ("all_star_role", ["Opener"]),
        "allstar_Closer": ("all_star_role", ["Closer"]),
        "allstar_AnchorSupport": ("all_star_role", ["Anchor/Support"]),
        "ct_Anchor": ("ct_role", ["Anchor"]),
        "ct_Rotator": ("ct_role", ["Rotator"]),
        "ct_Mixed": ("ct_role", ["Mixed"]),
        "t_Pack": ("t_role", ["Pack"]),
        "t_Lurker": ("t_role", ["Lurker"]),
        "t_Flex": ("t_role", ["Flex"]),
    }
    out = []
    for gname, (field, vals) in role_groups.items():
        sub = [r for r in strict if r[field] in vals]
        if not sub:
            continue
        n = len(sub)
        prim_fam = defaultdict(int)
        for r in sub:
            prim_fam[FAMILY.get(r["primary"] or "", "none")] += 1
        out.append({
            "role_group": gname, "field": field, "values": "+".join(vals),
            "n": n,
            "primary_rifle_rate": round(prim_fam["rifle"] / n, 4),
            "primary_sniper_rate": round(prim_fam["sniper"] / n, 4),
            "primary_smg_rate": round(prim_fam["smg"] / n, 4),
            "primary_none_rate": round((prim_fam["none"] + prim_fam["pistol"]) / n, 4),
            "primary_price_mean": round(np.mean([r["_primary_price"] for r in sub]), 1),
            "armor_rate": round(np.mean([1 if r["hasArmor"] else 0 for r in sub]), 4),
            "helmet_rate": round(np.mean([1 if r["hasHelmet"] else 0 for r in sub]), 4),
            "kit_rate": round(np.mean([1 if r["hasDefuseKit"] else 0 for r in sub]), 4),
            "smoke_mean": round(np.mean([r["_smoke"] for r in sub]), 3),
            "flash_mean": round(np.mean([r["_flash"] for r in sub]), 3),
            "he_mean": round(np.mean([r["_he"] for r in sub]), 3),
            "fire_mean": round(np.mean([r["_fire"] for r in sub]), 3),
            "grenade_count_mean": round(np.mean([r["_grenade_count"] for r in sub]), 3),
            "utility_value_mean": round(np.mean([r["_utility_value"] for r in sub]), 1),
            "equipment_value_mean": round(np.mean([r["equipmentValue"] for r in sub]), 1),
            "moneySpent_mean": round(np.mean([r["moneySpent"] for r in sub]), 1),
        })
    with open(os.path.join(ppc.PP_DIR, "role-style-summary.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)

    # ---------------------------------------------------------------
    # 2. firepower vs utility axis (within-condition comparison)
    #    weapon_share = primary canonical price / moneySpent (spend>0)
    #    utility_share = grenade value / moneySpent
    # ---------------------------------------------------------------
    cond_counts = defaultdict(int)
    for r in strict:
        cond_counts[r["_cond"]] += 1
    # conditions used for within-condition matching: keep conds with >=30 rows
    usable = {c for c, n in cond_counts.items() if n >= 30}

    def axis_stats(sub):
        rows = [r for r in sub if r["moneySpent"] > 0 and r["_primary_price"] > 0]
        if not rows:
            return None
        ws = np.array([r["_primary_price"] / r["moneySpent"] for r in rows])
        us = np.array([r["_utility_value"] / r["moneySpent"] for r in rows])
        return rows, ws, us

    # compare role A vs role B within shared conditions; aggregate as weighted
    # mean of per-condition differences (weights = min counts in condition)
    def role_pair_diff(field, vals_a, vals_b):
        rows_a = [r for r in strict if r[field] in vals_a]
        rows_b = [r for r in strict if r[field] in vals_b]
        diff_w = []
        diff_u = []
        wt = []
        counts_a = defaultdict(list)
        counts_b = defaultdict(list)
        for r in rows_a:
            counts_a[r["_cond"]].append(r)
        for r in rows_b:
            counts_b[r["_cond"]].append(r)
        for c in usable:
            if c not in counts_a or c not in counts_b:
                continue
            sa = axis_stats(counts_a[c])
            sb = axis_stats(counts_b[c])
            if sa is None or sb is None:
                continue
            w = min(len(sa[0]), len(sb[0]))
            diff_w.append(sa[1].mean() - sb[1].mean())
            diff_u.append(sa[2].mean() - sb[2].mean())
            wt.append(w)
        if not wt:
            return None
        wt = np.array(wt, dtype=float)
        return (float(np.average(diff_w, weights=wt)),
                float(np.average(diff_u, weights=wt)), len(wt))

    pairs = [
        ("all_star_role", ["IGL"], ["Opener"], "IGL vs Opener"),
        ("all_star_role", ["Anchor/Support"], ["Opener"], "Anchor/Support vs Opener"),
        ("all_star_role", ["Closer"], ["Opener"], "Closer vs Opener"),
        ("all_star_role", ["AWPer"], ["Opener"], "AWPer vs Opener"),
        ("t_role", ["Pack"], ["Lurker"], "T Pack vs Lurker"),
        ("t_role", ["Pack"], ["Flex"], "T Pack vs Flex"),
        ("t_role", ["Lurker"], ["Flex"], "T Lurker vs Flex"),
        ("ct_role", ["Anchor"], ["Rotator"], "CT Anchor vs Rotator"),
        ("ct_role", ["Anchor"], ["Mixed"], "CT Anchor vs Mixed"),
        ("ct_role", ["Rotator"], ["Mixed"], "CT Rotator vs Mixed"),
    ]
    axis_rows = []
    for field, va, vb, label in pairs:
        res = role_pair_diff(field, va, vb)
        if res is None:
            continue
        dw, du, ncond = res
        axis_rows.append({
            "comparison": label,
            "n_shared_conditions": ncond,
            "weapon_share_diff_A_minus_B": round(dw, 4),
            "utility_share_diff_A_minus_B": round(du, 4),
        })
    with open(os.path.join(ppc.PP_DIR, "role-style-axis.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(axis_rows[0].keys()))
        w.writeheader()
        w.writerows(axis_rows)

    # ---------------------------------------------------------------
    # plot 07: utility vs firepower by role group (unadjusted overview +
    # condition-mean markers)
    # ---------------------------------------------------------------
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(1, 3, figsize=(15, 4.5), sharex=True)
    for ax, (field, title) in zip(axes, (
            ("all_star_role", "All-Star role"),
            ("ct_role", "CT role"),
            ("t_role", "T role"))):
        groups = sorted({r[field] for r in strict if r[field]})
        for g in groups:
            sub = [r for r in strict if r[field] == g]
            rows = [r for r in sub if r["moneySpent"] > 0 and r["_primary_price"] > 0]
            if len(rows) < 30:
                continue
            ws = np.array([r["_primary_price"] / r["moneySpent"] for r in rows])
            us = np.array([r["_utility_value"] / r["moneySpent"] for r in rows])
            ax.scatter(ws.mean(), us.mean(), s=90, alpha=0.85, label=f"{g} (n={len(rows)})")
            ax.annotate(g, (ws.mean(), us.mean()), fontsize=7,
                        xytext=(3, 3), textcoords="offset points")
        ax.axhline(0, color="gray", lw=0.8)
        ax.axvline(0, color="gray", lw=0.8)
        ax.set_xlabel("weapon share (primary price / spent)")
        ax.set_ylabel("utility share (grenade value / spent)")
        ax.set_title(title)
    fig.suptitle("Role firepower-vs-utility axis (spend>0 & primary>0 strict rows)")
    fig.tight_layout()
    fig.savefig(os.path.join(ppc.PLOT_DIR, "07-role-firepower-vs-utility.png"), dpi=150)
    plt.close(fig)

    print(json.dumps({
        "strict_rows": len(strict),
        "roles": [r["role_group"] for r in out],
        "axis_comparisons": axis_rows,
    }, indent=2))


if __name__ == "__main__":
    main()
