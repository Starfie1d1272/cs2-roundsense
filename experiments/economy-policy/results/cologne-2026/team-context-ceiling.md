# Team-Context Ceiling

format-state conditional entropy (retained=none):
- individual context (side, lr, money//50): 0.5398 bits
- + team oracle (total start //2000, rifle count, AWP count): 0.2440 bits
- relative reduction: 54.8%

注：上述为全样本条件熵（oracle 上限，非 held-out）；team 特征含本回合团队聚合（决策时 GSI 不可见），
普通 GSI 看不到队友经济时的信息损失 ≈ 上述差值（oracle 上限）。
team-round-patterns.csv 含全量 team-round 聚合（含 drop 行——仅描述性）。