# RoundSense Policy V3 architecture lock

状态：**authoritative / implemented / behavior-frozen**

日期：2026-08-10

范围：Policy V3 技术设计、own-economy spending guidance、opponent economy
deployability、C4 uncertainty。production economy behavior 冻结于
`275566ea7b8751ce291d1283a96c06f168c1d58d`；完整验收见
`docs/experiments/policy-v3-final-acceptance.md`。本文件不设计 Overlay/UI。

第 1 节保留 implementation 前的裁决基线，第 13 节记录已经落地的 amendment
scope；其中“当前 main”均指架构锁定时的 `main @ 37a9756`，不是当前 feature HEAD。

## 0. 最终 gate

| 项目 | 结论 |
| --- | --- |
| GSI-only opponent economy | **GO（仅 coarse expectation）** |
| exact opponent money | **禁止** |
| C4 bomb state | **可锁：normal GSI direct observation + safe transition tracking** |
| C4 数字剩余时间 | **当前不可锁：UNKNOWN，等待唯一 Windows calibration** |
| V2 strategy | **拒绝整体复用** |
| V2 mechanics | **选择性移植，逐项测试** |
| NORMAL LIGHT economy | **GO：spending guidance + future-affordability scenario + secondary bundle** |
| fixed LIGHT SMG/单一 reserve target | **拒绝** |
| FORCE armor | **必须：generic FORCE resulting armor > 0** |
| Economy amendment implementation | **READY**；C4 数字计时另有 bounded blocker |

GO 的含义严格限定为：V3 可以消费
`LIKELY_ESTABLISHED_RIFLE | LIKELY_NOT_ESTABLISHED_RIFLE | UNKNOWN`，并把它
当作带校准范围的 INFERENCE。它不是 FACT，不表示 exact money，不允许成为
购买可行性或单一路径的硬 gate。

## 1. 权威基线与事实优先级

本设计按以下顺序裁决冲突：

1. production policy runtime：`feat/policy-v3-core @ 584ec5c` 的实际代码与
   Windows runtime evidence；
