# Team-Context Ceiling

format-state conditional entropy (retained=none):
- individual context (side, lr, money//50): 0.5398 bits
- + team oracle (total start //2000, rifle count, AWP count): 0.2440 bits
- relative reduction: 54.8%

注：上述为全样本条件熵（oracle 上限，非 held-out）；team 特征含本回合团队聚合（决策时 GSI 不可见），
注：team oracle 特征含本回合 resulting rifle/AWP counts（TEAM 聚合在回合结束后才
完整可知）——这是 post-decision oracle ceiling，不是'缺少 teammate economy 导致
X% 信息损失'的因果表述。全样本条件熵（非 held-out）。
team-round-patterns.csv 含全量 team-round 聚合（含 drop 行——仅描述性）。