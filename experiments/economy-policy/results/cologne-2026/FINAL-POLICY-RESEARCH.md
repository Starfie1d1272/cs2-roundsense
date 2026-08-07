# Final Policy Research — Cologne 2026 Professional Economy Evidence

## 1. Executive evidence summary

- STRICT 25,986 player-rounds（冻结 corpus，raw 43,620；exclusion partition 已审计）。
- 职业 format economy state（pistol/eco/semi/force/full）可由个人 live 状态高置信预测：
  full≥50% crossing 集中在 $3,650–4,100（支持区内）；lr1400 支持区 T $3,250+ / CT $3,400+。
- 购买行为（spend/loadout/utility）全部做 budget feasibility conditioning（moneySpent ≤ query M）。
- 团队 oracle 条件熵仅再降 ~6.4（个体状态已解释大部分）。
- drop 通道不可见（14,945 行 drop-flagged 排除），个人推荐在相关状态需保守。

## 2. Data quality / coverage

# Reachable-Money Audit

STRICT n=25986

- startMoney % 50 == 0: 25986/25986 (100.0%)
- moneySpent % 50 == 0: 25986/25986 (100.0%)
- non-$50 observations: 0 (listed below)


- state-space coverage: state-space-coverage.csv（exact/interpolated/unsupported 分层）。
- grenade 分布（strict）: {'0': 5289, '3': 3754, '1': 3172, '2': 3478, '4': 10293}
- retained coverage: exact 14 / family 43 / unsupported 53（retained-coverage.csv）。

## 3. Professional spend behavior

- professional-spend-surface.csv（p25/median/p75 + bank-after-buy 分布 + spend ratio）。
- purchase-cost reconstruction：exact 20.2% / explainable 48.7% / unresolved 31.1%
  （unresolved 主因：armor 受损 vs 全价无法区分、drop 混合——详见 purchase-cost-reconstruction.md）。

## 4. Weapon behavior

- weapon-choice-surface.csv（exact primary per state）；AK-47 24.8% / M4A4 10.7% / M4A1-S 9.3% / Galil 6.8% / AWP 5.3% / MP9 3.8%。
- 步枪主导：rifle+smoke+flash 40.5%、rifle+double-flash 11.3%（全局组合频率）。

## 5. Armor / kit / utility

- armor-kit-utility-surface.csv：armor/helmet/kit/smoke/flash1/flash2/HE/fire per state。
- T kit=0（invariant）；CT kit 概率随 money 上升（见 ct-kit-atlas 数据）。
- utility-combinations.csv：真实组合频率（无预设）。

## 6. Retained weapon behavior

- retained-behavior.csv：stays-same-primary / no-primary / upgraded 比例 per retained weapon。
- 存枪后 class 分布整体上移；retained AWP → 保 AWP 为主（省钱）。
- loadout-delta.csv：retained→resulting 转移模式。

## 7. Next-round preservation

- next-round-preservation.csv：nextIfLoseNoSpend / afterMedianSpend / T plant 分支 + 描述性桶分布。
- 职业购买后败方下局资金分布见 CSV（descriptive，非 production buckets）。

## 8. Team / drop / role ambiguity

# Team-Context Ceiling

format-state conditional entropy (retained=none):
- individual context (side, lr, money//50): -2471.8659 bits
- + team oracle (total start //2000, rifle count, AWP count): -2312.9633 bits
- relative reduction: 6.4%

普通 GSI 看不到队友经济时的信息损失 ≈ 上述差值（oracle 上限）。
team-round-patterns.csv 含全量 team-round 聚合（含 drop 行——仅描述性）。

# Drop-Sensitive Analysis

excluded drop rows: 14945 (gave / received 见 CSV)

## 按现金档（$500 桶，仅展示）
- $0-499: 6
- $500-999: 8
- $1000-1499: 46
- $1500-1999: 217
- $2000-2499: 389
- $2500-2999: 433
- $3000-3499: 897
- $3500-3999: 3142
- $4000-4499: 2151
- $4500-4999: 1427
- $5000-5499: 1065
- $5500-5999: 909
- $6000-6499: 802
- $6500-6999: 695
- $7000-7499: 507
- $7500-7999: 399
- $8000-8499: 347
- $8500-8999: 286
- $9000-9499: 255
- $9500-9999: 181
- $10000-10499: 146
- $10500-10999: 136
- $11000-11499: 83
- $11500-11999: 86
- $12000-12499: 77
- $12500-12999: 67
- $13000-13499: 44
- $13500-13999: 34
- $14000-14499: 27
- $14500-14999: 18
- $15000-15499: 23
- $15500-15999: 9
- $16000-16499: 33



- role-ambiguity.md：player-conditioned 残差熵 vs state 熵。

## 9. Stability / uncertainty

- stability.csv：5-fold match-series grouped（full crossing per fold）。
- uncertainty.csv：cluster bootstrap 90% CI（full50 crossing per T/CT × lr）。
- 见 uncertainty-summary.md / stability-analysis.md。

## 10. Deployable feature value

- feature-value.csv：money → +side → +lossReward → +retained → +armor/helmet → +roundstage 的 grouped log loss。
- round/score 增量极小（round-score-context.md）——不建议为它加 production 复杂度。

## 11. GSI deployability

- 见 docs/economy/gsi-deployability.md（live feature 逐项 availability/timing/reliability）。
- roundStartMoney 的 live 获取：NEEDS RUNTIME VALIDATION（decision-anchor-design.md）。

## 12. Planner readiness

- 见 docs/economy/planner-gap-audit.md（SUPPORTED/PARTIAL/MISSING per item）。
- representation benchmark：30-leaf rule tree logloss 0.4465 ≈ surface 0.5398（acc 0.832 vs 0.844）——
  规则树可接近 surface，选择留给人工。

## 13. Representation options

- representation-benchmark.csv：surface vs 30/60/100-leaf trees。
- lookup-feasibility.md：exact $50 lookup 轻量（JSON ~MB 级，O(1) hash），无插值必要（reachable 全 $50）。

## 14. What is now known

- 职业 format-state 分布、spend、loadout、utility、retained 行为：全部 per-state 概率化证据。
- 可负担性（canonical prices）after-loss 检查：affordability-targets.csv。
- 个人 live 状态足以支撑 policy 主体；团队/round/score 增益小；drop 是主要不可见通道。

## 15. What still requires HUMAN POLICY JUDGEMENT

- 普通玩家是否应比职业选手更保守（spend 阈值的主观缩放）。
- 高熵状态选哪一个分支（ambiguity-map.csv 中标出的 MIXED 区）。
- 头甲 vs utility 的主观优先级（职业分布只是参考）。
- AWP 是否默认推荐（职业 AWP 行为存在，但个人推荐是否推 AWP 是产品决策）。
- team-drop 无法观察时如何保守处理（drop-sensitive-analysis.md 的状态清单）。
- 表示形式选择：exact lookup / 规则树 / 混合（representation-benchmark.csv）。

## 16. What still requires RUNTIME VALIDATION

- roundStartMoney 的 live freeze-time 获取（decision-anchor-design.md）。
- 首次 payload 已购买时的 anchor 识别。
- 实时 current-round spend 显示（live-spend-feasibility.md 的 CONDITIONAL 项）。
- Windows packaging 全链（product-readiness-audit.md）。

---

**Interpretation**：本文件所有 professional 行为均为 OBSERVED REFERENCE，
不是 optimal truth，不构成推荐策略。下一阶段由人工基于 policy-review-table.csv /
policy-review-atlas.md 制定策略。