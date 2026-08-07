#!/usr/bin/env python3
"""Generate analysis-summary.md from final artifacts."""
import csv, json

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "cologne-2026")
META = json.load(open(f"{OUT}/_meta.json"))
ECON = list(csv.DictReader(open(f"{OUT}/economy-reference-surface.csv")))
PUR = list(csv.DictReader(open(f"{OUT}/purchase-surface.csv")))
RC = list(csv.DictReader(open(f"{OUT}/retained-coverage.csv")))
LOAD = list(csv.DictReader(open(f"{OUT}/conditional-loadouts.csv")))
PRIM = list(csv.DictReader(open(f"{OUT}/primary-distribution.csv")))

md = []
md.append("# RoundSense Final Professional Economy Analysis")
md.append("")
md.append("## Corpus")
md.append("")
e = META["exclusions"]
md.append("```text")
md.append("raw player-rounds:            {}".format(e["raw"]))
md.append("strict player-rounds:        {}".format(e["strict"]))
md.append("excluded overtime:           {}".format(e["overtime"]))
md.append("excluded drop_gave:          {}".format(e["drop_gave"]))
md.append("excluded drop_received:      {}".format(e["drop_received"]))
md.append("excluded loss-index ambiguous: {}".format(e["loss_index_ambiguous"]))
md.append("partition sum == raw:        {}".format(e["overtime"] + e["drop_gave"] + e["drop_received"] + e["loss_index_ambiguous"] + e["strict"] == e["raw"]))
md.append("```")
md.append("")
md.append("## Core corrections (hard assertions in build)")
md.append("")
md.append("- lossReward = LOSS_REWARDS[clamp(lossIndex,0,4)] = [1400,1900,2400,2900,3400] (asserted).")
md.append("- correctedRetainedPrimary: r13 -> None; transfer-like -> UNKNOWN; UNKNOWN never enters retained estimators; pistol + retained long gun = 0 (asserted).")
md.append("- grenades normalized once; count in [0,4], flash <= 2 (asserted). Strict distribution: {}".format(META["grenade_dist_strict"]))
md.append("- weapon taxonomy from DAK weapons.ts (SSG 08 = sniper, not rifle).")
md.append("- purchase feasibility: pool filtered to moneySpent <= M BEFORE bandwidth re-selection; N_eff < 20 -> LOW_SUPPORT (no unaffordable borrowing).")
md.append("")
md.append("## Estimators")
md.append("")
md.append("- Economy reference: adaptive Gaussian kernel, N_eff=100, h $20-500, grid $0-16000 step $50. No spend filter (target = format economy state).")
md.append("- Purchase/loadout: same kernel on the feasibility-conditioned pool.")
md.append("- Confidence: OBSERVED / INTERPOLATED / INTERPOLATED_WIDE / EXTRAPOLATED / LOW_SUPPORT (definitions in README).")
md.append("")
md.append("## Key supported crossings (retained=none, supported region)")
md.append("")
md.append("| side | lr1400 | lr1900 | lr2400 | lr2900 | lr3400 |")
md.append("|---|---|---|---|---|---|")
for side in ["t", "ct"]:
    row = []
    for lr in [1400, 1900, 2400, 2900, 3400]:
        rows = [r for r in ECON if r["side"] == side and r["lossReward"] == str(lr)
                and r["retained_value"] == "none" and r["confidence"] in ("OBSERVED", "INTERPOLATED")]
        f50 = next((int(r["roundStartMoney"]) for r in rows if float(r["p_full"]) >= 0.5), None)
        row.append("full50=" + ("${}".format(f50) if f50 else "-"))
    md.append("| {} | {} |".format(side.upper(), " | ".join(row)))
md.append("")
md.append("## Spot-check states")
md.append("")
def pur_row(side, lr, M, rv):
    for r in PUR:
        if r["side"] == side and r["lossReward"] == str(lr) and r["roundStartMoney"] == str(M) and r["retained_value"] == rv:
            return r
    return None

def load_top(side, lr, M, rv, k=5):
    return [r for r in LOAD if r["side"] == side and r["lossReward"] == str(lr)
            and r["roundStartMoney"] == str(M) and r["retained_value"] == rv][:k]

