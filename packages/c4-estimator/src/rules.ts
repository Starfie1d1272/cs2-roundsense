/**
 * Versioned C4 fuse rules.
 *
 * B2 [已证实-语料]: 用户语料中 bomb_planted → bomb_exploded 事件 tick 差
 *   恒为 2624 ticks @64tick = 41.000s（55 场比赛 / 223 个样本，覆盖
 *   2026-01 ~ 2026-06，2026-08-06 通过 experiments/economy-ledger 核验）。
 *   注意：该值来自 demoparser2 事件 tick 语义，若 planted/exploded 事件存在
 *   一致偏移（如 plant 动画起始 vs 完成），实际游戏内引信仍可能为 40s —
 *   需 Windows 实测（游戏内计时）最终确认（B4）。
 * 数值只存在于 HERE，绝不硬编码进估算器。
 */
export interface C4FuseRules {
  ruleSetId: string;
  fuseMs: number;
  source: string;
  status: "code-tentative" | "corpus-preliminary" | "corpus-verified" | "windows-verified";
  note: string;
}

export const C4_FUSE_RULES: C4FuseRules = {
  ruleSetId: "cs2-c4-fuse-2026-08",
  fuseMs: 41_000,
  source: "cs2-demo-format v3 bombs.json: planted→exploded tick delta = 2624 @64tick = 41.000s (55 matches / 223 plants, 2026-01~06, validate-economy.ts, 2026-08-06)",
  status: "corpus-verified",
  note: "demo tick 语义（plant 动画偏移/exploded 事件时刻）待 Windows 实测确认；若事件偏移 1s，真实引信可能为 40s",
};
