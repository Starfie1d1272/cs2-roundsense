# Purchase-Cost Reconstruction

STRICT rows with corrected retained: 3961

implied delta cost (retained->resulting, canonical display-name prices) vs moneySpent:

- exact match (|diff|<=100): 18.4% (n=729)
- explainable (<=600): 42.8% (n=1694)
- unresolved (>600): 38.8% (n=1538)

## unresolved 示例（diff > $600）

- de_dust2 r4 dgt: spent $700 retained=AK-47 resulting=AK-47 diff=$700
- de_dust2 r5 HUASOPEEK: spent $1100 retained=Galil AR resulting=M4A4 diff=$-1800
- de_dust2 r5 luchov: spent $500 retained=Galil AR resulting=M4A1-S diff=$-2400
- de_dust2 r9 meyern: spent $700 retained=AWP resulting=AWP diff=$700
- de_dust2 r16 KSCERATO: spent $700 retained=MP7 resulting=AK-47 diff=$-2000
- de_dust2 r20 yuurih: spent $800 retained=AK-47 resulting=Galil AR diff=$-1000
- de_mirage r3 meyern: spent $1850 retained=FAMAS resulting=Galil AR diff=$-1800
- de_mirage r4 luchov: spent $1100 retained=M4A4 resulting=M4A4 diff=$800

## 已知不可重建项（不猜测）
- armor damaged-state（$350 升级 vs $1000 全价无法区分）
- drop chronology / 回合中武器转移顺序
- 同一商品重复购买（如买两把同价枪再换）