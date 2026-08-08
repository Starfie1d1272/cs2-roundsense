# 对手经济上下文（opponentEconomyExpectation 的证据基础）

## 范围（Scope）

- 本文件只评估：**决策前（freezetime 前）已知的信息**能否区分对手的
  花费水平。不实现任何分类器，不设计任何 helmet 规则。
- 预决策特征（回合开始时已知）：对手 lossIndex（连败轨迹）、对手队伍
  startMoney、对手保留主武器/AWP 数量、对手上一回合存活人数、上一回合结果。
- 结局（描述目标，NOT 预测器）：对手当回合自身花费比
  team_money_spent / team_start_money，按 post-pistol 研究的 side-specific
  阈值映射为 eco / light / force/full。
  **语义注意**：该结局度量的是"花费比例"而非"步枪经济"。高余额队伍
  （例如刚大比分赢下上一回合）全步枪购买后比例仍落在 light 区间
  ——见下方 money 中介分解。

- 分析队伍-回合数：7580（全部常规回合，排除 R1/R13 与 overtime，
  双方视角）
- 对手花费类分布：{'force/full': 2779, 'eco': 918, 'light': 3883}

## 分组 OOF 判别（logistic, GroupKFold by match series）

- 完整预决策特征集：logloss=0.4627, brier=0.1577,
  auc=0.8273, n=7580, base rate=0.3666
- 仅对手 startMoney：logloss=0.6176, 
  brier=0.2185, auc=0.62
- 结论：轨迹类特征（连败、保留、存活、上回合结果）相对"只看钱"
  提供额外判别力。

## 补充结局：对手"步枪经济"（resulting rifle/sniper 人数 >= 3）

- 同一组预决策特征，结局改为对手回合结束时持有步枪/狙击 >= 3 人：
  logloss=0.1563, brier=0.0446,
  auc=0.9765, base rate=0.7872
- 仅对手 startMoney：logloss=0.2062, auc=0.9609
- 说明：该结局更贴近"established rifle economy"的描述；预测变量仍是
  纯预决策特征（对手回合结束的步枪人数只作为结局描述，不作为输入）。

## 存活人数单调性的 money 中介分解（FACT vs 解释）

- 原始关联 survived_prev=0: force/full rate 0.5316
- 原始关联 survived_prev=1: force/full rate 0.5638
- 原始关联 survived_prev=2: force/full rate 0.3392
- 原始关联 survived_prev=3: force/full rate 0.1608
- 原始关联 survived_prev=4: force/full rate 0.0956
- 原始关联 survived_prev=5: force/full rate 0.0671

- 按对手 startMoney 分段后的同表（n>=20 才报告）：

- survived_prev=0 hi(>=12k): n=461, force/full=0.5315
- survived_prev=1 hi(>=12k): n=2693, force/full=0.5912
- survived_prev=1 lo(<8000): n=21, force/full=0.6667
- survived_prev=1 mid(8-12k): n=537, force/full=0.4227
- survived_prev=2 hi(>=12k): n=1020, force/full=0.3284
- survived_prev=2 mid(8-12k): n=51, force/full=0.549
- survived_prev=3 hi(>=12k): n=1191, force/full=0.1537
- survived_prev=3 mid(8-12k): n=23, force/full=0.4348
- survived_prev=4 hi(>=12k): n=983, force/full=0.0946
- survived_prev=5 hi(>=12k): n=565, force/full=0.0673

## 分层说明

- FACT（游戏机制）: 赢下上一回合的队伍下一回合 startMoney 更高；
  存活人数多 ⇔ 赢下上一回合的概率高（机制性关联）。
- OBSERVED ASSOCIATION: 预决策特征（含 money）OOF 判别对手花费比例
  AUC 0.8273；对"步枪经济"结局 AUC 0.9765；
  存活人数的原始单调性在控 money 后大幅减弱/方向反转——原始信号
  主要由 money 水平中介。
- INFERENCE（产品假设，未在此验证）: 基于预决策特征做 context-sensitive
  规则（如 CT helmet 优先级）"可能"可行；但 live-GSI 特征可用性、
  阈值校准、结局定义（比例 vs 步枪经济）都是部署期问题。
- 无因果断言：本表不说明任何特征"导致"对手购买行为。