2. LIGHT bounded research：
   [`research/light-reserve-target @ e81be20`](https://github.com/Starfie1d1272/cs2-roundsense/blob/e81be20ab6d3636bfd31dd420b839c461d61c216/docs/experiments/light-reserve-target.md)；
3. frozen professional evidence：`research/economy-policy @ 0875db9`；
4. final strategy/role/opponent research：
   `research/post-pistol-strategy @ ac8444f`；
5. V2 engineering reference：`feat/economy-policy-v2 @ fb026ef`。

research branch 只提供证据；V2 只提供候选工程资产。V3 不 merge、
cherry-pick 或运行这些分支的生产代码。

### 1.1 对既有前提的冲突审计

发现一处必须纠正的冲突：post-pistol research 报告中的 opponent model
（AUC 0.827 / 0.977）使用了 `opponent_start_money`、retained primary/AWP、
survivors 等 demo oracle。`gsi-deployability.md` 只证明己方 money/inventory
可见，不能把这些 opponent fields 映射为 normal-player GSI。该模型只能作为
oracle ceiling，不能直接进入 production。

此外，当前 main 的两个行为不能成为 V3 前提：

- loss counter 缺失时 `assumed-1`：V3 必须改为 UNKNOWN，不得静默补值；
- 首个 `round.bomb=planted` receipt + 41s：这是 detection time + demo-event
  interval，不是真实 planted time + verified fuse。

本任务按要求不修改上述生产行为；V3 实现必须遵守本文件的新 contract。

### 1.2 LIGHT economy amendment evidence

`e81be20` 使用的 `semi` 是 cs2df 的 observational player-round heuristic
label，不是职业选手战略意图 ground truth。它锁定三项 architecture verdict：

- `SINGLE FIXED NEXT-CASH TARGET`：**NOT SUPPORTED**；
- `TEAM-SYNCHRONIZATION`：**NOT SUPPORTED**，且 teammate exact money 不可由
  normal-player GSI 部署；
- `NEXT-BUY LOWER-BOUND / SPENDING-ENVELOPE`：**PARTIALLY SUPPORTED**。

在当前回合输掉的 scenario 中，observational semi 对 `rifle + kevlar` 与
`rifle + kevlar + smoke + flash` 的保护率为 83.39% / 75.36%，明显位于 FORCE
的 6.80% / 0.61% 与 PRESERVE 的 99.10% / 95.48% 之间；但满足边界的 semi
仍分别有约 $1,400 / $950 median slack。因此 max-spend boundary 只能表示“不要
超过”，不能表示“应精确花满”。NORMAL no-primary 与 retained-primary 的保护
结构最强，new SMG + armor 明显更弱；POST_PISTOL 更不符合该结构，必须隔离。
可靠 linked LIGHT-loss 样本中，87.96% 下一轮为 FULL、83.84% 为严格 FULL +
rifle + armor；它支持产品解释，但不是 fixed reserve target 的因果证明。

这组证据推翻当前 production 中 `LIGHT = fixed SMG + armor` 与
`light.spend < force.spend` 的 mode 定义，但不推翻 `PolicyMode` 名称、
multimodal option、inventory-aware legality、trajectory 或 UNKNOWN contract。

同一冻结 production-offered audit 还发现 2,021 个 non-AWP FORCE resulting
armor-zero；职业 actual FORCE 只有 53 个 armor-zero，且全部非 AWP。这不是要拟合
职业 bundle，而是暴露了候选排序违反产品语义的 mechanical failure，因此 FORCE
armor 在本 amendment 中升级为 invariant。

## 2. Normal-player GSI 可见性核定

分类只描述 production 是否可用，不描述研究是否能在 demo 中看到。

### 2.1 直接可见（OBSERVED）

来自 current normal-player payload，缺字段时仍为 UNKNOWN：

| 信号 | source | production 语义 |
| --- | --- | --- |
| 自己阵营 | `player.team` | `CT | T`；其他/缺失 UNKNOWN |
| 自己现金 | `player.state.money` | 当前 receipt 的 live money，不等于 round-start money |
| 自己装备 | `player.state` + `player.weapons` | 只描述自己；armor/helmet/kit/weapon/grenade |
| 回合身份/阶段 | `map.round`, `round.phase`, `map.phase` | `over` payload 的 round 已可能是下一轮，必须由 tracker 处理 |
| 比分 | `map.team_ct.score`, `map.team_t.score` | 当前公开比分 |
| 双方 loss counter | `map.team_*.consecutive_round_losses` | Windows 已见；缺失不假定 |
| 回合胜方 | `round.win_team` 或比分 transition | 若 payload 提供则 direct；否则可由完整历史递推 |
| bomb 状态 | `round.bomb` | Windows normal-player 已见 planted/exploded/defused/dropped 等状态 |

### 2.2 仅凭历史 GSI 可靠递推（TRACKED）

只有 `historyIntegrity = "COMPLETE"` 且未跨 map/restart/gap 才可使用：

- 当前半场与 post-pistol 身份；
- 上一轮胜负、当前半场连续胜轮数；
- recorder 已见证的上一轮 plant；
- score/loss-counter trajectory；
- 每个事实的 `firstSeenSeq` / `lastSeenSeq` / stale 状态。

这些历史可以支持 coarse prior，但不能递推 exact opponent money。对手购买、
击杀奖励、存活装备、捡枪、drop、refund 均不可见；由规则推导的 money envelope
会快速变成接近全范围，V3 不把这种无信息 envelope 产品化。

### 2.3 Demo/spectator oracle（禁止进入 production）

- 对手 player/team exact money、start money、current spend；
- 对手 retained primary/AWP、resulting loadout、armor/utility；
- 对手 survivors、kill actor/weapon、drop/transfer；
- `allplayers_*`、spectator `bomb` root block、`phase_countdowns`；
- demo ticks、event offsets、职业队伍或 player identity；
- 由这些字段训练出的结果，若 live predictor 仍需要这些字段。

demo oracle 可以做 label、审计与 offline ceiling；不能伪装成 live FACT。

## 3. Opponent economy deployability gate

### 3.1 问题定义

exact money 无法部署，因此 gate 改成对实际建议有意义且可诚实验证的目标：

```ts
type OpponentEconomyClass =
  | "LIKELY_ESTABLISHED_RIFLE"
  | "LIKELY_NOT_ESTABLISHED_RIFLE"
  | "UNKNOWN";
```

offline label 是“当前回合对手 resulting rifle/sniper 人数 ≥3”。label 使用
demo oracle 合法；predictor 禁止读取当前结果或任何 opponent private state。

### 3.2 最小 held-out 实验

实现与 artifact：

- `experiments/policy-v3/opponent_economy_deployability.py`；
- `experiments/policy-v3/results/opponent-economy-deployability.json`。

输入固定为 43,620 player-round frozen table，SHA-256
`33f29c35...fe0d9e6`；weapon-family source SHA-256
`c08ff538...06b2cb`。评估单位 7,580 个 regulation team-round perspective，
106 个 match series，5-fold group-held-out。

predictor 只用：

- direct：opponent side、round-in-half、比分差、opponent loss index；
- tracked：上一轮胜负、上一轮 witnessed plant、当前半场连续胜轮数。

禁止输入 money、retained weapon/AWP、survivor、kill、spend、team/player
identity、current-round result。固定 reporting gate：`p<=0.20` 为 likely not，
`p>=0.80` 为 likely established，中间为 UNKNOWN。

### 3.3 结果

| model | AUC | Brier | 可判覆盖 | UNKNOWN | 可判准确率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| prevalence only | 0.4911 | 0.1675 | 0% | 100% | — |
| direct GSI | 0.9042 | 0.0967 | 65.90% | 34.10% | 95.66% |
| direct + tracked GSI | **0.9065** | **0.0962** | **67.61%** | **32.39%** | **95.73%** |

history 增益很小（AUC +0.0023、覆盖 +1.71pp）；主要能力来自公开的 round
stage、side、score 与 loss counter，而不是伪造经济账本。

最终 runtime artifact 选择 **direct-only**：`opponent-economy-direct.v2026-08.json`
用同一冻结 direct feature family、阈值和 final-fit procedure 重新封装。tracked
history 仍作为 FACT 保留，但上一轮 `planted` 的 GSI 可见语义和 replay end
reason 不同，不能为了极小指标增益把它当作 classifier 输入。

场景限制：

- post-pistol：n=808，覆盖 100%，总体准确率 90.97%；likely established
  precision 87.62%，likely not precision 94.31%；只能做 soft context；
- later rounds：覆盖 63.75%，可判准确率 96.62%，但**没有**可靠的 likely-not
  输出；不满足 likely-established gate 的 later state 必须 UNKNOWN；
- opponent CT：UNKNOWN 25.07%；opponent T：UNKNOWN 39.71%；
- overtime、loss counter 缺失、非标准 half/round lifecycle、
  calibration domain 外状态一律 UNKNOWN。

### 3.4 GO 的限制

该实验是同一职业赛事语料内的 held-out deployability，不是普通玩家人群的
校准证明。职业行为不是 optimal truth，ordinary matchmaking 可能有 domain
shift。因此 V3 的 GO 只允许：

1. 输出 coarse expectation + probability band + model/calibration id；
2. UNKNOWN 时无损 fallback；
3. 只调整 ADVICE 的次级 context（例如 helmet value 的说明或排序 tie-break）；
4. 不改变 FACT、affordability、合法性或机械 projection；
5. 后续有 ordinary-demo label 时重新校准，不能从 live normal GSI 反向生成假 label。

## 4. C4 architecture lock

### 4.1 现在能锁的事实

- normal-player GSI 的 `round.bomb` 可提供状态 observation；
- state machine 的去重、mid-round baseline guard、missing terminal guard、
  round reset 语义可继续保留；
- `receivedAtMonotonicNs` 是 receipt time，不是 plant completion time；
- transition 被见证时，可以精确表达 `detectedAt` 与
  `elapsedSinceDetection`；
- receiver 首包即 planted 时，plant time 与 remaining 都必须 UNKNOWN。

### 4.2 现在不能锁的数值

- 223/223 的 41.000s 是 demo event interval；
- 四个 38.56–39.49s 是 GSI receipt interval；
- real fuse、两个 demo endpoint offset、plant/explode 两端 GSI delay 均未拆开；
- 因此不得锁 40s、41s 或固定 `-1s/-2s` correction。

唯一剩余实验见
`docs/experiments/c4-windows-controlled-calibration.md`。它不阻塞 economy
Policy V3，但阻塞任何“calibrated remaining seconds”发布。

## 5. V3 contract：FACT、INFERENCE、ADVICE 分层

V3 不使用一个模糊的 `confidence` 同时表示字段缺失、模型不确定与建议强弱。

```ts
type FactStatus = "OBSERVED" | "TRACKED" | "UNKNOWN";

interface Fact<T> {
  status: FactStatus;
  value?: T;
  source: string;
  asOfSeq: number;
  reason?: string;
}

interface Inference<T> {
  status: "INFERRED" | "UNKNOWN";
  value?: T;
  probability?: number;
  calibrationId?: string;
  inputsAsOfSeq: number;
  reason?: string;
}
```

规则：

- `Fact` 只承载直接 observation 或无歧义历史递推；
- opponent class 永远是 `Inference`；
- projection 是带明确假设的 scenario，不是未来 FACT；
- `UNKNOWN` 不携带默认 value；调用方必须显式处理；
- 禁止 `value ?? assumedDefault` 进入 V3 policy path。

## 6. Domain ownership

| owner | 负责 | 不负责 |
| --- | --- | --- |
| `packages/gsi-protocol` | wire schema、cfg、receipt clock、sanitize、partial payload | round history、经济推断、建议 |
| `apps/roundsense` 的 `PolicyStateTracker` | payload sequence、round identity、history integrity、OBSERVED/TRACKED/UNKNOWN facts | weapon prices、购买策略、opponent oracle |
| `packages/economy-advisor` mechanics | prices/rules、inventory mapping contract、purchase legality/planning、scenario projection | mutable session state、UI |
| `packages/economy-advisor` Policy V3 | modes、recommendation set、opponent inference consumption、user preference | wire parsing、C4 |
| `packages/c4-estimator` | bomb state、detection anchor、calibrated interval/UNKNOWN | economy policy、demo live dependency |
| `packages/shared-types` | 少量跨包 serializable literals/contracts | mutable logic、policy constants |
| `apps/roundsense` orchestration | 依赖装配、输入/输出节流 | 重新解释 domain truth |

不新增 runtime research-data loader。所有 offline calibration 必须变成 versioned、
小型、可审计 artifact 或 constants，并保留 provenance。

## 7. Policy state 与 multi-round trajectory

### 7.1 输入

```ts
interface PolicyV3State {
  round: {
    number: Fact<number>;
    phase: Fact<string>;
    side: Fact<"CT" | "T">;
    score: Fact<{ ct: number; t: number }>;
    context: Fact<"PISTOL" | "POST_PISTOL" | "NORMAL" | "OVERTIME">;
  };
  player: {
    money: Fact<number>;
    lossIndex: Fact<number>;
    inventory: Fact<InventoryState>;
  };
  history: {
    integrity: "COMPLETE" | "PARTIAL" | "COLD_START";
    previousRounds: readonly RoundHistoryFact[];
  };
  opponent: Inference<OpponentEconomyClass>;
  preference: UserPreference;
}
```

`roundStartMoney` 若未来 tracker 能证明 first-freezetime anchor，可作为 Fact；
未证明时 UNKNOWN。它不是 V3 必需输入，也不得像 V2 一样用 `currentMoney`
静默替代。

### 7.2 Trajectory

V3 的决策单位是“当前选择如何改变未来 1–2 轮可达状态”，不是单轮 spend
threshold。每个候选购买计划生成相同的公开 scenario set：

- current win；
- current loss / no plant；
- T current loss / plant witnessed；
- unknown personal kill/drop/team-transfer 不加进 deterministic base，单独列为
  unresolved channel。

```ts
interface TrajectoryScenario {
  id: "WIN" | "LOSS_NO_PLANT" | "LOSS_WITH_PLANT";
  assumptions: readonly string[];
  nextMoney: { min: number; max: number };
  nextLossIndex: Fact<number>;
  followingRound: {
    action: "PRESERVE";
    outcome: "LOSS_NO_PLANT";
    money: Fact<{ min: number; max: number }>;
    lossIndex: Fact<number>;
    reachability: Fact<"UNKNOWN">;
  };
}
```

机械 projection 可以复用现有规则；policy 只能比较同一组 scenario，不能把
某一个“plain loss”当成必然未来，也不能重新引入单一 preservation budget。
`followingRound` 明示 t+1 不购买、随后 plain-loss 的 t+2 assumption；若 win
loss-index 未校准则其 t+2 money 为 UNKNOWN。

必须区分两种“可达”：

- exact inventory-aware future reachability 依赖 future inventory、drop、armor
  retention，仍一律为 UNKNOWN；
- canonical fresh-buy cash boundary 是明确假设下的 **SCENARIO projection**，可以
  由当前 money、`LOSS_NO_PLANT` reward、side 与 canonical prices 确定计算，但
  不是未来 FACT，也不是职业唯一最优金额。

后者只允许两个非学习、可审计的 capability：

```ts
type ProtectedNextBuyCapability =
  | "RIFLE_ARMOR"
  | "RIFLE_ARMOR_BASIC_UTILITY";
```

`RIFLE_ARMOR` 使用 side-canonical AK-47/M4A4 + Kevlar；
`RIFLE_ARMOR_BASIC_UTILITY` 再加 smoke + flash。它们来自 canonical price sum，
不是从 Major 拟合出的两个 policy threshold。对 capability cash target `G`、当前
cash `M` 与当前 `LOSS_NO_PLANT` reward `B`：

```text
requiredReserveNow = max(0, G - B)
reachableWithNoSpend = M >= requiredReserveNow
maxSpendNow = reachableWithNoSpend ? M - requiredReserveNow : 0
```

`maxSpendNow` 是 scenario boundary；只有 option 的 ADVICE 明确引用它时才成为
该 option 的 spending constraint。`reachableWithNoSpend=false` 时不得声称保护了
该 capability，也不得靠 `maxSpendNow=0` 伪造成功。

## 8. Multimodal recommendation

```ts
type PolicyMode = "PRESERVE" | "LIGHT" | "FORCE" | "FULL" | "AWP_PATH";

interface FutureAffordabilityBoundary {
  layer: "SCENARIO";
  scenario: "LOSS_NO_PLANT";
  capability: ProtectedNextBuyCapability;
  targetCash: number;
  requiredReserveNow: number;
  reachableWithNoSpend: boolean;
  maxSpendNow: number;
  assumptions: readonly string[];
}

type FutureAffordabilitySet =
  | {
      status: "PROJECTED";
      context: "NORMAL";
      boundaries: readonly FutureAffordabilityBoundary[];
    }
  | {
      status: "UNKNOWN";
      boundaries: readonly [];
      reason: string;
    }
  | {
      status: "NOT_APPLICABLE";
      boundaries: readonly [];
      reason:
        | "POST_PISTOL_STRATEGY"
        | "PISTOL_UNSUPPORTED"
        | "OVERTIME_UNSUPPORTED";
    };

type SpendingGuidance =
  | {
      layer: "ADVICE";
      kind: "MINIMIZE";
      protectedCapability?: ProtectedNextBuyCapability;
    }
  | {
      layer: "ADVICE";
      kind: "BOUNDED";
      protectedCapability: ProtectedNextBuyCapability;
    }
  | {
      layer: "ADVICE";
      kind: "CURRENT_ROUND_PRIORITY";
    }
  | {
      layer: "ADVICE";
      kind: "COMPLETE_CURRENT_BUY";
    };

interface RecommendationOption {
  id: string;
  mode: PolicyMode;
  spendingGuidance: SpendingGuidance;
  purchases: readonly PurchaseItem[];
  bundleSpend: number;
  resultingInventory: ReturnType<typeof resultingLoadout>;
  trajectory: readonly TrajectoryScenario[];
  reasons: readonly PolicyReason[];
  assumptions: readonly string[];
  conditionalAlternatives: readonly ConditionalAlternative[];
  adviceStrength: "DOMINANT" | "SUPPORTED" | "ALTERNATIVE";
}

interface PolicyV3Output {
  status: "READY" | "INSUFFICIENT_STATE" | "UNSUPPORTED_POLICY_EVIDENCE";
  futureAffordability: FutureAffordabilitySet;
  options: readonly RecommendationOption[];
  defaultOptionId?: string;
  unresolved: readonly string[];
  opponent: Inference<OpponentEconomyClass>;
}
```

这是对当前 production contract 的最小必要 amendment：

- 当前 `spend` 明确改名为 `bundleSpend`，只表示所列 purchases 的增量成本；
- 每个 option 新增 `spendingGuidance`，表示经济层 ADVICE；
- `futureAffordability` 在 output-level 只计算一次，供多个 option 引用，避免逐项
  复制相同 scenario；
- 不新增独立 `reserveGuidance`：`requiredReserveNow` 已由 boundary 表达，重复一份
  advice 字段会制造第二 truth；
- 不新增独立 numeric `recommendedSpend`：研究不支持另一个精确目标；BOUNDED advice
  通过 `protectedCapability` 引用唯一数值 ceiling，具体建议金额由 `bundleSpend`
  表达；
- 不再新增 boundary id；capability 本身就是两个 boundary 的唯一稳定键，不复制
  target cash；
- 现有 `resultingInventory`、trajectory、reasons、assumptions、conditional
  alternatives、opponent inference 与 multimodal/default contract 全部保留。

字段分层锁定如下：

| 概念 | 层 | owner / 语义 |
| --- | --- | --- |
| current money、loss index、inventory、side | FACT | OBSERVED/TRACKED/UNKNOWN；缺失不补值 |
| loss reward、prices | mechanics | 由已验证 canonical rules 对 FACT loss index/side 求值，不是 observation |
| future-affordability boundary | SCENARIO | canonical fresh-buy + `LOSS_NO_PLANT` assumption；不是 future FACT |
| spending guidance / protected boundary selection | ADVICE | per-option；可引用 boundary，但不能改写 boundary |
| purchases / `bundleSpend` | ADVICE + mechanics | per-option 的具体合法 bundle；`bundleSpend` 不要求等于 ceiling |

必要 money、loss index 或 side 为 UNKNOWN 时，保持现有
`INSUFFICIENT_STATE + options=[]`，同时 `futureAffordability.status=UNKNOWN` 且不携带
数值。只有 current inventory 为 UNKNOWN 时仍不生成 option，但在前三项已知时可以
保留 canonical `PROJECTED` boundary，因为它不声称 future inventory。POST_PISTOL
与 OVERTIME 返回 `NOT_APPLICABLE`，不能消费 NORMAL boundary；其中 POST_PISTOL
保持独立策略，OVERTIME 则因本研究只有 3 行 observational semi 而不外推。future
inventory 未知不会让 canonical boundary 变成 UNKNOWN；它只使 exact
inventory-aware `reachability` 继续为 UNKNOWN。

### 8.1 四类策略的最终语义

内部 enum 名称继续保留；不做 production rename，也不把 cs2df `semi` 当成
`LIGHT` ground truth。

| observational / 产品术语 | internal mode | 第一层 economy semantic |
| --- | --- | --- |
| eco | `PRESERVE` | future economy 优先；当前消费低于 LIGHT，默认 `MINIMIZE`；只在 scenario 可达时才声称保护 future capability |
| 半起 | `LIGHT` | 有限投入获得当前战斗力，同时至少保护 `RIFLE_ARMOR` boundary；spending guidance 先于 weapon choice |
| 强起 | `FORCE` | 当前回合优先；无战略性 future reserve；把可用资金尽量转成当前有效战斗力 |
| 全起 | `FULL` | 当前已能形成正常完整战斗配置；由 inventory-aware planner 补齐，而非固定 fresh-buy template |

NORMAL LIGHT 最多可表达两个有产品意义的 option：

- 稳妥：保护 `RIFLE_ARMOR_BASIC_UTILITY`；
- 激进：至少保护 `RIFLE_ARMOR`。

只有 `reachableWithNoSpend=true` 且 `bundleSpend <= maxSpendNow` 的 boundary 才可被
引用；NORMAL LIGHT 还必须有 `bundleSpend > 0`，否则应归为 PRESERVE 或已有装备下
的完整配置。两者都是同一 canonical projection 的 capability level，不是拟合阈值；未有
用户 risk preference 或其他已锁证据时，不因 Major frequency 自动声明其中一个
为唯一 default。相同 bundle 同时满足两个 boundary 时只保留保护更强的 option，
避免重复建议。LIGHT 不要求花满任何 boundary。

这套 contract 对所有 mode 通用，但只有声明 future protection 的 option 才引用
boundary：PRESERVE 引用当前可达的最强 boundary；LIGHT 引用上述一个 boundary；
FORCE 使用 `CURRENT_ROUND_PRIORITY` 且不引用 boundary；FULL 使用
`COMPLETE_CURRENT_BUY`，也不伪造下一轮保护承诺。

### 8.2 Secondary bundle planner

mode / spending guidance 先决定 constraint，bundle planner 后决定具体买什么：

- NORMAL LIGHT 没有 retained primary 时，可在 envelope 内组合 paid pistol、armor、
  utility 或其他合法有限投入；SMG 可以是结果之一，但不是 subtype 输入或 mode 本体；
- 有 retained primary 时不 downgrade、不为匹配模板重买更低级 primary；planner
  以补甲、utility、CT kit 等 top-up 为主；
- current inventory 影响增量成本与 resulting bundle，但不能把 future inventory
  伪装成 FACT；
- pistol、utility、AWP preference 可以在合法候选中排序或产生 secondary
  alternative，但不能突破引用的 boundary；
- planner 可以选择明显低于 ceiling 的 bundle；不得以“剩余预算未花完”为理由
  继续 greedily fill，也不得按 fixed weapon tier 压过更有效的 armored bundle。

### 8.3 FORCE mechanical invariant

generic FORCE 的硬约束为：

```text
FORCE => resultingInventory.armor > 0
```

weapon tier、spend 或排序不得压过 armored combat bundle。唯一允许的 no-armor
语义必须是显式 `AWP_PATH` / `AWP_NO_ARMOR` special path，并通过独立 option id、
reason 与测试暴露；它不能藏在 generic FORCE 中。AK/M4/SMG/paid-pistol FORCE
没有例外。

锁定行为：

- T post-pistol 必须能同时表达 `PRESERVE` 与 `FORCE`；不得压成一个 Top-1；
- POST_PISTOL winner/loser、T loser multimodality、CT loser FORCE-dominant +
  fallback 与 history-unavailable UNKNOWN 行为全部保留；不得调用 NORMAL LIGHT
  boundary/mode selection；
- `LIGHT` 是真实少数 mode，contract 必须能表达，但不要求每次都输出，更不要求
  exact weapon-bundle imitation；
- CT post-pistol 可以给 FORCE-dominant default，但仍由 affordability、inventory、
  preference 和 unknown facts 约束；
- 非 post-pistol state 若证据没有 dominant mode，`defaultOptionId` 可以缺失；
- 必要 FACT 缺失时返回 `INSUFFICIENT_STATE`，不得为了完整性生成 recommendation；
- PISTOL purchase policy 不在冻结 evidence scope，返回
  `UNSUPPORTED_POLICY_EVIDENCE`，不得静默变成 PRESERVE；
- professional frequency 只解释 support，不定义最优动作或胜率。

## 9. Opponent-context fallback

`OpponentEconomyClass` 不出现在 FACT 或 purchase planner 输入中。Policy V3
只允许在 option 已经机械合法、可负担后使用它：

- likely established：可提高一般 rifle-economy context 的理由权重，但不得把它
  翻译为 exact weapon mix 或“helmet 无价值”；
- likely not established：只在 post-pistol/calibrated support 内作为 soft modifier；
- UNKNOWN：删除所有 opponent-specific reason，保持同一组基础 modes；
- inference 变化不能使一个原本不可负担的 plan 变得可负担；
- inference 变化不能隐藏 multimodal alternative。

runtime contract 没有 `opponentMoney` 字段，避免下游误用 exact 数值。

### 9.1 CT helmet semantic amendment

`docs/experiments/ct-helmet-decision-targeted-study.md` 的 targeted evidence 将
helmet gate 锁为 **B（weak evidence）**：normal-GSI opponent context 对完整 fresh
purchase surface 只有很小的 held-out 概率增量，对 Kevlar-vs-vesthelm target 没有
稳定的实质增量；可判定“低 helmet threat”的覆盖仅 15/3,790 team-round。

因此 V3：

- 不新增独立 opponent helmet-threat inference；
- `LIKELY_ESTABLISHED_RIFLE` 不得创建、删除或默认选择 skip-helmet plan；
- 它只可在 own-state 已把 Kevlar / vesthelm 判为近似平局时，作为非约束性的轻量
  explanation/ranking tie-break；
- `LIKELY_NOT_ESTABLISHED_RIFLE` 不能作为省头信号；`UNKNOWN` 删除 helmet 的
  opponent-specific reason；
- CT fresh 买甲与已有满甲的基础 fallback 均保持保守：默认包含 helmet；只有明确的
  own-state opportunity cost / trajectory constraint 才保留 Kevlar 或 skip alternative。

## 10. AWP 与用户主动偏好

职业角色证据只支持“已知 designated AWPer”对 AWP 使用的强泛化，不支持从
ordinary-player GSI 自动识别职业角色。V3 规则：

```ts
interface UserPreference {
  source: "DEFAULT" | "USER_DECLARED";
  awpPriority: "NEUTRAL" | "PREFER" | "SAVE_FOR_AWP";
  riskBias?: "NEUTRAL" | "PRESERVE" | "CONTEST";
  utilityBias?: "NEUTRAL" | "PREFER";
}
```

- 不从购买历史自动宣称用户是 AWPer/IGL/Support/Opener；
- `USER_DECLARED` AWP preference 可以增加 `AWP_PATH` 并改变 mode 排序，但仍需
  通过 affordability 与 trajectory；
- weak professional role generalization 不等于禁止用户主动声明 risk/utility
  偏好；这些偏好是 user intent，不是研究推断；
- preference 不覆盖游戏规则、side legality 或 UNKNOWN facts。

## 11. C4 uncertainty contract

当前 main 的 `plantedAtMonotonicNs` 在语义上实际是 first detection receipt。
V3 实现必须改名，避免把 receipt 当 real event：

```ts
type C4Timing =
  | {
      status: "UNKNOWN";
      detectedPlantedAtNs?: bigint;
      elapsedSinceDetectionMs?: number;
      reason: "COLD_START" | "UNCALIBRATED" | "PROFILE_MISMATCH" | "GAP";
    }
  | {
      status: "BOUNDED";
      detectedPlantedAtNs: bigint;
      remainingMs: { min: number; max: number };
      calibrationId: string;
    };
```

只有 Windows protocol 通过且 build/cfg/server profile 匹配，才能从 detection
delay interval 推出 `BOUNDED`。没有 calibration 时可以显示 bomb state 与
elapsed-since-detection，但不得显示“剩余 40/41 秒”的 FACT 文案。

## 12. V2 reuse / reject

### 12.1 选择性复用的 mechanics

从 `fb026ef` 手工移植、独立 review/test，不整体 merge：

- canonical `weaponClassOf()` 与 weapon table 单一来源；
- `planPurchases()` 对 sniper、paid pistol、defuse kit 的 inventory-aware 支持；
- `resultingLoadout()` 的 kit/secondary/sniper 表达；
- side legality、grenade slots、flash ≤2、incremental armor cost；
- 现有 `projectNextRoundMoney()`，但包装成多 scenario trajectory；
- reason code、determinism、property sweep 与 threshold-boundary 测试方式。

`greedilyFit()` 只可抽取“合法性/预算内装配”的机械部分；V2 的候选顺序属于
strategy，不可连同函数整体复用。

### 12.2 明确废弃的 strategy abstraction

- `STRONG_BUY_GATES` 与 professional `p_full>=0.80` hard gate；
- 单一 `preservationBudget` / `nextRoundBaselineCost`；
- 单一 fixed next-cash/reserve target 与“精确花到 maxSpend”；
- teammate exact money、relative surplus 或 team-resynchronization policy；
- `LIGHT = SMG + armor`、`light.spend < force.spend` 与任何 fixed weapon-template
  mode identity；
- fresh-buy 的固定 `RIFLE→SMG→paid pistol→SAVE` tier；
- FORCE 中让更高 weapon tier 排序压过 resulting armor 的候选选择；
- 单一 `PolicyDecision` / `displayTag` / Top-1；
- `roundStartMoney ?? currentMoney` fallback；
- 一个 `confidence` 同时混合 input quality、model certainty、advice strength；
- auto branch 中的 retained/helmet/AWP 人工策略常量；
- `nextRoundGoal` 到 override 的旧映射作为默认策略；
- V2 replay 中“62% 高于职业 p75、chosen primary high support 0%”的策略输出；
- V2 branch 中意外纳入的 `__pycache__` 等生成物。

## 13. Economy amendment implementation mapping 与 acceptance

### 13.1 已落地 production scope

以下内容已按一个 economy amendment 语义单元落地，期间未重开研究：

1. `packages/economy-advisor/src/policy-v3.ts`：加入 shared canonical
   boundaries、`SpendingGuidance`、`bundleSpend` contract；重写 NORMAL LIGHT
   selection/planning；加入 generic FORCE armor hard gate。
2. `packages/economy-advisor/src/policy-v3.test.ts`：覆盖两个 side / loss reward、
   boundary formula、under-ceiling bundle、retained-primary、FORCE armor 与
   POST_PISTOL isolation。只有现有 `planPurchases()` 无法表达 bounded legal fitting
   时，才对 `advisor.ts` 抽取最小 mechanics helper；不得把新 strategy 放进通用
   planner。
3. `apps/roundsense/src/index.ts`：把现有 `option.spend` consumer 更新为
   `bundleSpend`，只做最小 presenter/CLI contract adaptation；`engine.ts` 不新增
   economy interpretation。`engine.test.ts` 只补 runtime/POST_PISTOL regression。
4. `scripts/policy-v3-final-acceptance.ts`：更新 frozen harness 的字段消费与下述
   gate；重跑同一 Major corpus，不改 eligibility、label、阈值或 baseline 数据。

上述列表是 economy amendment 的直接改动面。`PolicyStateTracker`、
`opponent-economy.ts`、C4 packages、GSI protocol、shared types 与 rules price artifact
是先行 Policy V3 production 基础，不应因后续 economy cleanup 再被顺手扩张。

### 13.2 Mechanical / contract gates

- 所有 option 继续满足 budget、side legality、grenade slots、flash cap 与 canonical
  planner legality；
- 所有 generic non-AWP FORCE 的 resulting armor-zero violation 必须为 **0**；
- 两个 boundary 对 T/CT 与全部 loss index 的 `targetCash`、reserve、max-spend
  projection 必须与 canonical prices/reward 自洽；
- `reachableWithNoSpend=false` 不得被 advice 引用为 protected capability；
- 每个 BOUNDED option 均满足
  `bundleSpend <= referencedBoundary.maxSpendNow`；
- planner 不要求 equality；必须有合法 case 保持正 slack；
- NORMAL LIGHT 的 `bundleSpend > 0`；零消费不得换名为 LIGHT；
- retained primary 不 downgrade，且 LIGHT 不因模板购买更低级 primary；
- current inventory UNKNOWN 时无 recommendation；money/loss index/side 任一 UNKNOWN
  时也无 boundary 数值；scenario 不进入 FACT；
- opponent UNKNOWN recommendation set、exact-opponent-money prohibition、C4 UNKNOWN
  与 trajectory assumptions 不退化。

### 13.3 Frozen Major behavioral re-acceptance

Major 是 high-level behavioral reference，不是唯一最优策略 ground truth。新的 gate：

1. mechanical legality 与 13.2 的 invariant 全部通过；
2. generic FORCE armor-zero **0**；
3. FULL / FORCE / PRESERVE(eco) 的 mode exact/compatible coverage 不低于
   `584ec5c` baseline；
4. POST_PISTOL winner/loser、T multimodality、CT dominant/fallback、history UNKNOWN
   的 targeted 与 subgroup 指标不退化；
5. NORMAL LIGHT 不再由 fixed SMG + armor candidate 决定；报告 no-primary、
   retained-primary 与其他 resulting bundles 的 coverage，不设 exact weapon-bundle
   imitation 提升门槛；
6. future-affordability guidance 与 canonical projection 逐行自洽；
7. retained-primary downgrade 为 0；
8. bundle spend 突破所属 advice envelope 为 0；
9. opponent UNKNOWN、C4 UNKNOWN 与 FACT/SCENARIO boundary targeted tests 不退化；
10. lead/best-set overall spend MAE、severe-any 与主要 money-band/side subgroup 必须
    报告相对 `584ec5c` 的 delta；overall spend MAE 与 severe-any 不得同时恶化，任何
    跨 side 或多个 money band 的同向恶化均阻塞自动 READY，需 case attribution 后
    重新作 architecture decision。

不再以 `LIGHT exact weapon bundle imitation` 作为成功条件，也不为了改善 Major
模仿率新增职业专用 threshold。frozen run 只验证新 policy 是否机械正确、经济解释
自洽且没有系统性行为退化。

## 14. Blocker 与 readiness

- **Policy V3 economy amendment blocker：无。** NORMAL LIGHT spending guidance、
  两个 canonical boundary、secondary planner contract、FORCE armor invariant 与
  frozen re-acceptance 已锁定。
- **其他 Policy V3 blocker：无。** opponent context 已有可部署 coarse gate，并有
  UNKNOWN fallback；multi-round/multimodal contracts 已锁定。
- **C4 calibrated countdown blocker：有且只有一个。** 必须完成 Windows
  controlled calibration；在此之前 timing 诚实返回 UNKNOWN，不阻塞 economy
  Policy V3。

**POLICY V3 ECONOMY ARCHITECTURE AMENDMENT: LOCKED**

**ECONOMY AMENDMENT IMPLEMENTED AND BEHAVIOR-FROZEN: YES (`275566e`)**
