# RoundSense — Capability Matrix

> 每个信号标注其证据等级。证据等级定义：
> - **GSI 直接观测**：普通玩家 GSI payload 中直接出现的字段（组件 + 字段名）。
> - **状态差分推导**：由 GSI 状态序列的差分/状态机推导（如 round 变化、bomb 状态跳变）。
> - **规则估算**：基于版本化规则 + 本地观测的模型输出（如剩余时间、下一回合经济）。
> - **Demo 真值**：`cs2-demo-format` v3 ZIP 中可核验的事实（离线，非实时）。
> - **不可用**：普通玩家场景下拿不到，禁止猜测填充。

## 1. C4 / 炸弹信号

| 信号 | 实时（普通玩家） | 离线真值（v3 ZIP） | 说明 |
|---|---|---|---|
| 安放完成事件 | 状态差分：`round.bomb: planted` 跳变（A3） | `bombs.json type=planted + tick` | 实时侧延迟 = buffer/throttle + 网络 + 处理，P0-A 待测 |
| 安放开始（plant_begin） | 不可用（GSI 无此状态） | `bombs.json type=plant_begin` | 实时侧只能观测"安放完成" |
| 爆炸事件 | 状态差分：`round.bomb: exploding`（或 round.phase→over 推断） | `bombs.json type=exploded + tick` | 实时侧"exploding"到达率/时序待测；不伪造未观测到的爆炸 |
| 拆包开始/完成 | 拆包开始不可用；完成 = `round.bomb: defused` | `bombs.json defuse_begin/defused` | 同上 |
| 剩余时间 | 规则估算：`plantedAt + fuseMs − now`（B1/B4） | `(explodedTick − plantedTick)/64` 精确值（实测恒 41.000s） | **Phase_countdowns 不可用（A2）→ 必须估算** |
| 引信时长 | 规则（B1，corpus-preliminary 41s，40s 待 Windows 排除） | 语料分布核验（B2，11/11 = 41.000s） | 规则文件版本化 |
| 炸弹位置/携带者 | 不可用（`bomb` 组件仅观战） | `bombs.json` position/actorIndex | — |
| 掉包/拾包 | `round.bomb: dropped`（A3） | `bombs.json dropped/picked_up` | dropped ≠ planted，不得误报安放 |

## 2. 个人状态信号

| 信号 | 实时（普通玩家） | 离线真值 | 说明 |
|---|---|---|---|
| 当前金钱 | GSI 直接观测：`player_state.money`（A10） | `player-economies.json startMoney`（回合开始时） | 实时是"当前"，demo 是"回合开始"，口径不同 |
| 装备价值 | `player_state.equip_value`（A10） | `player-economies.json equipmentValue` | 可用于交叉验证 |
| 主/副武器、投掷物 | `player_weapons`（对自己，A1/A10） | `player-economies.json primaryWeapon/secondaryWeapon/grenades` | — |
| 甲/头盔/钳 | `player_state.armor/helmet`；钳子需从 `player_weapons` 推断（item `defuser`，待实测字段） | `hasArmor/hasHelmet/hasDefuseKit` | 实时钳子字段待 Windows 实测 |
| 本回合击杀数/爆头数 | `player_state.round_kills/round_killhs`（A10） | `kills.json`（含武器类型，逐杀） | 击杀**武器类型**实时不可得（GSI 不报 kill feed）→ 击杀奖励只能按"当前武器类别 + round_kills"近似，标记为规则估算 |
| 存活保留装备 | 状态差分：死亡后重生 = 装备清零（待实测） | `player-economies.json` + kills | 实时侧"是否存活"由 round 结果 + player_state 推断，待实测 |
| 连败计数 | GSI 直接观测：`map.team_ct/team_t.consecutive_round_losses`（待实测字段名） | `rounds.json` winnerTeamKey 推导 | — |

## 3. 团队/回合信号

| 信号 | 实时（普通玩家） | 离线真值 | 说明 |
|---|---|---|---|
| 回合号 | `map.round`（A1） | `rounds.json roundNumber` | — |
| 回合阶段 | `round.phase`（freezetime/live/over，A1） | `rounds.json startTick/freezeEndTick/endTick` | — |
| 地图阶段 | `map.phase`（warmup/live/gameover…，A1） | manifest/match | — |
| 回合结果 | `round.win_team`（A1） | `rounds.json winnerTeamKey/endReason` | — |
| 比分 | `map.team_ct/team_t.score`（A1） | `rounds.json team*ScoreBefore` | — |
| 模式 | `map.mode`（待实测取值：competitive/premier…） | manifest/match | — |

## 4. 经济信号

| 信号 | 实时（普通玩家） | 离线真值 | 说明 |
|---|---|---|---|
| 下一回合收入预测 | 规则估算（C1-C3、C5、C8-C10） | `player-economies.json` startMoney 差分核验 | advisor 核心 |
| 购买建议 | 规则估算（P0-B） | 无（建议无真值，只有可执行性核验） | 可执行性 = 价格 ≤ 预测金钱 |
| 敌方经济 | 不可用（A2/F1）；未来仅概率输出 | `rounds.json team*Economy` + `player-economies.json` | P2，本轮不实现 |
| 敌方精确金额 | 不可用 | `player-economies.json`（全队） | 禁止实时猜测 |

## 5. 当前状态汇总（2026-08-06）

- 实时链路：GSI → receiver（204）→ NDJSON → 回放 → 状态机/估算器：**代码完成，Windows 实测未做**。
- 离线真值：demo-oracle 读取 v3 ZIP：**代码完成，抽样验证完成（fixtures/input）**；300+ 场语料批量核验待路径。
- 经济规划器：**代码完成（纯函数 + 版本化规则）**；数值核验待语料 + Windows。
- 敌方经济：**未实现（仅文档）**。
