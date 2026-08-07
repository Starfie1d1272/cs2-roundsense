#!/usr/bin/env python3
"""RoundSense Final Professional Economy Analysis Pipeline — build stage.

Single reproducible offline pipeline producing professional economy &
purchase reference surfaces with hard invariants. READ-ONLY on the corpus;
writes generated artifacts to /tmp/roundsense-economy-analysis-final/.

Usage:
    python3 build_final_surface.py [corpus.json] [dak-weapons.ts]

Run audit_final_surface.py afterwards for the full gate.
"""
import json, csv, math, os, sys, re
from collections import Counter

# ---------- configuration ----------
BASE = "/tmp/roundsense-cologne-policy"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "cologne-2026")
DAK_WEAPONS = os.path.expanduser(
    "~/GitHub/cs2-demo-analysis-kit/packages/presentation/src/weapons.ts")

CORPUS = sys.argv[1] if len(sys.argv) > 1 else f"{BASE}/player-rounds.json"
os.makedirs(OUT, exist_ok=True)

# ---------- 0. data contract ----------
ROWS = json.load(open(CORPUS))

def norm_grenades(v):
    if isinstance(v, str):
        try:
            parsed = json.loads(v)
        except Exception:
            raise ValueError("DATA_ERROR: grenades JSON string parse failed")
        if not isinstance(parsed, list):
            raise ValueError("DATA_ERROR: grenades JSON parsed to non-list")
        return parsed
    if not isinstance(v, list):
        raise ValueError("DATA_ERROR: grenades not a list")
    return v

for r in ROWS:
    r["grenades"] = norm_grenades(r["grenades"])
    r["retainedGrenades"] = norm_grenades(r["retainedGrenades"])

def drop_flags(r):
    nv = max(0, r["estLoadoutValue"] - r["estRetainedValue"])
    return (r["moneySpent"] > nv + 800, nv > r["moneySpent"] + 800)

STRICT = [r for r in ROWS if not r["overtime"]
          and not drop_flags(r)[0] and not drop_flags(r)[1]
          and not r["lossIndexAmbiguous"]]
# mutually exclusive exclusion categories via ordered classification:
# overtime -> drop_gave (incl. both-flagged) -> drop_received ->
# loss_index_ambiguous -> strict. Sum must equal raw count.
from collections import Counter as _Counter
_cats = _Counter()
for _r in ROWS:
    if _r["overtime"]:
        _cats["overtime"] += 1
    elif drop_flags(_r)[0]:
        _cats["drop_gave"] += 1
    elif drop_flags(_r)[1]:
        _cats["drop_received"] += 1
    elif _r["lossIndexAmbiguous"]:
        _cats["loss_index_ambiguous"] += 1
    else:
        _cats["strict"] += 1
EXCL = {"raw": len(ROWS), **dict(_cats)}
assert EXCL["strict"] == 25986, f"STRICT count mismatch: {EXCL['strict']} != 25986"
assert sum(v for k, v in EXCL.items() if k != "raw") == len(ROWS), \
    "exclusion categories do not partition raw corpus"

# ---------- 1. lossReward: unique mapping ----------
LOSS_REWARDS = [1400, 1900, 2400, 2900, 3400]
def loss_reward(idx):
    return LOSS_REWARDS[max(0, min(int(idx), 4))]
for i, expected in enumerate([1400, 1900, 2400, 2900, 3400]):
    assert loss_reward(i) == expected, f"lossReward({i}) != {expected}"

# ---------- 2. corrected retained ----------
prev_map = {}
for r in ROWS:
    prev_map[(r["map"], r["roundNumber"], r["playerIndex"])] = r

