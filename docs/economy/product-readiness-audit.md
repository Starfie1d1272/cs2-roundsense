# 产品就绪度审计（product readiness）

> 审计日期：2026-08-08
> 依据：`README.md`、根 `package.json`、`apps/roundsense/package.json`、`apps/gsi-recorder/package.json`、`packages/gsi-protocol/src/cfg.ts` + `src/index.ts`（导出面）、`apps/roundsense/src/index.ts`、`docs/runtime-checks.md`、`docs/evidence.md`。

## 1. 当前如何启动

```bash
pnpm install                 # 安装（pnpm 11.20 workspace）
pnpm test && pnpm typecheck  # 质量门（可选）
pnpm --filter @roundsense/roundsense start [--token <t>] [--port 3001] [--goal rifle_armor|awp|rifle_util|max_combat_now]
```

- `apps/roundsense` 的 `start` = `tsx src/index.ts`（package.json:7）——**tsx 直跑 TS 源码，无构建步骤**。
- 监听 `127.0.0.1:3001`（index.ts:76-79），启动时打印 GSI cfg 提示（引用 `packages/gsi-protocol` 的 cfg）。
- 相关命令：`pnpm recorder`（根 scripts，= `pnpm --filter @roundsense/gsi-recorder start`，录 GSI ndjson）；recorder 支持 `--cfg` 打印 gamestate_integration cfg（recorder index.ts `--cfg` 分支）；`pnpm validate`（离线 demo 验证器，研究侧非产品链路）。

## 2. 关键问题逐项

### 2.1 Standalone build（独立可分发构建）

**NO。**

- 无任何 `build` / `bundle` / `compile` script（根与 apps 的 package.json 均无）；运行时依赖 `tsx` + workspace 源码（`main: "src/index.ts"` 直接指向 TS 源，如 gsi-protocol package.json）。
- 无打包产物（无 dist/、无二进制、无 bundled node）。
- 结论：产品目前是"源码运行"形态，只能在装好 pnpm workspace 的开发机上跑；交付终端用户需要新增构建/打包步骤。

### 2.2 GSI cfg installer

**PARTIAL（有生成器，无安装器）。**

- `packages/gsi-protocol/src/cfg.ts`：`renderGsiCfg(options)`（:62-89，生成无 BOM 的 `gamestate_integration_*.cfg` 文本）+ `gsiCfgFileName()`（:92-94，返回 `gamestate_integration_roundsense.cfg`）+ `NORMAL_PLAYER_COMPONENTS`（:36-45，只请求普通玩家可用组件，不含观战专用 bomb/phase_countdowns）。
- 使用入口：gsi-recorder 的 `--cfg` 打印 cfg 文本，并提示"Save as gamestate_integration_roundsense.cfg in the CS2 csgo/cfg directory (Windows)"（recorder index.ts）——**手动保存**，没有任何脚本把文件写进游戏目录。
- 游戏目录路径仍是假设（cfg.ts:5-7 注释 A9 "exact path to be confirmed on Windows"）。
- 结论：**生成器 ✅ / 自动安装 ❌ / Windows 路径未验证 ❌（NEEDS RUNTIME VALIDATION）**。

### 2.3 Overlay

**NO —— CLI only。**

- README 明确产品定位"非 HUD / 非直播 / 非 Overlay"，实时输出为终端文本（C4 倒计时 + 经济建议两行式）。
- 无任何 overlay 相关目录/依赖（apps/ 下只有 roundsense + gsi-recorder；无 electron / TUI / webview / 渲染进程）。
- Overlay 数据契约见 `docs/economy/overlay-data-contract.md`（设计稿，尚未实现）。

### 2.4 Windows packaging 缺什么

