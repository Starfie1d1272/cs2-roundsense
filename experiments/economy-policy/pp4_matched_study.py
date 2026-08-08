#!/usr/bin/env python3
"""pp4 — post-pistol vs later normal-cycle matched study (lr=2400, no retained).

Compares FORCE/ECO tendency and opponent pre-decision economy between:
  A. POST_PISTOL: R2/R14 pistol losers (lossReward 2400 by construction)
  B. LATER_NORMAL: regulation rounds outside {R1,R2,R13,R14}, non-OT,
     lossIndex=2 (lossReward 2400), team has zero retained primaries.

Design:
  - transparent money-band analysis (per-player start mean bands, by side)
  - nearest-neighbor matching on (side, per-player start mean), caliper 300,
    1:1 with replacement-free greedy; sensitivity caliper 150/500
  - outcome: team spend ratio, FORCE rate, ECO rate (branch thresholds from
    pp2, side-specific; threshold sensitivity ±0.05 reported)
  - opponent pre-decision economy compared between samples

Outputs:
  matched-lr2400-context.csv        (band + matched + opponent economy tables)
  plots/05-postpistol-vs-later-lr2400.png
"""
import csv
import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post_pistol_common as ppc
from pp2_branch_mixture import cluster_ci  # reuse series-cluster bootstrap

SEED = 42


def load_all():
    with open(os.path.join(ppc.PP_DIR, "post-pistol-team-rounds.csv")) as f:
        pp = list(csv.DictReader(f))
    with open(os.path.join(ppc.PP_DIR, "post-pistol-branches.csv")) as f:
        br = {r["map"] + "|" + r["half"]: r for r in csv.DictReader(f)}
    for r in pp:
        b = br[r["map"] + "|" + r["half"]]
        r["branch"] = b["branch"]
        r["team_spend_ratio"] = float(r["team_spend_ratio"])
        r["team_start_money"] = float(r["team_start_money"])
        r["per_player_start_mean"] = float(r["per_player_start_mean"])
        r["pistol_bomb_planted"] = (r["pistol_bomb_planted"] == "True")
        r["opponent_team_start_money"] = float(r["opponent_team_start_money"])
        r["opponent_retained_primary_count"] = int(r["opponent_retained_primary_count"])
        r["opponent_retained_awp_count"] = int(r["opponent_retained_awp_count"])
        r["opponent_per_player_start_mean"] = float(r["opponent_per_player_start_mean"])
        r["opponent_survivors_pistol_end"] = int(r["opponent_survivors_pistol_end"])
    return pp


def build_later(rows):
    """Later-normal team-rounds: lr2400, no retained primary, not post-pistol
    rounds, non-OT, from the raw corpus (team-round aggregates)."""
    import research_common as rc
    raw = rc.load_rows()
    tr = ppc.build_team_rounds(raw)
    later = []
    for k, r in tr.items():
        if r["overtime"] or r["roundNumber"] in (1, 2, 13, 14):
            continue
        if r["lossIndex"] != 2:  # lossReward 2400
            continue
        if r["lossIndexAmbiguous"]:
            continue
        if r["retained_primary_count"] != 0:
            continue
        if r["team_start_money"] <= 0:
            continue
        later.append(r)
    return later


def branch_of_ratio(ratio, side, thresholds):
    thr = thresholds[side]
    if ratio > thr["force"]:
        return "FORCE"
    if thr.get("eco") is not None and ratio < thr["eco"]:
        return "ECO"
    return "LIGHT"