for r in STRICT:
    if r["roundNumber"] == 13:
        r["correctedRetainedPrimary"] = None
    elif (r["retainedPrimary"] and r["primary"] is None
          and 200 <= r["moneySpent"] <= 800):
        p = prev_map.get((r["map"], r["roundNumber"] - 1, r["playerIndex"]))
        if p and p["primary"]:
            r["correctedRetainedPrimary"] = "UNKNOWN"
        else:
            r["correctedRetainedPrimary"] = r["retainedPrimary"]
    else:
        r["correctedRetainedPrimary"] = r["retainedPrimary"]

# hard asserts (after metadata load, below)
r13_inherited = [r for r in STRICT if r["roundNumber"] == 13
                 and r["correctedRetainedPrimary"] not in (None, "UNKNOWN")]
assert len(r13_inherited) == 0, "r13 retained must be None"

# ---------- 3. weapon taxonomy from canonical DAK weapons.ts ----------
SRC = open(DAK_WEAPONS, encoding="utf-8").read()
FAMILY = {}   # weapon display name -> family (DAK comment group)
NAME_ALIAS = {}  # normalized code -> display name
cur_family = None
FAMILY_GROUPS = {"Rifles": "rifle", "Snipers": "sniper", "Pistols": "pistol",
                 "冲锋枪": "smg", "Heavy": "heavy", "Equipment / utility": "equipment"}
for line in SRC.splitlines():
    stripped = line.strip()
    if stripped.startswith("//") and not stripped.startswith("// "):
        # "//Rifles" style header without space
        g = stripped[2:].strip()
        if g in FAMILY_GROUPS:
            cur_family = FAMILY_GROUPS[g]
        continue
    m = re.match(r"\s*//\s*(.+)$", line)  # full comment line (ASCII or CJK)
    if m and not line.strip().startswith("export"):
        g = m.group(1).strip()
        if g in FAMILY_GROUPS:
            cur_family = FAMILY_GROUPS[g]
        continue
    m = re.match(r'\s*(\w+):\s*"([^"]+)"', line)
    if m and cur_family:
        code, name = m.group(1), m.group(2)
        NAME_ALIAS[code] = name
        FAMILY[name] = cur_family
# hard assertions: exact family mapping from canonical DAK source
FAMILY_ASSERTS = {"AK-47": "rifle", "M4A4": "rifle", "M4A1-S": "rifle",
                  "AWP": "sniper", "SSG 08": "sniper",
                  "MP9": "smg", "MAC-10": "smg", "MP7": "smg", "MP5-SD": "smg",
                  "Desert Eagle": "pistol"}
for _w, _f in FAMILY_ASSERTS.items():
    assert _w in FAMILY and FAMILY[_w] == _f, \
        f"weapon family parse failed: {_w} -> {FAMILY.get(_w)} expected {_f}"
assert FAMILY.get("SSG 08") == "sniper", "SSG08 must be sniper, not rifle"

def weapon_family(w):
    return FAMILY.get(w, "other")

_LONG_GUNS = {w for w, f in FAMILY.items() if f in ("rifle", "sniper", "smg")}

# retained asserts (post-metadata)
pistol_long = [r for r in STRICT if r["actionType"] == "pistol"
               and r["correctedRetainedPrimary"] in _LONG_GUNS]
assert len(pistol_long) == 0, f"pistol + corrected retained long gun: {len(pistol_long)}"
r13_inherited = [r for r in STRICT if r["roundNumber"] == 13
                 and r["correctedRetainedPrimary"] not in (None, "UNKNOWN")]
assert len(r13_inherited) == 0, "r13 retained must be None"

# ---------- grenade hard asserts ----------
for r in STRICT:
    n = len(r["grenades"])
    fl = r["grenades"].count("flashbang")
    assert 0 <= n <= 4, f"grenade count {n} out of [0,4]"
    assert fl <= 2, f"flash count {fl} > 2"
GRENADE_DIST_STRICT = Counter(len(r["grenades"]) for r in STRICT)

# ---------- 4. decision state / estimator core ----------
def eff_n(ws):
    s1 = sum(ws); s2 = sum(w * w for w in ws)
    return s1 * s1 / s2 if s2 else 0.0

