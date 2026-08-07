# RoundSense

面向 CS2 普通玩家的**只读实时决策辅助**（非 HUD / 非直播 / 非 Overlay）。读取
Game State Integration（GSI），在终端给出两件事：

- **C4 状态**：检测安放、估算剩余爆炸时间；
- **个人经济建议**：按当前现金 / 连败 / 装备 / 下一轮目标给出购买方案（推荐 / 强起 / 保枪）。

经济策略已用冻结的 IEM Cologne Major 2026 语料做过行为验证（见
`docs/cologne-purchase-policy-audit.md`）；职业决策仅作为行为参考，不是最优真值。

## 结构

```text
apps/
  roundsense/          # 实时 CLI：GSI → C4 + 经济建议（本仓库产品主体）
  gsi-recorder/        # GSI 录制（验证 / 调试用）
packages/
  gsi-protocol/        # GSI payload 校验、GSI cfg、token、clock
  c4-estimator/        # C4 安放检测 + 剩余时间估算（fuse 41000ms，见 evidence）
  economy-advisor/     # 购买建议引擎（纯函数）
  shared-types/        # 共享类型
  replay-harness/      # demo replay 测试辅助（c4-estimator 测试用）
tools/
  validate-demo.ts     # 唯一 P1 离线真值验证器（pnpm validate）
docs/
  evidence.md          # 经济规则研究最终结论（已核实 / 未决 / server profile）
  runtime-checks.md    # 仅剩的两个 Windows 实测项
```

## 快速开始

```bash
pnpm install
pnpm test && pnpm typecheck
# 离线 demo 验证（tiny fixture）
pnpm validate -- ../fixtures/demo-format/tiny-v3.zip
# 实时
pnpm --filter @roundsense/roundsense start
```

## 产品与研究的边界

- **P0（产品）**：`player_state.money` 等 GSI 字段直接驱动 C4 与购买建议；不依赖
  demo 推断的经济状态。OT 开局现金按 server profile 处理（见 evidence），
  live 场景直接读 GSI 现金。
- **P1（验证）**：`tools/validate-demo.ts` 是唯一离线验证器，只重跑规则升级时
  真正需要复查的不变量（整数账本、timeout 存活者、replay 现金归因）。
  研究结论已收敛于 `docs/evidence.md`；不再扩张 demo 现金流取证。

## 规则来源

- 正式规则：`packages/economy-advisor/rules/cs2-competitive-2026-08.json`
  （win/loss/plant/defuse/CT shared/TK 奖励，status=verified、
  statusScope=numeric-rules）
- 武器表：`packages/economy-advisor/rules/weapons.v2026-08-06.json`
  （GameTracking-CS2 `2e606a0b` 生成，逐字节可复现）
- 未决项与 server profile：`docs/evidence.md`
