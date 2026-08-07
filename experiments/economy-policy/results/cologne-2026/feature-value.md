# Feature Value — Armor / Helmet

deployable pre-decision armor/helmet 使用 retainedArmor/retainedHelmet（live GSI 可得，非 freeze-end 泄漏）。
grouped log loss（5-fold match-series）:

- +retained | format_state: 1.125 bits
- +retained | helmet: 0.8879 bits
- +retained | kit: 0.4335 bits
- +retained | smoke: 0.9342 bits
- +armor/helmet | format_state: 1.1646 bits
- +armor/helmet | helmet: 0.9188 bits
- +armor/helmet | kit: 0.46 bits
- +armor/helmet | smoke: 0.9874 bits

- format_state: Δ -0.0396 bits（+armor/helmet vs +retained）
- helmet: Δ -0.0309 bits（+armor/helmet vs +retained）
- kit: Δ -0.0265 bits（+armor/helmet vs +retained）
- smoke: Δ -0.0532 bits（+armor/helmet vs +retained）

结论：pre-decision armor/helmet 的增量信息存在但有限（Δ 见上）——
是否纳入 policy state 由人工决定；planner 的 inventory-aware 增量价格仍需要 armor 数值。