# Behavioral ranking and abstention contract

状态：**final narrow calibration / auto-lead disabled**

日期：2026-08-12

本报告收束 Product Alpha 所需的唯一问题：当 Policy V3 mechanics 已给出合法
economic candidates 时，职业行为 reference 是否足以排序、何时必须 abstain。它
不重跑 Cologne、不会改变 affordability、legality、future projection、mode
semantics 或 bundle planner，也不把职业行为当成 optimal-policy truth。

## 1. Frozen input and evaluation

输入为此前从四个 frozen Cologne event packages 直接重建的 NORMAL、非
post-pistol rows。它只使用 current deployable own-state：side、money、loss、
retained primary、retained armor，以及 Policy V3 在 `7f420f8` 输出的 current
mechanically valid candidate set。禁止 map、role、position、team spend、opponent
private state 与额外 trajectory history。

- multi-candidate rows：24,556；106 match series；
- ranking cohort：22,708（实际 behavioral label 也在 candidate set 内）；
- five folds：`sha256(match-series) mod 5`；
- primary frozen inputs：`/tmp/roundsense-candidate-conditioned-audit.json` 和
  `...-heldout.json`；本次 selective result：
  `/tmp/roundsense-candidate-conditioned-selective.json`。

版本化、可随 Product Alpha 一起审计的 compact summary 为
[`docs/data/behavioral-ranking-abstention-v1.json`](../data/behavioral-ranking-abstention-v1.json)。

candidate coverage 是 mechanics/candidate-space 指标，而不是 ranking failure：
`FORCE+FULL` 91.64%，`FORCE+LIGHT+PRESERVE` 99.17%，`FORCE+PRESERVE`
90.59%，`LIGHT+PRESERVE` 仅 2.62%。后者不具备 behavioral ranking support。

## 2. Result and calibration boundary

| candidate set | n | nested conditional-frequency Top-1 | compact 24-leaf tree Top-1 | product verdict |
| --- | ---: | ---: | ---: | --- |
| `FORCE+FULL` | 17,363 | 97.67% | 98.35% | stable ordering reference |
| `FORCE+LIGHT+PRESERVE` | 5,037 | 67.68% | 70.16% | rank only; normally multimodal |
| `FORCE+PRESERVE` | 308 | 84.42% | 89.61% | rank only; low support |
| `LIGHT+PRESERVE` | 5 compatible | — | — | abstain |

三选局的 tree selective slice 为：top score at least 0.70 / 0.80 / 0.90 时，
coverage 为 44.43% / 30.99% / 10.11%，held-out behavioral agreement 为
81.81% / 88.34% / 90.37%。这些是 **un-calibrated tree scores 的描述性
selection**，不是可向玩家展示的概率，不能直接变成 production threshold。

compact tree 相对 nested frequency 在全 cohort 的提升为 1.14pp，三选局为
2.48pp；不足以证明 Alpha 应承担模型 artifact、probability calibration、版本
migration 与解释成本。conditional-frequency prior 是将来最小实现的首选；tree
只保留为 offline upper reference。

## 3. Versioned future contract

未来若产品化，artifact 必须以独立版本（例如
`behavioral-ranking-v1`）供应，并至少声明：

```ts
type BehavioralRanking = {
  artifactVersion: string;
  source: "BEHAVIORAL_REFERENCE";
  candidateSet: readonly PolicyMode[];
  orderedCandidates: readonly PolicyMode[];
  support: number;
  status: "RANK_ONLY" | "ABSTAIN" | "LEAD_ELIGIBLE";
  // Probability omitted unless separately calibrated and audited.
};
```

硬边界：

1. mechanics 先生成 candidate set；prior 只能重排其成员，永不增加、删除或令
   某 mode 变得 affordable/legal。
2. `LIGHT+PRESERVE`、support 不足、candidate coverage 不足、fold direction
   不稳定，或 live state 不具备 verified pre-decision provenance时，返回
   `ABSTAIN`。
3. Alpha 的 `RANK_ONLY` 只影响展示顺序；不能设置 `defaultOptionId`，不能显示
   numeric probability，也不改变 `adviceStrength`。
4. `LEAD_ELIGIBLE` 仍需要未来单独的 calibration、margin stability 与玩家测试；
   本报告没有启用它。

因此本次实现前的 automatic behavioral auto-lead **仍关闭**。现有 unverified
first-freeze candidate 也绝不能启用它。
