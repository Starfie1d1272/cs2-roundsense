# POST-PISTOL STRATEGY RESEARCH — 最终研究报告

状态：2026-08-08，branch `research/post-pistol-strategy`
（checkpoint `5fccdd8` 之上完成 pp7、独立审计、hash 调查与本报告）。
语料：Cologne 2026 Major，202 张图 / 106 个 series；STRICT 25,986 player-rounds。

所有数字来自 `results/cologne-2026/post-pistol-strategy/` 下的 artifact
（pp1–pp7 产出），并已由 `audit_post_pistol_strategy.py`（80 项检查）独立
对账与复现。冻结 core（6 个 artifact）与 0875db9 内容基线 6/6 一致，
`packages/`、`apps/` 无改动。

## 数据层（VALIDATED）

- post-pistol team-rounds：404（T 205 / CT 199），每 (map, half) 一行，
  全部为手枪局败者，R2/R14，无 OT，lossReward 真 2400（audit 全量断言）。
- player-style-strict：25,986 行，无 OT，drop/ambiguous 已排除；
  role join：exact 25,167 / alias-player 432 / alias-team-only 387 / unresolved 0。
- 角色元数据：32 队 × 5 人 = 160 行，无重复；别名 5 条全部显式
  （role-aliases.csv，无模糊匹配）。
- 分支分类：side-specific 3 分量 GMM on team spend ratio；阈值确定性
  （T: eco 0.2038 / force 0.8898；CT: eco 0.2427 / force 0.7913）；
  后验 argmax == branch 列（audit 全量断言）。

## Q1. T / CT post-pistol 分支率（VALIDATED）

- T（n=205）：FORCE 39.0%（CI 31.7–46.0）/ ECO 50.2%（CI 43.2–57.8）/
  LIGHT 10.7%（CI 6.8–15.2）
- CT（n=199）：FORCE 80.9%（CI 75.4–86.2）/ ECO 15.1%（CI 9.6–20.6）/
  LIGHT 4.0%（CI 1.6–6.9）

## Q2. 两分支覆盖与 LIGHT 第三 mode（VALIDATED / DESCRIPTIVE）

- 两分支（FORCE+ECO）后验覆盖：T 84.4%（0.9）/ 86.8%（0.8）/ 88.3%（0.7）；
  CT 90.5%（0.9）/ 95.0%（0.8）/ 95.5%（0.7）。
- LIGHT 是 T 的**真实第三 mode**：GMM 3 分量权重 11.9%，BIC 3 分量最优
  （-582.8 < -470.8 < 445.7）；CT LIGHT 仅 4.0%，近似单峰 FORCE。
- 结论：T post-pistol 决策本质是"保经济 vs 冲"二选一（~90% 决策落在
  高置信 FORCE/ECO），两个推荐即可覆盖大部分决策；LIGHT 是少数但真实
  的中间态。CT 一个推荐（FORCE）即可覆盖绝大多数。

## Q3. CT：T 存活人数与 FORCE（DESCRIPTIVE）

- 原始关联（T survivors 0-1 → 4-5）：FORCE 率 87.5% → 76.8%（band 组，
  n=32/111/56），方向温和。
- money 控制后 grouped-OOF：money-only AUC 0.5147 → +T survivors 0.5267
  （ΔAUC +0.012），增益可忽略（audit 独立复现一致）。
- 解释：**"T survivors 决定 CT FORCE"不成立**——CT post-pistol FORCE 的
  主要决定因素是经济状态；存活人数信号在控钱后接近零。

## Q4. T：下包与 FORCE（DESCRIPTIVE / money 一致性说明）

- 原始关联：未下包 18.7% FORCE（n=139）vs 下包 81.8% FORCE（n=66），
  +63pp。
- money 控制后 grouped-OOF：money-only AUC 0.8209 → +plant 0.8029 →
  +survivors 0.7962（无增益，audit 复现一致）。
- 解释：plant 与 FORCE 有很强的原始关联，但在当前 grouped-OOF 模型中，
  加入 plant 并未提供超出 money 的增量预测价值。这一结果与 plant 主要
  通过 +$600/player 改变可支配经济的 money-mediated explanation **一致**，
  但不构成正式的因果中介证明（本分析不是 formal causal mediation
  analysis）。不能写"下包导致 FORCE +63pp"作为独立因果。

## Q5. Matched lr2400：post-pistol vs later normal cycle（VALIDATED / DESCRIPTIVE）

- overall（未匹配）：T PP 39.0%（n=205）vs later 41.4%（n=157）；
  CT PP 80.9%（n=199）vs later 57.8%（n=45）。later 样本 = lossIndex==2、
  零 retained primary、非 R1/R2/R13/R14（audit 独立重建 157/45 精确命中）。
