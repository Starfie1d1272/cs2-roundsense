# RoundSense 研究归档索引（Research Index）

> **状态：研究阶段已归档（Policy V3 冻结）**
>
> RoundSense 的经济策略研究阶段已于 Policy V3 验收后收口。当前主线以 **Policy V3** 作为 v0.1.0 产品基线，不再主动推进 Policy V4、更高维度的职业拟合或对手精确经济预测。
>
> 历史研究分支的最终提交均已通过 `archive/*` Git 标签永久归档，原远端分支已清理。所有研究脚本、离线数据表、图表和审计产物仍可通过对应标签完整查阅或检出。

---

## 1. 主线（`main`）已保留的权威文档

以下文档位于当前 `main` 分支，作为产品实现与规则核对的权威入口：

- [Policy V3 架构锁定](policy-v3-architecture.md) — 生产边界、状态契约、对手经济与 C4 门禁裁决（behavior-frozen）
- [Policy V3 最终产品行为验收](experiments/policy-v3-final-acceptance.md) — 基于 IEM Cologne Major 2026（43,620 原始样本 / 23,552 有效样本 / 202 张图）的最终行为验收与 0 机械性违规证明
- [CT 头盔决策定向研究](experiments/ct-helmet-decision-targeted-study.md) — 裁决不建立独立 helmet-threat 推断，仅作轻量 tie-break
- [最终购买策略诊断](experiments/purchase-policy-final-diagnostic.md) — 加时赛（OT）、道具组合规划、地图特异性与历史轨迹裁决
- [经济证据总表](evidence.md) — Windows 运行时观测与 demo 语料验证的 CS2 经济/结算规则
- [Windows 运行时核查记录](runtime-checks.md) — GSI payload、连败奖励、装备字段与 C4 观测记录
- [C4 Windows 受控校准方案](experiments/c4-windows-controlled-calibration.md) — C4 精确倒计时校准边界（当前暂停）
- [Cologne 购买策略审计](cologne-purchase-policy-audit.md) 与 [汇总数据](data/cologne-policy-summary.json)
- [Policy V2 设计文档（历史参考）](economy-policy-v2-design.md)

---

## 2. 归档分支总览（`archive/*` Tags）

所有 8 个历史研究与策略开发分支均已按 `archive/<原分支名>` 规则打上附注标签（annotated tag）：

| 归档标签 | 原分支 | 最终提交 | 日期 | 主线外独有路径数 | 归档定位 |
| --- | --- | --- | --- | ---: | --- |
| `archive/research/economy-policy` | `research/economy-policy` | `0875db9` | 2026-08-08 | 86 | 经济策略核心实证研究基线（图表、CSV、审计报告、产品就绪度审计） |
| `archive/research/post-pistol-strategy` | `research/post-pistol-strategy` | `ac8444f` | 2026-08-08 | 135 | 手枪局后策略、角色/风格泛化、AWP 关联与对手经济推断完整资产（继承自 `0875db9`） |
| `archive/feat/economy-policy-v2` | `feat/economy-policy-v2` | `fb026ef` | 2026-08-08 | 7 | 历史 V2 人工策略原型与离线回放对照（已被 V3 取代） |
| `archive/starfie1d/policy-v3-architecture-lock` | `starfie1d/policy-v3-architecture-lock` | `7c652a2` | 2026-08-08 | 0 | V3 架构锁定历史节点（内容已合入 `main`） |
| `archive/research/ct-helmet-decision` | `research/ct-helmet-decision` | `d194d17` | 2026-08-09 | 3 | CT 头盔决策定向研究脚本、武器爆头机制表与机器可读结果 |
| `archive/research/purchase-policy-final-diagnostic` | `research/purchase-policy-final-diagnostic` | `aaf491b` | 2026-08-09 | 7 | OT / 道具 / 轨迹最终诊断脚本与 JSON 结果（继承自 `d194d17`） |
| `archive/feat/policy-v3-core` | `feat/policy-v3-core` | `584ec5c` | 2026-08-10 | 7 | Policy V3 核心实现完整提交历史（生产代码已 squash 合入 `main`） |
| `archive/research/light-reserve-target` | `research/light-reserve-target` | `e81be20` | 2026-08-10 | 10 | 半起（LIGHT）保留资金与投入边界诊断报告及脚本（继承自 `584ec5c`） |

