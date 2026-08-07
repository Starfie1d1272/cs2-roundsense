#!/usr/bin/env python3
"""Section 21: does armor/helmet deserve policy state? (pre-decision fields)."""
import csv, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import RESULTS

FV = list(csv.DictReader(open(f"{RESULTS}/feature-value.csv")))
md = ["# Feature Value — Armor / Helmet", "",
      "deployable pre-decision armor/helmet 使用 retainedArmor/retainedHelmet（live GSI 可得，非 freeze-end 泄漏）。",
      "grouped log loss（5-fold match-series）:", ""]
for row in FV:
    if row["feature_level"] in ("+retained", "+armor/helmet"):
        md.append("- {} | {}: {} bits".format(row["feature_level"], row["target"], row["grouped_log_loss_bits"]))
md.append("")
armor_rows = [r for r in FV if r["feature_level"] == "+armor/helmet"]
base_rows = [r for r in FV if r["feature_level"] == "+retained"]
for t in ["format_state", "helmet", "kit", "smoke"]:
    a = next((float(r["grouped_log_loss_bits"]) for r in armor_rows if r["target"] == t), None)
    b = next((float(r["grouped_log_loss_bits"]) for r in base_rows if r["target"] == t), None)
    if a is not None and b is not None:
        md.append("- {}: Δ {:.4f} bits（+armor/helmet vs +retained）".format(t, b - a))
md.append("")
md.append("结论：pre-decision armor/helmet 的增量信息存在但有限（Δ 见上）——")
md.append("是否纳入 policy state 由人工决定；planner 的 inventory-aware 增量价格仍需要 armor 数值。")
open(f"{RESULTS}/feature-value.md", "w").write("\n".join(md))
print("feature-value.md:", len(md), "lines")
