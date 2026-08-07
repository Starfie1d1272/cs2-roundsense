# 实验协议：Windows 端 C4 延迟与精度（第一轮）

> 目标机器：Windows 台式机（运行 CS2）。
> 执行者：用户（或后续 Codex 生成的脚本）。
> 前置：[待Windows实测] A9 cfg 目录路径确认；本协议中所有待实测项在 docs/assumptions.md 有对应编号。

## 0. 实验目的（回答 P0-A 研究问题）

1. 普通玩家状态下是否稳定收到 `round.bomb` 的 `planted` 变化（漏报率）。
2. `buffer`/`throttle` 不同取值下，安放事件到达延迟、抖动、漏报、重复情况。
3. 单调时钟 + 引信模型能否给出有实战意义的剩余时间估算（最终倒计时误差）。
4. 服务重启、重复 payload、缺失中间状态、暂停、断线恢复时状态机是否安全重置。

## 1. 前置准备

1. 在 Windows 上安装 Node ≥ 22（或直接跑打包好的 recorder）。
2. 复制仓库到 Windows（或只复制 `apps/gsi-recorder` + `packages/gsi-protocol` + 根 package.json/pnpm-lock）。
3. `pnpm install && pnpm typecheck`。
4. 生成 cfg 并放置：
   ```powershell
   pnpm --filter @roundsense/gsi-recorder start -- --cfg --port 3000 --token <token> `
     > gamestate_integration_roundsense.cfg
   # 确认无 BOM（记事本另存为 UTF-8 无 BOM，或直接重定向生成）
   # 放置到 <Steam>\steamapps\common\Counter-Strike 2\game\csgo\cfg\  （路径待实测，A9）
   ```
5. 启动 recorder：`pnpm --filter @roundsense/gsi-recorder start -- --port 3000 --token <token> --out recordings\exp1.ndjson`
   - 检查 `http://127.0.0.1:3000/health` 返回 200。
6. 启动 CS2，确认控制台无 cfg 加载错误（A8：BOM 会导致静默不加载；观察 `/health` 计数是否增长）。

## 2. 实验 A：受控本地服务器重复安放

- 自建或使用本地 CS2 服务器（`map de_mirage; mp_warmup_end` 或练习模式），
  由同一玩家（或 bot 脚本）在 A/B 点反复安放/拆包/引爆。
- 每轮记录：安放时刻（游戏内时钟/录屏帧号可选）、recorder NDJSON 时间戳。
- 最少 30 次安放（统计 P50/P95/P99 需要）。

## 3. 实验 B：demo 回放时的 GSI 行为

- 在 CS2 内回放一份已知 demo（GOTV 回放或下载的比赛 demo），观察普通玩家/回放观战视角下 GSI 行为：
  - 回放观战（spectator）是否意外上报 `phase_countdowns`/`bomb` 组件（验证 A2 边界在回放场景的表现）；
  - `map.phase`、`round.phase`、`round.bomb` 在回放 seek/暂停时的行为（状态机重置安全性验证）。
- 该实验同时提供 **demo tick ↔ GSI 接收时刻对齐**的素材：
  - 用 `cs2df export` 导出同一 demo 为 v3 ZIP（在 Mac 或 Windows 的 Python 环境）；
  - `bombs.json` 中 `planted.tick`/`exploded.tick`（64 tick）为真值；
  - GSI 侧 `receivedAtMonotonicNs` 与 demo tick 对齐方法：以"回合开始（freezetime 结束）"或"爆炸瞬间"为锚点，计算 `plant_detection_delay_ms = GSI planted 接收时刻 − 真值 planted tick 时刻`。

## 4. 实验 C：真实竞技/Premier 验证

- 正常进行 5~10 场竞技/Premier，全程录制 NDJSON。
- 记录每场：地图、模式、胜负、回合数、是否重连/暂停。
- 赛后用 demo 文件（若官方提供）或记忆锚点核对 1~2 个安放事件。

## 5. buffer/throttle 参数矩阵（核心实验）

| buffer (s) | throttle (s) | timeout (s) | 备注 |
|---|---|---|---|
| 0.0 | 0.1 | 1.1 | 最低延迟配置 |
| 0.0 | 0.5 | 1.1 | 推荐起点 |
| 0.1 | 0.5 | 1.1 | 默认 buffer |
| 0.1 | 1.0 | 1.1 | Valve 默认 |
| 0.5 | 0.5 | 1.1 | 高 buffer |
| 0.0 | 0.0 | 1.1 | 极限（注意频率） |

