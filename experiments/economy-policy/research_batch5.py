#!/usr/bin/env python3
"""Research batch 5: purchase-cost reconstruction (5), affordability (8),
policy review table (29). Prices come from exported canonical rules."""
import csv, json, os, sys
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import (build_dataset, wprob, wquant, weights_at, retained_pool,
                             DEFAULT_PISTOLS, PAID_PISTOLS, RESULTS)

STRICT, FAMILY = build_dataset()
P = json.load(open(f"{RESULTS}/_prices.json"))
PRICES = dict(P["prices"])
WPRICE = P["weaponPrices"]
I2W = P["itemToWeapon"]
# weapon display name -> price (via item id)
NAME_PRICE = {}
for item, wid in I2W.items():
    if wid and wid in WPRICE:
        NAME_PRICE.setdefault(item, WPRICE[wid])
GRENADE_PRICES = {"smoke": PRICES.get("smoke", 300), "flashbang": PRICES.get("flash", 200),
                  "hegrenade": PRICES.get("he", 300), "molotov": PRICES.get("molotov", 400),
                  "incendiary": PRICES.get("incendiary", 600), "decoy": PRICES.get("decoy", 50)}
ARMOR = PRICES.get("kevlar", 650)
HELMET_FULL = PRICES.get("kevlar_helmet", 1000)
KIT = PRICES.get("defuser") or PRICES.get("defusekit") or 400

# ---------- 5. purchase-cost reconstruction ----------
# schema: retained (prev freeze loadout) vs resulting — reconstructible deltas
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
    # primary delta cost (weapon swap or upgrade)
    prim_cost = 0
    if res and res != ret:
        prim_cost = NAME_PRICE.get(res, 0)
    # armor delta: boolean retainedArmor -> hasArmor; helmet delta
    armor_cost = 0
    if r["hasArmor"] and not r["retainedArmor"]:
        armor_cost += ARMOR
    if r["hasHelmet"] and not r["retainedHelmet"]:
        armor_cost += HELMET_FULL - ARMOR if r["hasArmor"] else HELMET_FULL
    # grenade delta (count + types)
    rg = Counter(r["retainedGrenades"])
    ng = Counter(r["grenades"])
    grenade_cost = sum(GRENADE_PRICES.get(g, 0) * max(0, ng[g] - rg[g]) for g in set(ng) | set(rg))
    # kit delta
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
      "STRICT rows with corrected retained (exact/family usable): {}".format(n), "",
      "implied delta cost (retained->resulting, canonical prices) vs moneySpent:", "",
      "- exact match (|diff|<=100): {:.1f}% (n={})".format(100 * exact / n, exact),
      "- explainable (<=600): {:.1f}% (n={})".format(100 * explain / n, explain),
      "- unresolved (>600): {:.1f}% (n={})".format(100 * unres / n, unres), "",
      "## unresolved 示例（diff > $600）", ""]
for m, rnd, name, spent, ret, res, diff in examples:
    md.append("- {} r{} {}: spent ${} retained={} resulting={} diff=${}".format(
        m.split("-")[-1], rnd, name, spent, ret, res, diff))
md.append("")
md.append("## 可重建范围")
md.append("- retained→resulting primary 差价 ✓；armor/helmet boolean delta ✓（无数值，按全价）")
md.append("- grenade delta ✓（retainedGrenades vs grenades multiset）")
md.append("- kit delta ✓（retainedKit）")
md.append("- 不可重建：回合中 drop/购买顺序、armor 受损（$350 升级 vs $1000 全价无法区分）")
open(f"{RESULTS}/purchase-cost-reconstruction.md", "w").write("\n".join(md))
print("5 done: exact {:.1f}% explain {:.1f}% unresolved {:.1f}%".format(
    100 * exact / n, 100 * explain / n, 100 * unres / n))

# ---------- 8. affordability targets ----------
RIFLE_ITEMS = {"ak47": 2700, "m4a4": 3100, "m4a1s": 2900, "galil": 1800, "famas": 2050}
def target_cost(name):
    if name == "rifle+armor":
        return min(RIFLE_ITEMS.values()) + ARMOR  # cheapest rifle + kevlar
    if name == "rifle+helmet":
        return min(RIFLE_ITEMS.values()) + HELMET_FULL
    if name == "rifle+armor+smoke+flash":
        return min(RIFLE_ITEMS.values()) + ARMOR + GRENADE_PRICES["smoke"] + GRENADE_PRICES["flashbang"]
    if name == "rifle+armor+smoke+2flash":
        return min(RIFLE_ITEMS.values()) + ARMOR + GRENADE_PRICES["smoke"] + 2 * GRENADE_PRICES["flashbang"]
    if name == "awp+armor":
        return WPRICE.get("weapon_awp", 4750) + ARMOR
    if name == "awp+armor+smoke+flash":
        return WPRICE.get("weapon_awp", 4750) + ARMOR + GRENADE_PRICES["smoke"] + GRENADE_PRICES["flashbang"]
    if name == "smg+armor":
        return min(WPRICE.get("weapon_mp9", 1250), WPRICE.get("weapon_mac10", 1050)) + ARMOR
    if name == "paidpistol+armor":
        return min(PRICES.get("deagle", 700), PRICES.get("tec9", 300)) + ARMOR
    return 0
TARGETS = ["rifle+armor", "rifle+helmet", "rifle+armor+smoke+flash", "rifle+armor+smoke+2flash",
           "awp+armor", "awp+armor+smoke+flash", "smg+armor", "paidpistol+armor"]
