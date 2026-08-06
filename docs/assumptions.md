# RoundSense — Assumptions Register

> 每条假设带状态标签：
> - **[已证实-来源]**：有一手/可靠来源支持（注明来源与访问日期）
> - **[代码暂定]**：代码中采用了该值/行为，但尚未被实测数据确认
> - **[待Windows实测]**：需在 Windows + CS2 上实验确认
> - **[待语料核验]**：可用用户已有 demo 语料（300+ 场）统计核验
> - **[未来研究]**：本轮不处理，仅记录

## A. GSI 协议与普通玩家数据边界

- **A1** [已证实-来源] 普通玩家可用组件：`provider`、`map`、`map_round_wins`、`round`、`player_id`、`player_state`、`player_weapons`、`player_match_stats`。来源：Valve GSI wiki（Wayback 存档 2026-01-07，原页面 rev 484676）。
- **A2** [已证实-来源] 以下组件仅对 GOTV/观战/观察者有效：`allplayers_*`、`allgrenades`、`player_position`、`bomb`（炸弹位置/携带者）、`phase_countdowns`（逐阶段剩余时间，精度 0.1s）。普通玩家不可用。来源同上。→ **直接结论：普通玩家拿不到 `phase_ends_in`，C4 剩余时间必须由"安放事件 + 引信模型"估算，这正是 P0-A 的研究动机。**
- **A3** [已证实-来源] `round` 组件包含 `bomb` 状态字段，取值：`planted` / `exploding` / `defused` / `dropped`。来源同上（round 组件说明）。
- **A4** [代码暂定] CS2 客户端对普通玩家的实际行为与上述文档一致（该文档为 CS:GO 时代撰写，CS2 沿用 GSI 机制，社区实现可佐证）。待 Windows 实测确认字段级差异。
- **A5** [待Windows实测] `provider.timestamp` 的语义与精度（CS:GO 时代为整数 Unix 秒；CS2 是否一致、是否受 `precision_time` 影响未确认）。
- **A6** [已证实-来源] GSI 增量机制：状态变化时发送完整新状态 + `previously`/`added` 差分块；端点必须返回 2XX，否则客户端视为失败并在下次 heartbeat 重发完整状态（省略差分）。来源：Valve GSI wiki（同上）。
- **A7** [已证实-来源] 传输参数：`timeout` 默认 1.1s（响应超时即失败）、`buffer` 默认 0.1s（事件聚合延迟）、`throttle` 默认 1.0s（两次请求最小间隔）、`heartbeat` 默认值未在文档明确（待实测）。来源同上。→ **buffer+throttle 是安放事件到达延迟的主要可控因素，即 P0-A 参数矩阵的实验对象。**
- **A8** [已证实-来源] cfg 文件要求：`gamestate_integration_<name>.cfg` 置于游戏 `csgo/cfg` 目录；**不允许 UTF-8 BOM**，否则不加载。来源：Valve GSI wiki（同上）。
- **A9** [待Windows实测] CS2 的 cfg 目录具体路径（文档为 CS:GO 路径 `.../Counter-Strike Global Offensive/game/csgo/cfg`；CS2 应为 `.../Counter-Strike 2/game/csgo/cfg`，需在 Windows 上确认）。
- **A10** [已证实-来源] `player_state` 字段（对自己有效）：`health/armor/helmet/flashed/smoked/burning/money/round_kills/round_killhs/equip_value`。来源：社区 CS2 实现 LuiScreaMed/cs2_gsi_demo 类型定义（MIT，访问 2026-08-06）；字段级差异待 Windows 实测。

## B. C4 引信