def prim_top(side, lr, M, rv, k=4):
    rows = [r for r in PRIM if r["side"] == side and r["lossReward"] == str(lr)
            and r["roundStartMoney"] == str(M) and r["retained_value"] == rv]
    rows.sort(key=lambda r: -float(r["weighted_probability"]))
    return rows[:k]

SPOTS = [("t", 1900, "none", [3000, 3500, 3800, 4000, 4500, 5000]),
         ("t", 2400, "none", [2500, 3000, 3500, 4000]),
         ("ct", 1900, "none", [3000, 3500, 3800, 4000, 4500]),
         ("ct", 2400, "none", [2500, 3000, 3500, 4000])]
for side, lr, rv, Ms in SPOTS:
    for M in Ms:
        p = pur_row(side, lr, M, rv)
        if p is None or p["confidence"] == "LOW_SUPPORT":
            md.append("- {} lr{} ${} {}: UNSUPPORTED".format(side.upper(), lr, M, rv))
            continue
        econ = next((r for r in ECON if r["side"] == side and r["lossReward"] == str(lr)
                     and r["roundStartMoney"] == str(M) and r["retained_value"] == rv), None)
        md.append("### {} · lr{} · ${} · retained {}".format(side.upper(), lr, M, rv))
        md.append("```text")
        if econ:
            md.append("economy: eco {:.0f}% semi {:.0f}% force {:.0f}% full {:.0f}% (conf {}, ne {})".format(
                float(econ["p_eco"]) * 100, float(econ["p_semi"]) * 100, float(econ["p_force"]) * 100,
                float(econ["p_full"]) * 100, econ["confidence"], econ["effective_n"]))
        md.append("spend:   median ${} p25 ${} p75 ${} p90 ${}".format(
            p["spend_median"], p["spend_p25"], p["spend_p75"], p["spend_p90"]))
        pt = ", ".join("{} {:.0f}%".format(r["weapon"], float(r["weighted_probability"]) * 100)
                       for r in prim_top(side, lr, M, rv))
        md.append("primary: {}".format(pt))
        md.append("equip:   armor {:.0f}% helmet {:.0f}% kit {:.0f}%".format(
            float(p["armor_prob"]) * 100, float(p["helmet_prob"]) * 100, float(p["defusekit_prob"]) * 100))
        md.append("utility: smoke {:.0f}% flash>=1 {:.0f}% flash2 {:.0f}% HE {:.0f}% fire {:.0f}% gc {}".format(
            float(p["smoke_prob"]) * 100, float(p["flash1plus_prob"]) * 100, float(p["flash2_prob"]) * 100,
            float(p["HE_prob"]) * 100, float(p["fire_prob"]) * 100, p["grenade_count_mean"]))
        tops = load_top(side, lr, M, rv)
        if tops:
            md.append("top configs (mass {} res {}):".format(tops[0]["topK_mass"], tops[0]["residual_mass"]))
            for c in tops:
                md.append("  #{} {} | {} | a{} h{} k{} | sm{} fl{} HE{} fr{}  {:.1%}".format(
                    c["rank"], c["primary"], c["secondary_exact"], c["armor"], c["helmet"], c["defusekit"],
                    c["smoke"], c["flash_count"], c["HE"], c["fire"], float(c["weighted_probability"])))
        md.append("```")
        md.append("")
md.append("## Retained coverage")
md.append("")
from collections import Counter
lv = Counter(r["estimate_level"] for r in RC)
md.append("- exact: {} · family: {} · unsupported: {}".format(lv["exact"], lv["family"], lv["unsupported"]))
md.append("- exact-supported weapons: {}".format(", ".join(sorted({r["retained_weapon"] for r in RC if r["estimate_level"] == "exact"}))))
md.append("- no retained->none fallback exists (estimate_level only exact/family/unsupported).")
md.append("")
md.append("## Interpretation")
md.append("")
md.append("- Economy reference surface = professional behavior description.")
md.append("- Purchase/loadout surface = feasibility-conditioned professional behavior description.")
md.append("- Neither is automatically optimal play. RoundSense recommendation = professional evidence + deterministic CS2 rules + human policy judgement (next stage).")
open(f"{OUT}/analysis-summary.md", "w").write("\n".join(md))
print("analysis-summary.md:", len(md), "lines")
