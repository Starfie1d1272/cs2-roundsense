#!/usr/bin/env python3
"""Section 26: V1 gap analysis — production heuristic vs professional evidence."""
import csv, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import RESULTS

V1 = list(csv.DictReader(open(f"{RESULTS}/v1-gap.csv")))
md = ["# V1 Gap Analysis", "",
      "production V1（bundle heuristic planner，rifle_armor 默认 goal）在关键状态的行为 vs 职业证据。",
      "V1 推荐来自当前 production advisor（只读调用）。", ""]

def prof_spend(side, lr, M):
    rows = list(csv.DictReader(open(f"{RESULTS}/professional-spend-surface.csv")))
    for r in rows:
        if r["side"] == side and r["lossReward"] == str(lr) and r["roundStartMoney"] == str(M) and r["retained_value"] == "none":
            return r
    return None

md.append("## V1 spend vs professional spend（retained none）")
md.append("")
md.append("| side | lr | money | V1 cost | prof p25 | prof med | prof p75 |")
md.append("|---|---|---|---|---|---|---|")
for v in V1:
    if v["retained"] != "none" or int(v["money"]) % 1000 != 0:
        continue
    p = prof_spend(v["side"], v["lossReward"], v["money"])
    if p is None:
        continue
    md.append("| {} | ${} | ${} | ${} | ${} | ${} | ${} |".format(
        v["side"].upper(), v["lossReward"], v["money"], v["rec_cost"],
        p["spend_p25"], p["spend_median"], p["spend_p75"]))
md.append("")
md.append("## 观察（仅描述）")
md.append("")
md.append("- V1 推荐 cost 与职业 median spend 的差 = 现有 heuristic 到 evidence-backed policy 的距离（部分状态）。")
md.append("- V1 的 bundle 结构（固定模板 + 增量）无法表达职业的 utility 混合（见 conditional-loadouts）。")
md.append("- 完整 per-state 对比见 v1-gap.csv（240 行：side/lr/retained/money/goal/rec_class/rec_cost/rec_purchases）。")
open(f"{RESULTS}/v1-gap-analysis.md", "w").write("\n".join(md))
print("v1-gap-analysis.md:", len(md), "lines")
