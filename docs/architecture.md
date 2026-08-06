# RoundSense — Architecture

## 1. 数据流总览

```text
CS2 (Windows, 普通玩家)
  │  gamestate_integration_roundsense.cfg (buffer/throttle/timeout/auth)
  │  POST http://127.0.0.1:3000/  (每状态变化 + heartbeat)
  ▼
apps/gsi-recorder  ── 校验 token → 204 立即返回
  │  NDJSON 信封（墙钟 + 单调时钟 + provider.timestamp + build + 脱敏 payload）
  ▼
recordings/*.ndjson
  │
  ├──► replay-harness（Mac 离线）── normalize → c4-estimator 状态机/估算器
  │         └──► debug-viewer CLI（时间线输出）
  │
  └──► Windows 实验分析（experiments/c4-latency，脚本+指标）

cs2-demo-format v3 ZIP（语料）
  │  parseDemoPackage（cs2-demo-format npm 包，严格校验）
  ▼
demo-oracle ── bombTruth / economyTruth / roundTruth / gapReport
  │
  ├──► C4 真值（planted/exploded tick → fuse）← 核验估算器
  └──► 经济真值（startMoney/moneySpent/type/装备）← 核验经济规则

economy-advisor（纯函数）
  │  input(金钱/阵营/装备/连败/击杀/目标) + rules/cs2-competitive-2026-08.json
  ▼
  2~3 个方案（推荐/激进/节省）× 胜负分支投影 × 是否破坏目标 × 依据/假设
```

## 2. 模块职责

| 模块 | 职责 | 依赖 | 纯函数? |
|---|---|---|---|
| `@roundsense/gsi-protocol` | GSI payload schema、cfg 生成、token、双时钟、脱敏、NDJSON 信封 | zod | 是（除 NdjsonWriter 副作用） |
| `apps/gsi-recorder` | 127.0.0.1 HTTP 接收器、token 校验、204 快速路径、NDJSON 落盘 | gsi-protocol | 否（进程） |
| `@roundsense/c4-estimator` | C4 状态机（去重/基线/不伪造/重置）+ 剩余时间估算 | shared-types | 是 |
| `@roundsense/replay-harness` | NDJSON → 归一化 → 状态机；确定性回放 | c4-estimator, gsi-protocol | 是 |
| `@roundsense/demo-oracle` | v3 ZIP 只读 adapter + 真值查询 + 缺口报告 | cs2-demo-format | 是 |
| `@roundsense/economy-advisor` | 版本化规则 + 投影 + 方案生成 | shared-types, zod | 是 |
| `@roundsense/shared-types` | 跨包枚举（与 cs2-demo-format 保持一致的测试约束） | — | — |
| `apps/debug-viewer` | 最小 CLI 时间线（非 HUD） | replay-harness, c4-estimator | 否（CLI） |

## 3. 关键设计决策

- **单一时间源**：所有时长计算只用 `receivedAtMonotonicNs`（process.hrtime.bigint）。墙钟仅用于审计与跨机对齐；`provider.timestamp` 语义未证实（A5），只记录不参与计算。
- **状态机安全属性**（P0-A 验收）：
  1. 状态驱动去重：planted 已在状态中 → 重复 payload 无新事件；
  2. 中途启动：首包即 planted → `baseline_only`，进入 `planted_unknown`，不伪造安放时刻；
  3. 缺中间状态：round.phase=over 而无 defused/exploded → `round_over`，绝不输出 `exploded`；
  4. 重置：roundNumber 变化 / freezetime / map.gameover → `idle`。
- **基线判定**：freezetime、非 planted 炸弹状态、同回合前序观测 → 可信任 planted 转换；仅"live"首包 → 不可信（见证原则，见 state-machine.ts 注释）。
- **规则版本化**：C4 引信（c4-estimator/src/rules.ts）、经济奖励/价格/阈值（economy-advisor/rules/*.json）全部带 source/verifiedAt/status。代码零魔法数字。
- **证据分级**：docs/capability-matrix.md 为每个信号标注 GSI 直接观测 / 状态差分 / 规则估算 / demo 真值 / 不可用。
- **跨平台隔离**：gsi-protocol 的 cfg 生成与 docs/experiments/c4-latency.md 是 Windows 侧产物；其余全部为跨平台纯逻辑。

## 4. 技术栈（ADR-0001）

pnpm workspace + TypeScript 5.9 (strict, moduleResolution Bundler) + vitest 4 + zod 3 + cs2-demo-format 3.1.0 (npm)。与现有项目 cs2-demo-format / cs2-demo-analysis-kit 约定一致。

## 5. 已知边界（见 docs/assumptions.md 与 gaps.ts）

- 击杀武器类别实时不可得 → 击杀奖励按 `unknown`（$300）估算并标注。
- 敌方经济（P2）不实现。
- 300+ 场语料路径待提供；批处理接口待建（本轮只读 2 个代表 ZIP + tiny fixture）。