- **B1** [已证实-语料初步] CS2 C4 引信（demo 事件语义下）= **41.000 秒**：`bombs.json` planted→exploded tick 差恒为 2624 @64tick（3 场比赛 / 11 个样本，2026-08-06 demo-oracle 核验）。⚠️ 若 demoparser2 事件 tick 存在一致偏移（plant 动画起始 vs 完成 / exploded 事件时刻），真实游戏内引信可能仍为 40s —— 待 Windows 实测（B4）最终确认。规则文件 `c4-estimator/src/rules.ts` 已更新为 41000ms（status: corpus-preliminary）。
- **B2** [已证实-来源] demo 语料 `bombs.json` 中 `planted` 与 `exploded` 事件的 tick 差 / tickrate 可直接给出每场真实引信时长（本轮的 11 样本即由此得出）；批量语料路径确认后可扩展样本量。
- **B3** [已证实-来源] 拆弹时长 10s（无钳）/ 5s（有钳）——仅作为背景知识，P0-A 不依赖。
- **B4** [待Windows实测] 安放完成（plant 动画结束、`round.bomb=planted` 上报）与本地接收之间的延迟分布；引信剩余时间的本地估算误差；游戏内计时与 demo tick 的偏移确认。

## C. 经济规则（数值全部版本化，见 `packages/economy-advisor/rules/`）

- **C1** [已证实-语料] 竞技/Premier 回合结束奖励：淘汰获胜 $3250、时间获胜(CT) $3250、拆包获胜(CT) $3500、爆炸获胜(T) $3500。来源：cs.fandom Money 页 rev 186480（2026-07-08）+ 语料核验（55 场 / 10425 样本，winBomb 修正后 Δ≈−17~−38，2026-08-06）。
- **C2** [已证实-语料] 连败奖励：lossStreak 0→$1400、1→$1900、2→$2400、3→$2900、4+→$3400；连败计数"每败 +1、每胜 -1（min 0，max 4）"。来源：fandom（同上）+ 语料核验（分组均值 Δ≈±150，streak-1/4 的 ±400 系击杀修正耦合）。另证实：**手枪局失败奖金 $1900**（非 1400，Δ≈−15~+48，n=530）。
- **C3** [已证实-语料初步] T 下包后失败奖金：语料估计 ≈ $500-600（修正后 432/486，原始 689）；fandom 的 CS2 $600 合理，**CS:GO 的 $800 可排除**。规则文件保持 600（corpus-approximate）。
- **C4** [已证实-语料] 击杀奖励（近期语料 2026-05~06）：手枪 ≈300、SMG ≈600、步枪 ≈250-300、AWP ≈100-160 — 与 fandom 表一致量级。⚠️ 异常：≤2026-03 语料手枪击杀 ≈$25（疑似早期语料导出问题或规则变更，待核实）。来源：fandom Money 页 + 语料 OLS。
- **C5** [已证实-语料] **CT 共享团队奖励 = 每名 CT 每消灭一名 T +$50**（回合末结算，计入下回合 startMoney）。Steam 官方 2025-07-16 补丁引入；2026-08-06 整数全对账证实：科隆半决赛/决赛全部场次 win ctKills=5 残差≈0（决赛场逐样本精确 0，如 4100=3250+600+250），replay 回合末跳变 250/150/50=50×ctKills 完美整数。⚠️ 赛事服务器配置差异：科隆 1/4 决赛（6-18）未启用、半决赛/决赛（6-20/21）启用、完美世界赛事（59 场）未启用——**Valve 官方竞技/Premier 待用户 demo 确认**。advisor 已接线（`ctTeamKillsOnTs` → 投影 +$50/击杀/每人）。
- **C6** [已证实-来源] 上限 $16000（竞技/Premier），初始 $800。来源：cs.fandom Money 页（同上）。
- **C7** [已证实-来源] 价格表（CS2 Buy Menu）：Kevlar $650、Kevlar+头盔 $1000、拆弹器 $400、Zeus $200、Glock/USP/P2000 $200、P250 $300、CZ/Tec-9/Five-SeveN $500、Deagle $700、MAC-10 $1050、MP9 $1250、MP7 $1400、MP5-SD $1400、UMP $1200、P90 $2350、PP-Bizon $1400、Nova $1050、Sawed-Off $1100、MAG-7 $1300、XM1014 $2000、M249 $5200、Negev $1700、Galil $1800、FAMAS $1950、AK-47 $2700、M4A4 $2900、M4A1-S $2900、SG553 $3000、AUG $3300、SSG08 $1700、AWP $4750、G3SG1/SCAR-20 $5000、燃烧弹(CT) $500、Molotov(T) $400、Decoy $50、闪光 $200、HE $300、烟雾 $300。来源：cs.fandom Buy_Menu 页 rev 177116（2023-11-17），访问 2026-08-06。⚠️ 该页修订于 2023-11，**可能存在 2024-2026 价格补丁未反映** → [待Windows实测] 游戏内核对 + [待语料核验] 从 `player-economies.json` 的 moneySpent 分布交叉验证。
- **C8** [已证实-来源] 下包/拆包个人奖励 $300（给下包者/拆包者）。来源：cs.fandom Money 页（同上）。
- **C9** [已证实-来源] T 输掉时间耗尽回合（未拆包）存活者无回合结束奖励。来源：cs.fandom Money 页（同上）。
- **C10** [已证实-语料] 手枪局失败奖金 **$1900**（fandom 单独列出的行；语料 Δ≈−15~+48，n=530）。advisor 投影已按手枪局 1900 建模。连败计数每半场从 0 开始。

