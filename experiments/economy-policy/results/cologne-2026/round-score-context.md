# Round/Score Context

- baseline (side,lr,money): 0.5398 bits
- +round stage (//3): 0.3563 bits (Δ 0.184)
- +score diff (clamped ±6): 0.3262 bits (Δ 0.214)

解读（两层证据）:
- in-sample conditional entropy 有明显下降（Δ 0.18–0.21 bits）；
- 但 grouped OOF feature ladder 中 B5 +roundstage 对 format-state log loss 无改善（B4 0.8456 → B5 0.8619 bits，见 feature-value.csv）。
因此当前没有 held-out 证据支持为 production 增加 round/score complexity。