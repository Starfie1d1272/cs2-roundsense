# LIGHT reserve-target diagnostic

状态：**bounded offline diagnostic / architecture evidence**

日期：2026-08-10

基线：`584ec5ce91c6d1bf8d138783a42d137fe7276a47`

## 结论

**LIGHT RESERVE HYPOTHESIS: NOT SUPPORTED**

冻结 Cologne corpus 不支持“LIGHT 的稳定本质是单一 future reserve / next-round
cash target，loss reward 越高，本轮 reserve 就近似等额降低”。相反：

- actual LIGHT 的 residual cash `R` 比 `LOSS_NO_PLANT` next cash `N` 更集中；
- loss reward 与 `R` 几乎无单调关系，但与 `N` 有明显正相关；
- `N` 随 loss reward tier 明显上移，而不是聚集到一个共同目标；
- POST_PISTOL 与 NORMAL、无 primary 与新购 SMG、retained-primary top-up 不是同一
  reserve trajectory。

LIGHT 后输掉本轮的可链接样本中，下一轮确实有 87.96% 为 actual FULL，83.84%
为严格的 `FULL + rifle + armor`。这说明 LIGHT 经常位于下一轮正常购买之前，但它
是 observational outcome，不能反推“本轮按一个固定 reserveTarget 计算 maxSpend”。

## 口径与样本

主情景严格按：

```text
R = current money - actual spend
B = current loss reward
N = R + B
```

T 侧只额外报告 hypothetical `N_plant = N + $600`，没有把 future plant 当事实。

- frozen player-round：43,620；SHA-256
  `33f29c35fb124a4e45d38a00be8f389d32403c0762576b607db7a9a37fe0d9e6`；
- regulation drop/loss-index strict stage：25,986；
- 复用 replay pre-state、retained-primary correction 与 coherence filter 后 eligible：
  23,552（regulation 22,428；overtime 1,124）；
- actual LIGHT：2,330（T 1,437；CT 893；NORMAL 2,113；POST_PISTOL
  214；OVERTIME 3）。

主要排除与既有 final acceptance 完全一致：regulation derived drop-gave 9,842、
drop-received 5,103、ambiguous loss index 1,009、pistol round 3,028、retained
primary unknown 114；replay coherence 另排除 420 行。冻结 coherence filter 沿用
原验收中的 incendiary `$600` 口径，以保持 23,552 基线；购买能力解释读取当前
canonical `$500` 价格。

## 1. LIGHT residual cash

全部 actual LIGHT 的 `R` 为：

| n | P25 | median | P75 | IQR | MAD |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2,330 | $1,300 | $1,650 | $2,050 | $750 | $350 |

最常见 `$500` 区间是 `$1,500–1,999`（823，35.32%）和 `$1,000–1,499`
（575，24.68%）；合计 60.00%。T 的 median/IQR 是 `$1,600/$700`，CT 是
`$1,750/$750`。

context 差异明显：NORMAL 的 `R` median/IQR 为 `$1,700/$650`；POST_PISTOL
为 `$950/$700`。只有 3 个 OVERTIME LIGHT，不作结构解释。

retained inventory 改变 reserve：无 retained primary 的 median 为 `$1,600`，
有 retained primary 为 `$2,650`；无 retained armor 为 `$1,600`，有 retained
armor 为 `$2,200`。

## 2. loss reward 与 next-round cash

| loss index | B | n | median R | median N |
| ---: | ---: | ---: | ---: | ---: |
| 0 | $1,400 | 295 | $1,950 | $3,350 |
| 1 | $1,900 | 256 | $1,575 | $3,475 |
| 2 | $2,400 | 360 | $1,550 | $3,950 |
| 3 | $2,900 | 383 | $1,750 | $4,650 |
| 4 | $3,400 | 1,036 | $1,600 | $5,000 |

