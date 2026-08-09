# RoundSense Policy V3 最终购买策略诊断

状态：**final / economy research closeout**

日期：2026-08-09

parent：`research/ct-helmet-decision @ d194d17`

本报告只回答 overtime、utility allocation、regulation trajectory 三个问题。
它不实现 Policy V3，不修改 production，不研究 C4，也不把职业选择解释为最优或
因果结论。

确定性实现与结果：

- `experiments/economy-policy/purchase_policy_final_diagnostic.py`；
- `experiments/economy-policy/results/cologne-2026/purchase-policy-final-diagnostic.json`。

## 0. 最终裁决

| 问题 | 裁决 | 最小产品含义 |
| --- | --- | --- |
| OT purchase special case | **不需要** | tracker 仍要正确识别 `OVERTIME` 与 10k reset；购买策略只消费当前 own money / inventory / trajectory |
| utility bundle planner | **GO（有限 deterministic core）** | side、剩余 utility budget、retained utility、已选 mode / primary / armor 足够形成少量 bundle rule |
| map-specific utility | **NO-GO** | `map.name` 可部署，但平均 held-out 增量过小；不建 map rule table |
| regulation bounded history | **NO-GO** | 当前 state 已基本充分；不增加 W/L sequence、motif 或 cluster state |
| V3 architecture contract | **不修改** | 现有 `PolicyV3State` 已容纳所需 direct/tracked state；结果只约束实现时的 planner distillation |

因此，本任务没有留下新的 economy research branch。

## 1. 数据与证据边界

### 1.1 输入与 support

- frozen player-rounds：43,620，SHA-256
  `33f29c35fb124a4e45d38a00be8f389d32403c0762576b607db7a9a37fe0d9e6`；
- regulation strict：25,986；
- overtime：1,680 player-rounds，23 map instances，17 match series；
- regulation held-out 分析：22,428 player-rounds，202 map instances，106 match series；
- replay pre-state extraction：22,958/22,958 行成功，SHA-256
  `7a7c1a203700b929608b620db94016db717a1dbb09fd3d02723ebcfbaf3e3267`。

regulation 主要排除：3,028 pistol rows、114 个 frozen
`correctedRetainedPrimary=UNKNOWN`、415 个 replay-end utility 高于下一 freeze
结果的 transfer/消费歧义行，以及 1 个 utility-budget 不变量失败行。

### 1.2 必要的 pre-state 修正

现有 `retainedGrenades` 不是可靠的下一轮当前 inventory：它保留的是上一轮
freeze snapshot，无法扣除该轮实际投出的道具。直接使用会出现 1,527 个
`resulting < retained` 行。因此本研究没有把它伪装成 normal-GSI state，而是从
同一 frozen event package 的上一轮 replay 末帧恢复：

- alive / dead；
- armor；
- grenades；
- flags bit 4 的 defuse kit。

这只恢复下一轮 GSI 本来可以直接看到的**己方 pre-decision inventory**，没有读取
对手、击杀、存活人数、花费、身份、当前轮结果或地图位置。

购买 chronology 仍不可恢复。以下 utility 结论均是
“pre-state → freeze-end resulting bundle”的 allocation / opportunity-cost evidence，
不是“下一笔先买什么”的日志证据。

### 1.3 held-out discipline

- 5 folds，按 match series 整组 held out；
- uncertainty 使用 1,000 次 match-series cluster bootstrap；
- current-state estimator 显式表达 deployable state 的必要交互，例如
  `side × context × money`，避免把模型欠拟合误判成 history 增量；
- map practical gate：平均 log-loss 改善至少 0.005 bits、CI 下界 > 0、至少
  4/5 folds 为正且多数高 support maps 同向；
- history practical gate：policy target 改善至少 0.010 bits、CI 下界 > 0、
  至少 4/5 folds 为正。

这些 gate 衡量是否值得增加 production complexity，不是统计显著性或最优性检验。

## 2. A — Overtime purchase trajectory

### 2.1 赛事实际规则

corpus 中所有 OT map 都从 12:12 后的 round 25 开始。观测范围为 round 25–47，
可唯一分割为：

```text
block = (round - 25) // 6
half  = ((round - 25) % 6) // 3
path position = ((round - 25) % 3) + 1
```

共 62 个 match-level MR3 half、124 个 team-perspective half start、31 对完整的
MR3 block halves。每个三轮 half 内 side 恒定；同一 block 的第二 half 全部换边。
没有观测到第二套 OT 规则状态。

原 frozen player-round table 有一个必须明确的 capture artifact：

