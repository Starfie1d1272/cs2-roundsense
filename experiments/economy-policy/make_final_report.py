#!/usr/bin/env python3
"""Section 41: FINAL-POLICY-RESEARCH.md — rebuilt from repaired artifacts.

Sections: VALIDATED EVIDENCE / LIMITATIONS / HUMAN POLICY DECISIONS /
RUNTIME VALIDATIONS. Every number is read dynamically from artifacts —
no hard-coded historical results.
"""
import csv, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import RESULTS

def read_csv(name):
    return list(csv.DictReader(open(f"{RESULTS}/{name}")))

def read_md(name):
    p = f"{RESULTS}/{name}"
    return open(p).read() if os.path.exists(p) else ""

META = json.load(open(f"{RESULTS}/_meta.json"))
FV = read_csv("feature-value.csv")
UNC = read_csv("uncertainty.csv")
REP = read_csv("representation-benchmark.csv")
PR = read_csv("policy-review-table.csv")
COV = read_csv("retained-coverage.csv")
ECON = read_csv("economy-reference-surface.csv")

def fmt_money(v):
    return "${}".format(int(float(v))) if v not in ("", None) else "-"

def full_crossings():
    out = []
    for side in ["t", "ct"]:
        row = []
        for lr in [1400, 1900, 2400, 2900, 3400]:
            rows = [r for r in ECON if r["side"] == side and r["lossReward"] == str(lr)
                    and r["retained_value"] == "none"
                    and r["confidence"] in ("OBSERVED", "INTERPOLATED")]
            f50 = next((int(r["roundStartMoney"]) for r in rows if float(r["p_full"]) >= 0.5), None)
            row.append("lr{}: {}".format(lr, fmt_money(f50)))
        out.append("{} {}".format(side.upper(), " · ".join(row)))
    return out

def ladder_summary():
    """Feature ladder rows for format_state target."""
    out = []
    prev = None
    for row in FV:
        if row["target"] != "format_state":
            continue
        d = "" if prev is None else "{:+.4f}".format(float(row["grouped_oof_log_loss_bits"]) - prev)
        out.append("- {}: {:.4f} bits{} (coverage {:.0%})".format(
            row["feature_level"], float(row["grouped_oof_log_loss_bits"]), d, float(row["coverage"])))
        prev = float(row["grouped_oof_log_loss_bits"])
    return out

def ci_row(side, lr, q):
    for r in UNC:
        if r["side"] == side and r["lossReward"] == str(lr) and r["quantity"] == q and r["ci_low"]:
            return "${}–${} (median {})".format(r["ci_low"], r["ci_high"], r["median"])
    return "insufficient"

md = []
md.append("# Final Policy Research — Cologne 2026 Professional Economy Evidence (REPAIRED)")
md.append("")
md.append("> 本报告由修复后的 research pipeline 动态生成（entropy 归一化、feature ladder 同 universe、")
md.append("> benchmark OOF 公平化、stability/bootstrap estimator 分离、canonical price/legality）。")
md.append("> 任何数字均可从对应 CSV 复核。")
md.append("")
md.append("## VALIDATED EVIDENCE")
md.append("")
md.append("### Corpus / coverage")
md.append("")
md.append("- STRICT {} player-rounds（raw {}；exclusion partition 见 _meta.json）。".format(
    META["exclusions"]["strict"], META["exclusions"]["raw"]))
md.append("- 五档 lossReward 全部支持；retained coverage: exact {} / family {} / unsupported {}。".format(
    sum(1 for r in COV if r["estimate_level"] == "exact"),
    sum(1 for r in COV if r["estimate_level"] == "family"),
    sum(1 for r in COV if r["estimate_level"] == "unsupported")))
md.append("- grenade 分布（strict）: {}".format(META["grenade_dist_strict"]))
md.append("")
md.append("### Economy reference (supported crossings, retained=none)")
md.append("")
for line in full_crossings():
    md.append("- {}".format(line))
md.append("")
md.append("### Stability (5-fold match-series; economy estimator, no spend filter)")
md.append("")
for side in ["t", "ct"]:
    line = []
    for lr in [1400, 1900, 2400, 2900, 3400]:
        vals = [r for r in read_csv("stability.csv")
                if r["side"] == side and r["lossReward"] == str(lr)
                and r["kind"] == "economy" and r["full50_crossing"]]
        if vals:
            v = sorted(int(r["full50_crossing"]) for r in vals)
            line.append("lr{}: {} folds ${}–${}".format(lr, len(v), v[0], v[-1]))
    md.append("- {}: {}".format(side.upper(), "; ".join(line) or "insufficient"))
