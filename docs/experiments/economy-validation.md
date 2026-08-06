# 实验协议：经济规则核验（economy-validation）

> 目标：用 demo 语料（v3 ZIP 的 `player-economies.json`）经验核验版本化规则
> `economy-advisor/rules/cs2-competitive-2026-08.json` 中的数值（C1-C10）。

## 0. 执行记录

- **第一轮（2026-08-06，已完成）**：55 场比赛 / 1122 回合 / 10425 样本
  （rival-rating/pro-20260611/zips 52 场 + cs2-demo-analysis-kit/fixtures/input 13 场中可解析的 3 场，
  比赛日期 2026-01-25 ~ 2026-06-06）。
  脚本：`experiments/economy-ledger/scripts/validate-economy.ts`。
  方法：`income(p,r) = startMoney(r) − startMoney(r−1) + moneySpent(r−1)`；
  OLS（击杀类别计数 + CT 团队击杀数 + 截距）+ 击杀修正后的分组均值。
  结果摘要（详见规则文件 `corpusValidation`）：
  - C4 引信 223/223 = 41.000s（corpus-verified）
  - 胜利奖励 3250/3500、连败表 1400~3400、手枪局失败 1900 → 全部证实
  - T 下包奖金 ≈ 430~690（修正后），fandom $600 合理、CS:GO $800 可排除
  - 击杀奖励（近期语料）pistol ≈300 / smg ≈600 / rifle ≈250-300 / awp ≈100-160
  - **CT 团队击杀奖励：语料 OLS ≈ 0（无 $50）**；用户报告 2026-08 现版本有 $50/击杀
    → 语料截止 2026-06-06 未覆盖，待新语料/Windows 实测
  - ⚠️ 异常：≤2026-03 语料手枪击杀 ≈$25（疑似早期语料导出质量问题或规则变更，待核实）

## 1. 可核验的规则项与数据来源

| 规则项 | 数据来源 | 方法 |
|---|---|---|
| 连败奖励表 [1400,1900,2400,2900,3400] (C2) | `player-economies.json.startMoney` + `rounds.json.winnerTeamKey` | 按队伍连败计数分组，取同队同 round 的 `startMoney − (上回合末剩余)` 分布 |
| 胜利奖励 $3250/$3500 (C1) | 同上 | 胜方下一回合 startMoney 差分 |
| 下包奖金 $600 vs $800 (C3) | T 方下包后失败的回合（bombs.json planted + rounds.json endReason） | 失败分支差分 |
| 击杀奖励表 (C4) | `kills.json`（killerIndex/weapon）+ `player-economies.json` | 击杀武器 → 类别 → 奖励回归 |
| CT 团队击杀奖励 = 0 (C5) | 同上 | 验证 CT 方击杀数与团队金钱无关联 |
| 价格表 (C7) | `player-economies.json.moneySpent` + 购买的装备/武器字段 | moneySpent 与价格之和交叉验证 |
| 首局规则 (C10) | round 1/14 数据 | pistol 轮失败奖金分布 |
| 上限 $16000 (C6) | startMoney 最大值 | 直方图截断 |

## 2. 分析步骤（第二轮：语料扩展与残差收敛）

1. 语料扩展：接入 300+ 场完整语料（若存在）或 2026-06 之后的比赛导出；
   `experiments/economy-ledger/scripts/validate-economy.ts` 已支持目录批量。
2. 待收敛项：
   - plantBonusT 修正后估计（当前 432/486，目标 ±50 内）；
   - CT 团队击杀奖励 $50（用户报告）——用 2026-06 之后的新导出验证；
   - 手枪击杀奖励早期异常（≤2026-03 ≈25 vs 近期 ≈300）；
   - 价格表 moneySpent 交叉验证（C7）。
3. 残差显著非零的规则项 → 更新规则文件（新 ruleSetId + 注明依据），不改代码。
4. 输出：`experiments/economy-ledger/output/validation-report.md` + 每项 `{rule, samples, mean_error, p95_error, verdict}`。

## 3. 与本轮代码的关系

- 规则文件 `status: "provisional"`；核验通过后升级为 `"verified"` 并更新 `verifiedAt`。
- advisor 输出始终携带 `rules.status`，消费者可见数值的可信度。
- 若语料显示 CS2 下包奖金确为 $600，则 C3 从 [待语料核验] 转 [已证实-语料]；
  若为 $800，则规则文件更新并同步 assumptions.md。

## 4. 推荐覆盖率实验（recommendation-coverage）

- 从语料重建每回合的真实输入（金钱、装备、结果），离线跑 `recommend()`；
- 统计：推荐方案被"下一回合实际购买"满足/背离的比例；`breaksGoal` 判定与
  真实下回合购买能力的吻合度；
- 目的：验证 advisor 的简化假设（0 击杀投影、存活保留等）在真实分布下的表现，
  为第二轮调整提供依据。不在本轮执行。
