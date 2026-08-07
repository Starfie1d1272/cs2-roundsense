#!/usr/bin/env python3
"""Section 26: V1 gap analysis — production heuristic vs professional evidence.

JOINs frozen core artifacts (purchase-surface, primary-distribution,
economy-reference-surface) instead of re-estimating. V1 rows come from
v1_gap.ts (read-only production advisor calls).
"""
import csv, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import RESULTS

V1 = list(csv.DictReader(open(f"{RESULTS}/v1-gap.csv")))
PUR = list(csv.DictReader(open(f"{RESULTS}/purchase-surface.csv")))
PRIM = list(csv.DictReader(open(f"{RESULTS}/primary-distribution.csv")))
ECON = list(csv.DictReader(open(f"{RESULTS}/economy-reference-surface.csv")))

def find(rows, side, lr, M, rv="none"):
    for r in rows:
        if (r["side"] == side and r["lossReward"] == str(lr)
                and r["roundStartMoney"] == str(M) and r["retained_value"] == rv):
            return r
    return None

md = ["# V1 Gap Analysis", "",
      "production V1（bundle heuristic planner）在关键状态的行为 vs 职业证据。",
      "V1 推荐来自当前 production advisor（只读调用，未修改）。",
      "注：production roundType 为 4 类（eco/semi/force/full，totalCost=0 归 eco——与 format taxonomy",
      "的 pistol/save 语义不同）；rec_class 仅为 production 行为参考。", ""]
md.append("## V1 vs professional（retained none，$1000 步长状态）")
md.append("")
md.append("| side | lr | money | V1 class | V1 cost | prof spend p25/med/p75 | prof primary top1 | prof armor | prof smoke |")
md.append("|---|---|---|---|---|---|---|---|---|")
for v in V1:
    if v["retained"] != "none" or int(v["money"]) % 1000 != 0:
        continue
    p = find(PUR, v["side"], v["lossReward"], v["money"])
    e = find(ECON, v["side"], v["lossReward"], v["money"])
    if p is None or p["confidence"] in ("LOW_SUPPORT", "EXTRAPOLATED", ""):
        continue
    prims = [r for r in PRIM if r["side"] == v["side"] and r["lossReward"] == str(v["lossReward"])
             and r["roundStartMoney"] == str(v["money"]) and r["retained_value"] == "none"]
    prims.sort(key=lambda r: -float(r["weighted_probability"]))
    top1 = "{} {:.0f}%".format(prims[0]["weapon"], 100 * float(prims[0]["weighted_probability"])) if prims else "-"
    md.append("| {} | ${} | ${} | {} | ${} | ${}/{}/{} | {} | {:.0f}% | {:.0f}% |".format(
        v["side"].upper(), v["lossReward"], v["money"], v["rec_class"], v["rec_cost"],
        p["spend_p25"], p["spend_median"], p["spend_p75"], top1,
        100 * float(p["armor_prob"]), 100 * float(p["smoke_prob"])))
md.append("")
md.append("## 观察（仅描述）")
md.append("")
md.append("- V1 推荐 cost 与职业 median spend 的差 = 现有 heuristic 到 evidence-backed policy 的距离（部分状态）。")
md.append("- V1 的 bundle 结构（固定模板 + 增量）无法表达职业的 utility 混合（见 conditional-loadouts）。")
md.append("- V1 eco 类含 save 行为（totalCost=0）；对照职业 format eco/save 时需注意语义差。")
md.append("- 完整 per-state 对比见 v1-gap.csv（side/lr/retained/money/goal/rec_class/rec_cost/rec_purchases）。")
open(f"{RESULTS}/v1-gap-analysis.md", "w").write("\n".join(md))
print("v1-gap-analysis.md:", len(md), "lines")
