# Product Alpha Windows 验证清单

本文锁定 RoundSense Product Alpha 的实机验收边界。macOS/CI 可以验证策略、presentation、
renderer、Electron 启动与 Windows ZIP 产出，但不能替代 Windows + CS2 的最终验证。

## 已由自动化覆盖

- frozen Policy V3 的默认入口保持不变；round-scoped 玩家 intent 走独立 resolver。
- intent 在同一回合保留、跨回合清除；不可满足的 generic 默认购买组合不会取消已锁定的经济意图，且不会回退成自动建议。
- 最终配置与还要买是不同字段；未知主武器不会被当成“没有主武器”。
- 精确本轮消费固定为 UNKNOWN；冻结时间首个现金 receipt 仅作为未校准的 round-start-money anchor diagnostic，不能充当消费账本。
- receiver 仅绑定 `127.0.0.1`，token 校验、payload schema、body limit 与 health endpoint 复用核心实现。
- Steam library/manifest 发现、CS2 目录验证、cfg 安装/修复/备份/原子替换使用临时目录测试。
- dashboard 与 Overlay 共用 serializable presentation model；renderer 无 Node 权限，preload 仅暴露白名单 IPC。
- live/over 或 GSI stale 时 Overlay 隐藏；快捷键注册冲突会进入诊断。
- Windows x64 ZIP 可由 `pnpm package:win` 生成。

## WINDOWS_VALIDATION_REQUIRED

以下项目在发布给外部玩家前必须在 Windows 11 + 当前 CS2 实机逐项记录结果：

- [ ] 从干净用户目录启动 ZIP 中的 `RoundSense.exe`，确认单实例、tray、退出与设置持久化。
- [ ] Steam 默认库与第二 Steam Library 均能自动定位；手动选择目录可恢复自动发现失败。
- [ ] 首次安装 cfg、内容不一致修复、只读目录失败、端口占用和 token 不一致均给出正确诊断。
- [ ] 启动 CS2 后正常收到普通玩家 GSI；不消费 spectator-only 对手隐藏经济或装备。
- [ ] 进入 freezetime 显示 Overlay，进入 live/over 与状态流 stale 后立即隐藏。
- [ ] 自动建议、ECO/半起/强起/长枪局锁定、清除锁定和下一回合自动清除均与控制台一致。
- [ ] 记录至少一个完整回合的冻结时间首个现金 anchor、实际回合首现金与购买后的 GSI cash，确认它们的关系前不得启用“本回合已花”。
- [ ] 简洁/详细模式、六个锚点、75%–140% 缩放、快捷键冲突诊断均工作。
- [ ] Borderless/windowed 下 always-on-top、click-through、CS2 焦点、Alt-Tab 与输入不受影响。
- [ ] Exclusive fullscreen 的表现被明确记录；不能工作的组合不得宣称支持。
- [ ] 16:9、4:3 stretched、100%/125%/150% DPI、多显示器和不同主屏组合没有裁切或错位。
- [ ] Trusted Mode/反作弊环境下不触发注入或进程访问告警；RoundSense 始终只读 loopback GSI。
- [ ] 未签名 ZIP 的下载、解压、SmartScreen 提示与用户引导可接受；对外分发前另行决定代码签名。
- [ ] 当前 CS2 版本下 `Counter-Strike Global Offensive`/manifest installdir 与 cfg 路径仍成立。

数值 C4 倒计时继续由 `docs/experiments/c4-windows-controlled-calibration.md` 单独阻塞；本次
Product Alpha 不把未校准的剩余秒数带入 Overlay。
