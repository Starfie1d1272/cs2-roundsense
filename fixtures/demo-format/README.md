# fixtures/demo-format — v3 ZIP fixture

## tiny-v3.zip

从真实 v3 导出（`cs2-demo-analysis-kit/fixtures/input/sample-2026-05-17_de_ancient_Team_Spirit_13-10_Team_Falcons.zip`）裁剪而来：
保留全部 11 个必需文件，事件/聚合数组截断到前 2 回合，去掉 shots/replay/duels 可选流。

- 重新生成：`node scripts/make-tiny-demo-fixture.mjs <source-v3.zip>`
- 用途：demo-oracle 的离线测试（schema 严格校验通过，字段取自真实数据，天然合法）。
- 来源 ZIP 属 `cs2-demo-analysis-kit`（MIT），不在本仓库重复提交大文件。

## 300+ 场语料

用户已有三位数场次的 v3 ZIP 语料，**路径待提供**（本机 `fixtures/demos` 为空、无 NAS 挂载）。
批量核验（`experiments/economy-ledger`）将在路径确认后运行。
