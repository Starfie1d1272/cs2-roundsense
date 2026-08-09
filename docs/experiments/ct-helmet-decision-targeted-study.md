# RoundSense：CT Helmet Decision targeted study

状态：**final / targeted research**

日期：2026-08-09
产品裁决：**B — weak evidence**

## 0. 一句话结论

职业 CT 的 helmet 选择主要由自己的现金、当前整套购买与回合阶段解释；normal-player
GSI 对手背景对完整 fresh purchase surface 有极小的 held-out 概率改善，但对真正的
Kevlar-vs-vesthelm 决策没有稳定的实质增量，也几乎没有能力高覆盖地证明“对手
helmet threat 很低”。因此 **不批准独立 helmet-threat inference**，
`LIKELY_ESTABLISHED_RIFLE` 不得驱动省头，只能在 own-state 已形成近似平局时作为
非约束性的轻量 reason/tie-break。

职业行为只作为 observational evidence，不代表最优策略或因果效应。

## 1. 权威输入与可重跑入口

- production：`main @ 37a9756`；
- frozen economy evidence：`research/economy-policy @ 0875db9`；
- final post-pistol research：`research/post-pistol-strategy @ ac8444f`；
- V3 architecture lock：`starfie1d/policy-v3-architecture-lock @ 7c652a2`；
- frozen `player-rounds.json` SHA-256：
  `33f29c35fb124a4e45d38a00be8f389d32403c0762576b607db7a9a37fe0d9e6`；
- canonical DAK weapon display/family source SHA-256：
  `c08ff5380cab5267cb4c3175be9abcd19c5453616ef5ebd2db4e74305506b2cb`；
