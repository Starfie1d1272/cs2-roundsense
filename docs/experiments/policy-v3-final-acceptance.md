# Policy V3 最终产品行为验收

基线结论：**FAIL**；本 follow-up 重跑结论：**READY FOR FINAL SOL RE-AUDIT**。

本报告保留 `feat/policy-v3-core @
5a2fa8e1e12b2644b5d6a71afb2997286fef445f` 的 frozen baseline，并记录在同一
corpus/harness 上对 production `3e1b301ff2ab96ad9d99b3d3b66957a69b5f4835` 的
严格收敛修复。follow-up 没有修改 opponent artifact、C4、研究结论、eligibility、
baseline 或 discrepancy taxonomy。

机器可读结果：`experiments/policy-v3/results/policy-v3-final-acceptance.json`，
follow-up artifact SHA-256：
`a65effbfc132a9da29bfa733781e2d2ca688ccf34e12493275522677fa9dd9b6`。

## 1. Corpus、输入边界与 eligibility

- frozen player-round corpus：43,620 行，SHA-256
  `33f29c35fb124a4e45d38a00be8f389d32403c0762576b607db7a9a37fe0d9e6`；
- 202 个 map package；IEM Cologne Major 2026；`cs2-demo-format/3.0`；
  `cs2df 3.1.0`；`demoparser2 0.41.3`；
- eligible：23,552 player-round（regulation 22,428；OT 1,124）；
- replay pre-state：请求 23,352，恢复 23,352，0 missing；OT 每个 MR3 half
  首轮使用已核实的 $10,000 reset 与空 retained inventory；
- production state 只含 own side/money/inventory/loss index、round/context、
  score 与 opponent loss index；resulting spend/loadout、replay end
  armor/kit/grenades 和职业 action type 只用于 pre-state 恢复或事后 label；
- 未向 `recommendPolicyV3()` 提供 opponent exact state、teammate hidden
  purchase、identity/role、position/spawn、future result/kill。

Exclusions 按互斥顺序记账：regulation drop-gave 9,842、drop-received 5,103、
loss-index ambiguous 1,009、pistol 3,028、retained-primary unknown 114；OT
drop-sensitive 552；resulting grenade 低于 replay-end retained 419；utility
budget 越界 1。合计 20,068，`43,620 - 20,068 = 23,552`。

比较使用 `eco → PRESERVE`、`semi → LIGHT`、`force → FORCE`、
`full → FULL`。exact 是确定性 option 顺序的首项；compatible 检查完整
recommendation set 与 conditional alternatives。只有 1,747/23,552（7.42%）
状态有 declared `defaultOptionId`，因此 exact 不能解释为其余状态的强制 Top-1。

## 2. Mechanical invariant

审计了 55,275 个 V3 option/conditional candidate。

| invariant | violations |
| --- | ---: |
| recommendation 不超预算 | 0 |
| side legality | 0 |
| grenade slots ≤ 4 | 0 |
| flash ≤ 2 | 0 |
| retained rifle/AWP 不 downgrade | 0 |
| FORCE 不留明显 strategic bank | **20** |

另有以下 targeted checks 全部通过：required UNKNOWN 不被默认补值；PISTOL
明确 unsupported；NORMAL 与 OT 使用同一 generic policy；C4 remaining 保持
UNKNOWN；opponent UNKNOWN 不改变 recommendation set；LOSS_NO_PLANT projection
0 mismatch。

20 个 blocker 全部为 CT：16 个 NORMAL、4 个 POST_PISTOL，分布于 16 张 map
instance。lead FORCE 已有或买到 SMG/rifle、Kevlar 与四颗完整 utility，却留下
$1,150–$1,900；此时 $350 helmet upgrade 仍可由 own state 无歧义地负担。
它既是明显 FORCE bank，也是 CT helmet opportunity-cost 路径遗漏。由于任务规定
任何 mechanical invariant violation 直接记为 blocker，本项单独已经足以 FAIL。

## 3. Major behavioral alignment

职业行为只作为 behavioral reference，不作为 optimal-policy truth。

| 指标 | V3 lead exact | V3 compatible |
| --- | ---: | ---: |
| mode | 70.43% | 84.35% |
| primary family | 65.69% | 86.90% |
| armor state | 61.55% | 79.31% |
| armor presence | 81.87% | 92.74% |
| helmet | 72.74% | 83.80% |
| utility multiset | 38.94% | 58.61% |
| CT kit | 90.63% | 98.61% |

Utility feature compatible coverage：smoke 87.31%、fire 86.36%、flash1
86.59%、flash2 91.47%、HE 85.73%。

Spend：lead MAE $703.58、median AE $100、p90 AE $2,300、mean signed
+$145.87；best recommendation-set MAE $299.44、median AE $0。相同 zero-kill、
no-drop `LOSS_NO_PLANT` scenario 下，next-money MAE 与 spend MAE 相同，policy
相对 actual 的下一轮 money mean signed 为 −$145.87。没有把未来 kill/drop/
transfer 导致的真实 observed difference 记成 policy error。

## 4. Baseline comparison