相邻 tier 的 `B` 每次增加 `$500` 时，median `R` 依次变化 `-$375`、`-$25`、
`+$200`、`-$150`，不是预期的约 `-$500`；median `N` 反而变化 `+$125`、
`+$475`、`+$700`、`+$350`。

Spearman rank association 也指向同一结论：`B` 对 `R` 为 `-0.0369`，对 `N`
为 `+0.6503`。T/CT 分开后，`B` 对 `N` 分别为 `+0.6433/+0.6885`。NORMAL
内部仍是 `B→R -0.1583`、`B→N +0.5930`，不是单纯由 POST_PISTOL 混入造成。

## 3. N 是否比 R 更集中

否。

| group | R median | R IQR | N median | N IQR | IQR 变化 |
| --- | ---: | ---: | ---: | ---: | ---: |
| all LIGHT | $1,650 | $750 | $4,700 | $1,100 | +46.67% |
| T | $1,600 | $700 | $4,700 | $1,050 | +50.00% |
| CT | $1,750 | $750 | $4,650 | $1,300 | +73.33% |
| NORMAL | $1,700 | $650 | $4,800 | $850 | +30.77% |
| POST_PISTOL | $950 | $700 | $3,050 | $450 | -35.71% |

POST_PISTOL 是唯一有清晰收缩的实质 subgroup，但其 target 约 `$3.05k`，与
NORMAL 的 `$4.8k` 不同。整体 `N` 的最短 50% 区间是 `$4,350–5,250`；
`$4,500–4,999` 占 29.06%，`$5,000–5,499` 占 20.47%。这是一个常见区域，
不是比 `R` 更窄的单一 target。

T 的 hypothetical plant branch 只把分布整体上移 `$600`：median 从 `$4,700`
到 `$5,300`，IQR 都是 `$1,050`，不改变主结论。

## 4. 购买能力解释

按当前 canonical prices，`LOSS_NO_PLANT` 的主要 `$4.35k–5.25k` 区域通常能覆盖
正常 rifle bundle，但大多不到 `AWP + kevlar`：

| side | bundle | threshold | LIGHT N 可负担 |
| --- | --- | ---: | ---: |
| T | AK-47 + kevlar | $3,350 | 86.43% |
| T | AK-47 + vesthelm | $3,700 | 80.86% |
| T | AK-47 + kevlar + smoke + flash | $3,850 | 78.22% |
| T | AWP + kevlar | $5,400 | 11.69% |
| CT | M4A4 + kevlar | $3,550 | 78.50% |
| CT | M4A4 + vesthelm | $3,900 | 73.80% |
| CT | M4A4 + kevlar + smoke + flash | $4,050 | 70.77% |
| CT | AWP + kevlar | $5,400 | 15.01% |

T/CT 的 `N` median 接近（`$4,700/$4,650`），但 CT 分布更宽，且 CT rifle
bundle 更贵，因此 CT 的各类正常 rifle affordability 低约 7–8 个百分点。

## 5. FORCE / LIGHT / PRESERVE 对照

| actual mode | n | R median | R IQR | N median | N IQR |
| --- | ---: | ---: | ---: | ---: | ---: |
| FORCE | 3,616 | $100 | $100 | $2,100 | $600 |
| LIGHT | 2,330 | $1,650 | $750 | $4,700 | $1,100 |
| PRESERVE | 2,766 | $2,050 | $450 | $4,500 | $550 |

对照支持 FORCE 近乎清空当前资金、PRESERVE 留存更多、LIGHT 位于两者之间的
当前轮 spending 语义。但 `N` 没有形成相同顺序：PRESERVE median 反而低于
LIGHT，且二者高度重叠。这不支持用单一 next-round target 区分三种 mode。

## 6. LIGHT 后的下一轮

采用保守 link：同 map、同 player、严格相邻 player-round；当前与下一轮都不得
有 raw/derived drop-transfer、loss-index ambiguity 或 eligibility 污染。

