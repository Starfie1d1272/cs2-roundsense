# 偏好轴证据评估（Preference-Axis Evidence，产品向，仅证据）

证据等级：strong / moderate / weak / unsupported。
本文件不写任何 production policy，不设计 Policy V3 规则。

## 1. 经济风险轴：保经济 <-> 倾向 force

- T post-pistol：FORCE 39.0% / ECO 50.2% / LIGHT 10.7% (n=205)
- CT post-pistol：FORCE 80.9% / ECO 15.1% / LIGHT 4.0% (n=199)
- T 决策是真实双峰且有清晰 valley（两分支后验覆盖 84-88%）；
  LIGHT 是真实但少数 mode。CT 近似单峰 FORCE（覆盖 90-95%）。
- 队伍层方差：shrunk force rate 范围 0.333-1.000；
  n per team 小（~12 post-pistol 轮），overdispersion ≈ 0 → 原始率差在
  二项噪声内；28/32 支队伍为 LOW SUPPORT（见 team-system-propensity.csv）。
- 该轴的证据来自 pp2 分支混合与 pp5 队伍倾向（队伍层，非角色层）。
- EVIDENCE：moderate（方差存在且方向稳定，但队伍样本小、shrinkage 显示
  原始差异噪声大）。

## 2. 火力 <-> 道具（firepower <-> utility）

- 条件匹配（side x money x retained x post-pistol）角色差异：IGL vs Opener utility share +0.033；AWPer vs Opener weapon share +0.077；完整对比见 role-style-axis.csv。
- AWPer 的差异主要是预算后果（昂贵主武器 -> 少道具），不是独立风格轴。
- grouped-OOF（role-style-oof.csv）：utility target base AUC 0.8973 -> +全部角色 0.9015；leave-player-out 0.8969 -> 0.901（ΔAUC 约 +0.004，LPO 保留但极小）。
- rifle target：base 0.957 -> +角色 0.957（无增益，经济状态已近饱和）。
- EVIDENCE：weak（in-sample 方向符合 IGL/Support 预期，但量小；OOF/LPO
  增益 ~0.004，不足以为独立产品轴提供支撑）。

## 3. AWP 优先级（AWP priority）

- designated AWPer（role metadata，31 人）在 $5400+ 轮 resulting AWP rate 均值 0.813（31 队有有效样本，各队 0.81-0.96；HEROIC n_viable=0 不计）；non-AWPer 最高 0.1094；dual-AWP 队伍-回合率均值 0.0104。
- AWPer 在购买 AWP 前一轮的节省行为见 awp-economy-association.md（AWPer 前轮均花 $847 vs non-AWPer $1997）。
- 队伍层 AWP 保留率 vs post-pistol FORCE rate：rho=-0.37, p=0.06（Spearman, 描述性，见 awp-economy-association.md）。
- 角色泛化（role-style-oof.csv, all_players）：AWP target base AUC 0.8672 -> +角色 0.9846（series）；leave-player-out +角色 0.9838。
- EVIDENCE：strong（AWPer 行为规律，角色定义即行为）；moderate（队伍层
  AWP-经济风险 tradeoff，n_teams=27，p=0.06）。

## 4. 手枪偏好（pistol preference）

- strict 数据中支付手枪行 5686（purchased 4721 / carried 965）；分布按 side / money band / branch / role / purchase_state 见 pistol-preference.csv。
- canonical 合法性交叉检查：非法侧手枪行 259（carried 98 / non-carried 161；游戏禁止跨侧购买，这些是继承/换边行，不是购买）。
- 泛化（role-style-oof.csv, deagle vs other）：base AUC 0.5793 -> +角色 0.5807（series）；leave-player-out 0.5619——角色无 OOF 增益，LPO 下无改善。
- EVIDENCE：weak（side-legal 频率证据存在，但条件化后角色/队伍无泛化
  判别力，不足以支撑独立"手枪偏好"用户设置）。

## 结论（bottom line）

- 经济风险：最强、最贴近产品的轴（T 双峰 / CT 近单峰），队伍层 moderate。
- AWP 优先级：strong 的角色行为规律，队伍层 tradeoff 仅 moderate。
- firepower <-> utility：存在但小（weak），不单独支撑产品设置。
- 手枪偏好：weak——频率存在但无泛化证据。