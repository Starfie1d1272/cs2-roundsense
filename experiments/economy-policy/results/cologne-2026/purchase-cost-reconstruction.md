# Purchase-Cost Reconstruction

STRICT rows with corrected retained (exact/family usable): 3961

implied delta cost (retained->resulting, canonical prices) vs moneySpent:

- exact match (|diff|<=100): 20.2% (n=801)
- explainable (<=600): 48.7% (n=1930)
- unresolved (>600): 31.1% (n=1230)

## unresolved 示例（diff > $600）

- de_dust2 r4 dgt: spent $700 retained=AK-47 resulting=AK-47 diff=$700
- de_dust2 r5 HUASOPEEK: spent $1100 retained=Galil AR resulting=M4A4 diff=$1100
- de_dust2 r9 meyern: spent $700 retained=AWP resulting=AWP diff=$700
- de_dust2 r16 KSCERATO: spent $700 retained=MP7 resulting=AK-47 diff=$700
- de_dust2 r20 yuurih: spent $800 retained=AK-47 resulting=Galil AR diff=$800
- de_mirage r4 luchov: spent $1100 retained=M4A4 resulting=M4A4 diff=$800
- de_mirage r7 luchov: spent $800 retained=M4A4 resulting=M4A4 diff=$800
- de_mirage r9 max: spent $800 retained=M4A4 resulting=M4A4 diff=$800

## 可重建范围
- retained→resulting primary 差价 ✓；armor/helmet boolean delta ✓（无数值，按全价）
- grenade delta ✓（retainedGrenades vs grenades multiset）
- kit delta ✓（retainedKit）
- 不可重建：回合中 drop/购买顺序、armor 受损（$350 升级 vs $1000 全价无法区分）