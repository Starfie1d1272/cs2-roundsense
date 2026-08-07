# RoundSense — Assumptions Register（唯一权威）

> 状态：2026-08-06 收敛。每条假设带证据分级：
> `source-verified`（一手来源）/ `corpus-observed`（语料实证）/
> `runtime-unverified`（待 Windows 实测）/ `provisional`（假说）。
> 经济规则最终审计结论集中在 C 节；数值全部版本化于
> `packages/economy-advisor/rules/`（武器表为生成权威）。

## A. GSI 协议与普通玩家数据边界

- **A1** [source-verified] 普通玩家可用组件：`provider`、`map`、`map_round_wins`、`round`、`player_id`、`player_state`、`player_weapons`、`player_match_stats`。来源：Valve GSI wiki（Wayback 2026-01-07，rev 484676）。
- **A2** [source-verified] `allplayers_*`、`allgrenades`、`player_position`、`bomb`、`phase_countdowns` 仅观战/GOTV 可用 → 普通玩家拿不到 `phase_ends_in`，C4 剩余时间由"安放事件 + 引信模型"估算（P0-A）。
- **A3** [source-verified] `round.bomb` 取值：`planted/exploding/defused/dropped`。
- **A4** [runtime-unverified] CS2 客户端实际行为与 CS:GO 时代文档的字段级差异（`provider.timestamp` 语义、`gamestate_integration_<name>.cfg` 加载时机等）。
- **A5** [source-verified] GSI 增量机制 + `timeout/buffer/throttle` 传输参数（同上来源）。

## B. C4 引信

- **B1** [corpus-observed] demo 事件语义下 C4 引信 = **41.000s**（planted→exploded tick 差恒 2624 @64tick；2026-08-06 语料 223/223）。若 demoparser2 事件 tick 存在一致偏移，真实引信可能为 40s → [runtime-unverified]（协议：`docs/experiments/c4-latency.md`）。
- **B2** [corpus-observed] 拆弹 10s（无钳）/ 5s（有钳）。

## C. 经济规则（最终审计状态，2026-08-06）

- **C1** [corpus-observed] 回合结束奖励：淘汰/时间获胜(CT) $3250、拆包/爆炸获胜 $3500。整数账本 316 场证实。
- **C2** [source-verified + corpus-observed] 连败奖金：`min(3400, 1400 + 500×count)`；`mp_starting_losses 1` → 每半场起始 count=1（gamemode_competitive.cfg，buildid 24537688）；败 +1（cap 4）；半场重置 r13，OT 每 3 回合（r25/r28/r31…）重置。
  **OT 现金与 loss counter 重置相互独立**：counter 重置是 universal rule（OT half opener 重新从起始 count 计算）；**现金重置是 server/match profile**。语料 62 个 OT halves（科隆）呈**严格交替模式**：奇数序 opener（r25/r31/r37/r43）全员 carry-over（non-uniform），偶数序（r28/r34/r40/r46）全员 reset 到 10000（`mp_overtime_startmoney` game default）——**100% 一致、零例外**；12500 未出现。机制未判定（交替本身是观测事实，不猜规则）。不得把 OT reset 写成 $800。