def weights_at(pool, M, ne_t=100, h_min=20, h_max=500):
    """pool: list of (money, row). Returns (ws, h, ne)."""
    h = h_min
    while h <= h_max:
        ws = [math.exp(-((m - M) ** 2) / (2 * h * h)) for m, _ in pool]
        if eff_n(ws) >= ne_t:
            return ws, h, eff_n(ws)
        h += 10
    ws = [math.exp(-((m - M) ** 2) / (2 * h_max * h_max)) for m, _ in pool]
    return ws, h_max, eff_n(ws)

def retained_pool(side, lr, retained):
    """exact -> family -> unsupported. NEVER no-retained fallback."""
    if retained in (None, "UNKNOWN"):
        return None, "unsupported"
    exact = [(r["startMoney"], r) for r in STRICT
             if r["side"] == side and loss_reward(r["lossIndex"]) == lr
             and r["correctedRetainedPrimary"] == retained]
    if len(exact) >= 40:
        return exact, "exact"
    f = weapon_family(retained)
    fam_rows = [(r["startMoney"], r) for r in STRICT
                if r["side"] == side and loss_reward(r["lossIndex"]) == lr
                and r["correctedRetainedPrimary"] not in (None, "UNKNOWN")
                and weapon_family(r["correctedRetainedPrimary"]) == f]
    if len(fam_rows) >= 40:
        return fam_rows, "family"
    return None, "unsupported"

def confidence_for(M, pool, ne, exact_n, nearest):
    if ne < 20: return "LOW_SUPPORT"
    obs = [m for m, _ in pool]
    if M < min(obs) or M > max(obs): return "EXTRAPOLATED"
    if exact_n > 0: return "OBSERVED"
    if nearest > 200: return "INTERPOLATED_WIDE"
    return "INTERPOLATED"

def wquant(vals, ws, q):
    pairs = sorted(zip(vals, ws))
    tot = sum(w for _, w in pairs)
    acc = 0.0
    for v, w in pairs:
        acc += w
        if acc / tot >= q:
            return v
    return pairs[-1][0] if pairs else 0

def wprob(rows, ws, pred):
    s = sum(w for r, w in zip(rows, ws) if pred(r))
    t = sum(ws)
    return s / t if t else 0.0

def wdist(rows, ws, keyfn):
    agg = Counter()
    for r, w in zip(rows, ws):
        agg[keyfn(r)] += w
    tot = sum(agg.values())
    return {k: v / tot for k, v in agg.items()}

def emit_loadouts(rows, ws, ne, conf, side, lr, level, rv, M):
    """Shared conditional-loadout emission for none/exact/family states.
    Returns (top10_count, topk_mass)."""
    combos = Counter()
    for r, w in zip(rows, ws):
        g2 = r["grenades"]
        sec = "paid" if r["secondary"] in PAID_PISTOLS else ("default" if r["secondary"] in DEFAULT_PISTOLS else ("none" if not r["secondary"] else r["secondary"]))
        key = (r["primary"] or "none", r["secondary"] or "none", sec,
               bool(r["hasArmor"]), bool(r["hasHelmet"]), bool(r["hasDefuseKit"]),
               "smoke" in g2, g2.count("flashbang"), "hegrenade" in g2,
               ("molotov" in g2) or ("incendiary" in g2))
        combos[key] += w
    tot = sum(combos.values())
    top10 = combos.most_common(10)
    topk_mass = sum(c for _, c in top10) / tot
    for rank, ((pr, sec_ex, sec_kind, ar, he, kit, sm, fl, hev, fire), c) in enumerate(top10, 1):
        LOAD.append([side, lr, level, rv, M, rank, round(c / tot, 4), round(topk_mass, 4),
                     round(1 - topk_mass, 4), pr, sec_ex, sec_kind, int(ar), int(he), int(kit),
                     int(sm), fl, int(hev), int(fire), round(ne, 1), conf])
    return len(top10), topk_mass

