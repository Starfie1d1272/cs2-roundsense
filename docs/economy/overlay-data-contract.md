# Overlay 数据契约（设计稿）

> 目的：为最终 overlay 层定义**需要表达哪些字段**、每个字段的**可用性标签**（always available / freeze only / live update / conditional）与**数据来源**。
> 现状参考：`apps/roundsense/src/index.ts`（CLI 入口与打印）、`presenter.ts`（C4 倒计时渲染）、`engine.ts`（`tick` → `AdviceTick`）、`packages/economy-advisor`（`recommend` → `AdvisorOutput`）。
> 本文件只定义契约与可用性，不定义渲染布局。

## 1. 现有 CLI 输出（事实基线）

`index.ts` 目前打印两类行：

1. **C4 行**（`presenter.ts`，事件驱动 + 本地 0.5s 定时器）：`C4 PLANTED — X.Xs remaining`；`baseline_only` 时打印 `C4 PLANTED — remaining time unknown (joined mid-round)`；terminal 事件（`defused` / `exploded`）打印 `C4 DEFUSED` / `C4 EXPLODED`。
2. **经济行**（`index.ts:58-71`，freezetime 内、5s 节流）：
   - 首行：`side rN money=$X loss=N(gsi|assumed) goal=Y`（side / roundNumber / money / lossStreak + source / goal）
   - `推荐: <label> $<totalCost>`；`需买: <item>×qty、…`（`purchaseText`，含"头盔升级"文案）
   - `备选: <label> | 需买: … | $<cost>`（最多 2 个）
   - `⚠ <breaksGoalReason>`（破坏目标时）

`AdviceTick`（engine.ts:24-46）字段：`side / roundNumber / money / lossStreak / lossStreakSource / goal / recommended{label, purchases, totalCost, targetCost, armor, helmet} / alternatives[] / breaksGoal`。注意 **CLI 目前不打印投影分支**（`recommend` 输出里每个 scheme 都带 `projections{win, winBomb, loss, lossWithPlant}`，但 `AdviceTick` 没有透传，`index.ts` 也未显示）——overlay 若要"after-buy next-round projection"，需要先在 `AdviceTick` 增加字段。

## 2. 契约字段总表

### FACT 组（事实，不掺建议）

| # | 字段 | 类型/示例 | 可用性 | 来源 | 备注 |
|---|---|---|---|---|---|
| F1 | 当前现金 current money | `$2750` | **live update**（每个 GSI payload 刷新；freezetime/live/over 均有） | `player.state.money` | money 已含本回合已发生的击杀奖励（build 14174 实测：1650→2250 与 round_kills 0→1 同步，engine.ts:137-141 注释 C3）——overlay 不得再叠加 killsThisRound。菜单/热身期是否显示由 overlay 自行决定（本字段本身 always available） |
| F2 | 连败奖励 loss reward | `loss=1 → $1900` | **live update**（`map.team_*.consecutive_round_losses` 全 phase 发送）；**conditional**：index 0/3/4 与 capped 状态的 payout 未在受控 runtime 直接验证（`docs/runtime-checks.md` §1），显示金额时按 `lossBonus(index)` 表值（1400+500×idx，cap 3400）即可，但产品文档需保留该限定 | `consecutive_round_losses` → `lossBonus(rules, idx)`（rules.ts:163） | GSI 缺该字段时 engine 用 `lossStreak = 1` 并标 `lossStreakSource: "assumed-1"`（engine.ts:129-130）——overlay 必须把 assumed 状态可视化为 conditional（如 `loss=1(assumed)`） |
| F3 | 下一回合现金投影 next-round projection | `win $5900 / loss $4300`（四个分支） | **freeze only**：只在 freezetime 计算（engine.ts:121，advice 仅 freezetime）；同一 payload 内随购买方案变化（见 A3） | `projectNextRoundMoney`（projection.ts:38-56）：win 3250 / winBomb 3500 / loss 按 lossBonus / lossWithPlant（T 假想 +600） | 假想分支语义：`lossWithPlant` 是"若 T 输但完成下包"的假想结果，不是当前观测（projection.ts:17-20 注释）；CT 侧 lossWithPlant === loss。overlay 建议只显示 win / loss 两分支 + （T 侧可选）lossWithPlant，并标注 winBomb 仅在炸弹局相关 |
| F4 | C4 剩余时间 C4 timer | `C4 — 23.4s` | **live update**：安放后本地 0.5s 定时器驱动（presenter.ts:37），GSI payload 断流 30s 也不停表；安放前/拆后无此字段；`baseline_only`（中途加入）为 **conditional** `unknown` | `C4StateMachine`（c4-estimator）+ `estimateRemainingDefault`（fuse 41000ms，语料验证 1296/1296） | 本地归零**不是**领域事实（presenter.ts:73-77：归零只停表，不打印 exploded，等 GSI terminal 事件裁决）——overlay 同理：倒计时到 0 只显示 `0.0s`，爆炸/拆除必须以 GSI `round.bomb` terminal 状态为准 |
| F5 | 回合上下文 | `T r7 / 3-3 / half 2` | **live update** | `player.team` / `map.round` / `map_round_wins` | 低风险事实，CLI 已有 side+roundNumber，overlay 可加计分板 |

### ADVICE 组（建议，全部 **freeze only**——`tick` 在非 freezetime 返回 null，engine.ts:121）

