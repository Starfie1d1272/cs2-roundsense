# experiments/economy-ledger

经济规则验证实验目录。

- `scripts/validate-corpus.ts` — **唯一语料验证入口**：
  - **L1** summary-ledger 对账（startMoney − moneySpent 重建；91%——方法局限，非规则准确率）
  - **L2** replay endpoint integrity（buy-phase firstCash / next-start lastCash）
  - **L3** time_ran_out T 存活者无败方奖金 invariant
  - **L4** replay-native cash-transition ledger（`packages/demo-oracle/src/replay-ledger.ts`）：8 Hz replay 现金流逐变化事件归因；科隆 202 场 85,599 transitions **100.0% 解释**
  - L1-nonzero 分解、OT cash profile（server/match profile）、unknown 武器报告
  - 输出稳定 JSON `--json <path>`。运行：`pnpm --filter @roundsense/experiment-economy-ledger validate -- <zip|dir>...`
- `runtime-audit/` — 待执行的 Windows loss-counter 受控实验套件（协议见
  `docs/experiments/loss-counter-runtime.md`）

最终审计数字（2026-08-07）：科隆 202 replay 场 L1 90.6% / L4 100.0%；
59 mini 场（无 replay）仅 L1。结论见 `docs/assumptions.md` C/D 节。
