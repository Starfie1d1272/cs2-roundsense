# DecisionAnchor — design note（概念设计，不改 production）

> 目标：把离线研究（cologne-2026）使用的回合级决策特征锚定到 live GSI 观测，形成未来 live policy 的输入层。
> 本文档是**设计**，不是实现；引用的事实全部来自 `packages/gsi-protocol/src/payload.ts`、`apps/roundsense/src/observation.ts`、`apps/roundsense/src/presenter.ts`、`packages/c4-estimator/src/state-machine.ts`、`docs/runtime-checks.md` 与 Windows build 14174 观测记录。

## 1. 概念

```ts
// 设计草案 — 未实现
interface DecisionAnchor {
  roundId: number;             // 回合身份：采用 C4StateMachine 的 tracked-round 语义（见 §4）
  side: "CT" | "T";            // player.team，精确大写
  lossReward: number;          // 本局失败可得的连败奖金：lossBonus(rules, lossStreakGsi)
  roundStartMoney?: number;    // 首帧 freezetime money（仅当锚定纯净，见 §2）
  startInventory?: InventoryState; // 首帧 inventoryFrom(payload) 快照（optional）
  confidence: "high" | "medium" | "low";
}
```

- 锚定（anchor）的职责是**一次性建立回合基线**，之后每一帧 live 观测都相对该基线解释（如 `currentRoundSpend = roundStartMoney − currentMoney`）。
- 锚定失败不阻塞：`roundStartMoney`/`startInventory` 为 optional，缺失时 `confidence` 降级，下游按降级语义处理（与 engine.ts `lossStreakSource: "assumed-1"` 的显式降级风格一致）。
- `lossReward` 是**derived**：`lossBonus(rules, consecutive_round_losses)`，表 [1400,1900,2400,2900,3400]（rules JSON `lossBonusByStreak`，corpus-verified；index 0/3/4 与 capped 的 payout 为部分验证，见 runtime-checks.md #1）。

## 2. freeze transition 捕获第一帧

已知的 GSI 事实（OBSERVED）：

- `round.phase` 每回合循环 freezetime → live → over；`map.round` transition 时 +1。
- **over payload 的 `map.round` 已是下一回合号**（6/6）→ 锚定逻辑必须沿用 C4StateMachine 的规则：**over 观测不 reset、不采纳新身份**；新回合身份只在后续非 over 观测（freezetime/live）时建立。
- 因此 anchor 的建立点 = **首个非 over 观测且 roundId 变化的 payload**。engine.ts C1 只信任 freezetime 出建议，同理 anchor 的 `roundStartMoney` 只在 `round.phase === "freezetime"` 时尝试捕获（live 首帧说明首帧已晚于 freeze 结束——不可信为 round start，除非有同回合前序 freezetime 观测）。

捕获协议（设计）：
1. 观测到 roundId 变化（非 over）→ 打开锚定窗口，`anchor.roundId = 新 roundId`。
2. 窗口内第一帧 freezetime payload：记 `M0 = player.state.money`、`I0 = inventoryFrom(payload)`、`seq0 = receipt.seq`。
3. 同回合后续 freezetime payload 若出现 money 下降且可归因于价格表组合（kevlar 650 / kevlar_helmet 1000 / defuse_kit 400 / smoke 300 / flash 200 / he 300 / molotov 400 / incendiary 500 / decoy 50 / weapon prices 见 weapons rules）→ 购买已开始，`M0` 仍为有效 round start（因为它是 freeze 内的第一帧）。
4. 若本回合**第一条观测**就是 freezetime 且已带购买痕迹（见 §3），`roundStartMoney` 无法确认 → `undefined`，`confidence = low`。

## 3. first payload 已购买时的识别

问题：GSI 无回合开始现金字段（见 gsi-deployability.md roundStartMoney 节），且首帧可能已含购买。识别手段只有差分：

