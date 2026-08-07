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
  ├──► replay-harness（Mac 离线）── normalize ──► c4-estimator 状态机/估算器
  │         └──► debug-viewer CLI（时间线输出）
  │
  └──► Windows 受控实验分析（docs/experiments/ 协议，待执行）

cs2-demo-format v3 ZIP（语料）
  │  parseDemoPackage（严格校验）
  ▼
demo-oracle ── bombTruth / economyTruth / roundTruth / gapReport
  │          └── loss-bonus-state（唯一权威 loss 状态机：payout 表 + 重置 +
  │              winDecrement 候选模型 + payoutTierOf/candidateInternalWinDecrement）
  │
  ├──► C4 真值（planted/exploded tick → fuse）← 核验估算器
  └──► 经济真值（startMoney/moneySpent/type/装备）← 核验经济规则

economy-advisor（纯函数）
  │  input(金钱/阵营/装备/连败/击杀/目标)
  │  + rules/cs2-competitive-2026-08.json（回合奖励/非武器价格/阈值）
  │  + rules/weapons.v2026-08-06.json（生成权威：武器价格 + 击杀奖励）
  │  killReward: weaponId → class 聚合 → 显式报错（不猜 300）
  ▼
projection（下一回合分支预测）──► advisor（目标约束推荐）

experiments/economy-ledger
  └── validate-corpus.ts（唯一语料验证入口：整数账本 + replay settlement 层 + JSON 报告）
```

## 2. 关键模块约定

- **规则唯一性**：每个事实只在一个权威位置（assumptions.md / 规则 JSON / 武器表 / loss-bonus-state.ts），其他位置只引用。
- **证据分级**：source-verified / corpus-observed / runtime-unverified / provisional（见 assumptions.md 头部）。
- **武器表生成**：`packages/economy-advisor/scripts/generate-weapons.ts` ← GameTracking-CS2 weapons.vdata（钉 commit `2e606a0b`）；生成结果可复现（逐字节一致）+ 一致性测试。
- **验证方法**：整数账本对账（diff=0），无回归/OLS。
- **未决项**：win decrement（cap 分支）、buytime 精确截止、GSI consecutive_round_losses 可用性、moneySpent 毛/净——全部标 runtime-unverified 或 provisional，协议待执行。

## 3. 技术栈

pnpm workspace + TypeScript 5 strict + vitest + zod（ADR-0001）；不引入新工具链。
