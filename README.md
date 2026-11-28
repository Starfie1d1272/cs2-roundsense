# RoundSense

**只读、零内存注入的 CS2 冻结时间经济决策 HUD**。  
通过 CS2 官方 Game State Integration（GSI）实时读取你自己的局内经济与装备，在每回合冻结时间于雷达下方展示简洁的购买方案、本局投入与败后下局现金预测，回合开始后自动隐藏。

## 核心特点

- **解压即用**：Windows 便携 ZIP 内置完整 Node 运行时与后端服务，无需安装 Node、pnpm 或 Rust。
- **官方只读接口**：仅使用 CS2 官方本地 HTTP GSI（`127.0.0.1:3001`）与只读 Win32 窗口几何定位，**绝不读取或修改游戏内存**。
- **实时策略引擎（Policy V3）**：基于真实 CS2 竞技经济规则计算全起 / 强起 / 半起 / ECO / AWP 路线，支持「步枪手 / 狙击手 / Jame 攒狙」三种经济角色。
- **一键 GSI 配置**：自动发现 Steam / CS2 目录（亦支持手动选择文件夹），自动检测同端口冲突并安全备份原配置。
- **安静的桌面体验**：单实例运行、关闭设置窗口隐藏至系统托盘、透明鼠标穿透且不抢游戏焦点、退出或异常关闭时通过 Windows Job Object 自动回收后台进程。

## 使用方法（Windows 10 / 11）

> 运行环境要求：Windows 10 / 11（64 位）与系统内置的 Microsoft Edge WebView2 Runtime（Windows 11 默认自带），CS2 需运行在**全屏窗口化（Fullscreen Windowed）**或窗口模式下以显示透明叠层。

1. 从 GitHub Actions / Releases 下载 `RoundSense-win64-portable.zip` 并完整解压到任意目录。
2. 双击运行 `RoundSense.exe`，打开设置窗口。
3. 在右侧「游戏集成与连接」卡片中点击 **一键安装 GSI 配置**（若未自动找到目录，点击 **浏览…** 选择 CS2 安装目录）。
4. 按需调整 HUD 显示位置、缩放比例、背景不透明度与经济角色，所有修改即时生效并自动保存。
5. 启动或重启 CS2 进入竞技模式，每回合冻结时间 HUD 将自动出现，回合开始或 Alt+Tab 切出游戏后自动隐藏。
6. 平时可直接关闭设置窗口使其驻留系统托盘；需要完全退出时，右键托盘图标选择 **退出 RoundSense**。

## 本地数据与日志位置

- Windows：`%LOCALAPPDATA%\RoundSense\`（包含 `hud-settings.json`、`gsi-token`、`gsi-backups\`、`logs\sidecar.log`）
- macOS / Linux（开发模式）：`~/.config/RoundSense/`

## 开发者指南

```bash
# 安装依赖（Node >= 24.21, pnpm 12.9.1）
pnpm install

# 启动本地 HUD 服务（浏览器调试设置页 http://127.0.0.1:3100/）
pnpm hud

# 格式化、Lint、类型检查与全量测试
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test

# 构建桌面端单文件 Sidecar
pnpm --filter @roundsense/desktop build:sidecar

# 编译桌面宿主并打包 Windows 便携 ZIP（在 Windows 上运行）
cargo build --release --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @roundsense/desktop package:win
```

## 仓库结构

- `apps/desktop/` — Tauri v2 原生桌面宿主（单实例、系统托盘、Node Sidecar 生命周期、Win32 CS2 叠层定位）
- `apps/roundsense/` — 本地 HUD/GSI HTTP+SSE 服务、CS2 GSI 自动配置与共享 HUD/设置页 UI
- `packages/economy-advisor/` — CS2 竞技经济规则表与 Policy V3 推荐引擎
- `packages/gsi-protocol/` — CS2 GSI HTTP 接收器、Token 认证与协议解析
- `packages/c4-estimator/`、`packages/replay-harness/`、`packages/shared-types/` — 共享类型与回放测试基础设施

## License

MIT
