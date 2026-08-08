# C4 Windows controlled calibration protocol

状态：**唯一剩余实验，尚未执行**。本协议只用于本地 ground-truth 校准；
RoundSense 生产版仍只能消费 official normal-player GSI。

## 1. 要解决的三个量

当前证据把三个不同量混在了一起：

1. `realFuseMs`：C4 完成安放到游戏实际引爆的真实时间；
2. `demoEventOffsetMs`：demo 的 `planted` / `exploded` event tick 相对真实
   安放完成 / 引爆时刻的偏移；
3. `gsiDelayMs`：真实状态变化到 normal-player GSI 被本地接收的延迟，继续拆成
   游戏端有意聚合/节流、loopback transport、receiver handling。

现有 223 个 demo 样本只证明 `demo(planted→exploded)=2624 ticks @64 =
41.000s`；Windows 的 4 个样本只证明首个 planted receipt 到首个 exploded
receipt 为 38.56–39.49s。两者都不能直接给出 `realFuseMs`，也不能推出固定
correction。

## 2. 一次实验的同步采集面

在一台 Windows 机器、一个本地 practice/dedicated server、一个普通玩家客户端
内完成。所有时间源使用同一台机器的 `QueryPerformanceCounter`（QPC），禁止用
秒级 `provider.timestamp` 或墙钟做差。

### 2.1 本地 server ground truth（仅实验）

安装最小只读 server instrumentation，逐次记录：

- `runId`、trial、site、server tick、tick interval、QPC；
- `mp_c4timer`；
- `bomb_planted` 与 `bomb_exploded` game event；
- planted C4 entity 的 game time、`m_flC4Blow`（或当前 build 的等价字段）；
- 回合结束原因。

instrumentation 不修改经济、伤害、移动或 C4 规则。它只允许出现在本地实验
server，不进入产品，也不作为产品输入。

### 2.2 Demo

同一 session 录制 server demo。解析后保存每个 trial 的 `plant_begin`、
`planted`、`exploded` tick。必须用 trial/site/tick window 与 ground-truth 记录
一一关联，不能按数组位置猜测。

### 2.3 两路 normal-player GSI

同时启用两个只订阅 `NORMAL_PLAYER_COMPONENTS` 的 cfg；不得订阅 `bomb` root
block、`phase_countdowns` 或 `allplayers_*`：

| profile | endpoint | buffer | throttle | 用途 |
| --- | --- | ---: | ---: | --- |
| `cal-zero` | `127.0.0.1:3101` | 0.0s | 0.0s | 测量最小 emission + transport 路径 |
| `production` | `127.0.0.1:3102` | 0.1s | 1.0s | 测量当前生产配置 |

两个 receiver 在读取 socket 后、JSON parse 前立即记 QPC，并按现有 NDJSON
envelope 记录 payload、seq、QPC、cfg profile。必须验证普通玩家身份，且 payload
中没有 spectator-only block 被消费。

### 2.4 Windows transport trace

用 Windows ETW TCP/IP provider（或能给出等价 QPC 的 WPR trace）记录 CS2
进程向两个 endpoint 的 send 与 receiver 进程的 receive。按 endpoint、TCP
sequence 和 payload length 关联 HTTP POST。这样才能把：

- `game event → CS2 send`（游戏端 emission，含 buffer/throttle）；
- `CS2 send → receiver socket receive`（loopback transport）；
- `socket receive → NDJSON receipt`（receiver handling）

分开报告。没有 ETW 关联成功的 trial 不进入延迟校准。

## 3. Trial matrix

- `mp_c4timer` 分别设为 35、40、45 秒，各完成 10 次自然引爆，共 30 次；
- A/B site 各半，禁止拆包，固定 tickrate 与 server rules；
- 每次 plant 相对上一条 GSI change-driven payload 的间隔做轻微随机化，覆盖
  throttle phase，而不是总在同一相位安放；
- 记录 CS2 build、server build、GSI cfg 全文 SHA-256、instrumentation SHA-256、
  demo SHA-256；
- trial 若发生断线、暂停、回合提前结束、instrumentation 丢行或 ETW 无法关联，
  标为 invalid，不得补数。

三个 cvar 值用于检验斜率与固定 offset；只测一个 40 秒值无法区分“真实 fuse
变化”与“event endpoint 固定偏移”。

## 4. 计算

每个有效 trial 计算：

```text
realFuseMs = (c4BlowGameTime - plantCompleteGameTime) * 1000
demoIntervalMs = (demoExplodedTick - demoPlantedTick) * tickIntervalMs
demoPlantOffsetMs = (demoPlantedTick - groundTruthPlantTick) * tickIntervalMs
demoExplodeOffsetMs = (demoExplodedTick - groundTruthExplodeTick) * tickIntervalMs

gsiEmissionDelayMs(profile, event) = etwCs2SendQpc - groundTruthEventQpc
gsiTransportDelayMs(profile, event) = etwReceiverReceiveQpc - etwCs2SendQpc
receiverHandlingMs(profile, event) = ndjsonReceiptQpc - etwReceiverReceiveQpc
```

`production - cal-zero` 的 paired emission delta 只描述配置造成的额外排队；
不得把 transport 或 handler 时间算进 intentional delay。plant 与 explode 两端
分别报告分布，不能用 receipt-to-receipt 相减后把两端延迟抵消。

## 5. 通过条件

只有同时满足以下条件，才允许产生 versioned `C4CalibrationProfile`：

1. 三个 cvar 档各至少 10 个有效 trial，全部能一一关联四路记录；
2. `realFuseMs` 对 `mp_c4timer` 的斜率为 1，单次残差不超过 1 server tick；
3. demo 两个 endpoint offset 可重复，且能解释为何现有 interval 为 41s；
4. 两个 GSI profile 的 plant/explode emission、transport、handler 分布均完整；
5. production profile 给出保守的 detection-delay interval，而不是只给均值；
6. 重放原始记录能逐字节再生 summary，artifact 带所有输入 SHA-256。

任一条件失败，结论保持：`remainingTime.status = "UNKNOWN"`。不得依据四个旧
Windows 样本手调 1–2 秒 correction。

## 6. 校准后的 production 使用边界

校准通过后也只能生成与 build、GSI cfg、server fuse profile 匹配的 interval：

```ts
interface C4CalibrationProfile {
  id: string;
  gameBuild: number;
  gsiBufferMs: number;
  gsiThrottleMs: number;
  realFuseMs: number;
  plantDetectionDelayMs: { min: number; max: number };
}
```

生产 payload 无法证明 server 的 fuse profile 与校准一致时，仍必须 UNKNOWN。
实验 instrumentation、demo ticks、ETW 数据永远不能成为 live product 输入。
