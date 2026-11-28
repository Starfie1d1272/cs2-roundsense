# 更新日志

本文件记录 RoundSense 的重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.1] - 2026-11-28

### 调整

- 更新桌面端应用与系统托盘图标（`icon.png`、`icon.ico`），补充品牌标识（`logo.svg`）与仓库分享封面（`social-preview.png`）。
- 重写中英文 README，内嵌产品演示视频，补充更新日志与版本徽章。

## [0.1.0] - 2026-11-28

首个公开 Windows 便携版。

### 新增

- **冻结时间局内经济 HUD**：显示当前局势下的购买方案（`全起`、`强起`、`半起`、`ECO`、`起 AWP`）、具体花费或半起上限、CS2 武器/护甲/道具图标，以及按颜色分级的常规败局下回合现金预测。
- **开局锁定与自动隐藏**：每回合冻结时间锁定开局方案，买枪过程中保持稳定；解冻约 5 秒后、切出游戏、观战或手枪局时自动隐藏。
- **三种经济角色**：支持 `步枪手`、`狙击手` 与 `Jame 攒狙` 策略。
- **Policy V3 经济推荐引擎**：基于 IEM Cologne Major 2026（202 张图）定型，并在 PGL Singapore Major 2026 Stage 1（53 张新图）完成零调参盲测。
- **设置与离线预览工作台**：预览窗口跟随实际游戏分辨率缩放，内置亮/暗图场景，支持实时调整位置、缩放与透明度。
- **一键安装 CS2 GSI 配置**：自动发现 Steam / CS2 目录，备份原有配置并写入本地只读 GSI 配置（`127.0.0.1:3001`）。
- **Windows 便携桌面包**：基于 Tauri v2 的单实例桌面宿主，内置 Node Sidecar，支持系统托盘驻留、鼠标穿透叠层及退出时自动回收后台进程。

[Unreleased]: https://github.com/Starfie1d1272/cs2-roundsense/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Starfie1d1272/cs2-roundsense/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Starfie1d1272/cs2-roundsense/releases/tag/v0.1.0