1. **`previously`/`added` 差分**（OBSERVED：普通玩家也发送，41 payloads 中 previously 38/41、added 8/41；内容是变化增量）：
   - `previously.player.state.money` → 上一帧 money。
   - `previously.player.weapons.*.ammo_clip` → 弹药差分（已观测）。
   - `added.round.bomb` / `added.round.win_team` / `added.map.round_wins` → 状态标记。
   - ⚠️ **weapons entry 的增删（购买/卖出）是否出现在 previously 未确认**——当前只确认 ammo 类差分 → `NEEDS RUNTIME VALIDATION`。payload.ts 目前把 previously/added 按 `z.unknown()` 保留、不消费（assumption A2），未来消费需新增 typed schema。
2. **与上一回合结算帧对比**：D1 已证回合边界 money 跳变精确可测（结算 delta 7250→9150 / 9350→11750）。若首帧 freezetime money == 上一帧（over/live 帧）money 且 previously 无变化 → 锚定 exact（`confidence = high`）。
3. **inventory 无法帮助识别"开局自带 vs 已购买"**：armor/grenades/weapons 跨回合 carry-over，首帧 inventory 不携带购买历史。

识别结论（设计级判定表）：

| 首帧情形 | roundStartMoney | startInventory | confidence |
| --- | --- | --- | --- |
| 本回合有前序观测（freezetime/live）且首帧与上帧 money 无差 | exact | exact | high |
| 首帧 freezetime，无前序观测，无购买痕迹（previously 无 money 变化） | 可取（未验证） | 可取 | medium |
| 首帧 freezetime，有购买痕迹（money 相对上一帧下降且未结算） | **undefined** | 可取（但非 start 态） | low |
| 首帧直接 live/planted（mid-round join） | undefined | undefined | low（baseline_only 语义，同 C4 机器） |

## 4. 与现有 round 边界处理的关系（observation.ts / presenter.ts / state-machine.ts）

现有实现（事实，非设计）：

- `apps/roundsense/src/observation.ts`：`toC4Observation(receipt)` 纯映射 `{seq, roundNumber: map.round, roundPhase: round.phase, mapPhase: map.phase, bomb, receivedAtMonotonicNs, receivedAtWallClock}`——消费方是 C4StateMachine。
- `packages/c4-estimator/src/state-machine.ts`：持有 `tracked roundNumber`；over + 新号 → 不 reset 不 adopt；新身份只在非 over 观测采用；emit 用 `tracked round ?? obs.roundNumber`；freezetime / map.gameover → 安全 reset；回归测试强制真实序列（`r3 live planted → r4 over exploded → r4 freezetime`）。
- `apps/roundsense/src/presenter.ts`：唯一 mutable state 是 timer handle；plantedAt 作为 immutable closure 参数；presentation 不持有 domain 副本。

**设计约束**：DecisionAnchor 的 round 身份**必须复用 C4StateMachine 的 tracked-round 语义**（或作为独立 anchor machine 但遵循同一套 over-不采纳规则），禁止再实现第三套 round-identity 逻辑。Anchor 层可以挂在同一个 receipt 流上（`onPayload` 内、`machine.observe` 旁），因为 `toC4Observation` 已提供统一入口；anchor 只消费 `payload` 的 player/map/round 子集，与 C4 状态机无共享可变状态（除 round 身份来源外）。

## 5. 未决项清单

- [ ] freeze 首帧早于购买的概率（受控实验：freeze 即买 vs 延迟买）→ `NEEDS RUNTIME VALIDATION`
- [ ] `previously.weapons` 是否含 entry 增删（购买/卖出差分）→ `NEEDS RUNTIME VALIDATION`
- [ ] `lossBonus` index 0/3/4 与 capped 档位的 live payout 判别（当前 2/2 clean 样本）
- [ ] anchor 降级路径的消费方语义（`roundStartMoney=undefined` 时 policy 如何回退）
