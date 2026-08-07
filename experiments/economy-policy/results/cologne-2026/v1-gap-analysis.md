# V1 Gap Analysis

production V1（bundle heuristic planner，rifle_armor 默认 goal）在关键状态的行为 vs 职业证据。
V1 推荐来自当前 production advisor（只读调用）。

## V1 spend vs professional spend（retained none）

| side | lr | money | V1 cost | prof p25 | prof med | prof p75 |
|---|---|---|---|---|---|---|

## 观察（仅描述）

- V1 推荐 cost 与职业 median spend 的差 = 现有 heuristic 到 evidence-backed policy 的距离（部分状态）。
- V1 的 bundle 结构（固定模板 + 增量）无法表达职业的 utility 混合（见 conditional-loadouts）。
- 完整 per-state 对比见 v1-gap.csv（240 行：side/lr/retained/money/goal/rec_class/rec_cost/rec_purchases）。