- 我方起始经济匹配后（caliper 300，nearest-neighbor matching on
  side + per_player_start_mean）：T PP 46.0% vs 配对 later 5.8%；CT PP
  71.4% vs 9.5%。
  注意：匹配只控制了**我方**起始经济，**对手 pre-decision economy 未被
  控制**——T：PP 对手 start ~20.15k vs later ~25.18k（retained primary
  3.21）；CT：~18.91k vs ~24.05k（2.48）。
- 解释：同一 lossReward/零保留条件下，post-pistol 轮（手枪败者，人均
  ~2–2.7k）是系统性 FORCE 窗口；later 同档经济队伍更倾向 ECO。CT 的
  PP-vs-later 差异（80.9 vs 57.8）比 T 大，但 T 的匹配后差异更极端。
- 进一步说明：该结果支持 **money + lossReward 不是充分战略状态**——
  post-pistol context 与对手经济状态仍携带重要信息。但这是 observational
  result，**不能**证明"在控制 opponent economy 后 post-pistol 本身导致
  更高 FORCE"（对手经济未被 matching 控制）。

## Q6. 对手预决策经济差异（VALIDATED / DESCRIPTIVE）

- PP 对手（手枪胜者）：start ~18.8–20.1k、零保留主武器/AWP（定义）；
  later 对手：start ~26.5–26.7k、retained primary 3.0–3.3。
- 预决策特征对"对手花费类"OOF 判别：full AUC 0.827 vs 仅 startMoney 0.62
  （n=7,580，全部常规轮）。
- 对"对手步枪经济"（resulting rifle/sniper ≥3）判别：full AUC 0.977 vs
  money-only 0.961——预决策特征可以相当好地区分 established rifle economy。
- **存活人数单调性在控 money 后大幅减弱**：survived_prev 0→5 时 force/full 率
  53%→6.7%（原始），按对手 startMoney 分段后单调性大幅减弱/反转
  （如 hi(≥12k) 段内 surv0 0.53 / surv5 0.067 仍高，但 band 内对比表见
  opponent-economy-context.md）——原始信号与 money 为主要驱动一致
  （非正式中介证明，无因果断言）。
- 结论：可用回合历史/预决策上下文**有意义地区分** low buy / force /
  established rifle economy 状态，具备支撑 context-sensitive 规则（如 CT
  helmet 优先级）的潜力；但这是关联证据，live-GSI 可用性与阈值校准是
  部署问题（见 gsi-deployability.md）。

## Q7. 队伍/系统 force 倾向稳定性（WEAK / LOW SUPPORT）

- overdispersion ≈ 0（pp5）；32 队中 28 队 LOW SUPPORT（n<20）；
  shrunk force rate 范围 0.333–1.000，CI 宽。
- 解释：n≈12 post-pistol 轮/队时，原始率差与二项噪声兼容；**不声称
  "队伍 X 是 force-prone"**。队伍层存在方差（方向稳定），但样本不足
  以支撑个体队伍标签。

## Q8. AWP 依赖与经济保全（VALIDATED / DESCRIPTIVE）

- designated AWPer（31 人）在 startMoney ≥ $5400 的可负担轮中 resulting
  AWP rate 跨队均值约 0.813，有数据队伍（31 队）范围约 0.560–0.961
  （NRG 0.560 / TYLOO 0.611 / GamerLegion 0.639 … B8 0.961）；
  non-AWPer ≤ 0.109；dual-AWP 队伍-回合率 1.04%。
- AWPer 在购买 AWP 前一轮均花 $847（n=443）vs non-AWPer 买步枪前 $1997
  （n=6,669）——AWP 前经济保全行为存在。
- 队伍层 AWP 保留率 vs post-pistol FORCE rate：rho=-0.37，p=0.06
  （n=27 队，Spearman）——弱负相关，**不构成"AWP 队 ECO 因为需要 AWP"**
  的因果证据（相关、小样本、混淆）。

## Q9. 角色泛化：OOF / leave-player-out（核心问题）

target × 特征集（grouped 5-fold OOF AUC；LPO = GroupKFold by player）：

- utility_heavy：base 0.8973 → +全部角色 0.9015（series）；LPO
  0.8969 → 0.9013。ΔAUC ≈ +0.004，LPO 保留但极小。
- primary_rifle/sniper：base 0.957 → +角色 0.957（无增益，经济状态饱和）。
- AWP（designated AWPer 子集）：0.9339，角色集完全相同（子集内角色
  零变异，无判别信息）。