> 注：“主线外独有路径数”指该标签树中路径不在 `main` 的文件数；因存在分支继承关系，部分实验脚本在上下游标签中会重复出现。

---

## 3. 研究演进脉络

8 个归档节点构成三条清晰的演进支线：

1. **职业语料与基础策略实证线**
   - `archive/research/economy-policy`（`0875db9`） → `archive/research/post-pistol-strategy`（`ac8444f`）
2. **Policy V2 探索线（历史）**
   - `archive/feat/economy-policy-v2`（`fb026ef`）
3. **Policy V3 架构锁定、定向诊断与冻结验收线**
   - `archive/starfie1d/policy-v3-architecture-lock`（`7c652a2`）
   - → `archive/research/ct-helmet-decision`（`d194d17`）
   - → `archive/research/purchase-policy-final-diagnostic`（`aaf491b`）
   - → `archive/feat/policy-v3-core`（`584ec5c`，已合入 `main`）
   - → `archive/research/light-reserve-target`（`e81be20`）

---

## 4. 各归档研究的核心结论与关键产物

### 4.1 `archive/research/economy-policy`（`0875db9`）

- **研究目标**：基于 IEM Cologne Major 2026 冻结语料（原始 43,620 player-rounds，STRICT 25,986），建立可复现的职业经济决策实证基线、可部署特征阶梯（deployable feature ladder）与产品就绪度评估。
- **核心结论**：
  - 在 `retained=none` 下，T/CT 五档连败奖励（$1,400–$3,400）的 full-buy 经济分界线在 5-fold match-series 与 cluster bootstrap 下高度稳定（T 约 $3,800–$4,000，CT 约 $3,650–$4,100）。
  - 仅依赖普通玩家 GSI 可部署特征（金钱、阵营、连败奖励、保留主武器、回合阶段）即可获得主要信息增益；完整队友上下文仅作为理论上限参考（oracle ceiling），不可在普通玩家 GSI 中获取。
- **关键归档产物**：
  - `experiments/economy-policy/results/cologne-2026/FINAL-POLICY-RESEARCH.md`
  - `experiments/economy-policy/results/cologne-2026/policy-review-atlas.md`
  - `experiments/economy-policy/results/cologne-2026/*.csv` 与各连败档位曲线图 `*.png`
  - `docs/economy/{independent-validation,overlay-data-contract,planner-gap-audit,product-readiness-audit}.md`

### 4.2 `archive/research/post-pistol-strategy`（`ac8444f`）

- **研究目标**：分析手枪局败者在 R2/R14 的决策分布（404 队回合）、角色/风格泛化、AWP 经济关联以及仅用普通玩家 GSI 推断对手经济的边界。
- **核心结论**：
  - **T 手枪局后（n=205）**：ECO 50.2% / FORCE 39.0% / LIGHT 10.7%（LIGHT 为真实第三模态）；ECO + FORCE 两分支覆盖约 84–88%。
  - **CT 手枪局后（n=199）**：FORCE 80.9% / ECO 15.1% / LIGHT 4.0%，近似单峰 FORCE。
  - 控制经济后，CT 侧“T 存活人数”与 T 侧“是否下包”对 FORCE 均无显著额外预测增益（下包效应与 +$600/人 的现金变化一致）。
  - 同档 `lossReward=$2,400` 下，手枪局后是系统性 FORCE 窗口，与常规周期存在明显差异；但对手经济推断在最终 V3 验收中对购买方案集合变化数为 0，仅作轻量参考。
- **关键归档产物**：
  - `experiments/economy-policy/results/cologne-2026/post-pistol-strategy/POST-PISTOL-STRATEGY-RESEARCH.md`
  - `experiments/economy-policy/pp1_build_datasets.py` 至 `pp7_opponent_preference.py` 及 `audit_post_pistol_strategy.py`（80 项独立审计检查）
  - `experiments/economy-policy/metadata/{player-roles.md,role-metadata-record.json}`

### 4.3 `archive/feat/economy-policy-v2`（`fb026ef`）

- **研究目标**：实现人工规则版 Policy V2，并与 `0875db9` 职业证据做离线回放对照（2,105 个状态）。
- **核心结论**：离线回放显示 V2 整体花费偏激进（62% 高于职业 p75），且结构难以表达多可行方案与投入边界。V3 架构锁定阶段正式拒绝整体复用 V2 策略，仅选择性移植经单测验证的购买 mechanics。
- **关键归档产物**：
  - `packages/economy-advisor/src/policy-v2.ts` 与 `policy-v2.test.ts`
  - `experiments/economy-policy/results/policy-v2-review/policy-v2-review.md`