- 每个 block 的第二 half start 共 310 player rows，`startMoney` 直接为 10,000；
- 每个 block 的第一 half start 共 310 player rows，`startMoney` 留在 restart 前旧值；
  其中 242 行甚至小于同一行的 `moneySpent`；
- 对全部 620 个 reset player rows，使用
  `replay freeze-end money[0] + moneySpent` 重建，**620/620 = 10,000**。

因此本赛事是同一规则的 **10k MR3**；第一 half 的旧值不是 carry-over 语义，不能
进入 estimator。每个 MR3 half start 按 10k + empty retained inventory 处理。

### 2.2 path support

表中 `raw/clean` 是 player rows；clean 对 OT2/OT3 沿用 frozen drop/value gate，
reset 行不使用会被 restart 污染的 value-jump heuristic。`series` 用于揭示聚类
support。

| side | path | raw / clean | series | fresh armor n |
| --- | --- | ---: | ---: | ---: |
| CT | START | 310 / 310 | 17 | 310 |
| CT | W / L | 160 / 60；125 / 71 | 13；12 | 52；68 |
| CT | WW / WL / LW / LL | 75 / 28；60 / 25；65 / 16；45 / 31 | 10；5；7；6 | 26；25；16；31 |
| T | START | 310 / 310 | 17 | 310 |
| T | W / L | 125 / 57；160 / 94 | 12；14 | 51；92 |
| T | WW / WL / LW / LL | 45 / 20；65 / 37；60 / 20；75 / 49 | 5；9；5；10 | 17；37；18；49 |

WL/LW 等低 series path 只保留 descriptive 数字，不拟合完整规则。

### 2.3 CT helmet、spend 与 utility

“CT 前两轮通常省头，只有特定第三轮开始明显买头”只被部分、且方向相反地支持：

| CT path | fresh vesthelm | cluster CI95 | median spend | utility mean | kit |
| --- | ---: | ---: | ---: | ---: | ---: |
| START | 42.6% (n=310) | 35.3–50.9% | 5,250 | 3.89 | 58.7% |
| W | 65.4% (n=52) | 53.3–78.7% | 5,600 | 3.97 | 75.0% |
| L | 50.0% (n=68) | 33.3–65.3% | 5,250 | 3.99 | 73.2% |
| WW | 100% (n=26) | 100–100% | 5,850 | 3.96 | 100% |
| WL | 56.0% (n=25) | 40.0–75.0% | 5,600 | 3.60 | 44.0% |
| LW | 68.8% (n=16) | 52.6–86.7% | 5,325 | 3.81 | 75.0% |
| LL | 16.1% (n=31) | 3.2–31.1% | 3,850 | 2.52 | 6.5% |

真实结构是：OT1 的 CT fresh Kevlar 略占多数，但 OT2 并不“通常继续省头”；OT3
只有极端 `WW` 与 `LL` 显示大差异，其他 path support 小且不形成统一断点。
`LL` 同时出现更低 spend、更少 utility、更少 kit、更多 SMG/无 primary，说明 helmet
变化与当前 own bundle opportunity cost 同步，而不是独立的 OT helmet rule。

对“已有 100 armor、无 helmet”的 exact replay-end cohort，clean support 总计仅
7 行，不能裁决独立 upgrade path。

CT OT1 已是完整 rifle/AWP + utility 购买：rifle 78.7%、sniper 20.7%、smoke
97.4%、fire 96.1%、flash1 96.8%、HE 94.5%。除了 `LL` 当前经济收缩外，没有
另一种稳定的 OT allocation mode。

### 2.4 T

T 的 fresh helmet 在 START/W/L/WW/WL/LW 为 100%，LL 仍为 98.0%（n=49，
cluster CI95 94–100%）。OT1 median spend 4,900、utility mean 3.90；即使 LL，
median spend 4,600、utility mean 3.18。T 没有值得产品化的 OT 特例。

### 2.5 OT 裁决

**当前 generic own-state / trajectory 已足够，OT 不需要独立 purchase policy。**

tracker 必须正确产生 `OVERTIME` lifecycle、half reset 与 current money/inventory
FACT；planner 不需要 `OT1/OT2/OT3 path table`。10k reset 后的 own state、当前
retained loadout 和剩余预算已经解释可见差异。

## 3. B — Utility allocation

### 3.1 可部署 representation

utility planner 的条件状态为：

- side；
- 当前真实 retained grenade / kit；
- 已确定的 economic mode；
- 已确定的 resulting primary family 与 armor state；
- `utilityBudget = startMoney - nonUtilitySpend`；
- `POST_PISTOL | NORMAL`、score/loss/round context。