TYPES = ["pistol", "eco", "semi", "force", "full"]
DEFAULT_PISTOLS = {"Glock-18", "USP-S", "P2000"}
PAID_PISTOLS = {"P250", "Dual Berettas", "Tec-9", "CZ75-Auto", "Five-SeveN", "Desert Eagle", "R8 Revolver"}

# ---------- 5. build surfaces ----------
GRID = list(range(0, 16001, 50))
NONE_RETAINED = None  # "no primary retained" state — the only no-retained pool
ALL_LRS = [1400, 1900, 2400, 2900, 3400]

ECON, PURCH, PRIM, SEC, LOAD = [], [], [], [], []
RETAINED_SCAN = []  # retained-coverage rows

for side in ["t", "ct"]:
    for lr in ALL_LRS:
        # retained = none state (correctedRetainedPrimary is None)
        pool, level = retained_pool(side, lr, None) if False else (None, None)
        base = [(r["startMoney"], r) for r in STRICT
                if r["side"] == side and loss_reward(r["lossIndex"]) == lr
                and r["correctedRetainedPrimary"] is None]
        if len(base) >= 40:
            level = "none"
        else:
            continue
        obs_set = {m for m, _ in base}
        for M in GRID:
            rows = [r for _, r in base]
            ws, h, ne = weights_at(base, M)
            exact_n = sum(1 for m, _ in base if m == M)
            nearest = min(abs(m - M) for m, _ in base)
            conf = confidence_for(M, base, ne, exact_n, nearest)
            probs = {t: wprob(rows, ws, lambda r, t=t: r["actionType"] == t) for t in TYPES}
            assert abs(sum(probs.values()) - 1) < 0.01
            ECON.append([side, lr, level, "none", M, M in obs_set, exact_n, len(base),
                         round(ne, 1), nearest, h,
                         round(probs["pistol"], 3), round(probs["eco"], 3), round(probs["semi"], 3),
                         round(probs["force"], 3), round(probs["full"], 3), conf])
            # ---- purchase surface: budget feasibility conditioning ----
            feas = [(m, r) for m, r in base if r["moneySpent"] <= M]
            if len(feas) < 30:
                PURCH.append([side, lr, level, "none", M, M in obs_set, 0, len(base), 0, None, 500,
                              None, None, None, None, None, None, None, None, None, None, None, None, None, None,
                              "LOW_SUPPORT"])
                continue
            wsf, hf, nef = weights_at(feas, M)
            exact_f = sum(1 for m, _ in feas if m == M)
            nearest_f = min(abs(m - M) for m, _ in feas)
            conf_f = confidence_for(M, feas, nef, exact_f, nearest_f)
            if nef < 20:
                PURCH.append([side, lr, level, "none", M, M in obs_set, exact_f, len(feas), round(nef, 1), nearest_f, hf,
                              None, None, None, None, None, None, None, None, None, None, None, None, None, None,
                              "LOW_SUPPORT"])
                continue
            frows = [r for _, r in feas]
            spends = [r["moneySpent"] for r in frows]
            g = [r["grenades"] for r in frows]
            gc_mean = sum(w * len(gg) for w, gg in zip(wsf, g)) / sum(wsf)
            PURCH.append([side, lr, level, "none", M, M in obs_set, exact_f, len(feas), round(nef, 1), nearest_f, hf,
                          round(sum(w * s for w, s in zip(wsf, spends)) / sum(wsf), 0),
                          wquant(spends, wsf, 0.5), wquant(spends, wsf, 0.25), wquant(spends, wsf, 0.75),
                          wquant(spends, wsf, 0.9),
                          round(wprob(frows, wsf, lambda r: bool(r["hasArmor"])), 3),
                          round(wprob(frows, wsf, lambda r: bool(r["hasHelmet"])), 3),
                          round(wprob(frows, wsf, lambda r: bool(r["hasDefuseKit"])), 3),
                          round(wprob(frows, wsf, lambda r: "smoke" in r["grenades"]), 3),
                          round(wprob(frows, wsf, lambda r: r["grenades"].count("flashbang") >= 1), 3),
                          round(wprob(frows, wsf, lambda r: r["grenades"].count("flashbang") >= 2), 3),
                          round(wprob(frows, wsf, lambda r: "hegrenade" in r["grenades"]), 3),
                          round(wprob(frows, wsf, lambda r: ("molotov" in r["grenades"]) or ("incendiary" in r["grenades"])), 3),
                          round(gc_mean, 2),
                          conf_f])
            # exact weapon marginals (feasibility pool)
            pd = wdist(frows, wsf, lambda r: r["primary"] or "none")
            sd = wdist(frows, wsf, lambda r: r["secondary"] or "none")
            for w, p in pd.items():
                PRIM.append([side, lr, level, "none", M, w, round(p, 4), round(nef, 1), conf_f])
            for w, p in sd.items():
                SEC.append([side, lr, level, "none", M, w, round(p, 4), round(nef, 1), conf_f])
            # conditional loadouts top10 (shared path)
            emit_loadouts(frows, wsf, nef, conf_f, side, lr, level, "none", M)

        # ---- retained-conditioned (exact / family / unsupported) ----
        all_retained = sorted({r["correctedRetainedPrimary"] for r in STRICT
                               if r["side"] == side and r["correctedRetainedPrimary"] not in (None, "UNKNOWN")})
        for rw in all_retained:
            pool2, level2 = retained_pool(side, lr, rw)
            if pool2 is None:
                RETAINED_SCAN.append([side, lr, rw, weapon_family(rw), 0, 0, "unsupported"])
                continue
            exact_cnt = sum(1 for r in STRICT if r["side"] == side
                            and loss_reward(r["lossIndex"]) == lr
                            and r["correctedRetainedPrimary"] == rw)
            RETAINED_SCAN.append([side, lr, rw, weapon_family(rw), exact_cnt, len(pool2), level2])
            obs2 = {m for m, _ in pool2}
            for M in GRID:
                rows2 = [r for _, r in pool2]
                ws2, h2, ne2 = weights_at(pool2, M)
                exact2 = sum(1 for m, _ in pool2 if m == M)
                nearest2 = min(abs(m - M) for m, _ in pool2)
                conf2 = confidence_for(M, pool2, ne2, exact2, nearest2)
                probs2 = {t: wprob(rows2, ws2, lambda r, t=t: r["actionType"] == t) for t in TYPES}
                ECON.append([side, lr, level2, rw, M, M in obs2, exact2, len(pool2),
                             round(ne2, 1), nearest2, h2,
                             round(probs2["pistol"], 3), round(probs2["eco"], 3), round(probs2["semi"], 3),
                             round(probs2["force"], 3), round(probs2["full"], 3), conf2])
                feas2 = [(m, r) for m, r in pool2 if r["moneySpent"] <= M]
                if len(feas2) < 30:
                    continue
                wsf2, hf2, nef2 = weights_at(feas2, M)
                if nef2 < 20:
                    continue
                frows2 = [r for _, r in feas2]
                spends2 = [r["moneySpent"] for r in frows2]
                g2l = [r["grenades"] for r in frows2]
                gc2 = sum(w * len(gg) for w, gg in zip(wsf2, g2l)) / sum(wsf2)
                exact_f2 = sum(1 for m, _ in feas2 if m == M)
                nearest_f2 = min(abs(m - M) for m, _ in feas2)
                conf_f2 = confidence_for(M, feas2, nef2, exact_f2, nearest_f2)
                PURCH.append([side, lr, level2, rw, M, M in obs2, exact_f2, len(feas2), round(nef2, 1), nearest_f2, hf2,
                              round(sum(w * s for w, s in zip(wsf2, spends2)) / sum(wsf2), 0),
                              wquant(spends2, wsf2, 0.5), wquant(spends2, wsf2, 0.25), wquant(spends2, wsf2, 0.75),
                              wquant(spends2, wsf2, 0.9),
                              round(wprob(frows2, wsf2, lambda r: bool(r["hasArmor"])), 3),
                              round(wprob(frows2, wsf2, lambda r: bool(r["hasHelmet"])), 3),
                              round(wprob(frows2, wsf2, lambda r: bool(r["hasDefuseKit"])), 3),
                              round(wprob(frows2, wsf2, lambda r: "smoke" in r["grenades"]), 3),
                              round(wprob(frows2, wsf2, lambda r: r["grenades"].count("flashbang") >= 1), 3),
                              round(wprob(frows2, wsf2, lambda r: r["grenades"].count("flashbang") >= 2), 3),
                              round(wprob(frows2, wsf2, lambda r: "hegrenade" in r["grenades"]), 3),
                              round(wprob(frows2, wsf2, lambda r: ("molotov" in r["grenades"]) or ("incendiary" in r["grenades"])), 3),
                              round(gc2, 2),
                              conf_f2])
                pd2 = wdist(frows2, wsf2, lambda r: r["primary"] or "none")
                sd2 = wdist(frows2, wsf2, lambda r: r["secondary"] or "none")
                for w, p in pd2.items():
                    PRIM.append([side, lr, level2, rw, M, w, round(p, 4), round(nef2, 1), conf_f2])
                for w, p in sd2.items():
                    SEC.append([side, lr, level2, rw, M, w, round(p, 4), round(nef2, 1), conf_f2])
                # conditional loadouts top10 (shared path — retained states too)
                emit_loadouts(frows2, wsf2, nef2, conf_f2, side, lr, level2, rw, M)

