# experiments/recommendation-coverage

推荐覆盖率实验目录（见 `docs/experiments/economy-validation.md` §4）。

- 用语料重建每回合真实输入，离线跑 `recommend()`，统计推荐与真实购买行为的吻合度。
- 不在本轮执行；语料路径确认后开始。