输出是 resulting bundle 的 `smoke / fire / flash1 / flash2 / HE / CT kit`。
这与 deterministic planner 的“先锁主要装备，再在剩余预算与槽位内补 utility”顺序
一致，但不声称职业选手在商店中的点击 chronology。

### 3.2 budget-dependent priority

以下是无 retained utility 的高 support cohort。它表明不存在一条与价格无关的
全局排序，稳定结构是**价格可达的 bundle**：

1. 仅有 200–299 utility budget 时，第一闪是唯一高频项：CT FORCE 71.6%
   (n=102)，T FORCE 72.4% (n=58)。
2. 300–399 时，smoke 明显优先：CT FULL/FORCE 88.9%/85.1%
   (n=172/134)，T 81.8%/82.6% (n=137/109)；同价 HE 仅约 5–8%。
3. 500–599 时，`smoke + flash1` 成为稳定 bundle：CT FULL 为
   90.1%/95.4% (n=131)，T FULL 为 85.2%/85.9% (n=135)；FORCE 同方向。
4. 600 以上开始出现明确 side split，不能继续用单一线性 priority：CT 更快加入
   HE，T 在 fire / flash / HE 间分配。

full mode 且 utility budget ≥1,200 时：

| side | n | smoke | fire | flash1 | HE | flash2 | kit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| CT | 3,487 | 97.6% | 97.1% | 89.1% | 90.8% | 5.3% | 43.8% |
| T | 3,507 | 97.2% | 98.0% | 97.6% | 52.5% | 45.2% | — |

因此 CT 与 T 必须使用不同的高预算 template。kit 的个人概率只有 43.8%，反映
团队分配；normal-player own GSI 看不到全队 kit plan，所以它只能是受预算与用户
意图约束的 option，不能成为每位 CT 的 hard default。

### 3.3 HE vs second flash

在 final four-slot bundle 已有 `smoke + fire + flash1`，且第四槽严格为
`HE XOR flash2` 的直接比较中：

- CT：n=4,735，HE 94.72%，match-series cluster CI95 93.81–95.57%；
- T：n=4,978，HE 49.84%，cluster CI95 47.19–52.52%。

这给出一个稳定、可压缩的 side rule：**CT 最后一槽 HE 优先于第二闪**。
T 是真实近 50/50 选择，不能硬编码统一优先项。

### 3.4 Map ablation

`map.name` 已在 ordinary normal-player GSI schema 中直接可见，因而是合法候选；
地图位置、anchor/rotator 与职业 role 仍被禁止。

base vs base+map 的 5-fold match-series held-out 结果：

| metric | base | +map | improvement | cluster CI95 | folds |
| --- | ---: | ---: | ---: | ---: | ---: |
| macro item log loss (bits) | 0.4184 | 0.4143 | 0.0042 | 0.0031–0.0052 | 5/5 正 |

单项增量主要集中在 HE（+0.0110 bits，Brier 0.1259→0.1230）与 flash2
(+0.0083 bits，Brier 0.1112→0.1086)；smoke/fire/flash1 只有
0.0009–0.0014 bits，kit 反而 -0.0008 bits。

T 的 HE-vs-flash2 有明显 descriptive map split，例如 HE rate：Dust2 30.9%、
Mirage 39.4%、Inferno 66.6%、Anubis 65.3%。但整体平均增量低于 0.005 bits
product gate，且来源是单一职业赛事的 preference，不是普通玩家最优结果。

**Map：NO-GO。** 不创建 map-specific rule table；上述差异只保留在 artifact 中，
不进入 V3 runtime。

### 3.5 可进入 deterministic planner 的最小规则

允许压缩为 deterministic template：

1. 始终先尊重 retained utility、side legality、价格与四槽/双闪机械约束；
2. budget 仅够 200 时补 flash1；仅够 300 时 smoke 优先于 HE；500 时优先形成
   `smoke + flash1`；
3. CT 高预算 core 为 `smoke + fire + flash1 + HE`，最后一槽不以 flash2 替代 HE；
4. T 高预算 core 为 `smoke + fire + flash1`，第四槽保留
   `HE | flash2` 两个合法 alternative，不给职业频率包装成最优 Top-1；
5. CT kit 是独立、不占 grenade slot 的 supported option；没有 team plan 时不做
   每人 hard default；
6. 不按 map、职业 role 或位置改写上述规则。

只能保留为 descriptive probability、不能硬编码：