| # | 字段 | 类型/示例 | 可用性 | 来源 | 备注 |
|---|---|---|---|---|---|
| A1 | 花费目标 spend target | `推荐方案 $1450`（增量） | **freeze only**；推荐方案不存在（资金不足）时为 **conditional** `无（资金不足）` | `recommended.totalCost`（增量）vs `targetCost`（满配价值，advisor.ts:171-180） | overlay 应同时给两个数：本次需花 / 目标价值；`totalCost=0`（已持有全部装备）不能降级方案（advisor.ts:308-312 nonSave 逻辑） |
| A2 | 具体购买 concrete buy | `AK47、全甲、烟雾弹`；`头盔升级 $350` | **freeze only** | `recommended.purchases` + `armorItemDisplay`（index.ts:36-39） | 甲文案按当前甲况区分"头盔升级"（armor=100 && !helmet）与"甲+头"；grenade ×2 显示 `闪光弹×2` |
| A3 | 购买后下一回合投影 after-buy next-round projection | `买后：赢 $4450 / 输 $2850` | **freeze only**；随 A2 联动（每个方案有自己的 projections） | `scheme.projections`（advisor.ts:255，spendNow=totalCost 代入） | **CLI 现状缺口**：`AdviceTick` 未透传 projections，overlay 需要先扩展 engine.ts。展示时与"不买"基线（F3 无花费投影）并列，即"花 $X 买 Y 后，下回合各分支剩多少" |
| A4 | 备选方案 alternative | 至多 2 个（aggressive / conservative），各带 A2+A3 | **freeze only**；只有一个可选方案时为 **conditional**（无备选） | `alternatives`（advisor.ts:331-353 去重后 slice(0,2)） | 备选排序：aggressive 按 targetCost 降序、conservative 按升序（:332-333） |
| A5 | 歧义/风险标注 ambiguity & caveats | `⚠ 破坏目标：失败分支下回合 $2400 < 目标成本 $3850` | **freeze only**；无风险时 **conditional**（不出现） | `breaksGoal` / `breaksGoalReason`（advisor.ts:259-270）；`lossStreakSource === "assumed-1"`（engine.ts:150） | 已实现两类：破坏目标警告、lossStreak 假定来源。**建议新增第三类**：职业行为参考的频率旁注（"职业参考 68%·n=143，备选 FORCE 25%"——来自 decision-map 蒸馏，见 cs2-demo-analysis skill §5 相关 reference），标注为行为参考而非最优真值 |
| A6 | 方案角色 character | recommended / aggressive / conservative | **freeze only** | `scheme.character` | 决定 overlay 的视觉权重（推荐主显、备选次显） |

### 派生建议（未来，**conditional**）

| 字段 | 可用性 | 说明 |
|---|---|---|
| 购买可行性 feasibility | freeze only | `totalCost <= money`（`affordable`，advisor.ts:245）；当前 CLI 已隐含（推荐只从 affordable 中选），overlay 可显式展示"还差 $X" |
| 置信度/数据支持 confidence | conditional | 离线 policy surface 的 OBSERVED/INTERPOLATED/EXTRAPOLATED/LOW_SUPPORT 五类（见 skill `conditional-loadout-v2` reference）尚未接入 live 产品；接入前不得假装连续区间 |

## 3. 可用性标签速查

- **always available**：F1（money 数值本身）、F5（回合上下文）——只要在比赛中就有。
- **freeze only**：F3、A1–A6——全部由 `tick` 在 freezetime 产生；freezetime 之外 overlay 应保留上一帧或清空建议区（建议：保留但加"非购买阶段"淡化，清空会闪）。
- **live update**：F1、F2、F4（倒计时）——payload 驱动或本地定时器驱动，节流 5s 只作用于 advice 行（index.ts:58-61），C4 倒计时不受节流。
- **conditional**：F2 的 assumed-1 变体、F4 的 baseline_only unknown、A1 的无方案态、A4 的无备选态、A5 的无风险态（字段缺席即条件不成立）、未来 A6 扩展。

## 4. 字段 → GSI / advisor 来源映射（实现核对清单）

| Overlay 字段 | 直接来源 | 需要新增的接线 |
|---|---|---|
| F1 | `payload.player.state.money` | 无（engine.ts:124 已有） |
| F2 | `payload.map.team_t|team_ct.consecutive_round_losses` | `lossStreakSource` 已透传（engine.ts:150）；payout 金额需 overlay 侧调 `lossBonus` 或由 engine 输出 |
| F3 | `projectNextRoundMoney` | **`AdviceTick` 需增加 projections 透传**（当前只在 `Scheme` 内，engine.ts 未带出） |
| F4 | `C4StateMachine` 事件 + `estimateRemainingDefault` | 无（presenter.ts 已实现，overlay 复用同一状态机） |
| A1/A2/A4/A6 | `recommended` / `alternatives` | 无（AdviceTick 已含，index.ts:64-69 已打印） |
| A3 | `scheme.projections` | **同 F3：需扩展 AdviceTick** |
| A5 | `breaksGoal` / `lossStreakSource` | `breaksGoal` 已透传（engine.ts:170）；assumed 标记已透传 |

## 5. 语义红线（overlay 实现时必须遵守）

1. **本地倒计时归零 ≠ 爆炸**：爆炸/拆除只信 GSI terminal 事件（`round.bomb` exploded/defused），与 presenter.ts:73-77 同纪律。
2. **money 不再叠加击杀**：F1 已含本回合击杀奖励（C3 契约），overlay 不得把 `round_kills` 再算进投影。
3. **lossWithPlant 是假想分支**：显示时必须标注"若下包"（T 侧），不得当作当前事实。
4. **职业参考 ≠ 最优真值**：任何来自离线策略面的频率/概率旁注都要标"职业行为参考"，与 README 定位一致。
5. **freeze only 的建议不得跨 phase 伪装**：live/planted/over 阶段建议区只能显示上一 freezetime 的残留（明确淡化）或占位，不得重新计算。