- weapon mechanics：Valve game-data mirror
  [`weapons.vdata @ 2e606a0`](https://github.com/SteamTracking/GameTracking-CS2/blob/2e606a0bc54f619bc96689ae29cddc337cbde60a/game/csgo/pak01_dir/scripts/weapons.vdata)，
  SHA-256 `fbd0d6f754c234efb24ec5c6b8c335f190e67f17ac7ec98dc2cd2ea2ddb4037e`。

实现与结果：

- frozen source、派生 mechanics 表与机器可读结果保留在
  [`research/ct-helmet-decision @ d194d17`](https://github.com/Starfie1d1272/cs2-roundsense/tree/d194d17/experiments/ct-helmet-decision)；
- mainline 只保留本结论报告，避免把一次性大型研究资产作为 production surface。

重跑：

```bash
git worktree add /tmp/roundsense-helmet-study d194d17
cd /tmp/roundsense-helmet-study
uv run --script experiments/ct-helmet-decision/helmet_decision_study.py --check
```

如需从 pinned raw `weapons.vdata` 重建 mechanics artifact：

```bash
uv run --script experiments/ct-helmet-decision/helmet_decision_study.py \
  --weapon-vdata /path/to/pinned/weapons.vdata
```

脚本校验 corpus、weapon display source 与 raw vdata 的 SHA。结果文件包含 runtime
版本、输入 hash 和 $350 replay extraction hash。

## 2. 数据门禁与 cohort

### 2.1 为什么不能从 resulting helmet 直接反推

冻结 player-round table 同时包含：

- 决策前：`startMoney`、`retainedArmor`、`retainedHelmet`、retained inventory；
- 决策后：`moneySpent`、`hasArmor`、`hasHelmet`、resulting inventory。

因此只有 pre-state → resulting-state transition 才是本轮选择：

- `retainedHelmet=false && hasHelmet=true` 才计为本轮买头；
- inherited helmet 不进入本研究；
- `startMoney` 不用 current/resulting money 替代；
- current resulting opponent loadout 只进入 oracle，不进入 live predictor。

`retainedArmor` 只有 boolean，不能证明上一轮末 armor=100。对 $350 upgrade 的
secondary cohort，脚本读取同一 frozen event package 的上一轮 `replay.json` 最末
sample：schema 定义 `armor` 为 plain 0–100，`flags & 1` 为 alive。只有 alive 且
armor=100 才认定为真正 $350 选择。887 个布尔候选中，74 个末帧非 alive、270 个
armor≠100，最终保留 543 个；extraction SHA-256 为
`7ff65e6127688b3560983d15e497e1b0d62d6e7ebda5c7140224a5980c48bd89`。

### 2.2 Primary：fresh purchase

主 cohort 先定义完整的 fresh choice set：

- CT；
- regulation、非 R1/R13；
- 决策前 `retainedArmor=false && retainedHelmet=false`；
- `startMoney >= 1000`，三种选择都在初始预算内；
- 无 drop-gave/drop-received contamination；
- own 与 opponent reconstructed loss index 均不 ambiguous；
- 前一轮 history 完整；
- corrected retained primary 不为 `UNKNOWN`。

有效样本 6,687 player-round，106 match series、160 名选手：

| resulting choice | n | share |
| --- | ---: | ---: |
| no armor | 848 | 12.68% |
| Kevlar | 2,558 | 38.25% |
| vesthelm | 3,281 | 49.07% |

真正的 helmet target 单独限制为“已经买甲”的 5,839 条：Kevlar 2,558、vesthelm
3,281，买头率 56.19%。这避免把整轮 eco/no-armor 与 $350 helmet margin 混为一类。

### 2.3 Secondary：已有满甲的 $350 upgrade

严格定义为：上一轮末仍存活、armor=100、无 helmet，本轮 startMoney≥350。
有效样本 543，104 match series、137 名选手：买头 396、skip 147，买头率
72.93%。该 cohort 只作 secondary 稳健性检查，不与 fresh target 合并训练。

## 3. 方法与泄漏控制

### 3.1 三层特征

**Own-state only**：start money、retained own primary family/secondary/grenades/kit、
own loss index、上一轮己方胜负、round-in-half、公开比分。所有字段都锚定在购买前。

**Own + deployable opponent context**：只追加 architecture lock 已批准的
opponent public loss index、上一轮胜负、上一轮 witnessed plant、当前半场此前连续
胜轮数。禁止 opponent exact money、retained/current/resulting weapon、AWP、
survivor、kill、spend、team/player identity 和 current-round result。

**Demo oracle**：只用于 label/机制解释，读取 opponent resulting main firearm
（primary 优先，否则 secondary）和真实 weapon mix。

### 3.2 Validation

- 简单 logistic / multinomial logistic，不追求复杂模型；
- primary：deterministic 5-fold held-out by match series，同一 match 不跨 fold；
- sensitivity：deterministic 5-fold held-out by player，同一 player 不跨 fold；
- 不输入 team/player identity；
- paired delta 用 1,000 次 match-series cluster bootstrap；
- 同时报告 fold 与 money/round-stage subgroup stability。

match-series 与 player 是交叉结构，无法在保持 5-fold 支持量时用一个 split 同时把
两者完全隔离；因此两种 grouping 独立报告，不用较好的那一个替代另一种。

## 4. Own-state only 的解释能力

### 4.1 Fresh 三分类（no armor / Kevlar / vesthelm）

| model | held-out log-loss | Brier | accuracy | macro-F1 |
| --- | ---: | ---: | ---: | ---: |
| prevalence only | 0.9803 | 0.5980 | 49.07% | 0.2194 |
| own-state only | **0.6073** | **0.3629** | **72.23%** | **0.6998** |

player-held-out sensitivity 为 log-loss 0.6105、accuracy 72.41%、macro-F1 0.7032。
这说明完整 fresh purchase surface 主要由 own-state 决定。

### 4.2 Fresh Kevlar vs vesthelm

| model | AUC | Brier | log-loss | accuracy |
| --- | ---: | ---: | ---: | ---: |
| prevalence only | 0.4746 | 0.2465 | 0.6860 | 56.19% |
| own-state only | **0.8492** | **0.1548** | **0.4730** | **76.86%** |

player-held-out AUC 0.8461、Brier 0.1562，结论保持。

### 4.3 $350 upgrade secondary

own-state-only held-out AUC 0.9140、Brier 0.1027、accuracy 86.37%；
player-held-out AUC 0.9144。它比 fresh target 更容易由 own-state/round-stage 解释，
但 n=543，不能反过来主导 fresh policy。

## 5. Normal-GSI opponent context 的增量

### 5.1 Fresh 三分类

追加 opponent context 后 log-loss 0.6073→0.6007（−0.0066，cluster-bootstrap
95% CI [−0.0104, −0.0030]），Brier −0.0026；五个 series-held-out folds 的
log-loss 都改善。但 accuracy 72.23%→71.95%，macro-F1 0.6998→0.6996；
player-held-out 也只有 log-loss −0.0064。

这是可重复但产品量级很小的概率校准信号，不能证明它能决定 helmet skip。

### 5.2 Fresh Kevlar vs vesthelm

追加后 AUC 0.8492→0.8501（+0.0009，95% CI [−0.0004, +0.0025]），Brier
−0.0004（CI [−0.0012, +0.0002]），accuracy 反而下降 0.25pp。五 folds 中 AUC
两升、两降、一持平；post-pistol AUC −0.0064，低金额 subgroup −0.0088。

这不是稳定、实质的 held-out helmet-choice 增量。

### 5.3 $350 upgrade

追加后 AUC 0.9140→0.9197（+0.0057，95% CI [−0.0017, +0.0142]），Brier
−0.0007（CI [−0.0054, +0.0037]）。方向略正，但不确定性跨 0，且 folds/subgroups
的 Brier 方向不一致，只能作为 secondary weak evidence。

## 6. Demo-oracle weapon mix

### 6.1 可复现的 helmet-sensitive 定义

不是手写武器列表。脚本从 pinned `weapons.vdata` 解析 `m_nDamage`、
`m_flHeadshotMultiplier`、`m_flArmorRatio`、`m_nNumBullets`，定义：

> 单 projectile 武器在零距离对 100 HP 的头部命中，无头盔时致死、戴头盔时不致死。

计算为：

- unhelmeted = `damage × headshotMultiplier`；
- helmeted = `unhelmeted × armorRatio / 2`；
- `unhelmeted >= 100 && helmeted < 100` 才属于 helmet-sensitive。

例如 pinned data 给出：AK-47 144/111.6（不属于该类）、Galil 120/93、MAC-10
116/66.7（属于）、Tec-9 132/119.592（不属于）。MAG-7/XM1014 是 multi-projectile，
artifact 明确记为 UNKNOWN，不猜测；本研究进入 oracle/推断的 cohort 没有因此丢行。

这是零距离的一击生存阈值，不声称覆盖所有距离、穿透、低血量或多 pellet 命中。

### 6.2 原始行为梯度

Fresh armor buyers：

| opponent sensitive count | n | skip helmet |
| ---: | ---: | ---: |
| 0 | 2,443 | 53.42% |
| 1 | 1,219 | 41.18% |
| 2 | 729 | 33.47% |
| 3 | 649 | 39.45% |
| 4 | 519 | 35.07% |
| 5 | 280 | 24.64% |

存在 threat 时 skip 36.90%，不存在时 53.42%，方向明确；但 2→3 和 3→4 并非
严格单调，不能宣称平滑 dose-response。$350 upgrade 的对应值是 21.93% vs
43.75%，count=5 时 skip 仅 4.72%，但中间档同样有噪声。

### 6.3 “成熟长枪经济”不是 helmet threat

Fresh cohort 的 oracle cross-tab：

| established rifle | sensitive threat | n | skip helmet |
| --- | --- | ---: | ---: |
| no | no | 205 | 6.34% |
| no | yes | 989 | 8.39% |
| yes | no | 2,238 | 57.73% |
| yes | yes | 2,407 | 48.61% |

职业选手在 established rifle economy 下确实更常省头，但其中 51.82% 的样本仍有
至少一个 sensitive weapon；同为 established 时，有 threat 会把 skip rate 从
57.73% 压到 48.61%。因此“成熟经济”与省头相关，却不能推出“头盔无价值”。

然而把真实 threat count 加到 own-state 模型，fresh AUC 只从 0.8492 到 0.8509，
Brier −0.0006，bootstrap CI 跨 0；upgrade 甚至不改善。weapon mix 揭示了合理机制，
但其大部分行为关联已被 money/round-stage/own loadout 吸收。

## 7. $350 opportunity cost

### 7.1 Fresh Kevlar vs vesthelm

Kevlar skip 的 startMoney median $4,400、spend median $4,250、remaining median
$100；71.34% 在完成实际 basket 后余款 <$350。在这些 binding skips 中：

- 87.40% 同期新增 smoke / fire / kit 至少一项；
- 100% 同期新增 primary、paid secondary、smoke、fire 或 kit 至少一项。

这表明 $350 对 fresh 整套购买经常是真实 margin，而不是“明明什么都不缺却习惯性
不买头”。但 vesthelm 组资金更高，utility/kit 购买率也更高；这是 observational
association，不能声称某件道具因果替代 helmet。

Fresh 三分类的 own-state差异也很大：no-armor median start/spend/remaining 为
$2,400/$0/$2,150；Kevlar 为 $4,400/$4,250/$100；vesthelm 为
$5,450/$5,200/$300。no-armor 是独立 economy mode，不能并入 helmet skip。

### 7.2 $350 upgrade

upgrade skip 的 median start/spend/remaining 为 $2,650/$300/$2,200，只有 10.20%
在实际 basket 后余款 <$350。这一 secondary cohort 中，很多 skip 不是即时预算硬约束；
但 opponent context 与真实 threat 仍未提供足够的 held-out product gain，不能据此实现
“对面大枪就省头”的规则。

## 8. 独立 helmet-threat inference gate

在 3,790 个唯一 regulation CT team-round perspective 上，以真实
`sensitive_count>=1` 为 oracle label：

| deployable model | AUC | Brier | p≤0.20 / p≥0.80 coverage | high precision | low n |
| --- | ---: | ---: | ---: | ---: | ---: |
| direct GSI | 0.7400 | 0.2007 | 17.23% | 88.21% | 0 |
| direct + tracked | 0.7450 | 0.1985 | 18.68% | 89.47% | **15** |

tracked model 可以在有限覆盖下说“很可能存在 threat”，但几乎不能说“很可能没有
threat”：low 输出只覆盖 15/3,790（0.40%）。post-pistol 的 high 覆盖主要来自
Glock 等 sensitive pistol 的高 base rate（95.79%），不是精细 weapon-mix recovery。

这不足以建立能驱动 skip 的独立 inference。若未来普通匹配 demo 重新校准，可以只
重新审计 one-sided `LIKELY_HELMET_THREAT_PRESENT | UNKNOWN`；当前不批准加入 V3。

## 9. 对 `LIKELY_ESTABLISHED_RIFLE` 的裁决

现有 coarse class 对真实 threat 的映射：

| class | n | actual threat present | actual no threat |
| --- | ---: | ---: | ---: |
| `LIKELY_ESTABLISHED_RIFLE` | 2,116 | 53.73% | 46.27% |
| `LIKELY_NOT_ESTABLISHED_RIFLE` | 216 | **92.13%** | 7.87% |
| `UNKNOWN` | 1,458 | 60.97% | 39.03% |

`LIKELY_NOT_ESTABLISHED_RIFLE` 在本语料主要对应 pistol/SMG-rich states，恰恰更常有
helmet-sensitive weapon；`LIKELY_ESTABLISHED_RIFLE` 又接近一半一半。因此：

- **不得**把 `LIKELY_ESTABLISHED_RIFLE` 翻译为“对面都是 AK/AWP，头盔没价值”；
- **不得**用它单独创建、删除或默认选择 skip-helmet plan；
- 只允许在 own-state 已把 Kevlar 与 vesthelm 判成近似平局、且两者都合法可负担时，
  作为非常轻的 explanation/ranking tie-break；
- `UNKNOWN` 删除 opponent-specific helmet reason；
- `LIKELY_NOT_ESTABLISHED_RIFLE` 不能作为省头信号，最多支持保守买头的说明。

## 10. 产品裁决与唯一推荐

### 裁决

**B. 只有弱 evidence。** opponent context 对完整 fresh purchase 的概率校准有可重复
但很小的增量；对 helmet margin 的 binary choice 不稳定，低-threat inference 几乎无
coverage。它只能是轻 reason/tie-break，不能驱动 skip helmet。

### 唯一推荐

Policy V3 的 CT helmet 规则应采用 own-state conservative fallback：

> fresh 买甲时默认 vesthelm；只有当额外 $350 会阻断当前 plan 中更高优先级且明确的
> own-state 购买（primary、关键 utility、kit 或 trajectory constraint）时，才保留
> Kevlar alternative。已有满甲无头时同样默认提供 $350 upgrade；coarse opponent
> economy 不得主动把默认改成 skip。

这是一条 policy recommendation，不把职业频率冒充 optimal truth。若 output 是
multimodal，Kevlar 可作为 own-state opportunity-cost alternative；不能以 inferred
opponent loadout 伪装成确定事实。

## 11. Remaining limitations / domain shift

- 单一职业赛事语料；ordinary matchmaking 的购买、枪械混合与历史完整度会漂移；
- player-held-out 与 series-held-out 分开验证，无法在同一 5-fold 中同时隔离交叉的
  match/player 图；
- weapon-sensitive 定义是零距离单 projectile 一击阈值，不覆盖距离衰减、穿透、
  多 pellet、低 HP 或交火序列；
- opponent mix 是 freeze-end resulting loadout，不代表选手在购买时知道 exact mix；
- `moneySpent` 没有购买顺序，机会成本只能解释共现与预算 binding，不能做因果归因；
- team drop/transfer 只通过 frozen heuristic 排除，无法恢复完整购买 chronology；
- upgrade cohort n=543，部分 subgroup 很小，只能作 secondary；
- 职业行为不是 optimal truth，不能直接映射为胜率收益。

## 12. Readiness

- 独立 helmet-threat inference：**NOT APPROVED**；
- `LIKELY_ESTABLISHED_RIFLE` 驱动 skip：**PROHIBITED**；
- conservative own-state helmet fallback：**定义完成，可实现**。

**READY FOR HELMET POLICY IMPLEMENTATION: YES**
