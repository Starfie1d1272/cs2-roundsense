# ADR-0001：技术栈选择

- 状态：已采纳（2026-08-06）
- 背景：用户已有 cs2-demo-format 与 cs2-demo-analysis-kit，均使用 pnpm workspace + TypeScript 5 + vitest + zod。要求"能够复用时保持一致，不要为了个人偏好引入新的工具链"。
- 决策：
  - 包管理器 pnpm（workspace `apps/*` + `packages/*`）；
  - TypeScript 5.9 strict，`moduleResolution: Bundler`，`noEmit`，单根 tsconfig 覆盖全部包（cs2-demo-format 同款做法）；
  - 测试 vitest 4（node 环境，`**/*.test.ts` 与源码同目录）；
  - schema zod 3；v3 ZIP 解析直接复用 `cs2-demo-format@3.1.0`（npm 已发布），不 fork 不重写；
  - 无 eslint/prettier（与现有两个仓库一致），静态检查 = `tsc --noEmit`；
  - CLI 运行用 tsx（两个现有仓库均用）。
- 备选：Python 侧（cs2df 是 Python）——不选：实时 GSI 接收与状态机在 Node 端与既有 TS 分析栈对齐更顺；Python 仅用于 demo 导出（已在 cs2-demo-format 仓库内）。

# ADR-0002：数据来源与证据分级

- 状态：已采纳（2026-08-06）
- 背景：研究结论必须区分 GSI 直接观测 / 状态差分推导 / 规则估算 / demo 真值；未经验证的结论不得包装成事实。
- 决策：
  - 所有结论写入 docs/assumptions.md，带状态标签 [已证实-来源] / [代码暂定] / [待Windows实测] / [待语料核验] / [未来研究]；
  - 每个信号在 docs/capability-matrix.md 标注证据等级；
  - 经济数值只存在于版本化规则文件（带 sources/verifiedAt/status），代码零魔法数字；
  - 实时链路与离线真值分离：估算器不消费 demo 数据，demo-oracle 不进入实时路径；
  - 原始 GSI payload 脱敏（去 auth）后 NDJSON 落盘，默认 local-first，不上传。
- 后果：任何"精度/延迟结论"必须在 Windows 实验（docs/experiments/c4-latency.md）产出数据后才可写入文档。
