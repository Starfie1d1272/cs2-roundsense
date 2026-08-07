# Loadout-Delta Coverage

## Schema check (STRICT sample row)

- retainedArmor: bool
- retainedGrenades: list
- retainedHelmet: bool
- retainedKit: bool
- retainedPrimary: NoneType
- retainedSecondary: NoneType
- survivedPrev: bool

可重建的 delta：retained（上一回合 freeze loadout）→ resulting（本回合 freeze loadout）的 exact 差异。
不可重建：retained armor 无数值（boolean retainedArmor 存在）、无购买顺序、无回合中 drop。