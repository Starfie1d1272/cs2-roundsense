# RoundSense

面向 CS2 普通玩家的**只读实时决策辅助研究项目**（非 HUD / 非直播 / 非 OBS / 非 Overlay）。
当前状态：v0.1 研究基线已收敛——C4 安放时间估算（P0-A）、个人经济购买建议（P0-B）、
demo 真值适配（P1）。**经济数值规则已通过语料验证：replay-native cash ledger 严格归因
（科隆 202 场 93,506 次现金变化）：95.2% 精确事件归因 + 4.6% buytime 窗口交易，
0.02%（20 个）真未解释；L1 summary-ledger 对账率 91%（方法局限，非规则错误）；
loss-counter win transition 与 GSI runtime availability 仍待 Windows 实测。**

## 快速开始

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

## 仓库结构

```text
apps/
  gsi-recorder/     # 最小 GSI 接收器（127.0.0.1 + token + 204 + NDJSON）
  debug-viewer/     # 最小 CLI：回放 NDJSON 输出 C4 时间线
packages/
  gsi-protocol/     # GSI payload schema、cfg 生成、token、时钟、脱敏、NDJSON 信封
  c4-estimator/     # C4 状态机 + 剩余时间估算器（纯函数）
  economy-advisor/  # 目标约束购买规划器；武器价格/击杀奖励读生成权威表
  demo-oracle/      # cs2-demo-format v3 ZIP 只读 adapter + loss-bonus 状态机
  replay-harness/   # 确定性回放 harness（fixture → 状态机 → 事件）
  shared-types/     # 跨包枚举/领域类型
fixtures/
  gsi/              # 合成 GSI NDJSON fixture
  demo-format/      # 迷你 v3 ZIP fixture + 生成脚本
packages/economy-advisor/
  rules/weapons.v2026-08-06.json   # 生成权威武器表（GameTracking-CS2 2e606a0b）
  scripts/generate-weapons.ts      # 武器表生成器 + 一致性测试
experiments/
  economy-ledger/    # 唯一语料验证入口 scripts/validate-corpus.ts + 待执行 Windows 协议 runtime-audit/
docs/
  scope.md           # 做什么 / 明确不做什么
  assumptions.md     # 唯一权威假设登记（证据分级）
  capability-matrix.md # 信号 × 证据等级
  architecture.md    # 数据流架构
  adr/               # 架构决策记录
  experiments/       # 仅保留仍待执行的协议（c4-latency、loss-counter-runtime）
```

## 证据分级约定

- **source-verified**：一手来源（convar cfg、GameTracking-CS2 数据、Valve 文档）
- **corpus-observed**：语料整数账本 / replay 逐帧实证
- **runtime-unverified**：需 Windows + CS2 受控实验（GSI 字段、convar help 文字、cap 递减）
- **provisional**：假说，不得写入生产默认

每个事实只在 `docs/assumptions.md` 或对应规则文件定义一次，其他位置只链接。

## 文档入口

- [范围](docs/scope.md) — 做什么 / 明确不做什么
- [假设登记](docs/assumptions.md) — 唯一权威假设（含经济规则最终审计状态）
- [能力矩阵](docs/capability-matrix.md) — 信号 × 证据等级
- [架构](docs/architecture.md)
- [待执行协议](docs/experiments/c4-latency.md) · [loss-counter-runtime](docs/experiments/loss-counter-runtime.md)
