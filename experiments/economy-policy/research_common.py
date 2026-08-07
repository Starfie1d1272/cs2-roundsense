#!/usr/bin/env python3
"""Shared data layer for all economy research scripts (closeout-frozen).

Imported by build/plot/audit/research scripts. Logic is copied verbatim
from the audited build_final_surface.py — do not redesign here.
"""
import json, math, os, re
from collections import Counter

BASE = os.environ.get("ROUNDSENSE_CORPUS_DIR", "/tmp/roundsense-cologne-policy")
RESULTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "results", "cologne-2026"))
DAK_WEAPONS = os.path.expanduser(
    "~/GitHub/cs2-demo-analysis-kit/packages/presentation/src/weapons.ts")

# ---------- corpus ----------
def load_rows(path=None):
    p = path or f"{BASE}/player-rounds.json"
    return json.load(open(p))

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

def drop_flags(r):
    nv = max(0, r["estLoadoutValue"] - r["estRetainedValue"])
    return (r["moneySpent"] > nv + 800, nv > r["moneySpent"] + 800)

LOSS_REWARDS = [1400, 1900, 2400, 2900, 3400]
def loss_reward(idx):
    return LOSS_REWARDS[max(0, min(int(idx), 4))]

# ---------- weapon taxonomy (canonical DAK) ----------
FAMILY_GROUPS = {"Rifles": "rifle", "Snipers": "sniper", "Pistols": "pistol",
                 "冲锋枪": "smg", "Heavy": "heavy", "Equipment / utility": "equipment"}
def load_weapon_families(src=None):
    SRC = open(src or DAK_WEAPONS, encoding="utf-8").read()
    FAMILY = {}
    cur_family = None
    for line in SRC.splitlines():
        stripped = line.strip()
        if stripped.startswith("//") and not stripped.startswith("// "):
            g = stripped[2:].strip()
            if g in FAMILY_GROUPS:
                cur_family = FAMILY_GROUPS[g]
            continue
        m = re.match(r"\s*//\s*(.+)$", line)
        if m and not line.strip().startswith("export"):
            g = m.group(1).strip()
            if g in FAMILY_GROUPS:
                cur_family = FAMILY_GROUPS[g]
            continue
        m = re.match(r'\s*(\w+):\s*"([^"]+)"', line)
        if m and cur_family:
            FAMILY[m.group(2)] = cur_family
    FAMILY_ASSERTS = {"AK-47": "rifle", "M4A4": "rifle", "M4A1-S": "rifle",
                      "AWP": "sniper", "SSG 08": "sniper",
                      "MP9": "smg", "MAC-10": "smg", "MP7": "smg", "MP5-SD": "smg",
                      "Desert Eagle": "pistol"}
    for w, f in FAMILY_ASSERTS.items():
        assert FAMILY.get(w) == f, f"weapon family parse failed: {w} -> {FAMILY.get(w)}"
    return FAMILY

# ---------- dataset ----------
def build_dataset(rows=None):
    """Returns (STRICT, FAMILY) with corrected retained etc. (frozen logic)."""
    rows = rows if rows is not None else load_rows()
    for r in rows:
        r["grenades"] = norm_grenades(r["grenades"])
        r["retainedGrenades"] = norm_grenades(r["retainedGrenades"])
    STRICT = [r for r in rows if not r["overtime"]
              and not drop_flags(r)[0] and not drop_flags(r)[1]
              and not r["lossIndexAmbiguous"]]
    assert len(STRICT) == 25986, f"STRICT count mismatch: {len(STRICT)}"
    prev_map = {}
    for r in rows:
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
        r["_lr"] = loss_reward(r["lossIndex"])
    FAMILY = load_weapon_families()
    _LONG_GUNS = {w for w, f in FAMILY.items() if f in ("rifle", "sniper", "smg")}
    pistol_long = [r for r in STRICT if r["actionType"] == "pistol"
                   and r["correctedRetainedPrimary"] in _LONG_GUNS]
    assert len(pistol_long) == 0, f"pistol + corrected retained long gun: {len(pistol_long)}"
    return STRICT, FAMILY

# ---------- estimator ----------
def eff_n(ws):
    s1 = sum(ws); s2 = sum(w * w for w in ws)
    return s1 * s1 / s2 if s2 else 0.0

def weights_at(pool, M, ne_t=100, h_min=20, h_max=500):
    h = h_min
    while h <= h_max:
        ws = [math.exp(-((m - M) ** 2) / (2 * h * h)) for m, _ in pool]
        if eff_n(ws) >= ne_t:
            return ws, h, eff_n(ws)
        h += 10
    ws = [math.exp(-((m - M) ** 2) / (2 * h_max * h_max)) for m, _ in pool]
    return ws, h_max, eff_n(ws)

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

def retained_pool(STRICT, FAMILY, side, lr, retained):
    """exact -> family -> None (unsupported). NEVER no-retained fallback.
    Only for REAL exact retained weapons."""
    if retained in (None, "UNKNOWN"):
        return None, "unsupported"
    exact = [(r["startMoney"], r) for r in STRICT
             if r["side"] == side and r["_lr"] == lr
             and r["correctedRetainedPrimary"] == retained]
    if len(exact) >= 40:
        return exact, "exact"
    f = FAMILY.get(retained, "other")
    fam_rows = [(r["startMoney"], r) for r in STRICT
                if r["side"] == side and r["_lr"] == lr
                and r["correctedRetainedPrimary"] not in (None, "UNKNOWN")
                and FAMILY.get(r["correctedRetainedPrimary"], "other") == f]
    if len(fam_rows) >= 40:
        return fam_rows, "family"
    return None, "unsupported"

def no_retained_pool(STRICT, side, lr):
    """The no-retained state (correctedRetainedPrimary is None).
    NEVER call retained_pool(..., None) — it returns unsupported."""
    return [(r["startMoney"], r) for r in STRICT
            if r["side"] == side and r["_lr"] == lr
            and r["correctedRetainedPrimary"] is None]

def entropy_from_counts(counts):
    """Normalized entropy from RAW COUNTS (never raw counts into entropy()).
    Returns bits in [0, log2(n_classes)]."""
    total = sum(counts.values())
    if total <= 0:
        return 0.0
    ps = [v / total for v in counts.values() if v > 0]
    return -sum(p * math.log2(p) for p in ps)

def entropy_from_probs(ps):
    """Entropy from a probability distribution (values must already sum to 1)."""
    return -sum(p * math.log2(p) for p in ps if p > 0)

def load_prices(results_dir=None):
    """Canonical prices JSON (exported by export_prices.ts)."""
    d = results_dir or RESULTS
    return json.load(open(f"{d}/_prices.json"))

DEFAULT_PISTOLS = {"Glock-18", "USP-S", "P2000"}
PAID_PISTOLS = {"P250", "Dual Berettas", "Tec-9", "CZ75-Auto", "Five-SeveN", "Desert Eagle", "R8 Revolver"}
TYPES = ["pistol", "eco", "semi", "force", "full"]
