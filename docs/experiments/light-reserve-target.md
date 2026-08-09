# LIGHT reserve-target diagnostic

状态：**bounded offline diagnostic / architecture evidence**

日期：2026-08-10

研究 parent：`a1e6cd86653ddd71f3901386f67fd793976ed4c4`

## 结论

本轮保留上一轮结论，并把更一般的两个机制拆开判断：

- **H1 SINGLE FIXED NEXT-CASH TARGET：NOT SUPPORTED**；
- **H2 NEXT-BUY LOWER-BOUND / SPENDING-ENVELOPE：PARTIALLY SUPPORTED**；
- **H3 TEAM-SYNCHRONIZATION：NOT SUPPORTED**。

最小 architecture implication 是：LIGHT 不应继续被 fixed `SMG + armor` bundle
定义；NORMAL LIGHT 更适合表达为基于玩家自身可见经济状态的 limited-spend intent，
先给 future-affordability lower bound / spending envelope，再给 secondary bundle
recommendation。这个结构必须允许 context/subtype 使用不同 constraint source；不能收缩成
单一 reserveTarget，也不能使用 production GSI 不可见的 teammate exact money。

## 口径与样本

冻结 player-round 共 43,620 行，输入 SHA-256 为
`33f29c35fb124a4e45d38a00be8f389d32403c0762576b607db7a9a37fe0d9e6`。复用
final acceptance 的 regulation/drop/loss-index、replay pre-state、retained-primary 与
coherence 口径后，eligible 为 23,552；actual observational-semi/LIGHT 为 2,330
（T 1,437；CT 893；NORMAL 2,113；POST_PISTOL 214；OVERTIME 3）。本轮没有修改
eligibility、production source、threshold、POST_PISTOL、C4、opponent、team/drop model
或 UI。

下界诊断使用：

```text
M = current money
S = actual spend
B = current LOSS_NO_PLANT reward
N = M - S + B
reserve_required(G) = max(0, G - B)
max_spend(G) = max(0, M - reserve_required(G))
slack(G) = max_spend(G) - S
```

T/CT 的 `G` 分别采用 AK/M4A4：rifle + kevlar 为 `$3,350/$3,550`，rifle +
vesthelm 为 `$3,700/$3,900`，rifle + kevlar + smoke + flash 为
`$3,850/$4,050`。AWP 不作为普通 LIGHT 下界。

## 1. semi/LIGHT label provenance

冻结包声明 exporter `cs2df 3.1.0`。对应 `cs2-demo-format v3.1.0`
（`0e3e6c712abfbefde40e47192fbe0f4112b5b522`）的
`python/src/cs2df/events.py::_economy_type` 按下列顺序生成
`player-economies.json[].type`：

1. round 1/13 → `pistol`；
2. resulting `equipmentValue >= $4,000` → `full`；
3. `moneySpent < $1,000 && equipmentValue < $1,000` → `eco`；
4. `startMoney > 0 && moneySpent / startMoney >= 0.80` → `force`；
5. 其余 → `semi`。

因此它是**个人 player-round 的 observational semi label**，不是职业选手战略意图
ground truth。直接字段是 round number、start money、money spent 和 resulting
equipment value；primary/armor 不直接分支，但其价格会间接进入 equipment value。
`rounds.json` 的 team economy 是另一套多数票标签，并带 pistol-conversion override。
RoundSense 的研究映射才把个人 `semi` 映射成 LIGHT。

旧 Cologne 表中的 `pro action = semi` 是 exporter 行为标签；同一行的旧
`pro class = eco` 是依据 resulting loadout/比较目的建立的另一分类。因此诸如
`semi $300` 与 `eco` 可以同时成立，并非 corpus 自相矛盾。

## 2. clean team-context sample size

CLEAN TEAM SUBSET 要求同 map/round/side 恰有 5 人，subject 与四名队友均无
raw/derived drop/transfer-sensitive contamination。23,552 个 eligible subject 中纳入
5,589 个、覆盖 1,131 个 team-round；17,943 个因 team drop-sensitive 排除，另有
20 个因队友 residual 为负而排除。actual LIGHT 主分析为 354 人、177 个
team-round。

所有 teammate exact money、purchase、residual 与 transfer 都只属于
**ORACLE RESEARCH CONTEXT**，normal-player production GSI 不可见。

## 3. LIGHT pre-buy team money position

定义 `D_pre = M_i - median(M_teammates)`；team percentile 使用五人 midrank，最低为
0、最高为 1、并列取平均。

| actual mode | clean n | D_pre median | D_pre IQR | team percentile median | D_pre > 0 | richest/tied |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FORCE | 542 | -$250 | $450 | 0.25 | 22.88% | 8.86% |
| LIGHT | 354 | $0 | $518.75 | 0.50 | 48.31% | 21.19% |
| PRESERVE | 1,208 | $0 | $475 | 0.50 | 42.05% | 25.58% |
| FULL | 3,485 | $25 | $550 | 0.50 | 50.36% | 25.31% |

