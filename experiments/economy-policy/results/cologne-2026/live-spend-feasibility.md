# Live "本局已花 $X" — mechanical feasibility（显示可行性分级）

> 目标：机械评估 live UI 显示"本局已花 $X"（currentRoundSpend）的可行性，按 RELIABLE / CONDITIONAL / UNRELIABLE 分级。
> 依赖锚定：`roundStartMoney` 来自 DecisionAnchor（见 decision-anchor-design.md）；无锚定时 spend 不可定义。
> 事实基线：`docs/runtime-checks.md`（D1/D3，Windows build 14174）、`docs/evidence.md`、`packages/economy-advisor/src/projection.ts`、`packages/gsi-protocol/src/payload.ts`。

## 0. 定义与核心矛盾

机械定义：`spend = roundStartMoney − currentMoney`（money 差分）。
**核心矛盾**：`player.state.money` 是**实时净现金**，不是购买流水。实测契约（memory + runtime-checks）：

- money 实时**包含 kill 奖励**（1650 → 2250 恰随 round_kills 0→1；engine.ts C3 注释明确"past round_kills are NOT future income"）。
- 结算 delta 精确可测（D1：7250→9150 = 1900；9350→11750 = 2400）——说明 money 差分本身精确，**但差分 ≠ 花费**。
- grenades 是**单 entry + `ammo_reserve` 计数量**（flash×2 = 同一 entry reserve=2，D3）——数量变化可观测，但**投掷使用也会降 reserve（不是花费）**。

因此"已花 $X"只有两条机械路径：A) money 差分（简单、被奖励/退款污染）；B) 购买事件流（inventory + previously 差分，复杂、部分未验证）。分级如下。

## 1. RELIABLE（可直接显示）

| 显示项 | 方法 | 依据 |
| --- | --- | --- |
| 净现金流（net cash flow，可正可负） | `roundStartMoney − currentMoney`，标注"截至最后一帧" | money 实时精确（OBSERVED）；D1 结算 delta 精确；engine.ts 已按 exact 消费 |
| 首帧锚定的 roundStartMoney（若 anchor confidence=high/medium） | 见 decision-anchor-design.md §2-3 | 需先过 runtime validation（freeze 首帧捕获），验证前整体不算 RELIABLE → **见 §4** |

## 2. CONDITIONAL（有条件可用，必须带上下文标注）

| 场景 | 机械问题 | 判定与条件 |
| --- | --- | --- |
| **grenade 购买 vs 使用** | 购买 = reserve↑ & money↓；使用 = reserve↓ & money 不变。两者都改变同一 entry 的 `ammo_reserve` | **可区分**：用 money 差分佐证。购买额 = 价格表（smoke 300 / flash 200 / he 300 / molotov 400 / incendiary 500 / decoy 50，rules JSON `prices`）。reserve 变化但 money 无对应下降 → 使用，不计入 spend。依赖 freeze 内变化驱动的推送时序（median ~4.4s）→ 边界处可能欠采样 |
| **armor upgrade** | armor 0→100 = kevlar $650；armor=100 & helmet=false → vesthelm = **$350 upgrade**；**armor<100 买 kevlar_helmet = 文档化全价 $1000**（runtime-checks.md #3 收紧：绝不能把 OBSERVED 案例扩大成"任何已有甲都 $350"） | 购买识别可行（`player.state.armor`/`helmet` 变化），**价格判断必须带 armor 上下文**；armor<100 的 $1000 是文档化规则、未 live 验证 → 价格侧标注 `estimated` |
| **weapon change（换枪）** | 换枪 = 卖出+买入组合；同价换（如 AK↔M4 类）净 money 差可为 0 | 显示"已花"会误导。武器身份差分（entry 增删）**未确认出现在 previously** → `NEEDS RUNTIME VALIDATION`；验证前只能显示 net flow + inventory 变化列表，不显示"花费 $X" |
| **refund（卖出）** | 卖出 = money↑ & weapon entry 消失。sellback 语义**未解决**（evidence.md moneySpent notes："sellback semantics unresolved"）；CS2 通常全额退款但 live 未验证 | 若 previously.weapons 增删可见（待验证）→ spend 修正为 `Σ买入价 − Σ卖出价`；否则 refund 会把 spend 抵消成 net flow → 归入 UNRELIABLE |
| **CT shared / 回合末奖励** | 结算期 money 跳变（CT +50×tEliminated 独立到账、plant/defuse +300 等）会污染 freezetime 首帧前的差分 | live freezetime 内通常无结算跳变；但 D1 观测显示半场末可延迟到 +517 ticks → 锚定窗口需排除结算期帧 |

## 3. UNRELIABLE（不可作为事实显示）

| 场景 | 原因 |
| --- | --- |
| **live kill 奖励下的 money 差分 spend** | kill 奖励实时混入 money（实测 1650→2250）且 GSI 无 kill 事件流（`match_stats.round_kills` 只有计数；weaponClass 不可得 → killReward 不可归因，engine.ts catch→0）→ 多杀回合 spend 被严重低估。**"已花"必须基于购买事件流，money 差分只能做 net flow** |
| **buytime 尾段花费** | 普通玩家无 `phase_countdowns` → **live 无 buytime 倒计时**，购买窗口关闭时刻不可知（语料：最晚购买 freezeEnd+19.63s，buytime 从 freezeEnd 起算 H2）→ "已花"在 live 阶段会继续变化，无法给"最终 $X" |
| **未锚定的 roundStartMoney** | 无 anchor → 无基线 → spend 无定义（mid-round join / 首帧已购买，confidence=low） |

## 4. 结论表

| 显示目标 | 方法 | 分级 | 前置条件 |
| --- | --- | --- | --- |
| 本局净现金流（可正可负，实时） | `roundStartMoney − currentMoney` | **RELIABLE**（数值精确） | anchor 存在 |
| 本局已花（购买总额 $X） | 购买事件流差分（inventory + previously + 价格表） | **CONDITIONAL** | previously.weapons 增删验证 + armor 上下文价格 + 排除使用/奖励/退款 |
| 本局已花（money 差分） | `roundStartMoney − currentMoney` | **UNRELIABLE** | kill 奖励/refund/CT shared 污染，只适合 net flow |
| 最终已花（回合结束时） | moneySpent 语义（`m_iCashSpentThisRound` @ freeze_end 快照） | live 不可得 | 该字段只存在于 demo/服务器端，GSI 无（evidence.md） |

**总原则**：显示"已花 $X"前必须完成两项 runtime validation：(1) freeze 首帧锚定纯净性；(2) `previously.weapons` entry 增删可见性。任一未过，只能显示 net cash flow + 购买建议（现状 engine.ts 已覆盖），不显示 spend 总额。