## D. 经济分类口径（与已有基础设施一致）

- **D1** [已证实-来源] 回合经济类型枚举 `pistol|eco|semi|force|full` 与 `player-economies.json`/`rounds.json` 的 `teamAEconomy` 一致，定义在 `cs2-demo-format` schema（npm 3.1.0）。RoundSense `shared-types` 复制字面值，并在 demo-oracle 测试中断言两者一致，防止漂移。
- **D2** [已证实-来源] 手枪局转换（R2/R14 前局手枪局获胜方）由 `rounds.json` 分类为 `full`（语义隐含于 roundNumber + 前局 winnerTeamKey）。来源：cs2-demo-format schema 注释。

## E. 数据资产与可复用性

- **E1** [已证实-来源] `cs2-demo-format`（npm 3.1.0，MIT）：v3 ZIP 合同 + Zod schema + `parseDemoPackage(buffer)` 解析器。ZIP 内 `bombs.json`（tick 级 plant/defuse/explode 事件）与 `player-economies.json`（逐回合 startMoney/moneySpent/equipmentValue/type/装备）是 C4 与经济真值来源。
- **E2** [已证实-来源] `cs2-demo-analysis-kit`（@cs2dak/*，MIT/AGPL）：已有经济消费层（scoreboard 经济聚合、signals 装备价值差分、round-facts 团队经济类型）。**没有购买规划器** —— RoundSense 的 advisor 是新代码；DAK 仅作为验证/复用目标（后续批处理验证时可用）。
- **E3** [待确认] 300+ 场 v3 ZIP 语料：本机 `~/GitHub/cs2-demo-analysis-kit/fixtures/demos`（gitignored）为空，`/Volumes` 无 NAS 挂载 → **语料路径需用户提供**。本轮以 `fixtures/input/*.zip`（13 个代表性 ZIP）验证 adapter。
- **E4** [已证实-来源] 本机 Node 工具链：node 22 / pnpm 11 / vitest（现有项目 cs2-demo-format 与 cs2-demo-analysis-kit 均 pnpm+vitest+TS5 strict）→ 本仓库沿用该约定（ADR-0001）。

## F. 敌方经济（P2，未来研究）

- **F1** [已证实-来源] 普通玩家 GSI 无 `allplayers_*`、无敌方 money/equip_value（A2）→ 敌方经济只能由"我方观测 + 规则模型"给出概率分布（胜负结果、时间、击杀数、已知回合类型）。已有项目 `chis-dd/cs2gsi-eco-tracker`（无许可证，仅参考思路）证明"按回合胜负推算团队收入"可行。
- **F2** [未来研究] 敌方精确金额不可观测；不可观测变量不填默认值，低置信度时隐藏输出。
