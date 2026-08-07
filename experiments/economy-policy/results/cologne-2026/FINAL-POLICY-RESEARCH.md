# Final Policy Research — Cologne 2026 Professional Economy Evidence (REPAIRED)

> 本报告由修复后的 research pipeline 动态生成（entropy 归一化、feature ladder 同 universe、
> benchmark OOF 公平化、stability/bootstrap estimator 分离、canonical price/legality）。
> 任何数字均可从对应 CSV 复核。

## VALIDATED EVIDENCE

### Corpus / coverage

- STRICT 25986 player-rounds（raw 43620；exclusion partition 见 _meta.json）。
- 五档 lossReward 全部支持；retained coverage: exact 14 / family 43 / unsupported 53。
- grenade 分布（strict）: {'0': 5289, '3': 3754, '1': 3172, '2': 3478, '4': 10293}

### Economy reference (supported crossings, retained=none)

- T lr1400: $3800 · lr1900: $3900 · lr2400: $3900 · lr2900: $3850 · lr3400: $4000
- CT lr1400: $3650 · lr1900: $3850 · lr2400: $3900 · lr2900: $3900 · lr3400: $4100

### Stability (5-fold match-series; economy estimator, no spend filter)

- T: lr1400: 5 folds $3800–$3800; lr1900: 5 folds $3850–$3900; lr2400: 5 folds $3900–$3950; lr2900: 5 folds $3850–$3850; lr3400: 5 folds $4000–$4000
- CT: lr1400: 5 folds $3650–$3650; lr1900: 5 folds $3850–$3850; lr2400: 5 folds $3850–$3900; lr2900: 5 folds $3850–$3900; lr3400: 5 folds $4100–$4150

### Uncertainty (cluster bootstrap, match-series, B=500, seed 42)

- T: lr1400 full50 $3775–$3825 (median 3800) · full80 $3900–$4000 (median 3950); lr1900 full50 $3825–$3925 (median 3875) · full80 $4000–$4325 (median 4100); lr2400 full50 $3850–$3925 (median 3900) · full80 $4050–$4275 (median 4125); lr2900 full50 $3825–$3900 (median 3850) · full80 $3950–$4025 (median 4000); lr3400 full50 $3975–$4025 (median 4000) · full80 $4275–$4475 (median 4400)
- CT: lr1400 full50 $3600–$3925 (median 3925) · full80 $3950–$4125 (median 4000); lr1900 full50 $3800–$3875 (median 3850) · full80 $3975–$4275 (median 4050); lr2400 full50 $3800–$3950 (median 3875) · full80 $4100–$4425 (median 4225); lr2900 full50 $3850–$3950 (median 3900) · full80 $4025–$4125 (median 4075); lr3400 full50 $3900–$4225 (median 4100) · full80 $4375–$4475 (median 4425)
- median spend CI: uncertainty.csv quantities median_spend_2500 / median_spend_4000（feasibility estimator）。

### Deployable feature ladder (same row universe, grouped OOF, nested backoff)

- B0 money: 0.8234 bits (coverage 94%)
- B1 +side: 0.8435 bits+0.0201 (coverage 94%)
- B2 +lossReward: 0.8613 bits+0.0178 (coverage 94%)
- B3 +retained family: 0.8453 bits-0.0160 (coverage 94%)
- B4 +pre-decision armor/helmet: 0.8456 bits+0.0003 (coverage 94%)
- B5 +roundstage: 0.8619 bits+0.0163 (coverage 94%)

### Representation

- surface_exact_lookup_OOF: OOF logloss 1.1807 · acc 0.8224 · macroF1 -
- rule_tree_30leaves_OOF: OOF logloss 0.4654 · acc 0.8216 · macroF1 0.7205
- rule_tree_60leaves_OOF: OOF logloss 0.4794 · acc 0.8246 · macroF1 0.7291
- rule_tree_100leaves_OOF: OOF logloss 0.5067 · acc 0.8248 · macroF1 0.7302
- compression fidelity（full-data，非 held-out）: representation-benchmark.csv mode=compression_fidelity（KL/TV/label agreement）。

### Purchase-cost reconstruction (canonical display-name prices)

# Purchase-Cost Reconstruction

STRICT rows with corrected retained: 3961