md.append("")
md.append("### Uncertainty (cluster bootstrap, match-series, B=500, seed 42)")
md.append("")
for side in ["t", "ct"]:
    line = []
    for lr in [1400, 1900, 2400, 2900, 3400]:
        c = ci_row(side, lr, "full50")
        if c != "insufficient":
            line.append("lr{} full50 {} · full80 {}".format(
                lr, c, ci_row(side, lr, "full80")))
    md.append("- {}: {}".format(side.upper(), "; ".join(line) or "insufficient"))
md.append("- median spend CI: uncertainty.csv quantities median_spend_2500 / median_spend_4000（feasibility estimator）。")
md.append("")
md.append("### Deployable feature ladder (same row universe, grouped OOF, nested backoff)")
md.append("")
md.extend(ladder_summary())
md.append("")
md.append("### Representation")
md.append("")
for r in REP:
    if r["mode"] == "generalization_OOF":
        f1 = r["grouped_oof_macroF1"] or "-"
        md.append("- {}: OOF logloss {} · acc {} · macroF1 {}".format(
            r["representation"], r["grouped_oof_log_loss"], r["grouped_oof_accuracy"], f1))
md.append("- compression fidelity（full-data，非 held-out）: representation-benchmark.csv mode=compression_fidelity（KL/TV/label agreement）。")
md.append("")
md.append("### Purchase-cost reconstruction (canonical display-name prices)")
md.append("")
md.append(read_md("purchase-cost-reconstruction.md").split("## 已知不可重建项")[0])
md.append("")
md.append("### Affordability (exact legal targets, canonical prices + legality)")
md.append("")
md.append(read_md("affordability-evidence.md").split("affordability-targets.csv")[0])
md.append("")
md.append("### Team / role / round-score context (entropy-normalized)")
md.append("")
md.append(read_md("team-context-ceiling.md"))
md.append("")
md.append(read_md("role-ambiguity.md").splitlines()[0])
md.append(read_md("round-score-context.md").splitlines()[0])
md.append("")
md.append("## LIMITATIONS")
md.append("")
md.append("- drop 通道不可见（excluded {} drop-gave / {} drop-received）；个人推荐在相关状态需保守。".format(
    META["exclusions"]["drop_gave"], META["exclusions"]["drop_received"]))
md.append("- purchase-cost reconstruction 不可重建项：armor damaged-state、drop chronology、重复购买（见 reconstruction md）。")
md.append("- 团队/round/score 上下文为 ORACLE 研究（非 production 输入）；团队增益以修复后 held-out 数值为准。")
md.append("- roundStartMoney live 获取 NEEDS RUNTIME VALIDATION（freeze 首帧捕获；GSI 无回合开始现金字段）。")
md.append("")
md.append("## HUMAN POLICY DECISIONS")
md.append("")
md.append("- policy-review-table.csv：{} supported review-table rows（仅 OBSERVED/INTERPOLATED/INTERPOLATED_WIDE + purchase 非 LOW_SUPPORT）。".format(len(PR)))
md.append("- policy-review-atlas.md：{} 张人工 review cards（no-retained 关键金额 + retained rifle/SMG/AWP 代表 states——非全量覆盖，供人工审阅）。".format(
    sum(1 for _ in open(f"{RESULTS}/policy-review-atlas.md") if _.startswith("### "))))
md.append("- HUMAN POLICY DECISION 字段留空——由人工逐卡填写。")
md.append("")
md.append("## RUNTIME VALIDATIONS")
md.append("")
md.append("- freeze 首帧纯净性（first payload 是否已购买）— decision-anchor-design.md")
md.append("- previously.weapons entry 增删的可观测性 — decision-anchor-design.md")
md.append("- armor 受损态 vs 全价的 live 区分 — live-spend-feasibility.md")
md.append("- 全部 NEEDS RUNTIME VALIDATION 项见 gsi-deployability.md / fact-layer-contract.md")
open(f"{RESULTS}/FINAL-POLICY-RESEARCH.md", "w").write("\n".join(md))
print("FINAL-POLICY-RESEARCH.md:", len(md), "lines")
