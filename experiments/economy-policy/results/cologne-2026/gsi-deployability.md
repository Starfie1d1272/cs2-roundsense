# GSI Deployability Matrix — offline research features → live GSI sources

> 本文档把 `experiments/economy-policy` 离线研究（cologne-2026 语料）用到的特征逐项映射到 live GSI 数据源。
> 证据基线：`docs/runtime-checks.md`（Windows build 14174, 2026-08-07，84 payloads 受控 economy session + 41 payloads 普通玩家观测）、
> `docs/evidence.md`（语料核验结论）、`packages/gsi-protocol/src/payload.ts`（schema 事实）、`apps/roundsense/src/engine.ts`（产品消费方式）。
> 证据等级：`OBSERVED`（Windows 实测）/ `corpus-verified`（316 场整数账本）/ `NEEDS RUNTIME VALIDATION`（未受控验证）。

## 总表

| offline research feature | live GSI source | availability | timing | reliability |
| --- | --- | --- | --- | --- |
| side（阵营） | `player.team`（精确大写 `"CT"` / `"T"`） | OBSERVED（41 payloads；主菜单 payload 无此块） | 每个 in-game payload | **high** — 精确字符串；engine.ts C2 只接受 CT/T |
| loss index（连败数） | `map.team_*.consecutive_round_losses`（按 side 取 team_t/team_ct） | OBSERVED（40/41；仅主菜单缺失；**warmup 也计数**） | 所有 phase 均在；回合结算后更新（输 +1，赢 −2 递减 3→1/1→0 实测） | **high（direct mapping）** — 2 个 clean 判别样本精确命中：index 1 → 结算 delta $1900 = lossBonus(1)，index 2 → $2400 = lossBonus(2)。**index 0/3/4 与 capped(lCT=4) 未在受控 runtime 验证 payout**（runtime-checks.md #1）→ 表值映射仍属部分验证 |
| money（当前现金） | `player.state.money` | OBSERVED | **live 实时值**（变化驱动推送） | **high exact** — 实测含 kill 奖励（1650→2250 恰随 round_kills 0→1）；D1 结算 delta 精确。采样延迟：cadence median ~4.4s / min 0.6s / max 50s（throttle 0.5） |
| armor（甲） | `player.state.armor`（数值 0–100） | OBSERVED（D3：0→100，−$650） | 购买后下一个 change-driven payload | **high** — 只在 state，**从不进 `player.weapons`**（engine.ts inventoryFrom 已按此处理） |
| helmet（头盔） | `player.state.helmet`（boolean） | OBSERVED（D3） | 同上 | **high** — boolean 精确 |
| defusekit（拆弹钳） | `player.state.defusekit`（boolean，−$400） | OBSERVED（D3，已加入 payload.ts schema） | 同上 | **high** — 只在 state，weapons 无 entry |
| weapons（主/副武器） | `player.weapons` entries（`name`/`type`/`state`/`ammo_clip`/`ammo_reserve`/`ammo_clip_max`/`paintkit`）+ `weaponIdToItem()` 反查（economy-advisor 单一来源）+ GSI 层别名 `weapon_m4a4→m4a4` | OBSERVED（weapon_mp9/weapon_deagle/weapon_hkp2000 等；state 含 active/holstered/reloading） | 变化驱动 | **high（item 身份）** — type 字符串实测为 `"Submachine Gun"`、`"Machine Gun"`（带空格）。**weaponClass 不可得** → kill 奖励无法归因（engine.ts killsThisRound=[]，projection catch→0，不猜） |
| grenade quantities（投掷物数量） | 单 entry + `ammo_reserve`（flash×2 = 同一 `weapon_flashbang` entry reserve=2，无 quantity 字段、无第二个 entry） | OBSERVED（D3） | 购买/使用后 change-driven | **high（计数）** — engine.ts：`reserve>=0 ? reserve : 1`；reserve 缺失时仅证明 ≥1，无法区分 1 vs 未知（edge） |
| round phase（回合阶段） | `round.phase` = freezetime → live → over（每回合循环） | OBSERVED | 每回合循环；`map.phase` 只有 warmup/live（回合全程不变，**不可用于判回合**） | **high** — engine.ts C1 只在 freezetime 出建议 |
| round number（回合号） | `map.round` | OBSERVED（warmup=0；正式第一回合=1；transition +1） | ⚠️ **`round.phase="over"` 的 payload 里 `map.round` 已经是下一回合号**（build 14174 观测 6/6 一致） | **high with caveat** — 必须用 c4-estimator `C4StateMachine` 的 tracked-round 语义：over 不得 reset/adopt，新身份只在后续非 over 观测采用（state-machine.ts；回归测试 `r3 planted → r4 over exploded → r4 freezetime`） |
| bomb state（炸弹状态） | `round.bomb`：planted / exploding / exploded / defused / dropped（两种 dropped 拼写都见过） | OBSERVED — **普通玩家可收到**；无炸弹时字段**省略（absent）而非 null**（解析必须 hasOwnProperty，payload.ts roundSchema 为 nullable optional） | planted 后持续 present；爆炸后保持 `exploded` 到 over；下一回合 freezetime 消失 | **high** — 状态机安全模式（baseline / 见证基线 / 不伪造）见 c4-estimator |
| roundStartMoney（回合开始现金） | **无 GSI 字段**（payload.ts schema 不存在；`player.state.money` 是实时值） | **NOT AVAILABLE as a field** — 只能靠 freezetime 首帧捕获（见下） | 依赖首帧早于购买到达 | **NEEDS RUNTIME VALIDATION**（详见下一节） |

