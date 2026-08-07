# Deployable Feature Value

Same row universe (STRICT, retained!=UNKNOWN; retained=none is a legal category).
5-fold match-series grouped OOF log loss (bits), nested backoff (min cell 20).
越低越好；Δ = 该特征的信息增益；relative information gain = 1 - H_level / H_B0.

| level | target | OOF log loss | Δ vs prev | rel. info gain vs B0 | coverage |
|---|---|---|---|---|---|
| B0 money | format_state | 0.8234 |  |  | 0.94 |
| B0 money | helmet | 0.6480 |  |  | 0.94 |
| B0 money | kit | 0.3867 |  |  | 0.94 |
| B0 money | smoke | 0.6066 |  |  | 0.94 |
| B1 +side | format_state | 0.8435 | 0.0201 | -0.0244 | 0.94 |
| B1 +side | helmet | 0.5811 | -0.0669 | 0.1032 | 0.94 |
| B1 +side | kit | 0.2970 | -0.0897 | 0.232 | 0.94 |
| B1 +side | smoke | 0.6144 | 0.0078 | -0.0129 | 0.94 |
| B2 +lossReward | format_state | 0.8613 | 0.0178 | -0.0211 | 0.94 |
| B2 +lossReward | helmet | 0.5582 | -0.0229 | 0.0394 | 0.94 |
| B2 +lossReward | kit | 0.2992 | 0.0022 | -0.0074 | 0.94 |
| B2 +lossReward | smoke | 0.6430 | 0.0286 | -0.0465 | 0.94 |
| B3 +retained family | format_state | 0.8453 | -0.016 | 0.0186 | 0.94 |
| B3 +retained family | helmet | 0.5693 | 0.0111 | -0.0199 | 0.94 |
| B3 +retained family | kit | 0.2983 | -0.0009 | 0.003 | 0.94 |
| B3 +retained family | smoke | 0.6533 | 0.0103 | -0.016 | 0.94 |
| B4 +pre-decision armor/helmet | format_state | 0.8456 | 0.0003 | -0.0004 | 0.94 |
| B4 +pre-decision armor/helmet | helmet | 0.5679 | -0.0014 | 0.0025 | 0.94 |
| B4 +pre-decision armor/helmet | kit | 0.3012 | 0.0029 | -0.0097 | 0.94 |
| B4 +pre-decision armor/helmet | smoke | 0.6549 | 0.0016 | -0.0024 | 0.94 |
| B5 +roundstage | format_state | 0.8619 | 0.0163 | -0.0193 | 0.94 |
| B5 +roundstage | helmet | 0.5768 | 0.0089 | -0.0157 | 0.94 |
| B5 +roundstage | kit | 0.3045 | 0.0033 | -0.011 | 0.94 |
| B5 +roundstage | smoke | 0.6626 | 0.0077 | -0.0118 | 0.94 |

注：B4 使用 retainedArmor/retainedHelmet（pre-decision boolean，live GSI 可得）；
B3 的 retained family 包含 none 类别（不是过滤）。