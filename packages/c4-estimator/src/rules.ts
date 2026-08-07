/**
 * Versioned C4 fuse rules.
 *
 * B1 [corpus-observed]: demo-event semantics — planted→exploded tick delta
 *   = 2624 @64tick = 41.000s (2026-08-06 corpus, 223/223 samples, verified
 *   via the integer-ledger validator). If demoparser2 events carry a
 *   consistent offset (plant animation start vs completion), the real-game
 *   fuse could still be 40s — runtime-unverified, pending the Windows
 *   controlled test (docs/experiments/c4-latency.md).
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
  source: "cs2-demo-format v3 bombs.json: planted→exploded tick delta = 2624 @64tick = 41.000s (2026-08-06 corpus, 223/223 samples, validate-corpus.ts)",
  status: "corpus-verified",
  note: "demo tick 语义（plant 动画偏移/exploded 事件时刻）待 Windows 实测确认；若事件偏移 1s，真实引信可能为 40s",
};