- 可链接 1,185 / 2,330（50.86%）；
- 排除：drop/transfer-sensitive 1,111、map 已结束 19、下一轮 pistol reset 7、
  retained-primary unknown 1、replay grenade coherence 7；
- 当前 LIGHT 后 WIN 238：下一轮 FULL 221（92.86%）；
- 当前 LIGHT 后 LOSS 947：下一轮 FULL 833（87.96%）、FORCE 32（3.38%）、
  LIGHT 24（2.53%）、PRESERVE 58（6.12%）；
- 这 947 个 LOSS 样本的下一轮 resulting primary：rifle 804（84.90%）、
  sniper 43（4.54%）、none 89（9.40%）、SMG 11（1.16%）；
- `FULL + rifle + armor` 为 794（83.84%）；`FULL + rifle/sniper + armor`
  full-buy-like 为 831（87.75%）。

这验证了“LIGHT 常通向下一轮正常长枪购买”的描述，但没有证明当前 reserve 是
为了一个跨 loss-tier 稳定的 cash target 而选择。

## 7. LIGHT 子类型

| observational subtype | n | share | median R | median N | N IQR |
| --- | ---: | ---: | ---: | ---: | ---: |
| no primary，pistol/utility/armor | 1,695 | 72.75% | $1,650 | $4,800 | $850 |
| new SMG + armor | 284 | 12.19% | $1,400 | $3,375 | $2,100 |
| retained-primary top-up | 197 | 8.45% | $2,650 | $4,700 | $1,150 |
| other new primary bundle | 154 | 6.61% | $1,275 | $4,250 | $1,400 |

无 primary 子类型中 1,560 / 1,695（92.04%）最终持有 paid pistol。按全部
LIGHT resulting loadout 交叉计数，SMG + armor 仅 413 / 2,330（17.73%）。因此
当前 fixed `SMG + armor` bundle 也不能被解释为 actual LIGHT 的唯一实质；但不同
subtype 的 `N` 又不共享稳定 target，数据没有选出一个 reserve-first 替代定义。

retained inventory 提供一条有限的支持信号：有/无 retained primary 的 `N`
median 都是 `$4,700`，有/无 retained armor 也都是 `$4,700`。但这一 aggregate
一致性不足以推翻整体 dispersion、loss-tier trend 和 subtype 差异。

## 8. FORCE armor invariant

独立 mechanical invariant **被当前 production 违反**：

```text
FORCE => armor > 0
except explicit AWP-no-armor path
```

- 合法 empty-inventory probe：T `$2,700` 会给 `AK-47 / armor 0` FORCE；CT
  `$2,900` 会给 `M4A4 / armor 0` FORCE；均不是 AWP path；
- 23,552 个 Major eligible state 中，production 提供 FORCE 的有 23,432；其中
  2,022 个 resulting armor 为 0，只有 1 个是 explicit retained-AWP exception；
  non-AWP violation 为 2,021（占 FORCE-offered states 8.62%）；
- actual FORCE 为 3,616，其中 53（1.47%）resulting armor 为 0，且没有一个是
  AWP；Major replay 因而也存在对应 candidate 与 actual observation。

本研究分支不修 production。下一实现轮应把该 invariant 作为独立 mechanical
修复，不与 LIGHT semantic 混合。

## 9. 产品含义

本证据不足以把 Policy V3 改成：

```text
economy decision -> one reserveTarget -> maxSpend -> bundle
```

建议当前 architecture decision 是：

- 不采用单一 reserveTarget 作为全部 LIGHT 的定义；
- future affordability / loss scenarios 继续作为显式 trajectory ADVICE，而不是
  future FACT；
- 不把 fixed SMG + armor 提升为 LIGHT 的本质，另开 bounded study 处理实际
  no-primary、SMG 与 retained-primary 的异质性；
- 下一实现轮独立落实 FORCE armor invariant。

本轮没有修改 production source、threshold、POST_PISTOL、C4、opponent model、
team/drop model 或 UI。

**READY FOR ARCHITECTURE DECISION: YES**