LIGHT 买前不是显著的 team-money positive-outlier mode：其位置接近 FULL/PRESERVE，
而不是一个专门由“较富玩家替团队限购”触发的桶。

## 4. rich-player LIGHT 的 pre/post synchronization

定义 `R_i = M_i - S_i`、`D_post = R_i - median(R_teammates)`。全部 clean LIGHT
的 `|D_pre|` median 为 `$250`，`|D_post|` 反而为 `$450`；paired
`|D_pre|-|D_post|` median 为 `-$100`。

只看 `D_pre > 0` 的 171 个 rich-player LIGHT：

- `D_pre` median/IQR：`$350/$650`；
- `|D_post|` median/IQR：`$475/$750`；
- paired `|D_pre|-|D_post|` median/IQR：`-$50/$800`；
- 只有 66/171（38.60%）在消费后更接近 teammate residual median。

这不是向队友 residual 同步的分布。相同 rich-player 对照中，paired gap reduction
median / closer rate 为 FULL `$150/71.68%`、FORCE `$112.50/66.94%`、PRESERVE
`$0/18.11%`；LIGHT 也没有呈现独特的同步优势。

## 5. low-spend teammate subgroup

透明定义为 NORMAL observational-semi subject，四名队友至少 3 人的 exporter
observational mode 为 `eco` 或 `semi`（分别对应 low-spend PRESERVE/LIGHT 研究
映射），且 subject money 高于 teammate median。clean 样本为 130 人、77 个
team-round。

- 买前额外富余 `D_pre` P25/median/P75：`$125/$375/$925`；
- subject actual spend：`$1,150/$1,575/$2,000`；
- `D_post`：`-$250/$87.50/$393.75`；
- paired gap reduction：`-$175/$0/$468.75`；仅 48.46% 缩小差距；
- `spend - D_pre`：`$337.50/$975/$1,468.75`，spend / excess median 为 3.04。

实际消费通常远高于“相对队友多出的资金”，所以它不能解释为简单花掉 extra surplus
以对齐队友。

## 6. drop-sensitive descriptive result

允许 team-round 内存在 drop/transfer-sensitive 行、只作描述时，2,994 个 raw
observational-semi candidate 中纳入 2,625 人、1,214 个 team-round。总体 `D_pre`
median 为 `$0`；rich-player 1,270 人的 `D_pre` median 为 `$325`，`|D_post|`
median 为 `$450`，paired gap reduction median 为 `-$75`，仅 41.02% 更接近队友。

对应 low-spend subgroup 为 876 人：excess median `$325`、spend median `$1,800`、
gap reduction median `$0`、closer rate 47.49%、`spend - excess` median
`$1,437.50`。虽然 drop 污染使其不能承担主结论，这一方向与 clean subset 一致。

## 7. canonical next-buy threshold satisfaction

| actual mode | n | rifle + kevlar | rifle + vesthelm | rifle + kevlar + smoke + flash |
| --- | ---: | ---: | ---: | ---: |
| FORCE | 3,616 | 6.80% | 1.11% | 0.61% |
| LIGHT | 2,330 | 83.39% | 78.15% | 75.36% |
| PRESERVE | 2,766 | 99.10% | 97.00% | 95.48% |
| FULL | 14,840 | 50.16% | 38.21% | 35.38% |

LIGHT 对基础 rifle + armor 的保护率很高，并清晰位于 FORCE 与 PRESERVE 之间。
分 side 后三档保护率为 T `86.43%/80.86%/78.22%`、CT
`78.50%/73.80%/70.77%`；差异与 CT canonical rifle 更贵一致。

## 8. spending-cap slack

在已经满足相应 `G` 的 LIGHT 中，`S <= max_spend(G)` 在定义上为 100%；有信息量
的是 slack 没有收缩到 0：

| protected bundle | satisfied n | slack P25 | median | P75 | IQR |
| --- | ---: | ---: | ---: | ---: | ---: |
| rifle + kevlar | 1,943 | $1,000 | $1,400 | $1,700 | $700 |
| rifle + vesthelm | 1,821 | $750 | $1,100 | $1,400 | $650 |
| rifle + kevlar + smoke + flash | 1,756 | $650 | $950 | $1,300 | $650 |

这支持“保持一个购买能力下界，同时不要求把 cap 花满”，不支持 exact cash point。

## 9. +$200/$300/$500/$700 counterfactual break rates

下表是从当前 `N >= G` 跌到 `N < G` 的人数占该 mode 全部样本的比例，顺序均为
`+$200 / +$300 / +$500 / +$700`：

| mode | rifle + kevlar | rifle + kevlar + basic utility |
| --- | --- | --- |
| FORCE | 4.01% / 5.59% / 6.19% / 6.61% | 0.41% / 0.53% / 0.61% / 0.61% |
| LIGHT | 3.26% / 4.59% / 8.03% / 11.89% | 3.86% / 6.18% / 12.49% / 20.43% |
| PRESERVE | 0.76% / 1.55% / 3.62% / 7.27% | 3.65% / 6.47% / 24.26% / 50.47% |

