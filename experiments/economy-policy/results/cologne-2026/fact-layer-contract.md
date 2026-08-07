# FACT layer contract（live 事实层契约）

> 定义 live 层输出的**事实（fact）**及其类型标注：`exact`（GSI 直接给值）/ `derived`（观测值 + verified 规则计算）/ `estimated`（含未验证假设）/ `unavailable`（GSI 无字段）。
> 事实基线：`docs/runtime-checks.md`（Windows build 14174, 2026-08-07）、`docs/evidence.md`、`packages/economy-advisor/rules/cs2-competitive-2026-08.json`（lossBonusByStreak / prices / maxMoney=16000）、`packages/economy-advisor/src/projection.ts`、`apps/roundsense/src/engine.ts`。
> 消费方契约：现有 live advisor（engine.ts `tick()`）只依赖粗体项；`roundStartMoney`/`currentRoundSpend` 是未来 DecisionAnchor 层输出，进入 production 前必须过 runtime validation。

## FACT contract

| Fact | 类型 | 来源与计算 | 状态 / 备注 |
| --- | --- | --- | --- |
| **`currentMoney`** | **exact** | `player.state.money`（实时净现金，**含 kill 奖励**） | OBSERVED（1650→2250 随 round_kills 0→1；D1 结算 delta 精确）。engine.ts C3 消费时不再叠加 killsThisRound |
| **`side`** | **exact** | `player.team`，精确大写 `"CT"`/`"T"` | OBSERVED；engine.ts C2 只接受这两种 |
| **`lossIndex`** | **derived** | `map.team_*.consecutive_round_losses`（按 side 取 team_t/team_ct）；**缺失时 = 1 并标注 assumed**（engine.ts `lossStreakSource: "gsi" | "assumed-1"`） | OBSERVED（40/41；warmup 也计数；输 +1、赢 −2 递减实测）。2 个 clean 判别样本：index 1→1900、2→2400；**index 0/3/4 与 capped(lCT=4) 未在受控 runtime 验证 payout** → 表值映射部分验证 |
| **`lossReward`** | **derived（from rules）** | `lossBonus(rules, lossIndex)`：`[1400,1900,2400,2900,3400]`（rules JSON `lossBonusByStreak`） | 数值 corpus-verified（316 场整数账本）+ 2/2 runtime 命中；`mp_starting_losses=1` → 半场首败 lossStreak=1 自然付 1900（无 pistol 特例） |
| `nextIfLoseNoSpend` | derived | `clamp(currentMoney + lossReward, 0, 16000)`（projection.ts 公式，spendNow=0、kills=0 的特例） | derived 成立，但**不含**：CT shared +50×tEliminated、plant/defuse 个人 +300、TK −300、short-handed、T 存活 time_ran_out 无奖励（projection.ts assumptions；L3 语料 354 样本 0 违规）→ 精确值有边界误差 |
| `nextIfLoseWithPlantNoSpend`（T 专属） | derived（hypothetical） | `clamp(currentMoney + lossReward + plantBonusT, 0, 16000)`，`plantBonusT = 600`（corpus 近似，官方 2024-05-23 $800→$600）；CT 侧恒等于 nextIfLoseNoSpend | **假想分支**：live advice 只在 freezetime 跑，不可能知道当前下包（projection.ts 注释；2026-08-07 Final Convergence 删除 bombPlantedThisRound 输入）→ 是条件事实不是观测 |
| `currentInventory` | exact（runtime 表示） | `player.state.armor`（0–100）、`player.state.helmet`（boolean）、`player.state.defusekit`（boolean）；grenades 从 `player.weapons` 单 entry 的 `ammo_reserve` 计数；primary/secondary 经 `weaponIdToItem()` 反查 + GSI 别名 `weapon_m4a4→m4a4` | OBSERVED（D3 完整实测：kevlar/helmet/defusekit 只在 state；flash×2 = 同一 entry reserve=2）。**edge：reserve 缺失时 engine 取 1（≥1 证明），1 vs 未知不可分**；kevlar/kevlar_helmet 的 weapons entry 被 engine 跳过（价格上下文在 advisor） |
| `roundStartMoney` | **unavailable（无字段）** → optional | GSI 无回合开始现金字段；唯一途径 = DecisionAnchor freeze 首帧捕获 | **NEEDS RUNTIME VALIDATION**（freeze 首帧可能已含购买；cadence median ~4.4s；D1/D3 观测未受控验证首帧纯净性——见 gsi-deployability.md roundStartMoney 节） |
| `currentRoundSpend` | estimated（上限） | 依赖 `roundStartMoney` + 购买事件流差分；money 差分被 kill 奖励/refund/CT shared 污染 | **UNRELIABLE 作为"已花 $X"**（见 live-spend-feasibility.md）；`previously.weapons` entry 增删未验证；sellback 语义未解决（evidence.md）→ 验证前不得作为事实发布 |

## 类型语义

- **exact**：GSI 直接给值，无中间假设（采样延迟除外——变化驱动推送，cadence median ~4.4s）。
- **derived**：由 exact 观测 + verified 规则（rules JSON `status: verified`, `statusScope: "numeric-rules"`）确定性计算。
- **estimated**：计算依赖未验证假设（价格上下文、窗口边界、缺失字段默认），必须带 `assumed`/`estimated` 标注（同 engine.ts `lossStreakSource` 风格）。
- **unavailable**：GSI 协议无此字段，只能靠捕获/推断（roundStartMoney）或完全不可得（live buytime 倒计时、moneySpent 快照）。

## 消费方契约

1. **live advisor（现状，engine.ts）**：只消费 `currentMoney` + `lossIndex` + `lossReward`(derived) + `currentInventory`。缺 `map.round` → 不出建议（不猜 round 1）；缺 `consecutive_round_losses` → assumed-1 显式标注。这是 production 的事实基线。
2. **未来 anchor/policy 层**：`roundStartMoney`/`currentRoundSpend` 加入 FACT 层的前提 = decision-anchor-design.md §5 的两项 runtime validation 通过；在此之前任何 UI/建议不得引用 spend 总额。
3. **一致性规则**：同一事实只有一个 runtime source of truth（沿用 C4Presenter review 原则——presentation 不持有 domain 副本）；FACT 层字段不得在 app 层重复计算（weapon 映射单一来源 = `weaponIdToItem()` 反查，engine.ts 只保留 GSI 层别名与 grenade/armor/kit 的 runtime-observed 表示）。
