# Representation Options

## A. Predictive generalization (5-fold match-series grouped OOF)

Both the naive empirical exact-cell lookup and the rule trees are built
from training folds only and evaluated on held-out folds (apples-to-apples).
注意：naive exact-cell lookup 是经验频率基线，不是 frozen adaptive-Gaussian
kernel surface——本研究未对 frozen surface 与 tree 做 OOF 比较，
不声称 tree 优于 frozen surface。

| representation | leaves | OOF log loss | OOF acc | macroF1 |
|---|---|---|---|---|
| naive_empirical_exact_cell_lookup_OOF | -1 | 1.1807 | 0.8224 | - |
| rule_tree_30leaves_OOF | 30 | 0.4654 | 0.8216 | 0.7205 |
| rule_tree_60leaves_OOF | 60 | 0.4794 | 0.8246 | 0.7291 |
| rule_tree_100leaves_OOF | 100 | 0.5067 | 0.8248 | 0.7302 |

## B. Compression fidelity — NOT HELD-OUT PERFORMANCE

Full-data tree approximation of the full-data professional reference surface.

| leaves | avg KL (bits) | avg TV | label agreement |
|---|---|---|---|
| 30 | 0.1662 | 0.0848 | 0.9368 |
| 60 | 0.1374 | 0.0707 | 0.9433 |
| 100 | 0.1231 | 0.0634 | 0.9549 |

Compression fidelity measures how much a compact deterministic tree loses
relative to the full empirical surface — it is NOT a generalization claim.