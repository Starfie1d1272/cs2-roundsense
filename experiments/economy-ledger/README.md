# experiments/economy-ledger

经济规则验证实验目录。

- `scripts/validate-corpus.ts` — **唯一语料验证入口**（整数账本对账；武器奖励/价格读
  生成权威表 `packages/economy-advisor/rules/weapons.v2026-08-06.json`；loss 状态读
  `packages/demo-oracle/src/loss-bonus-state.ts`；未知武器显式报告；输出稳定 JSON
  `--json <path>`）。运行：`pnpm --filter @roundsense/experiment-economy-ledger validate -- <zip|dir>...`
- `scripts/timeout-survivor-audit.ts` — 可复用审计工具（time_ran_out T 存活者奖金核验）
- `runtime-audit/` — 待执行的 Windows loss-counter 受控实验套件（协议见
  `docs/experiments/loss-counter-runtime.md`）

最终审计数字（2026-08-06）：316 场 / 60325 样本 / ~90% diff=0 / 100% 整数残差；
结论见 `docs/assumptions.md` C 节。