AFF = []
for r in STRICT:
    if r["correctedRetainedPrimary"] is not None:
        continue
    next_lose = min(16000, r["startMoney"] - r["moneySpent"] + r["_lr"])
    row = [r["side"], r["_lr"], r["startMoney"], r["moneySpent"], next_lose]
    for t in TARGETS:
        row.append(int(next_lose >= target_cost(t)))
    AFF.append(row)
with open(f"{RESULTS}/affordability-targets.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "startMoney", "moneySpent", "nextIfLoseAfterSpend"] + TARGETS)
    w.writerows(AFF)
md = ["# Affordability Evidence", "",
      "每行：职业实际购买后若本回合输掉，nextIfLoseAfterSpend = min(16000, start - spent + lossReward)。",
      "1 = 下一局可负担该 target（canonical prices，便宜侧武器）。", "",
      "target costs: " + ", ".join("{} ${}".format(t, target_cost(t)) for t in TARGETS), "",
      "affordability-targets.csv 全量；以下为按背景的负担率摘要（下一局可负担 rifle+armor 的占比）：", ""]
for side in ["t", "ct"]:
    for lr in [1900, 2400, 2900]:
        rows_s = [r for r in AFF if r[0] == side and r[1] == lr]
        if not rows_s:
            continue
        rate = sum(r[5] for r in rows_s) / len(rows_s)
        md.append("- {} lr{}: {}% (n={})".format(side.upper(), lr, round(100 * rate), len(rows_s)))
open(f"{RESULTS}/affordability-evidence.md", "w").write("\n".join(md))
print("8 done")

# ---------- 29. policy review table ----------
# per deployable state (retained none, key money): compile the human review row
PR = []
GRID = list(range(1000, 7601, 100))
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        pool = [(r["startMoney"], r) for r in STRICT if r["correctedRetainedPrimary"] is None
                and r["side"] == side and r["_lr"] == lr]
        if len(pool) < 30:
            continue
        for M in GRID:
            feas = [(m, r) for m, r in pool if r["moneySpent"] <= M]
            if len(feas) < 30:
                continue
            ws, h, ne = weights_at(feas, M)
            if ne < 20:
                continue
            rows_f = [r for _, r in feas]
            spends = [r["moneySpent"] for r in rows_f]
            p25, med, p75 = (wquant(spends, ws, 0.25), wquant(spends, ws, 0.5), wquant(spends, ws, 0.75))
            bank = wquant([M - s for s in spends], ws, 0.5)
            next_ns = min(16000, M + lr)
            next_med = min(16000, M - med + lr)
            next_plant = min(16000, M - med + lr + 600) if side == "t" else ""
            pd = Counter()
            for r, w in zip(rows_f, ws):
                pd[r["primary"] or "none"] += w
            top3 = pd.most_common(3)
            pd_t = sum(pd.values())
            prim3 = ";".join("{}:{:.0f}%".format(w, 100 * c / pd_t) for w, c in top3)
            ent = -sum((c / pd_t) * __import__("math").log2(c / pd_t) for c in pd.values() if c > 0)
            combos = Counter()
            for r, w in zip(rows_f, ws):
                g2 = r["grenades"]
                sec = "paid" if r["secondary"] in PAID_PISTOLS else ("default" if r["secondary"] in DEFAULT_PISTOLS else ("none" if not r["secondary"] else r["secondary"]))
                combos[(r["primary"] or "none", sec, bool(r["hasArmor"]), bool(r["hasHelmet"]),
                        bool(r["hasDefuseKit"]), "smoke" in g2, g2.count("flashbang"),
                        "hegrenade" in g2, ("molotov" in g2) or ("incendiary" in g2))] += w
            top3c = combos.most_common(3)
            tc_tot = sum(combos.values())
            top3_mass = sum(c for _, c in top3c) / tc_tot
            c3 = ";".join("{}|a{}h{}|sm{}fl{}".format(p, int(ar), int(he), int(sm), fl)
                          for (p, sec, ar, he, kit, sm, fl, hev, fire), c in top3c)
            PR.append([side, lr, "none", M, ne,
                       p25, med, p75, bank,
                       next_ns, next_med, next_plant,
                       prim3,
                       round(wprob(rows_f, ws, lambda r: bool(r["hasArmor"])), 3),
                       round(wprob(rows_f, ws, lambda r: bool(r["hasHelmet"])), 3),
                       round(wprob(rows_f, ws, lambda r: bool(r["hasDefuseKit"])), 3),
                       round(wprob(rows_f, ws, lambda r: "smoke" in r["grenades"]), 3),
                       round(wprob(rows_f, ws, lambda r: r["grenades"].count("flashbang") >= 1), 3),
                       round(wprob(rows_f, ws, lambda r: r["grenades"].count("flashbang") >= 2), 3),
                       round(wprob(rows_f, ws, lambda r: "hegrenade" in r["grenades"]), 3),
                       round(wprob(rows_f, ws, lambda r: ("molotov" in r["grenades"]) or ("incendiary" in r["grenades"])), 3),
                       round(ent, 3), round(top3_mass, 3), c3])
with open(f"{RESULTS}/policy-review-table.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["side", "lossReward", "retained_value", "roundStartMoney", "effective_n",
                "spend_p25", "spend_median", "spend_p75", "bank_after_buy_median",
                "nextIfLoseNoSpend", "nextIfLoseAfterMedianSpend", "nextIfLoseAfterMedianSpendAndPlant",
                "top3_primary", "armor_prob", "helmet_prob", "defusekit_prob", "smoke_prob",
                "flash1plus_prob", "flash2_prob", "HE_prob", "fire_prob",
                "economy_entropy", "top3_loadout_mass", "top3_loadouts"])
    w.writerows(PR)
print("29 done: review table rows", len(PR))