# ---------- write CSVs ----------
def write_csv(path, header, rows):
    bad = [i for i, r in enumerate(rows) if len(r) != len(header)]
    if bad:
        raise SystemExit(f"SCHEMA FAIL {path}: {len(bad)} rows (first row {bad[0]})")
    with open(path, "w", newline="") as f:
        w = csv.writer(f); w.writerow(header); w.writerows(rows)
    print(f"{path}: {len(rows)} rows")

write_csv(f"{OUT}/economy-reference-surface.csv",
          ["side", "lossReward", "estimate_level", "retained_value", "roundStartMoney",
           "isObservedMoney", "exact_n", "pool_n", "effective_n", "nearest_observed_distance",
           "bandwidth", "p_pistol", "p_eco", "p_semi", "p_force", "p_full", "confidence"], ECON)
write_csv(f"{OUT}/purchase-surface.csv",
          ["side", "lossReward", "estimate_level", "retained_value", "roundStartMoney",
           "isObservedMoney", "exact_n", "pool_n", "effective_n", "nearest_observed_distance",
           "bandwidth", "spend_mean", "spend_median", "spend_p25", "spend_p75", "spend_p90",
           "armor_prob", "helmet_prob", "defusekit_prob", "smoke_prob", "flash1plus_prob",
           "flash2_prob", "HE_prob", "fire_prob", "grenade_count_mean", "confidence"], PURCH)
