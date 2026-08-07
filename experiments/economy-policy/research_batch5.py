#!/usr/bin/env python3
"""Research batch 5: purchase-cost reconstruction (5), affordability (8),
policy review table (29).

Prices/identity/legality come ONLY from _prices.json (exported by
export_prices.ts from production sources). Review table JOINs the frozen
core artifacts instead of re-estimating.
"""
import csv, json, os, sys
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import (build_dataset, wprob, wquant, weights_at, retained_pool,
                             no_retained_pool, entropy_from_probs,
                             DEFAULT_PISTOLS, PAID_PISTOLS, RESULTS)

STRICT, FAMILY = build_dataset()
P = json.load(open(f"{RESULTS}/_prices.json"))
PRICES = dict(P["prices"])
WPRICE = P["weaponPrices"]
I2W = P["itemToWeapon"]
I2D = P["itemToDisplay"]
D2I = P["displayNameToItem"]
SIDE_LEG = P["sideLegality"]
# canonical display-name -> price
NAME_PRICE = {}
for item, wid in I2W.items():
    if wid and wid in WPRICE and item in I2D:
        NAME_PRICE[I2D[item]] = WPRICE[wid]
# hard assertions: key weapons resolve displayName -> item -> weaponId -> price
KEY_DISPLAY = ["AK-47", "M4A4", "M4A1-S", "Galil AR", "FAMAS", "AWP", "SSG 08",
               "MP9", "MAC-10", "Five-SeveN", "Tec-9", "Desert Eagle"]
for d in KEY_DISPLAY:
    item = D2I.get(d)
    assert item, f"displayNameToItem missing {d}"
    wid = I2W.get(item)
    assert wid and wid in WPRICE, f"cannot resolve {d} -> price"
    assert NAME_PRICE.get(d) == WPRICE[wid], f"price mismatch {d}"
# side legality sanity (canonical from export; these MUST hold)
assert SIDE_LEG.get("ak47") == "t" and SIDE_LEG.get("m4a4") == "ct"
assert SIDE_LEG.get("tec9") == "t" and SIDE_LEG.get("fiveseven") == "ct"
assert SIDE_LEG.get("mac10") == "t" and SIDE_LEG.get("mp9") == "ct"

def display_side(item):
    return SIDE_LEG.get(item, "both")

def item_price(item):
    wid = I2W.get(item)
    return WPRICE.get(wid, 0) if wid else 0

GRENADE_PRICES = {"smoke": PRICES.get("smoke", 300), "flashbang": PRICES.get("flash", 200),
                  "hegrenade": PRICES.get("he", 300), "molotov": PRICES.get("molotov", 400),
                  "incendiary": PRICES.get("incendiary", 600), "decoy": PRICES.get("decoy", 50)}
ARMOR = PRICES.get("kevlar", 650)
HELMET_FULL = PRICES.get("kevlar_helmet", 1000)
KIT = PRICES.get("defuser") or PRICES.get("defusekit") or 400

# ---------- 5. purchase-cost reconstruction (canonical display-name prices) ----------
rows = []
exact = 0
explain = 0
unres = 0
examples = []
for r in STRICT:
    if r["correctedRetainedPrimary"] in (None, "UNKNOWN"):
        continue
    ret = r["correctedRetainedPrimary"]
    res = r["primary"]
    prim_cost = 0
    if res and res != ret:
        prim_cost = NAME_PRICE.get(res, 0)
    armor_cost = 0
    if r["hasArmor"] and not r["retainedArmor"]:
        armor_cost += ARMOR
    if r["hasHelmet"] and not r["retainedHelmet"]:
        armor_cost += HELMET_FULL - ARMOR if r["hasArmor"] else HELMET_FULL
    rg = Counter(r["retainedGrenades"])
    ng = Counter(r["grenades"])
    grenade_cost = sum(GRENADE_PRICES.get(g, 0) * max(0, ng[g] - rg[g]) for g in set(ng) | set(rg))
    kit_cost = KIT if (r["hasDefuseKit"] and not r["retainedKit"]) else 0
    implied = prim_cost + armor_cost + grenade_cost + kit_cost
    diff = r["moneySpent"] - implied
    rows.append([r["map"], r["roundNumber"], r["name"], r["startMoney"], r["moneySpent"],
                 ret, res, round(prim_cost, 0), round(armor_cost, 0), round(grenade_cost, 0),
                 round(kit_cost, 0), round(implied, 0), round(diff, 0)])
    if abs(diff) <= 100:
        exact += 1
    elif abs(diff) <= 600:
        explain += 1
    else:
        unres += 1
        if len(examples) < 8:
            examples.append([r["map"], r["roundNumber"], r["name"], r["moneySpent"], ret, res, diff])
with open(f"{RESULTS}/purchase-cost-mismatches.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["map", "round", "player", "startMoney", "moneySpent", "retainedPrimary",
                "resultingPrimary", "implied_primary", "implied_armor", "implied_grenades",
                "implied_kit", "implied_total", "diff"])
    w.writerows(rows)
