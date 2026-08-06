# experiments/c4-latency

Windows 端 C4 延迟与精度实验目录（第一轮协议见 `docs/experiments/c4-latency.md`）。

- `output/`（gitignored）：各配置的 `*.summary.json` + 分析脚本产物。
- 运行方式：在 Windows 上跑 recorder（`pnpm --filter @roundsense/gsi-recorder start`），
  采集 `recordings/*.ndjson`，回传 Mac 分析。
- 分析脚本（后续 Codex/第二轮）：读 NDJSON + v3 ZIP 真值，输出第 6 节指标。