- 每个配置至少 20 次安放（实验 A 环境），cfg 中同步修改 buffer/throttle，
  **NDJSON 信封里的 `gsi.bufferMs/throttleMs` 会记录实际参数**，供事后分组。
- 同一配置下跑实验 A + 实验 B（回放）各一轮。

## 6. 指标定义（与分析脚本的输入格式）

对每个配置，从 NDJSON + 真值（v3 ZIP 或录屏锚点）计算：

- `plant_detection_delay_ms` = GSI 收到 planted 的单调时刻 − 真值 planted 时刻（秒 → ms）。
  真值时刻来源（按可用性优先级）：
  a) 同场 demo 的 v3 ZIP `bombs.json planted.tick / 64`（需与 GSI 会话时间轴对齐）；
  b) 本地服务器实验：`sv_cheats` 下用控制台/录屏帧号记录（帧号×帧时长）。
- 分布：`p50 / p95 / p99 / mean / min / max`（`plant_detection_delay_ms`）。
- `jitter_ms` = 相邻 planted 事件延迟差值的绝对值的分布（同上分位）。
- `missed_rate` = 真值安放次数中未收到 planted 的比例（含 baseline_only 抑制的计数，分开报告）。
- `dup_rate` = 同一真值安放产生的重复 planted 事件数（状态机去重后应为 0，用于验证去重）。
- `final_countdown_error_ms` = 估算剩余时间 vs 实际爆炸时刻的误差：
  `error = (plantedAt + fuseMs_规则) − exploded真值时刻`，其中 fuseMs_规则 取
  `c4-estimator/src/rules.ts` 的 41000（corpus-observed，demo 事件语义；
  真实游戏是否 40s 仍 runtime-unverified，本实验可提供证据）。
- 每条记录必须可追溯：`seq`、`receivedAtMonotonicNs`、`provider.timestamp`、`gsi.bufferMs/throttleMs`。

## 7. 输出格式（Windows → Mac 分析）

NDJSON 保持 recorder 原生格式（`recordings/*.ndjson`）。
输出统一放到 gitignored 的 `recordings/c4-latency/`（不再创建 experiment 输出目录）。
新增一个 `recordings/c4-latency/<配置>.summary.json`（脚本生成）：

```json
{
  "config": { "bufferMs": 0, "throttleMs": 500, "timeoutMs": 1100 },
  "mode": "local-server | demo-replay | premier",
  "map": "de_mirage",
  "samples": 30,
  "plant_detection_delay_ms": { "p50": 0, "p95": 0, "p99": 0, "mean": 0, "min": 0, "max": 0 },
  "jitter_ms": { "p50": 0, "p95": 0 },
  "missed_rate": 0.0,
  "dup_rate": 0.0,
  "final_countdown_error_ms": { "p50": 0, "p95": 0, "p99": 0 },
  "fuse_source": "rules/cs2-c4-fuse-2026-08 (corpus-verified 41000ms demo-event; real-game 40s pending Windows)"
}
```

## 8. 状态机重启/异常场景清单（实验 D）

在实验 A 环境逐项执行并记录事件序列（用 debug-viewer 回放验证）：

1. recorder 中途启动（首包即 planted）→ 期望 `baseline_only`，无 planted 事件。
2. 重复 payload（网络重发/服务器重推）→ 期望 planted 仅 1 次。
3. 缺失中间状态（人为丢弃 defused/exploded 包）→ 期望 `round_over` 而非伪造 exploded。
4. 暂停/超时（`map.phase=paused`）→ 状态保持，恢复后正常。
5. 断线重连（recorder 重启，CS2 继续）→ 重启后首包只建基线。
6. 地图切换（gameover → warmup → live）→ 状态重置为 idle。

## 9. 完成后交付

- `recordings/*.ndjson`（原样保留，上传到 Mac 分析）。
- `recordings/c4-latency/*.summary.json`。
- 每配置 1~2 行观察笔记（漏报场景、异常状态值、`round.bomb` 实际取值集合）。
- 更新 `docs/assumptions.md` 中 A4/A5/A7/A9/A10 与 B1/B4 的状态标签（41000 vs 40s 的判定证据）。