n = len(rows)
md = ["# Purchase-Cost Reconstruction", "",
      "STRICT rows with corrected retained: {}".format(n), "",
      "implied delta cost (retained->resulting, canonical display-name prices) vs moneySpent:", "",
      "- exact match (|diff|<=100): {:.1f}% (n={})".format(100 * exact / n, exact),
      "- explainable (<=600): {:.1f}% (n={})".format(100 * explain / n, explain),
      "- unresolved (>600): {:.1f}% (n={})".format(100 * unres / n, unres), "",
      "## unresolved 示例（diff > $600）", ""]
for m, rnd, name, spent, ret, res, diff in examples:
    md.append("- {} r{} {}: spent ${} retained={} resulting={} diff=${}".format(
        m.split("-")[-1], rnd, name, spent, ret, res, diff))
md.append("")
md.append("## 已知不可重建项（不猜测）")
md.append("- armor damaged-state（$350 升级 vs $1000 全价无法区分）")
md.append("- drop chronology / 回合中武器转移顺序")
md.append("- 同一商品重复购买（如买两把同价枪再换）")
open(f"{RESULTS}/purchase-cost-reconstruction.md", "w").write("\n".join(md))
print("5 done: exact {:.1f}% explain {:.1f}% unresolved {:.1f}%".format(
    100 * exact / n, 100 * explain / n, 100 * unres / n))

# ---------- 8. affordability: exact legal item targets (canonical legality) ----------
# Build exact legal target list per side: (label, cost) — no "cheapest rifle".
SMOKE, FLASH = GRENADE_PRICES["smoke"], GRENADE_PRICES["flashbang"]
def targets_for(side):
    """Exact legal item combinations with canonical prices. side in {'t','ct'}."""
    t = []
    def add(label, cost):
        t.append((label, cost))
    # rifles
    for item in ["ak47", "galil", "famas"]:
        if display_side(item) in (side, "both"):
            add("{} + armor".format(I2D[item]), item_price(item) + ARMOR)
            add("{} + helmet".format(I2D[item]), item_price(item) + HELMET_FULL)
            add("{} + armor + smoke + flash".format(I2D[item]), item_price(item) + ARMOR + SMOKE + FLASH)
            add("{} + armor + smoke + 2flash".format(I2D[item]), item_price(item) + ARMOR + SMOKE + 2 * FLASH)
    for item in ["m4a4", "m4a1s"]:
        if display_side(item) in (side, "both"):
            add("{} + armor".format(I2D[item]), item_price(item) + ARMOR)
            add("{} + armor + smoke + flash".format(I2D[item]), item_price(item) + ARMOR + SMOKE + FLASH)
    # smgs
    for item in ["mac10", "mp9"]:
        if display_side(item) in (side, "both"):
            add("{} + armor".format(I2D[item]), item_price(item) + ARMOR)
    # awp
    add("AWP + armor", item_price("awp") + ARMOR)
    add("AWP + armor + smoke + flash", item_price("awp") + ARMOR + SMOKE + FLASH)
    # paid pistols
    for item in ["tec9", "fiveseven", "deagle"]:
        if display_side(item) in (side, "both"):
            add("{} + armor".format(I2D[item]), item_price(item) + ARMOR)
    # legality asserts: no illegal weapon in a side's target list
    return t

T_LEGAL = targets_for("t")
CT_LEGAL = targets_for("ct")
# hard asserts: no CT Galil / no T M4 / no CT Tec-9 / no T Five-SeveN
ct_labels = [l for l, _ in CT_LEGAL]
t_labels = [l for l, _ in T_LEGAL]
assert not any("Galil" in l for l in ct_labels), "CT Galil illegal"
assert not any(l.startswith("M4") for l in t_labels), "T M4 illegal"
assert not any("Tec-9" in l for l in ct_labels), "CT Tec-9 illegal"
assert not any("Five-SeveN" in l for l in t_labels), "T Five-SeveN illegal"

AFF = []
for r in STRICT:
    if r["correctedRetainedPrimary"] is not None:
        continue
    next_lose = min(16000, r["startMoney"] - r["moneySpent"] + r["_lr"])
    legal = T_LEGAL if r["side"] == "t" else CT_LEGAL
    row = [r["side"], r["_lr"], r["startMoney"], r["moneySpent"], next_lose]
    for label, cost in legal:
        row.append(int(next_lose >= cost))
    AFF.append(row)
headers = ["side", "lossReward", "startMoney", "moneySpent", "nextIfLoseAfterSpend"] + [l for l, _ in T_LEGAL if True]
# header must match the FIRST side's targets; T and CT may differ in count —
# emit per-side files to keep schema exact
with open(f"{RESULTS}/affordability-targets.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "startMoney", "moneySpent", "nextIfLoseAfterSpend",
                "target_labels", "target_costs", "affordable_mask"])
    for row in AFF:
        w.writerow(row[:5] + [json.dumps([l for l, _ in (T_LEGAL if row[0] == "t" else CT_LEGAL)]),
                              json.dumps([c for _, c in (T_LEGAL if row[0] == "t" else CT_LEGAL)]),
                              json.dumps(row[5:])])