naive affordability 依次尝试 rifle+armor、SMG+armor、pistol+armor、pistol、
save。V2 reference 是默认 `rifle_armor` fixed-tier 的 recommended + 两个
alternatives，仅作离线 reference。

| 指标 | V3 lead / set | naive | V2 lead / set |
| --- | ---: | ---: | ---: |
| mode | 70.43% / 84.35% | 68.08% | 53.40% / 67.48% |
| primary family | 65.69% / 86.90% | 66.56% | 66.56% / 91.63% |
| armor state | 61.55% / 79.31% | 32.41% | 65.17% / 81.05% |
| utility multiset | 38.94% / 58.61% | 15.15% | 16.47% / 18.69% |
| spend MAE | $703.58 / $299.44 | $1,181.98 | $791.24 / $550.57 |
| severe-any | 50.37% | 86.02% | 64.36% |

V3 相比 naive 与 V2 有明确整体价值，尤其在 mode set、utility、spend 和
severe-any；但 lead primary family 比 naive 低 0.87pp，armor presence 比
naive 低 5.11pp。因此结果不是“所有维度全面胜出”。PASS 失败原因不是 baseline
没有价值，而是下面的机械 blocker 与重复 subgroup failure。

## 5. Material discrepancy attribution

Material 定义为 lead 在 mode、primary、armor state、utility multiset、kit 任一
不同，或 absolute spend difference ≥ $1,000。17,845/23,552 为 material。
每一行按固定 precedence 赋一个 primary reason：

| reason | count | eligible rate |
| --- | ---: | ---: |
| `COVERED_ALTERNATIVE` | 4,671 | 19.83% |
| `UNAVAILABLE_CONTEXT` | 1,088 | 4.62% |
| `ROBUST_GENERAL_DEFAULT` | 5,161 | 21.91% |
| `DATA_AMBIGUITY` | 30 | 0.13% |
| `POLICY_MISS` | **5,984** | **25.41%** |
| `UNEXPLAINED` | **911** | **3.87%** |

`COVERED_ALTERNATIVE` 只在非首项 candidate 与 actual 的 mode、primary、armor、
utility、kit 全部一致且 spend difference < $1,000 时使用；没有用“有某个更像的
candidate”放宽归因。`ROBUST_GENERAL_DEFAULT` 只覆盖 mode、primary 与 armor
presence 已一致，剩余差异是 helmet/utility/spend 的标准化普通玩家 default。

## 6. Severe mismatch 与 subgroup

Severe-any 11,862（50.37%）；它是多个 component flag 的 union，不等同于
POLICY_MISS。主要 component：primary family 8,081；spend ≥ $1,000 6,525；
helmet 6,420；armor presence 4,270；V3 FORCE / actual ECO 2,053；V3
PRESERVE / actual FULL 494；V3 FULL / actual ECO 178。多数 FORCE/ECO 差异可由
set 中的 PRESERVE 覆盖，因此没有把全部 2,053 直接当 policy miss。

持续失败的 subgroup：

- actual `LIGHT`：2,330；V3 exact 0、compatible 0。V3 在全部 23,552 个状态中
  一次也没有 offer `LIGHT`，说明该 contract 分支在当前实际输入域不可达；
- POST_PISTOL actual `FULL`：992；mode compatible 0。该 context 的 best-set
  spend MAE 只有 $165.78，说明一部分是 FORCE/FULL mode 表达和 bundle label
  不一致，但产品 mode coverage 仍为系统性缺口；
- POST_PISTOL：mode exact 38.56%、compatible 65.78%、lead spend MAE
  $1,325.38；CT severe 89.24%、T severe 69.71%；
- money $2,000–2,999 与 $3,000–3,999 的 severe rate 分别为 81.39% 和
  73.46%；retained-primary 状态 severe 约 23%，empty inventory 约 55%，失败
  明显集中于 fresh/低中钱状态；
- OT mode exact 约 98.7%、compatible 约 99.4%，没有显示需要 OT-specific policy。

最重要的 POLICY_MISS 是 `LIGHT` mode 的零可达性；最重要的 mechanical miss 是
上述 20 个 CT FORCE helmet/bank 状态。UNEXPLAINED 为 911，不为零，但没有被
强行改写成职业“不最优”或其他 post-hoc reason。

## 7. Opponent deployment consistency

- runtime artifact 只使用 direct normal-player GSI feature：opponent side、
  round-in-half、score difference、opponent loss index；tracked history 未进入
  final runtime classifier；
- production artifact 从冻结脚本重新生成后逐字节一致，SHA-256
  `582f3a9158b997eb7ed55c433a8509fc4ae66a9f50ed2b6fcd6f3bc3514d28c9`；
- frozen OOF artifact 也逐字节复现，SHA-256
  `197f0f4fbedf9df427a59503285d8cfbc0662b9bedd8ec180adc3e2f35515cca`；
- 继续只引用冻结 5-fold match-series-held-out direct-GSI 证据：AUC 0.9042、
  Brier 0.0967、coverage 65.90%、selective accuracy 95.66%；没有报告
  final-fit 同 corpus training accuracy；
