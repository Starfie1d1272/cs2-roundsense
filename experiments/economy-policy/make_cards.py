#!/usr/bin/env python3
"""Section 30: policy review atlas — decision cards from the review table."""
import csv, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import RESULTS

ROWS = list(csv.DictReader(open(f"{RESULTS}/policy-review-table.csv")))

def card(side, lr, M, rv="none"):
    r = None
    for row in ROWS:
        if (row["side"] == side and row["lossReward"] == str(lr)
                and row["roundStartMoney"] == str(M) and row["retained_value"] == rv):
            r = row
            break
    if r is None:
        return "### {} · lr${} · ${} — UNSUPPORTED (no review row)\n".format(side.upper(), lr, M)
    out = []
    out.append("### {} · lossReward ${} · roundStartMoney ${} · retained {}".format(side.upper(), lr, M, rv))
    out.append("")
    out.append("```text")
    out.append("support:   {} · exact_n {} · effective_n {} · nearest ${} · estimate {}".format(
        r["confidence"], r["exact_n"], r["effective_n"], r["nearest_observed_distance"], r["estimate_level"]))
    out.append("economy:   entropy {} bits".format(r["economy_entropy"]))
    out.append("spend:     p25 ${} · median ${} · p75 ${}".format(
        r["spend_p25"], r["spend_median"], r["spend_p75"]))
    out.append("next:      no-spend ${} · after-median-spend ${} · T plant ${}".format(
        r["nextIfLoseNoSpend"], r["nextIfLoseAfterMedianSpend"], r["nextIfLoseAfterMedianSpendAndPlant"]))
    out.append("primary:   {}".format(r["top3_primary"]))
    out.append("equip:     armor {:.0f}% · helmet {:.0f}% · kit {:.0f}%".format(
        float(r["armor_prob"]) * 100, float(r["helmet_prob"]) * 100, float(r["defusekit_prob"]) * 100))
    out.append("utility:   smoke {:.0f}% · flash>=1 {:.0f}% · flash2 {:.0f}% · HE {:.0f}% · fire {:.0f}%".format(
        float(r["smoke_prob"]) * 100, float(r["flash1plus_prob"]) * 100, float(r["flash2_prob"]) * 100,
        float(r["HE_prob"]) * 100, float(r["fire_prob"]) * 100))
    out.append("loadout top3 (mass {}):".format(r["top3_loadout_mass"]))
    for c in r["top3_loadouts"].split(";"):
        out.append("  - {}".format(c))
    out.append("```")
    out.append("")
    out.append("**HUMAN POLICY DECISION:**")
    out.append("[blank]")
    out.append("")
    return "\n".join(out)

md = ["# Policy Review Atlas (Decision Cards)", "",
      "职业行为证据卡——供人工逐状态制定 policy。无推荐列。",
      "仅含 OBSERVED/INTERPOLATED/INTERPOLATED_WIDE 且 purchase 非 LOW_SUPPORT 的 state。", ""]
n_cards = 0
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        md.append("---")
        md.append("")
        rows_side = [r for r in ROWS if r["side"] == side and r["lossReward"] == str(lr)
                     and r["retained_value"] == "none"]
        picks = []
        for M in [1500, 2500, 3000, 3500, 4000, 5000]:
            if any(r["roundStartMoney"] == str(M) for r in rows_side):
                picks.append(M)
        for M in picks:
            md.append(card(side, lr, M))
            n_cards += 1
open(f"{RESULTS}/policy-review-atlas.md", "w").write("\n".join(md))
print("policy-review-atlas.md:", len(md), "lines,", n_cards, "cards")
