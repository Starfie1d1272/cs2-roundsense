# Deployable Feature Value

5-fold match-series grouped held-out log loss (bits) per feature level / target.
越低越好；差值 = 该特征的信息增益。

- money | format_state: 0.7432
- money | helmet: 0.7014
- money | kit: 0.3345
- money | smoke: 0.6581
- +side | format_state: 0.7815
- +side | helmet: 0.6234
- +side | kit: 0.2469
- +side | smoke: 0.6994
- +lossReward | format_state: 1.1250
- +lossReward | helmet: 0.8879
- +lossReward | kit: 0.4335
- +lossReward | smoke: 0.9342
- +retained | format_state: 1.1250
- +retained | helmet: 0.8879
- +retained | kit: 0.4335
- +retained | smoke: 0.9342
- +armor/helmet | format_state: 1.1646
- +armor/helmet | helmet: 0.9188
- +armor/helmet | kit: 0.4600
- +armor/helmet | smoke: 0.9874
- +roundstage | format_state: 2.4802
- +roundstage | helmet: 2.0240
- +roundstage | kit: 0.9680
- +roundstage | smoke: 2.2226

注：+armor/helmet 使用 retainedArmor/retainedHelmet（pre-decision boolean，live GSI 可得）。