implied delta cost (retained->resulting, canonical display-name prices) vs moneySpent:

- exact match (|diff|<=100): 18.4% (n=729)
- explainable (<=600): 42.8% (n=1694)
- unresolved (>600): 38.8% (n=1538)

## unresolved 示例（diff > $600）

- de_dust2 r4 dgt: spent $700 retained=AK-47 resulting=AK-47 diff=$700
- de_dust2 r5 HUASOPEEK: spent $1100 retained=Galil AR resulting=M4A4 diff=$-1800
- de_dust2 r5 luchov: spent $500 retained=Galil AR resulting=M4A1-S diff=$-2400
- de_dust2 r9 meyern: spent $700 retained=AWP resulting=AWP diff=$700
- de_dust2 r16 KSCERATO: spent $700 retained=MP7 resulting=AK-47 diff=$-2000
- de_dust2 r20 yuurih: spent $800 retained=AK-47 resulting=Galil AR diff=$-1000
- de_mirage r3 meyern: spent $1850 retained=FAMAS resulting=Galil AR diff=$-1800
- de_mirage r4 luchov: spent $1100 retained=M4A4 resulting=M4A4 diff=$800



### Affordability (exact legal targets, canonical prices + legality)

# Affordability Evidence

每行：职业实际购买后若本回合输掉，nextIfLoseAfterSpend = min(16000, start - spent + lossReward)。
1 = 下一局可负担该 exact legal target（canonical prices + canonical side legality）。

## T legal targets

- AK-47 + armor $3350
- AK-47 + helmet $3700
- AK-47 + armor + smoke + flash $3850
- AK-47 + armor + smoke + 2flash $4050
- Galil AR + armor $2450
- Galil AR + helmet $2800
- Galil AR + armor + smoke + flash $2950
- Galil AR + armor + smoke + 2flash $3150
- MAC-10 + armor $1700
- AWP + armor $5400
- AWP + armor + smoke + flash $5900
- Tec-9 + armor $1150
- Desert Eagle + armor $1350

## CT legal targets

- FAMAS + armor $2600
- FAMAS + helmet $2950
- FAMAS + armor + smoke + flash $3100
- FAMAS + armor + smoke + 2flash $3300
- M4A4 + armor $3550
- M4A4 + armor + smoke + flash $4050
- M4A1-S + armor $3550
- M4A1-S + armor + smoke + flash $4050
- MP9 + armor $1900
- AWP + armor $5400
- AWP + armor + smoke + flash $5900
- Five-SeveN + armor $1150
- Desert Eagle + armor $1350



### Team / role / round-score context (entropy-normalized)

# Team-Context Ceiling

format-state conditional entropy (retained=none):
- individual context (side, lr, money//50): 0.5398 bits
- + team oracle (total start //2000, rifle count, AWP count): 0.2440 bits
- relative reduction: 54.8%

普通 GSI 看不到队友经济时的信息损失 ≈ 上述差值（oracle 上限）。
team-round-patterns.csv 含全量 team-round 聚合（含 drop 行——仅描述性）。

# Role Ambiguity
# Round/Score Context

## LIMITATIONS

- drop 通道不可见（excluded 9842 drop-gave / 5103 drop-received）；个人推荐在相关状态需保守。
- purchase-cost reconstruction 不可重建项：armor damaged-state、drop chronology、重复购买（见 reconstruction md）。
- 团队/round/score 上下文为 ORACLE 研究（非 production 输入）；团队增益以修复后 held-out 数值为准。
- roundStartMoney live 获取 NEEDS RUNTIME VALIDATION（freeze 首帧捕获；GSI 无回合开始现金字段）。

## HUMAN POLICY DECISIONS

- policy-review-table.csv / policy-review-atlas.md：仅 supported states（3157 cards 覆盖 3157 rows）。
- HUMAN POLICY DECISION 字段留空——由人工逐卡填写。

## RUNTIME VALIDATIONS

- freeze 首帧纯净性（first payload 是否已购买）— decision-anchor-design.md
- previously.weapons entry 增删的可观测性 — decision-anchor-design.md
- armor 受损态 vs 全价的 live 区分 — live-spend-feasibility.md
- 全部 NEEDS RUNTIME VALIDATION 项见 gsi-deployability.md / fact-layer-contract.md