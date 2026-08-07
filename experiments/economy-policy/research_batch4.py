#!/usr/bin/env python3
"""Research: representation options benchmark (27) + lookup feasibility (28).
Run with DAK venv python (sklearn)."""
import csv, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import build_dataset, RESULTS

STRICT, FAMILY = build_dataset()

# target: format economy state (professional reference, NOT recommendation)
X, y = [], []
for r in STRICT:
    if r["correctedRetainedPrimary"] is not None:
        continue
    X.append([1 if r["side"] == "t" else 0, r["_lr"], r["startMoney"]])
    y.append(r["actionType"])
X = np.array(X, dtype=float)
CLASSES = ["pistol", "eco", "semi", "force", "full"]
y_idx = np.array([CLASSES.index(v) for v in y])

# 5-fold grouped by match series
import hashlib
def group_of(m):
    return m.rsplit("-m", 1)[0]
folds = np.array([int(hashlib.sha256(group_of(r["map"]).encode()).hexdigest(), 16) % 5
                  for r in STRICT if r["correctedRetainedPrimary"] is None])

from sklearn.tree import DecisionTreeClassifier
from sklearn.metrics import log_loss, accuracy_score, brier_score_loss

def evaluate(clf):
    ll = 0.0
    acc = 0.0
    n = 0
    for f in range(5):
        tr, te = folds != f, folds == f
        clf.fit(X[tr], y_idx[tr])
        proba = clf.predict_proba(X[te])
        ll += log_loss(y_idx[te], proba, labels=list(range(5))) * te.sum()
        acc += accuracy_score(y_idx[te], clf.predict(X[te])) * te.sum()
        n += te.sum()
    return ll / n, acc / n

# surface (exact lookup) baseline: empirical per (side,lr,money//50) cell
from collections import defaultdict, Counter
def surface_eval():
    tbl = defaultdict(Counter)
    pairs = []
    for r in STRICT:
        if r["correctedRetainedPrimary"] is not None:
            continue
        tbl[(r["side"], r["_lr"], r["startMoney"] // 50)][r["actionType"]] += 1
        pairs.append((r, r["actionType"]))
    ll = 0.0
    acc = 0.0
    n = 0
    for r, label in pairs:
        c = tbl[(r["side"], r["_lr"], r["startMoney"] // 50)]
        tot = sum(c.values())
        p = c[label] / tot
        ll += -np.log2(max(p, 1e-9))
        acc += (c.most_common(1)[0][0] == label)
        n += 1
    return ll / n, acc / n

surf_ll, surf_acc = surface_eval()
rows = [["surface_exact_lookup", -1, round(surf_ll, 4), round(surf_acc, 4)]]
for leaves in [30, 60, 100]:
    clf = DecisionTreeClassifier(max_leaf_nodes=leaves, min_samples_leaf=20, random_state=42)
    ll, acc = evaluate(clf)
    rows.append(["rule_tree_{}leaves".format(leaves), leaves, round(ll, 4), round(acc, 4)])
    print("tree {} leaves: logloss {:.4f} acc {:.4f}".format(leaves, ll, acc))
print("surface exact lookup: logloss {:.4f} acc {:.4f}".format(surf_ll, surf_acc))

with open(f"{RESULTS}/representation-benchmark.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["representation", "leaves", "grouped_log_loss", "grouped_accuracy"])
    w.writerows(rows)

# ---------- 28. lookup feasibility ----------
# state count estimate
n_states = 0
for side in ["t", "ct"]:
    for lr in [1400, 1900, 2400, 2900, 3400]:
        for M in range(0, 16001, 50):
            n_states += 1
base_states = n_states  # retained=none only
# retained families: none/rifle/smg/awp/other -> x5
md = ["# Lookup Feasibility", "",
      "retained=none states: {} (T/CT x 5 lr x 321 money)".format(base_states), "",
      "retained family levels (none/rifle/smg/awp/other): {} states".format(base_states * 5),
      "exact-retained supported (8 weapons x ~5 lr x side x money where supported): 显著更大但受支持限制",
      "",
      "若每 state 存 top3 loadouts + spend target + confidence：",
      "- JSON 每行 ~250B → {} states ~ {} MB".format(base_states * 5, round(base_states * 5 * 250 / 1e6, 1)),
      "- binary (fixed-width) 每行 ~64B → ~ {} MB".format(round(base_states * 5 * 64 / 1e6, 1)),
      "- lookup: 预计算 dict key (side,lr,money//50,retained) -> O(1) hash",
      "- 插值：$50 grid 覆盖全部实际可达现金（reachable-money audit），无插值必要",
      ""]
open(f"{RESULTS}/lookup-feasibility.md", "w").write("\n".join(md))
print("lookup-feasibility.md written")