## roundStartMoney 专项说明

GSI 没有回合开始现金字段，唯一途径是 **freeze 开始后的第一帧 freezetime payload** 的 `player.state.money`。
三个已知风险：

1. **首帧可能已含购买**：cadence 实测 median ~4.4s / min 0.6s（变化驱动 + throttle 0.5），而 freezetime 一开始玩家就可以买。41-payload 观测的 money 序列显示大购买（r4 10700 → 1650，mp9+deagle）发生在两个 payload 之间——购买本身对 GSI 只表现为 money/inventory 跳变，**"freeze 开始"与"首帧到达"之间的购买窗口不可见**。
2. **D1/D3 观测只证明边界跳变可测，未证明首帧捕获**：D1 的判别方法是"结算前最后 money → 结算后第一个 money 的 delta"（7250→9150 = 1900；9350→11750 = 2400，见 runtime-checks.md #1 与 discriminator-session 记录），D3 是单 freezetime 顺序购买（vest → vesthelm → defuser → smoke → flash），两者都没有受控验证"freeze 第一帧早于任何购买"。
3. **`previously`/`added` 只能缩小盲区，不能消除**：`previously.player.state.money`（38/41 payloads OBSERVED）提供上一帧 money 差分；若首帧 money 相对上一帧（over/live 帧）出现无法归因的下降，可判定"已购买"→ roundStartMoney 降级为 undefined。但 freeze 起始与首帧之间的购买对 GSI 完全不可见。

**结论**：`roundStartMoney` 的 live 获取标记为 `NEEDS RUNTIME VALIDATION`。受控实验设计（建议）：bot 局 freezetime 开始后立即购买 vs 延迟 5s 购买，对比首帧 payload 的 `money`/`inventory` 与 `previously` 差分，确定"首帧纯净"的实际概率与最坏延迟。

## 普通玩家不可用组件（影响面）

`bomb` 位置、`phase_countdowns`（含 freeze 剩余时间 `phase_ends_in`）、`allplayers_*`、`player_position` 仅观战/观察者可用（payload.ts 将其与 previously/added 一起按 `z.unknown()` 保留、不消费，assumption A2）。
影响：**live 无 buytime 倒计时**（buy 窗口关闭时刻不可知）→ `currentRoundSpend` 的截止时刻只能是"最后一帧"。

## 结论

- 离线研究的核心特征（side / loss index / money / armor / helmet / defusekit / weapons / grenades / phase / round / bomb）**全部有 OBSERVED 的 live 数据源**，可靠性 high（loss index 的 0/3/4/capped 档位为部分验证）。
- `roundStartMoney` 是唯一无字段的特征 → 必须经 anchor 层捕获 + runtime validation，任何依赖它的下游（`currentRoundSpend`）在验证前不得进入 production。
