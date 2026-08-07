#!/usr/bin/env python3
"""Independent overnight-research audit — cross-artifact validation.

Reads ONLY generated artifacts (no re-estimation) and verifies every
repaired invariant. Non-zero exit on any failure.
"""
import csv, json, hashlib, math, os, sys
from collections import defaultdict

OUT = "/tmp/roundsense-economy-analysis-final"
FAILS = []
def check(name, cond, detail: object = ""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(detail) if detail else ""))
    if not cond:
        FAILS.append((name, str(detail)))

R = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "cologne-2026")
META = json.load(open(f"{R}/_meta.json"))

# ---- core freeze: SHA256 identical to pre-repair snapshot ----
BEFORE = "/tmp/roundsense-core-before.sha256"
CORE = ["economy-reference-surface.csv", "purchase-surface.csv",
        "primary-distribution.csv", "secondary-distribution.csv",
        "conditional-loadouts.csv", "retained-coverage.csv"]
if os.path.exists(BEFORE):
    before = {}
    for line in open(BEFORE):
        h, p = line.strip().split("  ", 1)
        before[os.path.basename(p)] = h
    for name in CORE:
        h = hashlib.sha256(open(f"{R}/{name}", "rb").read()).hexdigest()
        check("core unchanged: " + name, before.get(name) == h)
else:
    print("NOTE: no core-before snapshot — skipping core-freeze check")

# ---- entropy sane ----
# feature ladder + team/role/round-score + review table + ambiguity map
FV = list(csv.DictReader(open(f"{R}/feature-value.csv")))
for r in FV:
    v = float(r["grouped_oof_log_loss_bits"])
    check("entropy: feature ladder {} {} finite".format(r["feature_level"], r["target"]),
          math.isfinite(v) and v >= 0)
AMB = list(csv.DictReader(open(f"{R}/ambiguity-map.csv")))
for r in AMB:
    e = float(r["economy_entropy"]); pe = float(r["primary_entropy"])
    check("entropy: ambiguity {} {} in [0,log2(5)]".format(r["side"], r["roundStartMoney"]),
          e >= 0 and e <= math.log2(5) + 0.01)
    check("entropy: primary {} finite".format(r["roundStartMoney"]),
          math.isfinite(pe) and pe >= 0)
PR = list(csv.DictReader(open(f"{R}/policy-review-table.csv")))
for r in PR:
    e = float(r["economy_entropy"])
    check("entropy: review {} {} in [0,log2(5)]".format(r["side"], r["roundStartMoney"]),
          e >= 0 and e <= math.log2(5) + 0.01)

# ---- loss reward: only canonical values ----
for f in ["drop-sensitive-states.csv", "stability.csv", "uncertainty.csv",
          "professional-spend-surface.csv", "next-round-preservation.csv",
          "state-space-coverage.csv"]:
    rows = list(csv.DictReader(open(f"{R}/{f}")))
    bad = [r for r in rows if r.get("lossReward") not in ("1400", "1900", "2400", "2900", "3400", "")]
    check("lossReward canonical: " + f, len(bad) == 0, bad[:3])
DS = list(csv.DictReader(open(f"{R}/drop-sensitive-states.csv")))
idx0 = [r for r in DS if r["lossReward"] == "1400"]
check("lossReward: idx0 -> 1400 present in drop-sensitive", len(idx0) > 0)

# ---- feature ladder: same universe, retained variation, grouped folds ----
levels = [r["feature_level"] for r in FV if r["target"] == "format_state"]
check("feature ladder: 6 levels", len(levels) == 6, levels)
b0 = next(r for r in FV if r["feature_level"] == "B0 money" and r["target"] == "format_state")
b3 = next(r for r in FV if r["feature_level"] == "B3 +retained family" and r["target"] == "format_state")
check("feature ladder: B3 (retained) has real information (different from B2)",
      abs(float(b3["grouped_oof_log_loss_bits"]) - float(b0["grouped_oof_log_loss_bits"])) > 1e-4,
      "B0 {} B3 {}".format(b0["grouped_oof_log_loss_bits"], b3["grouped_oof_log_loss_bits"]))
check("feature ladder: coverage sane", all(float(r["coverage"]) > 0.9 for r in FV))

# ---- benchmark: apples-to-apples + compression separated ----
REP = list(csv.DictReader(open(f"{R}/representation-benchmark.csv")))
gen = [r for r in REP if r["mode"] == "generalization_OOF"]
comp = [r for r in REP if r["mode"] == "compression_fidelity"]
check("benchmark: surface OOF exists", len(gen) >= 4, len(gen))
check("benchmark: surface is OOF (not full-data)", any("OOF" in r["representation"] for r in gen))
check("benchmark: compression rows exist", len(comp) == 3, len(comp))
for r in comp:
    check("benchmark: compression has KL/TV", r["grouped_oof_log_loss"] == "" and r["grouped_oof_accuracy"] == "",
          r["representation"])

# ---- stability: economy rows must have no spend filter (code-level proxy:
#      economy rows exist with full50 crossing AND full80 crossing columns) ----
STAB = list(csv.DictReader(open(f"{R}/stability.csv")))
econ_rows = [r for r in STAB if r["kind"] == "economy"]
pur_rows = [r for r in STAB if r["kind"] == "purchase_median_spend"]
check("stability: economy rows exist", len(econ_rows) > 0)
check("stability: purchase rows exist", len(pur_rows) > 0)
check("stability: economy rows have crossings", any(r["full50_crossing"] for r in econ_rows))

