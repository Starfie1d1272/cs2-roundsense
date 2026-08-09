# RoundSense

面向 CS2 普通玩家的**只读实时决策辅助**（非 HUD / 非直播 / 非 Overlay）。产品只消费
normal-player Game State Integration（GSI）及其可连续追踪的历史，不把 demo / spectator
oracle 伪装成实时能力。

当前提供两类输出：

- **个人经济 Policy V3**：先给出当前策略（eco / 半起 / 强起 / 全起），再给出本局建议投入、
  最多投入、输掉后的下局经济与购买能力；具体购买组合是第二层、inventory-aware 建议。
- **C4 状态**：检测安放与状态转换。数字剩余时间在 Windows controlled calibration 完成前
  保持 `UNKNOWN`；当前只安全表达 detection anchor 与 elapsed-since-detection。

经济策略已用冻结的 IEM Cologne Major 2026 语料做过完整行为验收。职业决策只作为
behavioral reference，不是最优真值。

## Policy V3 语义

- eco = `PRESERVE`：优先 future economy，当前消费最小化；
- 半起 = `LIGHT`：在 future-affordability boundary 内有限投入，不是固定 SMG + 甲；
- 强起 = `FORCE`：当前回合优先，generic FORCE 的 resulting armor 必须大于 0；
- 全起 = `FULL`：按当前装备补齐完整配置；手枪局赢家使用独立 conversion planner；
- `bundleSpend` 只表示具体购买组合的增量成本；`spendingGuidance` 表达经济建议，
  `futureAffordability` 表达明确假设下的未来可达能力；
- `OBSERVED / TRACKED / UNKNOWN` 不静默补值；opponent `UNKNOWN` 不改变基础推荐。

权威设计与冻结验收分别见 [`docs/policy-v3-architecture.md`](docs/policy-v3-architecture.md)
和 [`docs/experiments/policy-v3-final-acceptance.md`](docs/experiments/policy-v3-final-acceptance.md)。

## 结构

```text
apps/
  roundsense/          # GSI lifecycle tracker、runtime orchestration 与终端输出
  gsi-recorder/        # GSI 录制（验证 / 调试用）
packages/
  gsi-protocol/        # wire schema、GSI cfg、token、receipt clock
  c4-estimator/        # bomb-state transition 与未校准 timing contract
  economy-advisor/     # mechanics、Policy V3、compact opponent calibration
  shared-types/        # 少量跨包 serializable contracts
  replay-harness/      # demo replay 测试辅助
scripts/
  policy-v3-final-acceptance.ts  # 冻结 corpus 行为验收 harness
tools/
  validate-demo.ts     # P1 离线经济账本验证器
```

## 快速开始

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm --filter @roundsense/roundsense start
```

本地存在冻结 corpus 与 202 个 map package 时，可重跑完整 Policy V3 acceptance：

```bash
pnpm exec tsx scripts/policy-v3-final-acceptance.ts
```

## 产品与研究边界

- **产品 mainline**：runtime、compact/versioned calibration、权威架构、最终研究结论、
  frozen acceptance harness 与机器可读验收结果。
- **frozen research branches**：大型探索脚本、派生研究输入与诊断结果。CT helmet 研究固定在
  `research/ct-helmet-decision @ d194d17`，最终 purchase-policy 诊断固定在
  `research/purchase-policy-final-diagnostic @ aaf491b`。
- live advisor 直接读取 own GSI money / inventory / loss counter；demo 字段只用于离线 label、
  pre-state 恢复和审计，不进入 production policy 输入。

## 规则来源

- 正式规则：`packages/economy-advisor/rules/cs2-competitive-2026-08.json`；
- 武器表：`packages/economy-advisor/rules/weapons.v2026-08-06.json`；
- opponent compact calibration：
  `packages/economy-advisor/rules/opponent-economy-direct.v2026-08.json`；
- 未决项与 server profile：`docs/evidence.md`。
