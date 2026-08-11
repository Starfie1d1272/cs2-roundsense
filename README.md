# RoundSense

**面向 CS2 玩家的本地、只读回合决策助手。**

RoundSense 读取 CS2 Game State Integration（GSI），在冻结时间结合你的现金、装备、
败方奖励和回合上下文，帮助你判断这局该 eco、半起、强起还是全起，投入应控制在什么
范围，以及如果输掉，下一局还能买什么。

Product Alpha 提供 Windows 桌面控制台与游戏 Overlay：同一个 Electron 主进程承载
loopback GSI receiver、连续状态 tracker 与 Policy V3，renderer 只接收可序列化的产品视图。
不需要独立后端、WebSocket、账号或第三方 Overlay 宿主。

## 为什么需要 RoundSense

多数购买辅助首先回答“买什么”。RoundSense 更先回答一个影响整场经济的问题：

> **这一局值得投入到什么程度？**

它按“经济策略 → 投入边界 → 败后影响 → 具体购买”的顺序组织建议。枪械和道具组合很
重要，但它们服务于回合策略，而不是替代策略本身。

## Product Alpha 体验

1. 启动 RoundSense，应用自动定位 Steam/CS2 并检查自己的 GSI 配置；需要时可一键安装或修复。
2. 收到普通玩家 GSI 后，控制台显示连接状态；只有可验证的冻结时间会显示 Overlay。
3. 默认建议保持 frozen Policy V3 行为。ECO、半起、强起与长枪局首先是经济 commitment；玩家锁定后仍保留该意图，即使当前 generic default 购买组合不可生成。
4. Overlay 按意图展示：ECO 强调最小投入；半起显示 guardrail 和越线后果；强起只强调当前回合；长枪局在详细模式才显示 inventory-aware 默认配置和“还要买”。这些组合不是地图、位置或战术条件下的唯一最优解。
5. 回合进入 live 后自动隐藏；玩家锁定在下一回合自动清除。

## 核心能力

- **经济策略**：区分 eco、半起、强起与全起，先决定投入程度，再提供 inventory-aware 的通用默认购买组合。
- **可靠边界**：按最新现金重算“从现在起还能花多少”及败后能力；半起不是固定储备或固定模板。
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
  → serializable Product View
  → desktop dashboard / click-through Overlay
```

RoundSense 的实时建议只使用普通玩家 GSI 可见的信息，以及从连续 GSI payload 中安全
追踪得到的上一回合状态。主进程是唯一 session owner；renderer 不重建 tracker 或策略状态。

## 快速开始

### 前置要求

- Node.js 22
- pnpm 11.20.0
- CS2 与 RoundSense 运行在同一台电脑上

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动 Product Alpha 桌面端

```bash
pnpm desktop
```

Windows 上首次启动会通过 Steam registry、`libraryfolders.vdf` 与 `appmanifest_730.acf`
定位安装目录，并验证 `game/csgo/cfg` 和 `game/bin/win64/cs2.exe`。应用只管理：

```text
<CS2>/game/csgo/cfg/gamestate_integration_roundsense.cfg
```

已有但内容不同的 RoundSense cfg 会先备份，再原子替换；token 随本地设置生成并只写入本机
cfg，不会出现在复制出的诊断信息中。若自动定位失败，可从控制台选择 CS2 目录。

### 3. 构建 Windows x64 ZIP


```bash
pnpm package:win
```

产物位于 `apps/desktop/release/`。Alpha ZIP 尚未签名；Windows SmartScreen 与真实 CS2
行为仍需按 [Windows Product Alpha 验证清单](docs/product-alpha-windows-validation.md) 实测。

保留的 CLI/recorder 仍可用于协议与策略调试，桌面产品不依赖它们作为后台服务。

## 数据边界与安全性

- 完全本地运行，HTTP receiver 绑定 loopback 地址。
- 只读消费 CS2 官方提供的 GSI payload。
- 不读取游戏内存，不向游戏进程注入代码，也不修改游戏状态。
- 实时推荐不使用只有 demo 或 spectator 才能看到的对手隐藏经济与装备信息。
- 信息缺失时保留“未知”，不会为了给出完整答案而伪造确定值。
- GSI 没有可靠的回合首现金/交易账本，因此 Product Alpha 不计算“本回合已花”精确值；
  Overlay 不展示这个永久 UNKNOWN。诊断会记录冻结时间首个现金 receipt 候选，供 Windows 实测 round-start-money anchor，但它不是已验证的回合首现金或消费账本。
- 数值 C4 剩余时间在 Windows controlled calibration 前仍不进入 Product Alpha Overlay。

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
  desktop/             # Electron main/preload/dashboard/overlay 与 Windows packaging
  roundsense/          # tracker、product presentation contract 与 CLI adapter
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
pnpm build
pnpm package:win
pnpm --filter @roundsense/tools validate -- ../fixtures/demo-format/tiny-v3.zip
```

当前环境能验证的项目与 Windows/CS2 实机边界见
[Product Alpha Windows 验证清单](docs/product-alpha-windows-validation.md)。

完整研究资产保留在 frozen research branches；mainline 保留生产代码、权威结论与可复现
验收入口。
