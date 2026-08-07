# RoundSense — Capability Matrix

> 证据等级：GSI 直接观测 / 状态差分推导 / 规则估算 / Demo 真值 / 不可用。
> 规则细节见 [assumptions.md](assumptions.md)（唯一权威）。

## 1. C4 / 炸弹信号

| 信号 | 实时（普通玩家） | 离线真值（v3 ZIP） | 说明 |
|---|---|---|---|
| 安放完成 | 状态差分：`round.bomb: planted` | `bombs.json planted + tick` | 延迟 = buffer/throttle + 网络，P0-A 待测 |
| 安放开始 | 不可用 | `bombs.json plant_begin` | 实时只能观测"完成" |
| 爆炸 | 差分：`round.bomb: exploding` | `bombs.json exploded` | 不伪造未观测事件 |
| 拆包 | 开始不可用；完成 = `defused` | `defuse_begin/defused` | — |
| 剩余时间 | 规则估算：`plantedAt + fuseMs − now` | 精确（223/223 = 41.000s） | Phase_countdowns 不可用 → 必须估算 |
| 引信时长 | 规则（41s，corpus-observed；40s 未排除） | 语料分布核验 | [runtime-unverified] 见 c4-latency 协议 |
| 炸弹位置/携带者 | 不可用 | `bombs.json` | — |

## 2. 个人状态信号

| 信号 | 实时 | 离线真值 | 说明 |
|---|---|---|---|
| 当前金钱 | `player_state.money` | `startMoney`（回合开始） | 口径不同 |
| 装备价值 | `player_state.equip_value` | `equipmentValue` | 可交叉验证 |
| 主/副武器、投掷物 | `player_weapons` | `primary/secondary/grenades` | — |
| 甲/头盔/钳 | armor/helmet；钳子推断 | hasArmor/hasHelmet/hasDefuseKit | 钳子字段 [runtime-unverified] |
| 击杀武器 | **不可用**（GSI 无此字段） | kills.json weapon | 实时路径用 class 聚合奖励 |

## 3. 经济/回合信号

| 信号 | 实时 | 离线真值 | 说明 |
|---|---|---|---|
| 连败计数 | `map.team_ct/team_t.consecutive_round_losses`（**declared；当前 build 是否发送 [runtime-unverified]**） | rounds.json winnerTeamKey 推导（`loss-bonus-state`） | Windows 受控实验待测（loss-counter-runtime 协议） |
| 回合胜负 | `round.win_team` | rounds.json | — |
| 败方奖金 | 规则估算（payout 表） | replay 结算跳变（精确） | win decrement 未决 → 投影为估算 |
| CT 团队奖励 | 规则（50×消灭） | 整数账本证实 | 输入 ctTeamKillsOnTs 由调用方提供 |
| moneySpent | —（GSI 无） | `m_iCashSpentThisRound`@freezeEnd 快照 | 不含 buytime 尾段；语义见 C10 |
| buytime 窗口 | — | freezeEnd+19.6s 内购买观测 | H2 成立；精确截止未测 |

## 4. 明确不可用（禁止猜测填充）

- `phase_countdowns`、`bomb` 位置、`allplayers_*`（普通玩家不可用）
- 击杀武器（实时）
- 内部 loss counter（GSI 字段未实测前）
- unknown 武器击杀奖励（显式报错）
