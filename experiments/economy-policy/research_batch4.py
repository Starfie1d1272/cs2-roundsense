#!/usr/bin/env python3
"""Research: representation benchmark (27) — TWO separate questions.

A. Predictive generalization: surface lookup vs rule tree, BOTH 5-fold
   match-series grouped OOF. Each fold builds the lookup/tree from the
   training fold only and evaluates on the held-out fold.
B. Compression fidelity (NOT held-out): how well a compact deterministic
   tree approximates the FULL-data professional reference surface.
   Reported as KL / TV / label agreement — explicitly not generalization.

Run with DAK venv python (sklearn): env -u PYTHONPATH <venv>/bin/python
"""
import csv, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_common import build_dataset, RESULTS

STRICT, FAMILY = build_dataset()
TYPES = ["pistol", "eco", "semi", "force", "full"]

# same row universe as the feature ladder: retained != UNKNOWN (none is legal)
UNIVERSE = [r for r in STRICT if r["correctedRetainedPrimary"] != "UNKNOWN"]
X, y = [], []
for r in UNIVERSE:
    X.append([1 if r["side"] == "t" else 0, r["_lr"], r["startMoney"]])
    y.append(r["actionType"])
X = np.array(X, dtype=float)
y_idx = np.array([TYPES.index(v) for v in y])

import hashlib
def group_of(m):
    return m.rsplit("-m", 1)[0]
folds = np.array([int(hashlib.sha256(group_of(r["map"]).encode()).hexdigest(), 16) % 5
                  for r in UNIVERSE])

from sklearn.tree import DecisionTreeClassifier
from sklearn.metrics import log_loss, accuracy_score, f1_score

def tree_eval(leaves):
    """Grouped OOF: fit on 4 folds, evaluate held-out fold."""
    ll = 0.0
    acc = 0.0
    f1 = 0.0
    n = 0
    for f in range(5):
        tr, te = folds != f, folds == f
        clf = DecisionTreeClassifier(max_leaf_nodes=leaves, min_samples_leaf=20, random_state=42)
        clf.fit(X[tr], y_idx[tr])
        proba = clf.predict_proba(X[te])
        pred = clf.predict(X[te])
        ll += log_loss(y_idx[te], proba, labels=list(range(5))) * te.sum()
        acc += accuracy_score(y_idx[te], pred) * te.sum()
        f1 += f1_score(y_idx[te], pred, labels=list(range(5)), average="macro", zero_division=0) * te.sum()
        n += te.sum()
    return ll / n, acc / n, f1 / n