- 23,552 个 replay state 中，把 opponent inference 全部替换为 UNKNOWN 后，
  recommendation-set change 为 0。

## 8. 是否需要重开 research

**不需要。** FAIL 来自当前实现中可直接复现的 mode reachability、option semantics
和 CT FORCE own-state fitting，不需要重新拟合 threshold、增加 Major 规则、
map-specific policy、role inference 或 opponent oracle。

最小修复边界：

1. FORCE 完成 primary/armor/utility fitting 后，若 CT own-state 仍能负担 helmet，
   不得留下上述明显 bank；
2. 让 `LIGHT` 在适用的低中钱/retained 状态真实可达，并补齐 post-pistol
   resulting full bundle 的 FULL/FORCE mode 一致性；不要为此重新拟合 corpus
   threshold。

修复后只需按同一 frozen harness 重跑 targeted invariant、mode/subgroup 与全量
behavioral replay，不需要重开 economy research。

## 9. Follow-up re-audit（production `3e1b301`）

该节是本轮 implementation follow-up 的结果；上文数字仍是 `5a2fa8e` baseline，
用于 before/after 对照，而不是被改写的历史。

### 9.1 三个 P0 修复

1. CT `FORCE` 在主武器、护甲和有效 utility 已拟合后，若 own-state 仍可负担
   $350 helmet upgrade，会重新按原始 inventory 规划并仅在完整 bundle 不超预算时
   加入。`CT_FORCE_STRATEGIC_BANK`：**20 → 0**。
2. `LIGHT` 现在是受控的 partial investment：完整 rifle buy 不可达时，提供独立的
   `SMG + armor` bundle，保留现有 utility，不把剩余预算继续填成 FORCE utility。
   它只在其 spend 严格小于对应 FORCE bundle 时出现，因此不是 FORCE 的改名。
3. `POST_PISTOL` 只在 `history.integrity=COMPLETE` 且上一手枪局 winner FACT 明确
   属于自己时使用 generic/full-ish bundle；pistol loser 保持冻结的 T
   `PRESERVE + FORCE` 和 CT `FORCE-dominant + PRESERVE`。winner 不可得时只给
   无 dominant 的 `PRESERVE + FORCE` supported set。

本轮只消费 tracker 既有 `previousRounds[].winner`；没有新增 RoundContext、对手
private state、role/position、map tactic 或未来结果字段。frozen harness 仅从紧邻
前一回合重建这一 continuous normal-player GSI FACT。

### 9.2 窄诊断

- 2,330 个 actual LIGHT：T/CT 为 1,437/893；2,113 在 NORMAL、214 在
  POST_PISTOL；1,345（57.7%）位于 $3,000–3,999，523 位于 $2,000–2,999。
  2,133 条没有 retained primary、2,033 条没有 retained armor；结果 bundle 以
  no-primary（1,701）和 SMG（421）为主。该标签不是单一金额区间或单一 retained
  loadout，因此未引入 money threshold；production LIGHT 采用可解释的、严格小于
  FORCE spend 的 partial bundle。
- 3,524 个 POST_PISTOL state 中，pistol winner/loss 为 1,740/1,784；992 个
  actual FULL 中 **987（99.5%）** 属于 winner、5 属于 loser，支持 winner/loser
  语义分流。

### 9.3 Before / after

| 指标 | baseline `5a2fa8` | follow-up `3e1b301` |
| --- | ---: | ---: |
| CT_FORCE_STRATEGIC_BANK | 20 | **0** |
| actual LIGHT exact / compatible | 0.00% / 0.00% | **0.04% / 54.16%** |
| POST_PISTOL FULL exact / compatible | 0.00% / 0.00% | **95.97% / 95.97%** |
| POST_PISTOL mode exact / compatible | 38.56% / 65.78% | **69.95% / 93.36%** |
| overall mode exact / compatible | 70.43% / 84.35% | **75.13% / 93.75%** |
| spend MAE, lead / best-set | $703.58 / $299.44 | **$579.08 / $249.95** |
| severe-any | 50.37% | **45.94%** |
| POLICY_MISS | 5,984 | **5,287** |
| UNEXPLAINED | 911 | **581** |

所有回归机械项均为 0：超预算、side legality、grenade slots、flash cap、retained
rifle/AWP downgrade 与 FORCE strategic bank。PISTOL unsupported、required
UNKNOWN、opponent UNKNOWN recommendation-set、C4 remaining UNKNOWN，以及
NORMAL/OT shared generic policy 也保持原有契约。T/CT pistol-loser 定向回归均
保持；没有以改善 winner FULL 破坏 loser policy。

剩余系统性差异仍是 corpus behavioral reference 中的 `POLICY_MISS` 5,287 和
`UNEXPLAINED` 581；本轮没有把它们拟合成职业专用规则。architecture 的唯一行为
变化是消费既有 tracked previous-winner FACT，没有偏离 Policy V3 的
FACT/INFERENCE/ADVICE 与 normal-player deployability 边界。

## Final decision

**READY FOR FINAL SOL RE-AUDIT: YES**