### 4.4 `archive/starfie1d/policy-v3-architecture-lock`（`7c652a2`）

- **研究目标**：在 V3 编码前锁定所有生产门禁（仅粗粒度对手经济推断、禁止精确对手金钱、C4 未校准降级为 UNKNOWN、放弃 V2 整体复用）。
- **归档说明**：文档主体已演进并保留在主线 [docs/policy-v3-architecture.md](policy-v3-architecture.md)；本标签保留架构锁定的原始里程碑快照。

### 4.5 `archive/research/ct-helmet-decision`（`d194d17`）

- **研究目标**：检验是否值得基于普通玩家 GSI 构建独立的“对手头盔威胁”推断模块来指导 CT 省头盔。
- **核心结论**：**裁决 B（weak evidence）**。不批准独立 helmet-threat 推断；`LIKELY_ESTABLISHED_RIFLE` 不得硬性驱动省头，仅可在 own-state 近似平局时作轻量说明/tie-break。结论报告已合入主线 [docs/experiments/ct-helmet-decision-targeted-study.md](experiments/ct-helmet-decision-targeted-study.md)。
- **关键归档产物**：
  - `experiments/ct-helmet-decision/helmet_decision_study.py`
  - `experiments/ct-helmet-decision/data/weapon-headshot-mechanics.v2026-08-06.json`
  - `experiments/ct-helmet-decision/results/helmet-decision-study.json`

### 4.6 `archive/research/purchase-policy-final-diagnostic`（`aaf491b`）

- **研究目标**：在实现 Policy V3 前收口三个剩余问题——加时赛特判、道具组合规划、地图特异性与常规局历史序列。
- **核心结论**：OT 不需要特殊购买策略（仅需正确识别 10k reset）；道具规划 **GO**（有限确定性核心）；地图特化道具 **NO-GO**；常规局胜负序列/motif **NO-GO**。结论报告已合入主线 [docs/experiments/purchase-policy-final-diagnostic.md](experiments/purchase-policy-final-diagnostic.md)。
- **关键归档产物**：
  - `experiments/economy-policy/purchase_policy_final_diagnostic.py`
  - `experiments/economy-policy/results/cologne-2026/purchase-policy-final-diagnostic.json`

### 4.7 `archive/feat/policy-v3-core`（`584ec5c`）

- **研究目标**：完整实现并验收 Policy V3 确定性经济决策核心与连续 GSI 状态追踪。
- **归档说明**：生产代码与最终验收报告已合入 `main`（`e6275de`），本标签保留 V3 实现与多轮收敛修复的完整逐提交历史。

### 4.8 `archive/research/light-reserve-target`（`e81be20`）

- **研究目标**：检验半起（LIGHT）究竟遵循单一固定留钱目标（H1）、下回合购买下界/投入包络（H2），还是团队同步（H3）。
- **核心结论**：H1 与 H3 均 **NOT SUPPORTED**，H2 **PARTIALLY SUPPORTED**。因此 NORMAL LIGHT 不应再绑定固定的 `SMG + armor` 模板，而应先给出“未来购买力下界 / 投入边界（建议投入与激进上限）”，再给出次级购买推荐。该结论已纳入主线 [docs/policy-v3-architecture.md](policy-v3-architecture.md)。
- **关键归档产物**：
  - `docs/experiments/light-reserve-target.md`
  - `scripts/light-reserve-diagnostic.ts`
  - `experiments/policy-v3/results/light-reserve-diagnostic.json`

---

## 5. 如何查阅或复现归档资产

直接读取单个归档文件（无需切换分支）：

```bash
# 示例：查看 post-pistol 最终研究报告
git show archive/research/post-pistol-strategy:experiments/economy-policy/results/cologne-2026/post-pistol-strategy/POST-PISTOL-STRATEGY-RESEARCH.md

# 示例：查看 LIGHT 保留资金诊断报告
git show archive/research/light-reserve-target:docs/experiments/light-reserve-target.md
```

如需在临时目录检出完整归档树并重跑脚本：

```bash
git worktree add /tmp/roundsense-archive archive/research/post-pistol-strategy
# 用完后清理：
git worktree remove /tmp/roundsense-archive
```