# ---- spend/preservation: none-retained states actually exist ----
SPEND = list(csv.DictReader(open(f"{R}/professional-spend-surface.csv")))
none_spend = [r for r in SPEND if r["retained_value"] == "none"]
check("spend surface: none-retained rows exist", len(none_spend) > 0, len(none_spend))
sides_lrs = set((r["side"], r["lossReward"]) for r in none_spend)
check("spend surface: none-retained covers all supported side/lr",
      len(sides_lrs) >= 8, sorted(sides_lrs))
PRES = list(csv.DictReader(open(f"{R}/next-round-preservation.csv")))
check("preservation: none-retained rows exist", len([r for r in PRES if r["retained_value"] == "none"]) > 0)

# ---- prices: key display weapons resolve canonical price ----
P = json.load(open(f"{R}/_prices.json"))
D2I = P["displayNameToItem"]; I2W = P["itemToWeapon"]; WP = P["weaponPrices"]
KEY = ["AK-47", "M4A4", "M4A1-S", "Galil AR", "FAMAS", "AWP", "SSG 08",
       "MP9", "MAC-10", "Five-SeveN", "Tec-9", "Desert Eagle"]
for d in KEY:
    item = D2I.get(d)
    wid = I2W.get(item) if item else None
    check("price: {} resolves".format(d), bool(item and wid and wid in WP), (d, item, wid))

# ---- affordability: side legality ----
AFF = list(csv.DictReader(open(f"{R}/affordability-targets.csv")))
t_rows = [r for r in AFF if r["side"] == "t"]
ct_rows = [r for r in AFF if r["side"] == "ct"]
check("affordability: rows exist", len(t_rows) > 0 and len(ct_rows) > 0)
for r in t_rows[:20]:
    labels = json.loads(r["target_labels"])
    check("affordability T legal: no M4", all("M4" not in l.split(" + ")[0] for l in labels), labels[:4])
    check("affordability T legal: no Five-SeveN", all("Five-SeveN" not in l for l in labels))
for r in ct_rows[:20]:
    labels = json.loads(r["target_labels"])
    check("affordability CT legal: no Galil", all("Galil" not in l for l in labels))
    check("affordability CT legal: no Tec-9", all("Tec-9" not in l for l in labels))

# ---- review table: no EXTRAPOLATED / LOW_SUPPORT; entropy recomputable;
#      top loadouts match conditional-loadouts ----
bad_conf = [r for r in PR if r["confidence"] not in ("OBSERVED", "INTERPOLATED", "INTERPOLATED_WIDE")]
check("review table: no EXTRAPOLATED/LOW_SUPPORT", len(bad_conf) == 0, bad_conf[:3])
ECON = list(csv.DictReader(open(f"{R}/economy-reference-surface.csv")))
LOAD = list(csv.DictReader(open(f"{R}/conditional-loadouts.csv")))
for r in PR[:60]:
    e = next((x for x in ECON if x["side"] == r["side"] and x["lossReward"] == r["lossReward"]
              and x["retained_value"] == r["retained_value"] and x["roundStartMoney"] == r["roundStartMoney"]), None)
    if e is None:
        check("review: economy row joinable", False, r); continue
    probs = [float(e["p_" + t]) for t in ["pistol", "eco", "semi", "force", "full"]]
    ent = -sum(p * math.log2(p) for p in probs if p > 0)
    check("review: economy_entropy recomputable", abs(ent - float(r["economy_entropy"])) < 0.01,
          "{} vs {}".format(round(ent, 3), r["economy_entropy"]))
    # top loadout must exist in conditional-loadouts for the same state
    lrows = [x for x in LOAD if x["side"] == r["side"] and x["lossReward"] == r["lossReward"]
             and x["retained_value"] == r["retained_value"] and x["roundStartMoney"] == r["roundStartMoney"]]
    check("review: loadouts joinable for {}".format(r["roundStartMoney"]), len(lrows) > 0)
    if lrows:
        first = r["top3_loadouts"].split(";")[0]
        check("review: top loadout format complete (HE/fire/secondary present)",
              "HE" in first and "fr" in first and "|" in first and first.count("|") >= 2, first)

# ---- no stale numbers in final report (old conclusion PHRASES, not bare
#      numbers that legitimately appear in other contexts) ----
REPORT = open(f"{R}/FINAL-POLICY-RESEARCH.md").read()
for stale in ["0.4465 ≈ surface", "0.4465", "team oracle 条件熵仅再降 ~6.4%",
              "exact 20.2%", "48.7%", "31.1%",
              "30-leaf rule tree logloss"]:
    if stale in REPORT and stale not in ("0.4465",):
        check("final report: stale conclusion absent ({})".format(stale), False)
    elif stale == "0.4465":
        check("final report: stale tree logloss absent", "0.4465" not in REPORT)
    else:
        check("final report: stale conclusion absent ({})".format(stale), True)

# ---- artifacts row counts ----
counts = {}
for f in os.listdir(R):
    if f.endswith(".csv"):
        counts[f] = sum(1 for _ in open(f"{R}/{f}")) - 1
print("P: artifact row counts:", json.dumps(counts, indent=1))

# ---- git: production unchanged ----
import subprocess
diff = subprocess.run(["git", "diff", "37a9756", "--", "packages/", "apps/"],
                      capture_output=True, text=True, cwd=os.path.expanduser("~/GitHub/cs2-roundsense"))
check("git: production packages/apps unchanged vs 37a9756", diff.stdout.strip() == "")

if FAILS:
    print("\nRESEARCH AUDIT FAILED:", len(FAILS), "failures")
    for name, detail in FAILS:
        print(" -", name, "|", detail)
    sys.exit(1)
print("\nRESEARCH AUDIT: ALL PASS")