- **C2a** [provisional] **胜利递减 unresolved**：202 replay 场 77 个干净 L-W-L 窗口——可观测 payout-tier drop 跨任意单次胜利 = 1（所有胜利类型相同，含 time_ran_out）；按文档更新顺序（败+1）推导的候选内部 decrement = 2；cap 状态（count≥4）无窗口（3400 不可辨识）。需直接 GSI/netvar 观测（协议：`docs/experiments/loss-counter-runtime.md`）。**不得写为已证实。**
- **C2b** [corpus-observed] `time_ran_out` 输方：**存活 T 无败方奖金**（validator L3 全量 202 场 354 个存活 T 样本零违规；死亡 T 拿正常表值奖金）。曾误报的"存活者 +1400"经查为死亡 T 的正常奖金。
- **C3** [corpus-observed] T 下包后失败奖金 $600（全 T 队）；`cash_player_bomb_planted 300`（下包者个人）。
- **C4** [source-verified] 击杀奖励 = **生成权威武器表**（`rules/weapons.v2026-08-06.json`，GameTracking-CS2 `2e606a0b`）：awp 100、p90 300、cz75a 300、xm1014 600、SMG 600、刀 1500、bizon 1300（2026 降价）。查找顺序：weapon-specific → class 聚合 → 显式报错（unknown 不猜 300）。
- **C5** [corpus-observed] CT 共享团队奖励 = 每名 CT 每消灭一名 T **+$50**（victim 口径含 C4/世界击杀）。**任意回合结果均发放**（CT 赢/输都发；L4 replay ledger 确认其为独立跳变，在 endTick 后约 3.7s 单独结算，不与 win/loss 合并）。此前"Casual only"的 wiki 表述与赛事竞技行为不一致——以 corpus 为准。
- **C6** [source-verified] 上限 $16000、初始 $800（语料 cap 过滤生效）。
- **C7** [source-verified] 武器价格 = 生成武器表（含 bizon 1300）；非武器价格（甲/钳/投掷物）在规则 JSON。
- **C8** [corpus-observed] 击杀武器 event-name 完整性：**22 个 knife/bayonet CSWeaponNameID 全部自动生成 alias**（生成器读 `CSWeaponNameID.h` → 全部映射 `weapon_knife` 1500）。**pinned 真实枚举 fixture**（`fixtures/csweaponnameid/knife-ids.txt`，提取自 GameTracking 2e606a0b）作为测试输入——升级 GameTracking revision 时 diff 该 fixture 即可暴露新增刀型（不是"CI 自动看到 Valve 上游"，而是"升级时强制 completeness diff"）。全语料 35 个唯一 kills.weapon 值 zero unknown。
- **C9** [corpus-observed] **buytime 语义**：`mp_buytime 20` 从冻结结束起算（H2）——语料成功购买最晚至 freezeEnd+19.63s；H1（roundStart 起算）被否决；精确截止点 [runtime-unverified]。
- **C10** [corpus-observed] **moneySpent 语义**：cs2df 在 `round_freeze_end` 事件采样游戏原生 `m_iCashSpentThisRound`（`CCSPlayerController_InGameMoneyServices`）——**不包含 freezeEnd 之后、buytime 关闭前的购买/退款**（42/42 replay 样本验证）。sellback 对原生累计字段的影响 unresolved——**L4 显示退款/尾段交易在 replay 可见（如 +200 refund），正是 L1 残差的主要机制**。

## D. 已验证的 validator 口径

- **D1** 验证方法 = 整数账本对账（income 差分 vs 全建模奖励；diff=0 期望），不用回归/OLS。
- **D2** **L1 = summary-ledger exact reconciliation rate，不是规则准确率**：202 replay 场 90.6% diff=0（261 场 91.0%）。L1 非零样本分解（3653 个，全 replay 场）：**3653/3653 在 replay-native 层无 unexplained/ambiguous（summaryFieldLimitation）**——即这些样本的整段 replay 现金流可解释，残差源于 summary 字段重建；887 个（mini 无 replay 场）标 noReplay。±200/±300/±500 峰在 replay 层 = buy-window purchase/refund transitions。
- **D3** **L4 replay-native cash-transition ledger（严格归因）**：202 场 **93,506 次现金变化**（独立遍历全部 replay rounds，无 L1 跳过）：**精确事件归因 95.2%**（exact 89.0% + compound-exact 6.2%，均要求 actor+tick+金额严格匹配或已知事件精确求和）；**buy-window 交易 4.6%**（确认 buytime 窗口内、方向已知、物品未唯一识别——不算精确归因）；**sampling-ambiguous 0.1%（90 个）**；**真未解释 0.02%（20 个）**（kill 归属在 kills.json 缺失、未知 -50 机制等——保持 unexplained 不猜）。8 Hz aliasing 实际发生（multi-kill/win+kill/loss+kill 同窗口合并）但**全部可精确分解**。**不再声称 100%**——严格 classifier 的诚实结果是 95.2% 精确 + 4.6% 窗口交易 + 0.1% 歧义 + 0.02% 未解释。
- **D4** 全量 diff=0 命中率**不**作为状态机证明（只证现有模型与语料一致）。
