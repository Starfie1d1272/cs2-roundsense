# 实验协议：经济规则核验（economy-validation）

> 目标：用 demo 语料（v3 ZIP 的 `player-economies.json`）经验核验版本化规则
> `economy-advisor/rules/cs2-competitive-2026-08.json` 中的数值（C1-C10）。
> 状态：**语料路径待用户提供**（本机未找到，见 E3）。

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

## 2. 分析步骤（语料路径确认后执行）

1. `experiments/economy-ledger/` 建立批处理脚本：
   - 输入：语料目录（ZIP 列表，路径参数化，不硬编码）；
   - 对每场：`demo-oracle` 加载 → `economyTruth()` + `teamLossStreakPerRound()` →
     计算每队每回合的 `expectedStartMoney = prevStartMoney − prevSpent + reward(outcome)`；
   - 汇总：实际 vs 预测的残差分布，按规则项分组输出。
2. 残差显著非零的规则项 → 更新规则文件（新 ruleSetId + 注明依据），不改代码。
3. 输出：`experiments/economy-ledger/output/validation-report.md` + 每项 `{rule, samples, mean_error, p95_error, verdict}`。

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
