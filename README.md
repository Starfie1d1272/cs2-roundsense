# RoundSense

面向 CS2 普通玩家的**只读实时决策辅助研究项目**。当前为 v0.1 研究基线：C4 安放时间估算（P0-A）与个人经济购买建议（P0-B）的最小可验证实现，外加 demo 真值适配（P1）。

## 快速开始

```bash
pnpm install
pnpm typecheck
pnpm test
```

## 仓库结构

```text
apps/
  gsi-recorder/     # 最小 GSI 接收器（127.0.0.1 + token + 204 + NDJSON）
  debug-viewer/     # 最小 CLI：回放 NDJSON 输出 C4/经济时间线
packages/
  gsi-protocol/     # GSI payload schema、cfg 生成、token、时钟、脱敏、NDJSON 信封
  c4-estimator/     # C4 状态机 + 剩余时间估算器（纯函数）
  economy-advisor/  # 目标约束购买规划器（版本化规则）
  demo-oracle/      # cs2-demo-format v3 ZIP 只读 adapter（真值查询）
  replay-harness/   # 确定性回放 harness（fixture → 状态机 → 事件）
  shared-types/     # 跨包枚举/领域类型
fixtures/
  gsi/              # 合成 GSI NDJSON fixture
  demo-format/      # 迷你 v3 ZIP fixture + 生成脚本
experiments/        # 实验目录（Windows C4 实验、经济账本、推荐覆盖率）
docs/               # 边界文档、假设登记、能力矩阵、实验协议、ADR
```

## 文档入口

- [范围](docs/scope.md) — 做什么 / 明确不做什么
- [假设登记](docs/assumptions.md) — 每条假设的状态标签
- [能力矩阵](docs/capability-matrix.md) — 信号 × 证据等级
- [架构](docs/architecture.md)
- [Windows C4 实验协议](docs/experiments/c4-latency.md)
- [经济验证协议](docs/experiments/economy-validation.md)

## 状态标记约定

文档中统一使用：**[已证实-来源]** / **[代码暂定]** / **[待Windows实测]** / **[待语料核验]** / **[未来研究]**。未经过真实 Windows/CS2 实验验证的结论一律标记为假设或待验证，不包装成事实。