write_csv(f"{OUT}/primary-distribution.csv",
          ["side", "lossReward", "estimate_level", "retained_value", "roundStartMoney",
           "weapon", "weighted_probability", "effective_n", "confidence"], PRIM)
write_csv(f"{OUT}/secondary-distribution.csv",
          ["side", "lossReward", "estimate_level", "retained_value", "roundStartMoney",
           "weapon", "weighted_probability", "effective_n", "confidence"], SEC)
write_csv(f"{OUT}/conditional-loadouts.csv",
          ["side", "lossReward", "estimate_level", "retained_value", "roundStartMoney", "rank",
           "weighted_probability", "topK_mass", "residual_mass", "primary", "secondary_exact",
           "secondary_kind", "armor", "helmet", "defusekit", "smoke", "flash_count",
           "HE", "fire", "effective_n", "confidence"], LOAD)
write_csv(f"{OUT}/retained-coverage.csv",
          ["side", "lossReward", "retained_weapon", "family", "exact_n", "pool_n", "estimate_level"], RETAINED_SCAN)

# raw ambiguous-flag count (non-OT; may overlap drop flags) vs exclusive partition count
RAW_AMBIG = sum(1 for r in ROWS if r["lossIndexAmbiguous"] and not r["overtime"])
json.dump({"exclusions": EXCL, "raw_ambiguous_flag_count": RAW_AMBIG,
           "exclusive_ambiguity_only": EXCL["loss_index_ambiguous"],
           "grenade_dist_strict": dict(GRENADE_DIST_STRICT),
           "weapon_families": {_w: FAMILY[_w] for _w in FAMILY_ASSERTS}},
          open(f"{OUT}/_meta.json", "w"), indent=1)