def main():
    pp_rows = load_all()
    thresholds = {}
    with open(os.path.join(ppc.PP_DIR, "branch-thresholds.csv")) as f:
        for r in csv.DictReader(f):
            if r["side"] in ("t", "ct"):
                thresholds[r["side"]] = {
                    "eco": float(r["threshold_eco_light"]) if r["threshold_eco_light"] else None,
                    "force": float(r["threshold_light_force"]),
                }

    later = build_later(rows=None)
    later_recs = []
    for r in later:
        side = r["side"]
        ratio = r["team_money_spent"] / r["team_start_money"]
        later_recs.append({
            "match_series": ppc.series_of_map(r["map"]),
            "map": r["map"], "roundNumber": r["roundNumber"], "side": side,
            "team": None, "branch": branch_of_ratio(ratio, side, thresholds),
            "team_spend_ratio": ratio,
            "team_start_money": r["team_start_money"],
            "per_player_start_mean": r["per_player_start_mean"],
            "opponent_team_start_money": None,  # filled below from team-rounds
            "opponent_retained_primary_count": None,
            "opponent_retained_awp_count": None,
            "opponent_per_player_start_mean": None,
            "opponent_survivors_pistol_end": None,
        })
    # opponent pre-decision economy for later rows: same-round opponent team-round
    tr_all = ppc.build_team_rounds(ppc.rc.load_rows())
    opp_map = {}
    for k, r in tr_all.items():
        if r["overtime"] or r["roundNumber"] in (1, 2, 13, 14):
            continue
        if r["lossIndex"] != 2 or r["lossIndexAmbiguous"]:
            continue
        if r["retained_primary_count"] != 0:
            continue
        opp_side = "ct" if r["side"] == "t" else "t"
        opp = next((tr_all[(m2, rn2, tk2)] for (m2, rn2, tk2), rr in tr_all.items()
                    if m2 == r["map"] and rn2 == r["roundNumber"] and rr["side"] == opp_side),
                   None)
        if opp is None:
            continue
        opp_map[(r["map"], r["roundNumber"], r["side"])] = {
            "opponent_team_start_money": opp["team_start_money"],
            "opponent_retained_primary_count": opp["retained_primary_count"],
            "opponent_retained_awp_count": opp["retained_awp_count"],
            "opponent_per_player_start_mean": opp["per_player_start_mean"],
            "opponent_survivors_pistol_end": 0,  # survivors of previous round unknown for later rows
        }
    for r in later_recs:
        o = opp_map.get((r["map"], r["roundNumber"], r["side"]))
        if o:
            r.update(o)

    pp_recs = [{
        "match_series": r["match_series"], "map": r["map"],
        "roundNumber": r["post_pistol_round"], "side": r["side"],
        "team": r["team"], "branch": r["branch"],
        "team_spend_ratio": r["team_spend_ratio"],
        "team_start_money": r["team_start_money"],
        "per_player_start_mean": r["per_player_start_mean"],
        "opponent_team_start_money": r["opponent_team_start_money"],
        "opponent_retained_primary_count": r["opponent_retained_primary_count"],
        "opponent_retained_awp_count": r["opponent_retained_awp_count"],
        "opponent_per_player_start_mean": r["opponent_per_player_start_mean"],
        "opponent_survivors_pistol_end": r["opponent_survivors_pistol_end"],
    } for r in pp_rows]

    out = []

    # ---------------------------------------------------------------
    # 1. transparent band analysis (per-player start mean, by side)
    # ---------------------------------------------------------------
    def money_band(x):
        if x < 2400:
            return "<2400"
        if x < 2700:
            return "2400-2700"
        if x < 3000:
            return "2700-3000"
        if x < 3300:
            return "3000-3300"
        if x < 3600:
            return "3300-3600"
        return ">=3600"

    for side in ("t", "ct"):
        a = [r for r in pp_recs if r["side"] == side]
        b = [r for r in later_recs if r["side"] == side]
        for band in sorted({money_band(r["per_player_start_mean"]) for r in a + b}):
            aa = [r for r in a if money_band(r["per_player_start_mean"]) == band]
            bb = [r for r in b if money_band(r["per_player_start_mean"]) == band]
            if len(aa) < 3 or len(bb) < 3:
                out.append({
                    "analysis": "band", "side": side, "band": band,
                    "sample": "POST_PISTOL", "n": len(aa), "force_rate": "",
                    "eco_rate": "", "mean_spend_ratio": "",
                    "mean_opponent_start": "", "opp_retained_primary": "",
                })
                out.append({
                    "analysis": "band", "side": side, "band": band,
                    "sample": "LATER_NORMAL", "n": len(bb), "force_rate": "",
                    "eco_rate": "", "mean_spend_ratio": "",
                    "mean_opponent_start": "", "opp_retained_primary": "",
                })
                continue
            for label, rr in (("POST_PISTOL", aa), ("LATER_NORMAL", bb)):
                ratios = np.array([r["team_spend_ratio"] for r in rr])
                out.append({
                    "analysis": "band", "side": side, "band": band,
                    "sample": label, "n": len(rr),
                    "force_rate": round(sum(r["branch"] == "FORCE" for r in rr) / len(rr), 4),
                    "eco_rate": round(sum(r["branch"] == "ECO" for r in rr) / len(rr), 4),
                    "mean_spend_ratio": round(float(ratios.mean()), 4),
                    "mean_opponent_start": round(np.mean(
                        [r["opponent_team_start_money"] for r in rr if r["opponent_team_start_money"]]), 1)
                    if any(r["opponent_team_start_money"] for r in rr) else "",
                    "opp_retained_primary": round(np.mean(
                        [r["opponent_retained_primary_count"] for r in rr
                         if r["opponent_retained_primary_count"] is not None]), 4)
                    if any(r["opponent_retained_primary_count"] is not None for r in rr) else "",
                })

    # ---------------------------------------------------------------
    # 2. nearest-neighbor matching (side, per-player start mean)
    # ---------------------------------------------------------------
    for caliper in (150, 300, 500):
        for side in ("t", "ct"):
            a = [r for r in pp_recs if r["side"] == side]
            b = [r for r in later_recs if r["side"] == side]
            rng = np.random.default_rng(SEED)
            rng.shuffle(a)
            rng.shuffle(b)
            used = set()
            pairs = []
            for ra in a:
                best = None
                best_d = caliper + 1
                for i, rb in enumerate(b):
                    if i in used:
                        continue
                    d = abs(rb["per_player_start_mean"] - ra["per_player_start_mean"])
                    if d < best_d:
                        best_d = d
                        best = i
                if best is not None and best_d <= caliper:
                    used.add(best)
                    pairs.append((ra, b[best]))
            if len(pairs) < 10:
                continue
            ar = np.array([p[0]["team_spend_ratio"] for p in pairs])
            br = np.array([p[1]["team_spend_ratio"] for p in pairs])
            out.append({
                "analysis": "matched", "side": side, "band": f"caliper{caliper}",
                "sample": "POST_PISTOL", "n": len(pairs),
                "force_rate": round(sum(p[0]["branch"] == "FORCE" for p in pairs) / len(pairs), 4),
                "eco_rate": round(sum(p[0]["branch"] == "ECO" for p in pairs) / len(pairs), 4),
                "mean_spend_ratio": round(float(ar.mean()), 4),
                "mean_opponent_start": round(np.mean([p[0]["opponent_team_start_money"] for p in pairs]), 1),
                "opp_retained_primary": round(np.mean(
                    [p[0]["opponent_retained_primary_count"] for p in pairs]), 4),
                "paired_later_force_rate": round(
                    sum(p[1]["branch"] == "FORCE" for p in pairs) / len(pairs), 4),
                "paired_later_eco_rate": round(
                    sum(p[1]["branch"] == "ECO" for p in pairs) / len(pairs), 4),
                "paired_later_mean_spend_ratio": round(float(br.mean()), 4),
                "paired_later_mean_opponent_start": round(np.mean(
                    [p[1]["opponent_team_start_money"] for p in pairs
                     if p[1]["opponent_team_start_money"]]), 1),
                "paired_later_opp_retained_primary": round(np.mean(
                    [p[1]["opponent_retained_primary_count"] for p in pairs
                     if p[1]["opponent_retained_primary_count"] is not None]), 4),
            })

    # ---------------------------------------------------------------
    # 3. overall comparison with cluster-bootstrap CI
    # ---------------------------------------------------------------
    for side in ("t", "ct"):
        a = [r for r in pp_recs if r["side"] == side]
        b = [r for r in later_recs if r["side"] == side]
        for label, rr, is_pp in (("POST_PISTOL", a, True), ("LATER_NORMAL", b, False)):
            if not rr:
                continue
            ci_f = cluster_ci(rr, "all", lambda r: r["branch"] == "FORCE")
            ci_e = cluster_ci(rr, "all", lambda r: r["branch"] == "ECO")
            out.append({
                "analysis": "overall", "side": side, "band": "",
                "sample": label, "n": len(rr),
                "force_rate": round(sum(r["branch"] == "FORCE" for r in rr) / len(rr), 4),
                "force_ci95": f"[{ci_f[0]:.3f},{ci_f[1]:.3f}]",
                "eco_rate": round(sum(r["branch"] == "ECO" for r in rr) / len(rr), 4),
                "eco_ci95": f"[{ci_e[0]:.3f},{ci_e[1]:.3f}]",
                "mean_spend_ratio": round(np.mean([r["team_spend_ratio"] for r in rr]), 4),
                "mean_opponent_start": round(np.mean(
                    [r["opponent_team_start_money"] for r in rr if r["opponent_team_start_money"]]), 1),
                "opp_retained_primary": round(np.mean(
                    [r["opponent_retained_primary_count"] for r in rr
                     if r["opponent_retained_primary_count"] is not None]), 4),
                "opp_retained_awp": round(np.mean(
                    [r["opponent_retained_awp_count"] for r in rr
                     if r["opponent_retained_awp_count"] is not None]), 4),
                "opponent_per_player_start_mean": round(np.mean(
                    [r["opponent_per_player_start_mean"] for r in rr
                     if r["opponent_per_player_start_mean"]]), 1),
                "opponent_survivors_pistol_end_mean": round(np.mean(
                    [r["opponent_survivors_pistol_end"] for r in rr
                     if r["opponent_survivors_pistol_end"] is not None]), 4),
            })

    with open(os.path.join(ppc.PP_DIR, "matched-lr2400-context.csv"), "w", newline="") as f:
        fields = ["analysis", "side", "band", "sample", "n", "force_rate",
                  "force_ci95", "eco_rate", "eco_ci95", "mean_spend_ratio",
                  "mean_opponent_start", "opp_retained_primary", "opp_retained_awp",
                  "opponent_per_player_start_mean", "opponent_survivors_pistol_end_mean",
                  "paired_later_force_rate", "paired_later_eco_rate",
                  "paired_later_mean_spend_ratio", "paired_later_mean_opponent_start",
                  "paired_later_opp_retained_primary"]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(out)

    # ---------------------------------------------------------------
    # plot
    # ---------------------------------------------------------------
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(10.5, 4.2))
    for ax, side in zip(axes, ("t", "ct")):
        a = [r for r in pp_recs if r["side"] == side]
        b = [r for r in later_recs if r["side"] == side]
        # matched at caliper 300
        pairs = None
        rng = np.random.default_rng(SEED)
        rng.shuffle(a)
        rng.shuffle(b)
        used = set()
        pairs = []
        for ra in a:
            best = None
            best_d = 301
            for i, rb in enumerate(b):
                if i in used:
                    continue
                d = abs(rb["per_player_start_mean"] - ra["per_player_start_mean"])
                if d < best_d:
                    best_d = d
                    best = i
            if best is not None and best_d <= 300:
                used.add(best)
                pairs.append((ra, b[best]))
        if pairs:
            ar = np.array([p[0]["team_spend_ratio"] for p in pairs])
            br = np.array([p[1]["team_spend_ratio"] for p in pairs])
            ax.hist(ar, bins=20, alpha=0.55, label=f"POST_PISTOL n={len(pairs)} (matched)",
                    color="#4c72b0", density=True)
            ax.hist(br, bins=20, alpha=0.55, label=f"LATER_NORMAL n={len(pairs)} (matched)",
                    color="#dd8452", density=True)
        ax.set_title(f"side={side.upper()} — matched spend ratio (caliper 300)")
        ax.set_xlabel("team spend ratio")
        ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(os.path.join(ppc.PLOT_DIR, "05-postpistol-vs-later-lr2400.png"), dpi=150)
    plt.close(fig)

    # console summary
    summ = {}
    for side in ("t", "ct"):
        a = [r for r in pp_recs if r["side"] == side]
        b = [r for r in later_recs if r["side"] == side]
        summ[side] = {
            "post_pistol_n": len(a),
            "post_pistol_force_rate": round(sum(r["branch"] == "FORCE" for r in a) / len(a), 4),
            "post_pistol_eco_rate": round(sum(r["branch"] == "ECO" for r in a) / len(a), 4),
            "later_n": len(b),
            "later_force_rate": round(sum(r["branch"] == "FORCE" for r in b) / len(b), 4),
            "later_eco_rate": round(sum(r["branch"] == "ECO" for r in b) / len(b), 4),
        }
    print(json.dumps(summ, indent=2))


if __name__ == "__main__":
    main()