以“当前已满足者”为分母，LIGHT 对应基础 bundle 为
`3.91%/5.51%/9.62%/14.26%`，basic utility 为
`5.13%/8.20%/16.57%/27.11%`。多数 LIGHT 并不紧贴 ceiling；数据更像宽松的
spending envelope，而非精确边界优化。

## 10. LIGHT subtype differences

context 先于 bundle 切分，避免把 POST_PISTOL 混入 NORMAL：

| subtype | n | clean team n | rich-player paired gap reduction median | base / util satisfaction | base break +$200/300/500/700 | util break +$200/300/500/700 |
| --- | ---: | ---: | ---: | --- | --- | --- |
| NORMAL no-primary pistol/utility/armor | 1,581 | 204 | $0 | 93.23% / 86.53% | 2.34/3.73/6.70/10.06% | 3.35/5.44/12.14/20.05% |
| NORMAL retained-primary top-up | 197 | 48 | -$150 | 92.39% / 79.19% | 7.61/9.14/13.20/19.29% | 6.09/10.66/18.27/28.93% |
| NORMAL new SMG + armor | 208 | 27 | $125 | 64.90% / 55.29% | 3.37/3.85/9.62/14.90% | 5.29/7.21/12.02/19.23% |
| NORMAL other new primary | 127 | 20 | $475 | 87.40% / 76.38% | 5.51/6.30/11.02/19.69% | 8.66/12.60/22.05/35.43% |
| POST_PISTOL observational semi | 214 | 55 | -$1,162.50 | 17.76% / 7.94% | 4.67/6.54/9.81/11.21% | 1.40/2.80/3.74/7.01% |

NORMAL no-primary 是最大 subtype（67.85%），也最符合 future-buy lower bound；但其
rich-player gap reduction median 仍为 0，仅 41.90% 更接近队友。new SMG + armor
保护率明显更低，更像另一种 contest behavior。POST_PISTOL 同时不符合普通 rifle
下界与 team sync，必须维持独立 strategy。OVERTIME 只有 3 人，不解释。

## 11. FORCE/PRESERVE controls

FORCE 的三档下界保护率接近 0，PRESERVE 接近 100%，LIGHT 位于二者之间；这为
H2 提供了有效的 mode-discrimination control。FULL 不是为“下一轮输后购买力”设计，
因此其 50.16% 基础满足率只作描述。

团队位置对照则不支持 H3：LIGHT 的买前正向 outlier 比例和 percentile 没有高于
FULL/PRESERVE；rich-player 消费后的 gap reduction 还弱于 FULL/FORCE。clean 与
drop-sensitive 两套数据均给出相同方向，因此不是缺数据导致的
`NOT IDENTIFIABLE`。

FORCE armor invariant 仍保持既有结论：`FORCE => armor > 0`，仅 explicit
AWP-no-armor path 例外。本研究分支不修复它。

## 12. hypothesis verdicts

H1 **NOT SUPPORTED**：上一轮 `R` median `$1,650`、`R+B` 不比 `R` 集中、loss
reward 增长不被 `R` 等额抵消，结论不变。

H2 **PARTIALLY SUPPORTED**：整体与尤其 NORMAL no-primary/retained-primary 对
canonical future-buy lower bound 有高保护率和正 slack，并与 FORCE/PRESERVE 清晰
分离；但 new-SMG 较弱、POST_PISTOL 明确不成立，不能把它提升为所有 LIGHT 的统一
semantic。

H3 **NOT SUPPORTED**：clean 数据量足以判断；LIGHT 不经常是独特的正向
team-money outlier，rich-player 的 paired residual gap median 没有缩小，low-spend
场景的消费也不对应额外富余。drop-sensitive 描述结果同向。

## 13. minimal architecture implication

建议把普通 LIGHT 的 architecture 从：

```text
fixed SMG + armor bundle
```

改为：

```text
own-state limited-spend intent
  -> context/subtype-specific future-affordability lower bound and max-spend envelope
  -> secondary bundle recommendation
```

这里的 lower bound / max-spend 是 ADVICE，不是 future FACT；bundle 也不是 mode
定义。POST_PISTOL 保持独立，new-SMG 允许另一 constraint source。team exact money
仅为 oracle research evidence，不能进入 production。实现前仍需另开 production task
明确 normal-player 自有状态 contract；本轮只完成 architecture diagnostic。

**SINGLE FIXED NEXT-CASH TARGET: NOT SUPPORTED**

**NEXT-BUY LOWER-BOUND / SPENDING-ENVELOPE: PARTIALLY SUPPORTED**

**TEAM-SYNCHRONIZATION: NOT SUPPORTED**

**READY FOR FINAL LIGHT ARCHITECTURE DECISION: YES**