- T 的 HE vs second flash；
- 每位 CT 是否承担 kit；
- 600–1,199 中不同 full/force bundle 的精细频率；
- 任何 map-specific utility preference；
- 任何购买 chronology。

## 4. C — Regulation trajectory-state sufficiency

### 4.1 current state 与 bounded history

current baseline 只使用 normal-player 可部署的：side、money、loss counters、
score/round/context、当前 inventory；major/utility stage 依次加入已经确定的
mode、primary、armor 与 utility budget。

bounded history 只增加完整 half 内最近 1–3 轮的 W/L 与 witnessed T plant。
没有使用 survivors、kills、spend、身份、对手 loadout 或当前轮结果。

### 4.2 held-out increment

| target | current log loss | +history | improvement | cluster CI95 | 正向 folds |
| --- | ---: | ---: | ---: | ---: | ---: |
| economic mode | 0.5632 | 0.5637 | -0.0005 bits | -0.0034–0.0024 | 3/5 |
| major primary family | 0.4207 | 0.4211 | -0.0003 bits | -0.0022–0.0013 | 1/5 |
| utility allocation | 0.4184 | 0.4194 | -0.0009 bits | [-0.0012, -0.0007] | 0/5 |

没有 target 接近 +0.010 bits practical gate。

current baseline 已显式表达完全 deployable 的
`side × context × money/loss` 交互，避免把线性 estimator 欠拟合误认为
history 价值。在这个 adequate current-state baseline 上，POST_PISTOL 子集增量为
-0.0027 bits（CI -0.0075–0.0020），不支持新增 sequence state。

进一步的 POST_PISTOL 定向检查：

- `current + previous outcome`：-0.0030 bits，CI -0.0081–0.0019；
- 再加 witnessed plant：-0.0035 bits，CI -0.0090–0.0020；
- T-only previous plant：+0.0012 bits，CI -0.0058–0.0073，3/5 folds 为正。

这与 frozen post-pistol 结论一致：plant 的原始 FORCE 关联主要由当前 money 吸收；
`POST_PISTOL` 与当前经济 state 已经表达了可部署差异。

### 4.3 trajectory 裁决

**current V3 state 基本充分；bounded trajectory history：NO-GO。**

不新增：

- W/L sequence enum；
- high-support motif table；
- sequence cluster；
- `POST_PISTOL_WON/LOST/PLANTED` 的新 purchase-policy state。

现有 tracker 仍可保留完整历史用于 FACT integrity、loss/score tracking 与
mechanical trajectory scenario，但 V3 购买建议不因本研究增加一个 history-driven
policy branch。

## 5. V3 architecture 是否修改

**不修改 `docs/policy-v3-architecture.md`。**

理由：

- architecture 已有 `round.context=OVERTIME`、当前 money/inventory 与 UNKNOWN
  boundary；OT 只要求 tracker 正确处理 reset，没有新 purchase state；
- utility planner rule 是现有 mode/primary/armor/own inventory 上的 strategy
  distillation，不改变 owner、FACT/INFERENCE/ADVICE 或 public contract；
- map 与 bounded history 均 NO-GO；
- opponent economy、helmet weak-evidence、T/CT post-pistol multimodality、AWP
  preference 与 C4 边界均未被推翻。

## 6. Remaining limitations

只保留当前 professional corpus 不能解决的限制，不由此创建新任务：

1. **ordinary-player domain shift**：职业赛事内 held-out 稳定不证明普通玩家的
   utility preference、kit coordination 或 mode calibration；Policy V3 长期仍需普通
   玩家 label 校准。
2. **optimality / causality**：职业购买频率不能证明某 bundle 提高胜率；本报告只锁
   deterministic default 与 alternative 的可解释 evidence，不声称最优。
3. **真实商店 chronology**：event package 没有逐笔购买日志；只能恢复 pre-state
   与 freeze-end bundle。
4. **team utility/kit coordination intent**：own normal GSI 与当前 corpus 都不能把
   团队战术分工转化为可靠的个人 FACT；因此 kit 和 T 第四槽必须保留 alternative。
5. **少量 weapon transfer pre-state**：frozen `correctedRetainedPrimary=UNKNOWN`
   的 114 行已排除；replay 末帧只记录 active weapon，不能补成完整、无歧义的
   pre-decision weapon inventory。

## 7. 最终状态

**READY FOR POLICY V3 IMPLEMENTATION: YES**

**ECONOMY RESEARCH CLOSED: YES**

唯一允许的长期经济后续是既定的 ordinary-player domain-shift calibration；本报告
不打开 OT、map、trajectory、role、opponent 或更复杂模型的新 research branch。