| 缺失项 | 现状 | 说明 |
|---|---|---|
| Installer（安装器） | 缺 | 无 .exe/.msi/安装脚本；用户需手动装 Node + pnpm + clone + pnpm install。**NEEDS RUNTIME VALIDATION**（Windows 上 Node/pnpm 运行时未验证） |
| Auto-start（自启） | 缺 | 无开机自启/服务/计划任务方案；skill 实测记录：SSH 启动的进程断开即回收、`schtasks /run` 非交互令牌会卡 GUI 游戏、交互 GUI 需 `psexec -i 1 -d` 或 `steam -applaunch 730` 带参（见 cs2-demo-analysis skill `windows-gsi-observation` reference）——任何自启方案都要过这三条坑。**NEEDS RUNTIME VALIDATION** |
| Overlay | 缺 | 见 §2.3，CLI only |
| GSI cfg 自动部署 | 半缺 | 生成器有、自动写入游戏目录无（§2.2） |
| 规则/武器表更新通道 | 缺 | rules JSON 与武器表随仓库走 git；无热更新机制（对单机工具可接受，列出备查） |

## 3. 最终产品链现状

`install → configure GSI → launch → capture → policy → overlay → shutdown`

| 环节 | 现状 | 状态 |
|---|---|---|
| **install** | `pnpm install`（开发形态）；无终端用户安装器 | PARTIAL（dev-only）——Windows **NEEDS RUNTIME VALIDATION** |
| **configure GSI** | `renderGsiCfg` 生成 cfg（无 BOM、普通玩家组件集）；`--cfg` 打印；**手动**放入游戏 `csgo/cfg`（路径未验证） | PARTIAL——生成器 ✅、自动安装 ❌、路径 **NEEDS RUNTIME VALIDATION** |
| **launch** | `pnpm --filter @roundsense/roundsense start`（127.0.0.1:3001，可选 token）；游戏侧 `steam -applaunch 730`（Windows 实测路径见 skill reference） | DONE（dev）；Windows 进程生命周期（psexec/自启）**NEEDS RUNTIME VALIDATION** |
| **capture** | GSI receiver + zod 校验 + token auth + ndjson 录制；build 14174 全流程 Windows 实测通过（`docs/runtime-checks.md`，84 payload 受控会话）；`fixtures/gsi/*.ndjson` 固化测试样本 | **DONE**（Windows runtime-observed 2026-08-07） |
| **policy** | economy-advisor 纯函数引擎：价格/奖励规则语料整数账本验证（status=verified, 2026-08-06）、科隆职业行为审计（`docs/cologne-purchase-policy-audit.md`）、live GSI 经济契约实测（money 含 kill 奖励、freezetime-only advice）；已知未决项（win 递减形状、OT server profile、loss index 0/3/4 payout）**均不影响 live 产品**（live 直接读 GSI 真值） | **DONE**（产品级；缺口见 `docs/economy/planner-gap-audit.md`，不影响链路可行性） |
| **overlay** | 不存在；CLI 输出（C4 倒计时 + 推荐/备选）已具备 overlay 所需大部分字段，投影字段（F3/A3）需先扩展 `AdviceTick` | **MISSING**（契约已设计，见 `docs/economy/overlay-data-contract.md`） |
| **shutdown** | Ctrl+C 直接退出；无优雅停机/状态持久化；Windows 上进程管理（回收/自启）无产品化方案 | PARTIAL——**NEEDS RUNTIME VALIDATION**（Windows 生命周期） |

## 4. 结论

- **可工作的产品核心链路（install→launch→capture→policy）已全部实现并经 Windows 实测**（capture 环节 2026-08-07 实机验证）。
- **距终端用户可交付还缺三块**：① standalone build（现在只能源码跑）；② overlay（CLI only）；③ Windows packaging（installer / auto-start / GSI cfg 自动部署 / 进程生命周期）——其中 Windows 侧全部 **NEEDS RUNTIME VALIDATION**。
- GSI 配置环节"生成器 → 自动安装"的半步差距是 Windows 上手成本的主要来源，优先做 cfg 自动写入（含游戏目录探测）收益最高。
