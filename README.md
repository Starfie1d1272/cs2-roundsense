# RoundSense

**面向 CS2 玩家的本地、只读回合决策助手。**

RoundSense 读取 CS2 Game State Integration（GSI），在冻结时间结合你的现金、装备、
败方奖励和回合上下文，帮助你判断这局该 eco、半起、强起还是全起，投入应控制在什么
范围，以及如果输掉，下一局还能买什么。

当前原型通过本地 CLI 展示结果；策略引擎与 presentation 解耦，后续可以接入更低认知
负担的展示方式。

## 为什么需要 RoundSense

多数购买辅助首先回答“买什么”。RoundSense 更先回答一个影响整场经济的问题：

> **这一局值得投入到什么程度？**

它按“经济策略 → 投入边界 → 败后影响 → 具体购买”的顺序组织建议。枪械和道具组合很
重要，但它们服务于回合策略，而不是替代策略本身。

## 目标展示示例

> 以下是 Policy V3 structured output 的目标展示示例，不是当前 CLI 的逐字输出。

```text
CT · Round 8 · $3,450

半起
建议投入 ≤ $1,250
激进上限 $1,750

推荐：
半甲 + 烟 + 闪

如果输掉：
下一局预计 $4,200
✓ 可保持长枪 + 甲
✗ 长枪 + 甲 + 基础道具

对手经济：未知
```

## 核心能力

- **经济策略**：区分 eco、半起、强起与全起，先决定投入程度，再规划购买组合。
- **投入边界**：同时表达建议投入和最多投入，半起不是固定的一套枪甲模板。
- **败后经济**：给出输掉当前回合后的现金情景，以及下一局关键购买能力是否仍可达。
- **装备感知建议**：根据已有主武器、护甲、头盔、钳子和道具，只补真正需要购买的内容。
- **手枪局后策略**：区分手枪局赢家的 conversion 与输家的独立策略，不套用普通回合模板。
- **C4 状态检测**：安全支持 bomb-state observation 与状态转换检测；数值剩余时间仍等待
  Windows controlled calibration，当前不提供精确实时倒计时。

## 工作方式

```text
CS2 GSI
  → 当前可见状态与安全连续追踪的历史
  → Policy V3
  → 投入建议 / 未来经济 / 购买组合
  → 当前 CLI / 未来 presentation
```

RoundSense 的实时建议只使用普通玩家 GSI 可见的信息，以及从连续 GSI payload 中安全
追踪得到的上一回合状态。策略引擎输出结构化结果，CLI 只是当前的验证和展示界面。

## 快速开始

### 前置要求

- Node.js 24.21.0（24 LTS 系列）
- pnpm 12.9.1
- CS2 与 RoundSense 运行在同一台电脑上

### 1. 安装依赖

```bash
pnpm install
```

### 2. 生成并安装 GSI 配置

选择一个本地 token，并生成与 RoundSense 默认端口一致的配置：

```bash
pnpm --filter @roundsense/gsi-recorder start --cfg --port 3001 --token roundsense-local
```

将命令输出的配置正文保存为 `gamestate_integration_roundsense.cfg`（UTF-8、无 BOM），
放入 CS2 配置目录：

```text
<Steam>/steamapps/common/Counter-Strike 2/game/csgo/cfg/
```

### 3. 启动 RoundSense

使用与 cfg 相同的 token：

```bash
pnpm --filter @roundsense/roundsense start --token roundsense-local --port 3001
```

服务默认只监听 [http://127.0.0.1:3001](http://127.0.0.1:3001)。进入游戏后，
RoundSense 会在可验证的购买窗口（当前为 freezetime）输出经济建议。

## 数据边界与安全性

- 完全本地运行，HTTP receiver 绑定 loopback 地址。
- 只读消费 CS2 官方提供的 GSI payload。
- 不读取游戏内存，不向游戏进程注入代码，也不修改游戏状态。
- 实时推荐不使用只有 demo 或 spectator 才能看到的对手隐藏经济与装备信息。
- 信息缺失时保留“未知”，不会为了给出完整答案而伪造确定值。

## 验证

Policy V3 使用冻结的 IEM Cologne Major 2026 corpus 做 behavioral conformance
validation：

- 43,620 条 raw player-rounds
- 23,552 条 eligible player-rounds
- 202 个 map packages
- 所有 Policy V3 mechanical invariant violations = 0

职业比赛行为在这里是 expert behavioral reference，不是唯一正确或最优策略的真值。

完整方法、限制与结果见：

- [Policy V3 最终产品行为验收](docs/experiments/policy-v3-final-acceptance.md)
- [Policy V3 architecture](docs/policy-v3-architecture.md)

## 开发与仓库结构

```text
apps/
  roundsense/          # 当前 CLI 与 runtime orchestration
  gsi-recorder/        # GSI cfg 生成、录制与调试
packages/
  economy-advisor/     # Policy V3 与购买 mechanics
  gsi-protocol/        # GSI schema、receiver 与 cfg
  c4-estimator/        # C4 状态与 timing contract
  shared-types/        # 跨包共享类型
  replay-harness/      # 离线 replay 测试辅助
scripts/
  policy-v3-final-acceptance.ts
```

常用验证命令：

```bash
pnpm test
pnpm typecheck
pnpm --filter @roundsense/tools validate -- ../fixtures/demo-format/tiny-v3.zip
```

云环境新任务开始时，在修改代码前执行 `bash scripts/cloud-start.sh`：先用
`git pull --ff-only origin main` 同步当前任务分支，再按锁文件安装依赖。脚本使用
环境安装阶段保留在 `/workspace/.roundsense-tools` 的工具链；发现本地改动、分支
分叉或工具链版本不匹配时停止，不重置或覆盖已有工作。环境快照本身不会自动拉取
Git 更新，需要在环境的启动说明中要求每个新任务执行此脚本。

完整研究资产保留在 frozen research branches；mainline 保留生产代码、权威结论与可复现
验收入口。
