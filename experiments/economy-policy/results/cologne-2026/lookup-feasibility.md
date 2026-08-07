# Lookup Feasibility

retained=none states: 3210 (T/CT x 5 lr x 321 money)

retained family levels (none/rifle/smg/awp/other): 16050 states
exact-retained supported (8 weapons x ~5 lr x side x money where supported): 显著更大但受支持限制

若每 state 存 top3 loadouts + spend target + confidence：
- JSON 每行 ~250B → 16050 states ~ 4.0 MB
- binary (fixed-width) 每行 ~64B → ~ 1.0 MB
- lookup: 预计算 dict key (side,lr,money//50,retained) -> O(1) hash
- 插值：$50 grid 覆盖全部实际可达现金（reachable-money audit），无插值必要