md = ["# Affordability Evidence", "",
      "每行：职业实际购买后若本回合输掉，nextIfLoseAfterSpend = min(16000, start - spent + lossReward)。",
      "1 = 下一局可负担该 exact legal target（canonical prices + canonical side legality）。", "",
      "## T legal targets", ""]
for label, cost in T_LEGAL:
    md.append("- {} ${}".format(label, cost))
md.append("")
md.append("## CT legal targets")
md.append("")
for label, cost in CT_LEGAL:
    md.append("- {} ${}".format(label, cost))
md.append("")
md.append("affordability-targets.csv 全量（每行含 target_labels/costs/affordable_mask JSON）。")
open(f"{RESULTS}/affordability-evidence.md", "w").write("\n".join(md))
print("8 done: T targets {} CT targets {}".format(len(T_LEGAL), len(CT_LEGAL)))

# ---------- 29. policy review table: JOIN frozen core artifacts ----------
ECON = list(csv.DictReader(open(f"{RESULTS}/economy-reference-surface.csv")))
PUR = list(csv.DictReader(open(f"{RESULTS}/purchase-surface.csv")))
PRIM = list(csv.DictReader(open(f"{RESULTS}/primary-distribution.csv")))
LOAD = list(csv.DictReader(open(f"{RESULTS}/conditional-loadouts.csv")))

def key(row, side, lr, rv, M):
    return (row["side"] == side and row["lossReward"] == str(lr)
            and row["retained_value"] == rv and row["roundStartMoney"] == str(M))

PR = []
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        for rv in ["none"] + sorted({r["retained_value"] for r in ECON
                                     if r["retained_value"] not in ("none",)}):
            for M in sorted({int(r["roundStartMoney"]) for r in ECON
                             if r["side"] == side and r["lossReward"] == str(lr)
                             and r["retained_value"] == rv}):
                if M < 800 or M > 6000:
                    continue
                e = next((r for r in ECON if key(r, side, lr, rv, M)), None)
                p = next((r for r in PUR if key(r, side, lr, rv, M)), None)
                if e is None or p is None:
                    continue
                # only supported states enter decision cards
                if e["confidence"] in ("EXTRAPOLATED", "LOW_SUPPORT"):
                    continue
                if p["confidence"] in ("EXTRAPOLATED", "LOW_SUPPORT", "") or p["spend_p90"] == "":
                    continue
                probs = [float(e["p_" + t]) for t in ["pistol", "eco", "semi", "force", "full"]]
                econ_ent = entropy_from_probs(probs)
                prims = [r for r in PRIM if key(r, side, lr, rv, M)]
                prims.sort(key=lambda r: -float(r["weighted_probability"]))
                prim3 = ";".join("{}:{:.0f}%".format(r["weapon"], 100 * float(r["weighted_probability"]))
                                 for r in prims[:3])
                load = [r for r in LOAD if key(r, side, lr, rv, M)]
                load.sort(key=lambda r: int(r["rank"]))
                top3c = load[:3]
                top3_mass = float(load[0]["topK_mass"]) if load else 0.0
                c3 = ";".join("{}|{}|a{}h{}k{}|sm{}fl{}HE{}fr{}".format(
                    c["primary"], c["secondary_exact"], c["armor"], c["helmet"], c["defusekit"],
                    c["smoke"], c["flash_count"], c["HE"], c["fire"]) for c in top3c)
                PR.append([side, lr, rv, M, e["confidence"], e["exact_n"], e["effective_n"],
                           e["nearest_observed_distance"], e["estimate_level"],
                           p["spend_p25"], p["spend_median"], p["spend_p75"], "",
                           min(16000, M + lr),
                           min(16000, M - int(float(p["spend_median"] or 0)) + lr),
                           min(16000, M - int(float(p["spend_median"] or 0)) + lr + 600) if side == "t" else "",
                           prim3,
                           p["armor_prob"], p["helmet_prob"], p["defusekit_prob"],
                           p["smoke_prob"], p["flash1plus_prob"], p["flash2_prob"],
                           p["HE_prob"], p["fire_prob"],
                           round(econ_ent, 3), round(top3_mass, 3), c3])
with open(f"{RESULTS}/policy-review-table.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "retained_value", "roundStartMoney", "confidence",
                "exact_n", "effective_n", "nearest_observed_distance", "estimate_level",
                "spend_p25", "spend_median", "spend_p75", "bank_after_buy_median",
                "nextIfLoseNoSpend", "nextIfLoseAfterMedianSpend", "nextIfLoseAfterMedianSpendAndPlant",
                "top3_primary", "armor_prob", "helmet_prob", "defusekit_prob", "smoke_prob",
                "flash1plus_prob", "flash2_prob", "HE_prob", "fire_prob",
                "economy_entropy", "top3_loadout_mass", "top3_loadouts"])
    w.writerows(PR)
print("29 done: review table rows", len(PR))