# ---------- spot-check states (retained none) ----------
def spot(side, lr, M, rv="none"):
    p = None
    for r in PURCH:
        if (r[0] == side and r[1] == lr and r[4] == M and r[3] == rv):
            p = r; break
    if p is None or p[25] == "LOW_SUPPORT":
        print(f"{side.upper()} lr{lr} ${M} {rv}: UNSUPPORTED")
        return
    e = None
    for r in ECON:
        if (r[0] == side and r[1] == lr and r[4] == M and r[3] == rv):
            e = r; break
    if e is None:
        print(f"{side.upper()} lr{lr} ${M} {rv}: no economy row")
        return
    print(f"\n=== {side.upper()} · lr{lr} · ${M} · retained {rv} ===")
    print(f"  evidence: conf={e[16]} ne={e[8]} bw=${e[10]} nearest=${e[9]}")
    print(f"  economy:  eco {float(e[12])*100:.0f}%  semi {float(e[13])*100:.0f}%  force {float(e[14])*100:.0f}%  full {float(e[15])*100:.0f}%")
    print(f"  spend:    median ${p[12]}  p25 ${p[13]}  p75 ${p[14]}  p90 ${p[15]}")
    print(f"  primary:  " + ", ".join(f"{x[5]} {float(x[6])*100:.1f}%" for x in PRIM
                                      if x[0] == side and x[1] == lr and x[3] == rv and x[4] == M)[:120])
    print(f"  equip:    armor {float(p[16])*100:.0f}%  helmet {float(p[17])*100:.0f}%  kit {float(p[18])*100:.0f}%")
    print(f"  utility:  smoke {float(p[19])*100:.0f}%  flash>=1 {float(p[20])*100:.0f}%  flash2 {float(p[21])*100:.0f}%  HE {float(p[22])*100:.0f}%  fire {float(p[23])*100:.0f}%  gc {p[24]}")
    tops = [x for x in LOAD if x[0] == side and x[1] == lr and x[2] == rv and x[3] == M][:5]
    print(f"  top configs (mass {tops[0][6] if tops else '-'}/res {tops[0][7] if tops else '-'}):")
    for x in tops:
        print(f"    #{x[4]} {x[8]} | {x[9]} | a{x[11]} h{x[12]} k{x[13]} | sm{x[14]} fl{x[15]} HE{x[16]} fr{x[17]}  {float(x[5])*100:.1f}%")

for side, lr, Ms in [("t", 1900, [3000, 3500, 3800, 4000, 4500, 5000]),
                      ("t", 2400, [2500, 3000, 3500, 4000]),
                      ("ct", 1900, [3000, 3500, 3800, 4000, 4500]),
                      ("ct", 2400, [2500, 3000, 3500, 4000])]:
    for M in Ms:
        spot(side, lr, M)

print("\nBUILD STAGE COMPLETE — run audit_final_surface.py for the full gate")