def surface_oof():
    """Grouped OOF naive empirical exact-cell lookup: build cell table from
    TRAIN folds only, evaluate held-out fold; unseen cells get the global
    train distribution. This is the NAIVE baseline — NOT the frozen
    adaptive-Gaussian surface (the frozen kernel surface is never compared
    here because the trees were not evaluated against it)."""
    ll = 0.0
    acc = 0.0
    n = 0
    for f in range(5):
        tr, te = folds != f, folds == f
        tbl = {}
        global_counter = {}
        for i in np.where(tr)[0]:
            key = (int(X[i, 0]), int(X[i, 1]), int(X[i, 2]) // 50)
            tbl.setdefault(key, [0] * 5)[y_idx[i]] += 1
            global_counter[y_idx[i]] = global_counter.get(y_idx[i], 0) + 1
        gtot = sum(global_counter.values())
        gdist = np.array([global_counter.get(c, 0) / gtot for c in range(5)])
        for i in np.where(te)[0]:
            key = (int(X[i, 0]), int(X[i, 1]), int(X[i, 2]) // 50)
            c = tbl.get(key)
            if c is None:
                dist = gdist
            else:
                c = np.array(c, dtype=float)
                dist = c / c.sum()
            ll += -np.log2(max(dist[y_idx[i]], 1e-9))
            acc += (dist.argmax() == y_idx[i])
            n += 1
    return ll / n, acc / n

sll, sacc = surface_oof()
rows = [["naive_empirical_exact_cell_lookup_OOF", -1, round(sll, 4), round(sacc, 4), ""]]
for leaves in [30, 60, 100]:
    ll, acc, f1 = tree_eval(leaves)
    rows.append(["rule_tree_{}leaves_OOF".format(leaves), leaves, round(ll, 4), round(acc, 4), round(f1, 4)])
    print("tree {} leaves OOF: logloss {:.4f} acc {:.4f} macroF1 {:.4f}".format(leaves, ll, acc, f1))
print("surface OOF: logloss {:.4f} acc {:.4f}".format(sll, sacc))

# ---------- B. compression fidelity (full-data, NOT held-out) ----------
# full-data surface probabilities per cell vs full-data tree probabilities
full_tbl = {}
for i in range(len(X)):
    key = (int(X[i, 0]), int(X[i, 1]), int(X[i, 2]) // 50)
    full_tbl.setdefault(key, [0] * 5)[y_idx[i]] += 1
cell_probs = {}
for key, c in full_tbl.items():
    c = np.array(c, dtype=float)
    cell_probs[key] = c / c.sum()

def kl(p, q):
    return float(sum(pi * np.log2(pi / qi) for pi, qi in zip(p, q) if pi > 0 and qi > 0))

def tv(p, q):
    return float(0.5 * sum(abs(pi - qi) for pi, qi in zip(p, q)))

COMP = []
for leaves in [30, 60, 100]:
    clf = DecisionTreeClassifier(max_leaf_nodes=leaves, min_samples_leaf=20, random_state=42)
    clf.fit(X, y_idx)  # FULL data — compression, not generalization
    # evaluate on the same full data against the full-data surface
    kl_sum = tv_sum = 0.0
    agree = 0
    n = 0
    for key, p in cell_probs.items():
        # tree probability for this cell: predict at cell center
        center = np.array([[key[0], key[1], key[2] * 50 + 25]])
        dist = clf.predict_proba(center)[0]
        kl_sum += kl(p, dist)
        tv_sum += tv(p, dist)
        agree += (np.argmax(p) == np.argmax(dist))
        n += 1
    COMP.append([leaves, round(kl_sum / n, 4), round(tv_sum / n, 4), round(agree / n, 4)])
    print("compression {} leaves: avg KL {:.4f} avg TV {:.4f} label agreement {:.4f}".format(*COMP[-1]))

with open(f"{RESULTS}/representation-benchmark.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["representation", "leaves", "grouped_oof_log_loss", "grouped_oof_accuracy",
                "grouped_oof_macroF1", "avg_kl_bits", "avg_tv", "label_agreement", "mode"])
    for r in rows:
        w.writerow(r + ["", "", "", "generalization_OOF"])
    for leaves, k, t, ag in COMP:
        w.writerow(["rule_tree_{}leaves_full".format(leaves), leaves, "", "", "",
                    k, t, ag, "compression_fidelity"])

md = ["# Representation Options", "",
      "## A. Predictive generalization (5-fold match-series grouped OOF)", "",
      "Both the naive empirical exact-cell lookup and the rule trees are built",
      "from training folds only and evaluated on held-out folds (apples-to-apples).",
      "注意：naive exact-cell lookup 是经验频率基线，不是 frozen adaptive-Gaussian",
      "kernel surface——本研究未对 frozen surface 与 tree 做 OOF 比较，",
      "不声称 tree 优于 frozen surface。", "",
      "| representation | leaves | OOF log loss | OOF acc | macroF1 |", "|---|---|---|---|---|"]
for r in rows:
    md.append("| {} | {} | {:.4f} | {:.4f} | {} |".format(r[0], r[1], r[2], r[3], r[4] if r[4] else "-"))
md.append("")
md.append("## B. Compression fidelity — NOT HELD-OUT PERFORMANCE")
md.append("")
md.append("Full-data tree approximation of the full-data professional reference surface.")
md.append("")
md.append("| leaves | avg KL (bits) | avg TV | label agreement |")
md.append("|---|---|---|---|")
for leaves, k, t, ag in COMP:
    md.append("| {} | {:.4f} | {:.4f} | {:.4f} |".format(leaves, k, t, ag))
md.append("")
md.append("Compression fidelity measures how much a compact deterministic tree loses")
md.append("relative to the full empirical surface — it is NOT a generalization claim.")
open(f"{RESULTS}/representation-options.md", "w").write("\n".join(md))
print("representation done")
