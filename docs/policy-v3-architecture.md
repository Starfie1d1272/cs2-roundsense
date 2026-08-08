# RoundSense Policy V3 architecture lock

状态：**authoritative / implementation-ready**

日期：2026-08-08

范围：Policy V3 技术设计、opponent economy deployability、C4 uncertainty。
本文件不实现 V3，不设计 Overlay/UI。

## 0. 最终 gate

| 项目 | 结论 |
| --- | --- |
| GSI-only opponent economy | **GO（仅 coarse expectation）** |
| exact opponent money | **禁止** |
| C4 bomb state | **可锁：normal GSI direct observation + safe transition tracking** |
| C4 数字剩余时间 | **当前不可锁：UNKNOWN，等待唯一 Windows calibration** |
| V2 strategy | **拒绝整体复用** |
| V2 mechanics | **选择性移植，逐项测试** |
| Policy V3 implementation | **READY**；C4 数字计时另有 bounded blocker |

GO 的含义严格限定为：V3 可以消费
`LIKELY_ESTABLISHED_RIFLE | LIKELY_NOT_ESTABLISHED_RIFLE | UNKNOWN`，并把它
当作带校准范围的 INFERENCE。它不是 FACT，不表示 exact money，不允许成为
购买可行性或单一路径的硬 gate。

## 1. 权威基线与事实优先级

本设计按以下顺序裁决冲突：

1. production：`main @ 37a9756` 的实际代码与 Windows runtime evidence；
2. frozen professional evidence：`research/economy-policy @ 0875db9`；
3. final strategy/role/opponent research：
   `research/post-pistol-strategy @ ac8444f`；
4. V2 engineering reference：`feat/economy-policy-v2 @ fb026ef`。

两条 research branch 只提供证据；V2 只提供候选工程资产。V3 不 merge、
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

场景限制：

- post-pistol：n=808，覆盖 100%，总体准确率 90.97%；likely established
  precision 87.62%，likely not precision 94.31%；只能做 soft context；
- later rounds：覆盖 63.75%，可判准确率 96.62%，但**没有**可靠的 likely-not
  输出；不满足 likely-established gate 的 later state 必须 UNKNOWN；
- opponent CT：UNKNOWN 25.07%；opponent T：UNKNOWN 39.71%；
- overtime、loss counter 缺失、history gap、非标准 half/round lifecycle、
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
  nextLossIndex: Fact<number> | { status: "UNKNOWN"; reason: string };
  reachableModes: readonly PolicyMode[];
}
```

机械 projection 可以复用现有规则；policy 只能比较同一组 scenario，不能把
某一个“plain loss”当成必然未来，也不能重新引入单一 preservation budget。

## 8. Multimodal recommendation

```ts
type PolicyMode = "PRESERVE" | "LIGHT" | "FORCE" | "FULL" | "AWP_PATH";

interface RecommendationOption {
  id: string;
  mode: PolicyMode;
  purchases: readonly PurchaseItem[];
  spend: number;
  trajectory: readonly TrajectoryScenario[];
  reasons: readonly PolicyReason[];
  adviceStrength: "DOMINANT" | "SUPPORTED" | "ALTERNATIVE";
}

interface PolicyV3Output {
  status: "READY" | "INSUFFICIENT_STATE";
  options: readonly RecommendationOption[];
  defaultOptionId?: string;
  unresolved: readonly string[];
}
```

锁定行为：

- T post-pistol 必须能同时表达 `PRESERVE` 与 `FORCE`；不得压成一个 Top-1；
- `LIGHT` 是真实少数 mode，contract 必须能表达，但不要求每次都输出；
- CT post-pistol 可以给 FORCE-dominant default，但仍由 affordability、inventory、
  preference 和 unknown facts 约束；
- 非 post-pistol state 若证据没有 dominant mode，`defaultOptionId` 可以缺失；
- 必要 FACT 缺失时返回 `INSUFFICIENT_STATE`，不得为了完整性生成 recommendation；
- professional frequency 只解释 support，不定义最优动作或胜率。

## 9. Opponent-context fallback

`OpponentEconomyClass` 不出现在 FACT 或 purchase planner 输入中。Policy V3
只允许在 option 已经机械合法、可负担后使用它：

- likely established：可提高“对 rifle threat 的防护”类理由权重；
- likely not established：只在 post-pistol/calibrated support 内作为 soft modifier；
- UNKNOWN：删除所有 opponent-specific reason，保持同一组基础 modes；
- inference 变化不能使一个原本不可负担的 plan 变得可负担；
- inference 变化不能隐藏 multimodal alternative。

runtime contract 没有 `opponentMoney` 字段，避免下游误用 exact 数值。

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
- fresh-buy 的固定 `RIFLE→SMG→paid pistol→SAVE` tier；
- 单一 `PolicyDecision` / `displayTag` / Top-1；
- `roundStartMoney ?? currentMoney` fallback；
- 一个 `confidence` 同时混合 input quality、model certainty、advice strength；
- auto branch 中的 retained/helmet/AWP 人工策略常量；
- `nextRoundGoal` 到 override 的旧映射作为默认策略；
- V2 replay 中“62% 高于职业 p75、chosen primary high support 0%”的策略输出；
- V2 branch 中意外纳入的 `__pycache__` 等生成物。

## 13. Implementation sequence 与 acceptance

实现时按语义完整单元推进，不要求本任务执行：

1. contracts + `PolicyStateTracker`：先让 UNKNOWN、history integrity、round
   identity 可测试；
2. V2 mechanical ports：逐项移植 planner/rules tests，不移植 strategy；
3. trajectory scenarios + multimodal output；
4. opponent inference adapter + UNKNOWN fallback；
5. explicit preferences/AWP path；
6. C4 uncertainty rename/contract；数字 timing 等 calibration 通过后单独实现。

Policy V3 acceptance：

- 任意缺失字段、cold start、seq gap、map reset 都有 UNKNOWN test；
- T post-pistol 输出至少两个可区分 mode；CT 支持 dominant + fallback；
- opponent inference 设为 UNKNOWN 时，基础合法 recommendations 不消失；
- 没有 public/runtime type 能表达 exact opponent money；
- user-declared AWP preference 有作用，但非声明用户不会被自动标记角色；
- 所有 option 的 purchases 均通过 canonical planner；
- trajectory 每个数字都附 scenario assumptions；
- C4 未校准时不存在 numeric remaining FACT。

## 14. Blocker 与 readiness

- **Policy V3 blocker：无。** opponent context 已有可部署 coarse gate，并有
  UNKNOWN fallback；multi-round/multimodal contracts 已锁定。
- **C4 calibrated countdown blocker：有且只有一个。** 必须完成 Windows
  controlled calibration；在此之前 timing 诚实返回 UNKNOWN，不阻塞 economy
  Policy V3。

**READY FOR POLICY V3 IMPLEMENTATION: YES**
