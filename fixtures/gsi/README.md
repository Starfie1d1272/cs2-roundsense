# fixtures/gsi — 合成 GSI NDJSON fixtures

由 `scripts/gen-gsi-fixtures.mjs` 确定性生成（含合成单调时钟与墙钟），
用于离线验证 replay harness 与 C4 状态机。**不是真实采集数据**。

| 文件 | 场景 | 预期事件序列 |
|---|---|---|
| plant-explode.ndjson | 安放 → 重复 payload → exploding → 回合结束 | planted ×1, round_over（含爆炸信号说明） |
| mid-round-start.ndjson | 接收器中途启动，首包即 planted | baseline_only, defused, reset（无 planted） |
| plant-defuse.ndjson | 安放 → 拆包 | planted, defused |
| drop-before-plant.ndjson | 掉包 → 安放 → 回合结束 | planted, round_over（不伪造爆炸） |
| missing-middle.ndjson | 缺中间状态（defused/exploded 包丢失） | planted, round_over（不伪造） |
| restart-map.ndjson | gameover → 新地图 → 重新安放/拆包 | planted, round_over, reset, planted, defused |
| pause.ndjson | 暂停（timeout）期间保持安放状态 | planted, defused |

payload 中 `auth` 一律不存在（录制端已脱敏，见 gsi-protocol sanitize）。