- AWP（all_players）：base 0.8672 → +角色 0.9846（series）；LPO
  0.9838。**ΔAUC +0.117，leave-player-out 完整保留——AWP 角色是唯一
  强泛化信号**。
- paid-pistol deagle vs other：base 0.5793 → +角色 0.5807（series）；
  LPO 0.5619（无增益，略降）。

结论：
- **utility 的 in-sample 角色差异存在但 OOF/LPO 增益 ~0.004**——不足以
  支撑"IGL 偏好道具"作为泛化规则；LPO 无改善的目标按任务口径表述为
  ROLE METADATA DOES NOT GENERALIZE FOR THIS TARGET。
- **AWP 是例外**：role metadata 对 AWP 购买有强、可跨玩家泛化的判别力。
  精确表述：这证明 **designated AWPer role 对 AWP 使用有极强、可跨玩家
  泛化的预测力**，而不是证明某个抽象的"AWP economy personality latent
  trait"。

## Q10. 偏好轴证据（汇总，详见 preference-axis-evidence.md）

1. 经济风险（保经济 ↔ force-prone）：**moderate**。T 双峰 / CT 近单峰是
   最强的行为结构；队伍层方差存在但样本小（28/32 LOW SUPPORT）。
2. firepower ↔ utility：**weak**。条件匹配差异方向符合预期（IGL/Support
   略多道具），但量小（utility share +0.033 等），OOF/LPO 增益 ~0.004。
3. AWP 优先级：**strong**（角色行为规律 + LPO 泛化 ΔAUC +0.117）；
   队伍层 AWP-经济 tradeoff 仅 moderate（rho=-0.37, p=0.06）。
4. 手枪偏好：**weak**。支付手枪行 5,686（purchased 4,721 / carried 965），
   side 合法（canonical 交叉检查；259 行侧不匹配均为继承/换边行，非购买），
   但条件化后（money/branch/role）无 OOF/LPO 判别力（deagle AUC ~0.58）。

大样本 in-sample 身份效应 ≠ 产品偏好轴：除 AWP 外，role 效应未通过
leave-player-out。

## Q11. 多模态状态（VALIDATED）

- **T post-pistol：真双模态**（ECO/FORCE 双峰 + valley，LIGHT 真实第三
  mode 10.7%）——不适合单一"推荐"；两个推荐（保经济 / 冲）覆盖 ~90%。
- **CT post-pistol：近单模态 FORCE**（80.9%，两分支覆盖 90–95%）。
- 对手经济（全轮）：花费类三分类中 light 占 51.2%，但"light"区间混合了
  高余额全步枪队伍（其花费比例被自身 money 水平压低）——这是 outcome
  定义语义，不是真实第三购买模式；对手 rifle economy 状态近乎可判
  （AUC 0.977）。

## 产品含义（PRODUCT IMPLICATION — NOT YET POLICY）

- post-pistol 决策应提供"保经济 / 冲"两个方向（T 双模态），而非单一
  推荐；CT 可直接默认 FORCE 方向。
- 对手经济期望（opponentEconomyExpectation）有充分证据基础（预决策
  特征 AUC 0.83–0.98），可支撑 context-sensitive 规则（如 CT helmet
  优先级）的设计，但**本研究报告不设计任何 V3 规则**。
- AWP 角色是唯一可泛化的角色信号（LPO AUC 0.984）；utility/火力/
  手枪的角色轴证据不足，**不应**作为用户偏好设置。
- 队伍级"force-prone"标签证据不足（二项噪声内），**不应**产品化。

## 明确不支持的陈述（NOT SUPPORTED）

- "下包导致 FORCE +63pp"（无超出 money 的增量 OOF 预测价值）。
- "T 存活人数决定 CT FORCE"（控钱后 OOF 增益 ≈ 0）。
- "IGL 偏好道具 / 角色风格可泛化"（utility ΔAUC +0.004，LPO 无实质增益；
  手枪偏好无增益）。
- "AWP 队 ECO 因为需要 AWP"（仅弱相关 rho=-0.37，p=0.06）。
- "队伍 X 是 force-prone"（overdispersion ≈ 0，样本不足）。

## 与冻结 core 的关系（VALIDATED）

- 6 个冻结 artifact 内容与 0875db9 基线 6/6 一致（audit 用 git blob
  内容 SHA-256 验证）；`packages/`、`apps/` 无改动；旧
  `_core-sha256.json` 未被修改（其与基线的差异见 core-hash-investigation.md：
  旧值哈希的是同一内容的 CRLF 临时表示，非提交的 LF 状态）。
- 本报告所有结论均不依赖旧 `_core-sha256.json`。
