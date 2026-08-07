# 购买规划器（planPurchases）能力缺口审计

> 审计日期：2026-08-08
> 审计对象：`packages/economy-advisor/src/advisor.ts`（`planPurchases` / `resultingLoadout` / `fulfillsLoadoutGoal` / `armorIncrementalUnit` / `BUNDLES` / `resolveItems`）、`rules.ts`（`ITEM_TO_WEAPON` / `weaponIdToItem` / `price`）、`types.ts`（`InventoryState`）
> 价格真值：`rules/cs2-competitive-2026-08.json`（非武器价格）+ `rules/weapons.v2026-08-06.json`（武器表，GameTracking-CS2 `2e606a0b` pinned）
> 结论分级：**SUPPORTED** = 规划器可按购买项完整规划（含 bundle 提供、inventory 感知、目标满足语义）；**PARTIAL** = 部分能力存在（价格/识别/满足其一），但购买规划或产品入口缺失；**MISSING** = 规划器完全不处理。

## 1. 机制速览（先讲清楚规划器怎么工作）

- `planPurchases(inventory, targetItems, rules)`（advisor.ts:126）：对每个目标 item 逐项消费——已持有则不计购买（inventory-aware incremental），未持有则 `add(item)` 记入 purchases；`totalCost` = 本次实际需花（增量），`targetCost` = 空库存下的完整目标价值。
- 满足语义是**族级**的：`RIFLE_FAMILY`（advisor.ts:16）= `["ak47","m4a4","m4a1s","galil","famas"]`，`SMG_FAMILY`（:17）= 全部 7 把 SMG。当前持有任意族内武器即满足对应目标（`consume` :139-147）。
- `GRENADES`（:18）= `["smoke","flash","he","molotov","incendiary"]`，手雷按**多重集**扣减（`ownedGrenades` 计数减法，:135-136/:158-162）。
- `resultingLoadout`（:45-64）把 purchases 应用回 inventory 得到购买后 loadout；**goal fulfillment 只看这个 loadout**（`fulfillsLoadoutGoal` :71-92），不看购买清单本身。
- 未知 item（不落入任何分支，:164 注释 "unknown target item → no guessing"）：**静默跳过——不买、不计成本**。这是后面多个 MISSING 的共同根因。
- `resolveItems`（:221-228）只做两处 side 解析：`ak47` → `rifleFor(side)`（T→ak47 / CT→m4a4，:7-9）、`mac10` → `smgFor(side)`（T→mac10 / CT→mp9，:11-13）。

## 2. 总览表

| 购买项 | 价格（武器表/rules） | 族满足 | 购买规划 | bundle 提供 | 分级 |
|---|---|---|---|---|---|
| ak47 | $2700 | ✅ 步枪族 | ✅ | ✅（T 侧解析） | **SUPPORTED** |
| m4a4 | $2900 | ✅ 步枪族 | ✅ | ✅（CT 侧解析） | **SUPPORTED** |
| m4a1s | $2900 | ✅ 步枪族 | ❌（无 bundle 引用） | ❌ | **PARTIAL** |
| galil | $1800 | ✅ 步枪族 | ❌ | ❌ | **PARTIAL** |
| famas | $1950 | ✅ 步枪族 | ❌ | ❌ | **PARTIAL** |
| sg553 | $3000 | ❌ 不在族内 | ❌ | ❌ | **MISSING** |
| aug | $3300 | ❌ 不在族内 | ❌ | ❌ | **MISSING** |
| ssg08 | $1700 | ❌（sniper） | ❌ | ❌ | **MISSING** |
| scar20 | $5000 | ❌（sniper） | ❌ | ❌ | **MISSING** |
| g3sg1 | $5000 | ❌（sniper） | ❌ | ❌ | **MISSING** |
| mac10 | $1050 | ✅ SMG 族 | ✅ | ✅（T 侧解析） | **SUPPORTED** |
| mp9 | $1250 | ✅ SMG 族 | ✅ | ✅（CT 侧解析） | **SUPPORTED** |
| mp7 / mp5sd | $1400 / $1400 | ✅ SMG 族 | ❌ | ❌ | **PARTIAL** |
| ump45 | $1200 | ✅ SMG 族 | ❌ | ❌ | **PARTIAL** |
| p90 | $2350 | ✅ SMG 族 | ❌ | ❌ | **PARTIAL** |
| bizon | $1300 | ✅ SMG 族 | ❌ | ❌ | **PARTIAL** |
| awp | $4750 | ✅ 精确匹配 | ✅ | ✅（awp-* bundle） | **SUPPORTED** |
| deagle | $700 | ✅ 精确匹配 secondary | ✅ | ✅（force-deagle） | **SUPPORTED** |
| tec9 / fiveseven | $500 / $500 | 仅 secondary 识别 | ❌（consume 无分支） | ❌ | **PARTIAL** |
| p250 | $300 | 仅 secondary 识别 | ❌ | ❌ | **PARTIAL** |
| cz75 | $500 | 仅 secondary 识别 | ❌ | ❌ | **PARTIAL** |
| dual | $300 | 仅 secondary 识别 | ❌ | ❌ | **PARTIAL** |
| revolver | $600 | 仅 secondary 识别 | ❌ | ❌ | **PARTIAL** |
| kevlar | $650 | ✅ armor>0 即满足 | ✅ | ✅ | **SUPPORTED** |
| kevlar_helmet（升级 $350） | $1000 | ✅ armor>0 && helmet | ✅（含增量价） | ✅ | **SUPPORTED** |
| defuse_kit | $400 | `hasDefuseKit` 已建模（types.ts:18） | ❌（consume 无分支） | ❌ | **MISSING** |
| smoke | $300 | ✅ 多重集 | ✅ | ✅ | **SUPPORTED** |
| flash（×2） | $200 | ✅ 多重集（×2 两个条目） | ✅ | ✅（×1） | **SUPPORTED**（见 §4.4 max2 缺口） |
| he | $300 | ✅ 多重集 | ✅ | ✅（rifle-util-full / max-full） | **SUPPORTED** |
| molotov | $400 | ✅ 多重集 | ✅（引擎层） | ❌ 无 bundle | **PARTIAL** |
| incendiary | $500 | ✅ 多重集 | ✅（引擎层） | ❌ 无 bundle | **PARTIAL** |

## 3. 逐项明细

### 3.1 步枪

- **ak47 / m4a4：SUPPORTED**。bundle 模板统一写 `ak47`（BUNDLES :189-218），`resolveItems` 按 side 解析成 ak47（T）或 m4a4（CT）。注意：CT 侧永远推荐 m4a4，**没有 m4a1s 偏好机制**（见下）。
- **m4a1s：PARTIAL**。在 `RIFLE_FAMILY` 内（已持有 m4a1s 可满足步枪目标），但任何 bundle 都不会把它作为购买目标；`rifleFor`（:7-9）硬编码 m4a4。
- **galil / famas：PARTIAL**。同样只进族满足、不进购买规划。galil（T-only）与 famas（CT-only）的 side 归属未建模（见 §4.1）。
- **sg553 / aug：MISSING —— 最值得修的真实缺口**。两把枪在武器表中 class 均为 `"rifle"`（`weapons.v2026-08-06.json`：`weapon_sg556` / `weapon_aug` → rifle），但 advisor 的 `RIFLE_FAMILY`（:16）**手工清单不含它们**。后果是产品语义 bug：T 玩家上一回合买了 SG553 并存活，`inventory.primary === "sg553"` → `hasRifle === false`（:132）→ 规划器会**再推荐买一把 AK47**。已持有的步枪不算步枪，这是 goal fulfillment 的假阴性。`RIFLE_FAMILY` 与武器表 class 的漂移风险同样适用于后续任何新武器——族定义应改为从 `rules.ts` 武器表 class 派生（参考分析管线"禁止手写 RIFLES/SMGS 集合"的纪律），而不是 advisor 里再抄一份。
- **ssg08 / scar20 / g3sg1：MISSING**。武器表 class 为 `"sniper"`（非 `"awp"`），advisor 无任何 sniper 分支；ssg08 手持也不会满足任何目标（不会破坏什么，但也永远不被认可）；scar20（CT-only）/ g3sg1（T-only）无购买规划。AWP 是唯一的狙类支持。

### 3.2 SMG

- **mac10 / mp9：SUPPORTED**（bundle `half-smg`，side 解析）。
- **mp7 / mp5sd / ump45 / p90 / bizon：PARTIAL**。全部在 `SMG_FAMILY`（:17，7 把全含），已持有可满足半起目标，但从不作为购买目标。武器表 killAward 差异（p90=300，其余 SMG=600）不影响购买规划，只影响投影（投影走 `killReward` 武器表，正确）。

### 3.3 AWP

- **SUPPORTED**。精确匹配（`inventory.primary === "awp"` 才满足，:146），`fulfillsLoadoutGoal("awp")` = primary awp && armor>0（:75，甲是 goal 成本的一部分，与 `goalTargetCost("awp") = 4750 + 650` 对齐）；bundle `awp-helmet` / `awp-kevlar` / `rifle-bridge` / `save` 完整。awp 不可负担时推荐降级到 save 的逻辑在 `recommend`（:322-329）。

### 3.4 Paid pistols（deagle 之外）

- **deagle：SUPPORTED**（force-deagle bundle、secondary 精确匹配、`resultingLoadout` 专门处理 :55）。
- **tec9 / fiveseven / p250 / cz75 / dual / revolver：PARTIAL**。价格全部存在（武器表：tec9 500 / fiveseven 500 / p250 300 / cz75a 500 / elite 300 / revolver 600），`ITEM_TO_WEAPON`（rules.ts:123-133）全部映射，`inventoryFrom`（engine.ts:96-98）会把 Pistol 类型武器正确识别为 secondary——但 `planPurchases.consume` **没有这些 item 的分支**（:138-165 只处理 rifle/smg/awp/deagle/kevlar/kevlar_helmet/grenade），`resultingLoadout` 同样不处理（:53-62 只认 deagle）。若未来 bundle 加入 p250，规划器会静默跳过它：不买、不计成本，且 `resultingLoadout` 不会更新 secondary——双重静默失败。补支持需要同时改 consume 与 resultingLoadout。

### 3.5 Armor upgrade（kevlar → kevlar_helmet，$350 增量）

- **SUPPORTED，且语义精确**。`armorIncrementalUnit`（:99-104）：仅当 `armor === 100 && !hasHelmet` 时按 `price(kevlar_helmet) − price(kevlar) = $350` 计增量；其余情况（无甲 / 残甲）按全价 $1000。该 $350 案例是 Windows build 14174 runtime 实测（armor=100, helmet=false → vesthelm → money delta −350，见 `docs/runtime-checks.md` §3），契约明确**不得外推**到残甲。
- 语义细节：`consume("kevlar")` 由 `armor > 0` 满足（:152-153，"具有护甲"而非"满甲回满"）；`consume("kevlar_helmet")` 由 `armor > 0 && hasHelmet` 满足（:156）。残甲（如 armor=35）持有者不会被规划 kevlar 回满——与游戏内"已有甲不能再买 kevlar"一致，正确。`resultingLoadout` 买甲后设 `armor = 100`（:57）——注意这是"购买后满甲"的合理模型，因为游戏内买甲即回满。

### 3.6 defusekit

- **MISSING（产品层完全缺席）**。`InventoryState.hasDefuseKit`（types.ts:18）与 GSI 侧 `player.state.defusekit` 读取（engine.ts:109）都已就绪，价格 `defuse_kit: 400` 在 rules JSON 中——但 `planPurchases.consume` 无 defuse_kit 分支、`BUNDLES` 无任何 kit 条目、`fulfillsLoadoutGoal` 不含 kit。CT 玩家永远拿不到"补拆弹器"建议。$400 是 CT 半起/eco 局的高频决策项，属 P0 级产品缺口。

### 3.7 smoke / flash / HE

- **smoke / flash：SUPPORTED**（rifle-util / max-* / force-deagle 等 bundle 全覆盖；多重集扣减正确处理"已持有 1 颗烟只补 1 颗"）。
- **HE：SUPPORTED**（`rifle-util-full`、`max-full`）。
- **flash ×2：见 §4.4 的 max2 缺口**——多重集本身支持 ×2（`quantity` 字段与 `resultingLoadout` 的按量 push :60 均正确），GSI 侧 `ammo_reserve=2` 也会展开成两个条目（engine.ts:87-89），但**没有任何上限校验**。

### 3.8 molotov / incendiary

- **PARTIAL**。`isGrenade` 包含二者（:18）、价格存在（400/500）、`planPurchases` 多重集与 `resultingLoadout` 都会正确处理（若作为 target 传入）——但**没有任何 bundle 引用它们**，且 **T/CT side 归属未建模**（molotov T-only、incendiary CT-only，与 §4.1 同类问题）。产品永不主动建议燃烧弹，仅引擎层可用。

## 4. 横切检查

### 4.1 Side legality（T 不能买 m4a4 等）

**PARTIAL（靠模板解析隐性保证，无规则层强制）。**

- 正常工作流中 side 合法性只由 `resolveItems`（:221-228）保证：模板里的 `ak47`/`mac10` 是 side-agnostic 占位符，按 side 解析成合法武器。因此 shipped bundles 永远不可能给 T 推 m4a4 或给 CT 推 ak47/galil。
- 但 `planPurchases` **没有 side 参数、没有合法性表**：任何调用方直接传 `m4a4` target + T side 都会照常计价（`price(rules, "m4a4")` 存在）。合法性是约定而非不变量。
- 武器级 side 归属完全未建模：galil / sg553 / g3sg1（T-only）、famas / aug / scar20（CT-only）在族/规划层均无区分；`RIFLE_FAMILY` 混装双方步枪意味着"CT 手持 galil（捡的）满足步枪目标"成立——这作为 loadout 语义是合理的（目标满足看持有，不看购买渠道），但**作为购买规划语义是危险的**：若未来某 bundle 把 galil 作为 target，CT 会被规划去买 T-only 武器。
- 建议：把 side→可购武器表做成 rules 层数据（或复用武器表 class + side 字段），在 `planPurchases` 或 `resolveItems` 加硬断言。

### 4.2 Inventory-aware incremental cost

**SUPPORTED。** `totalCost` 只计缺项（`consume` 先查持有再 `add`），`targetCost` 计全值，`armorIncrementalUnit` 处理甲升级增量——"已持有装备按 inventory 快照参与本次购买差额计算"（assumptions :287）。`recommend` 里"已持有步枪只补甲仍满足 rifle_armor"的语义由 `fulfillsLoadoutGoal` 对 resulting loadout 的判断保证（:265）。

### 4.3 Grenade multiset

**SUPPORTED。** `InventoryState.grenades: ItemId[]` 是多重集（types.ts:20 注释 "flash ×2 → two entries"）；`planPurchases` 用 `ownedGrenades` 计数做减法（:135-136/:158-162），`resultingLoadout` 按 quantity push（:59-61），`fulfillsLoadoutGoal` 计数 smoke/flash（:81-87）。无 set 去重错误。

### 4.4 Flash max 2

**MISSING（上限约束不存在）。** 多重集支持 ×2，但全链路无 "flash ≤ 2 / 其他手雷 ≤ 1" 的校验：target 传 `{item:"flash", quantity:3}` 会照买 3 颗（游戏内不可行，GSI `ammo_reserve` 也到不了 3）。当前 bundles 最高只用到 flash ×1，实际不会触发，但属于"靠模板自觉"而非规则强制——与 §4.1 同类问题。建议在 `planPurchases` 入口对 grenade quantity 做上限断言（flash 2，其余 1）。

### 4.5 Armor 语义（armor:number 0-100）

**SUPPORTED。** `InventoryState.armor` 是数值（types.ts:14-16，注释明确 "numeric; the boolean is derived as armor > 0, never stored"）；`planPurchases` 局部派生 `hasArmor = inventory.armor > 0`（:131），不落库；`armorIncrementalUnit` 的 $350 分支严格限定 `armor === 100 && !hasHelmet`（:100）。与 `docs/runtime-checks.md` §3 的实测契约逐字对齐。唯一提醒：`resultingLoadout` 把任何 kevlar/kevlar_helmet 购买都写成 `armor = 100`（:57）——对"购买即回满"是正确模型，但若未来要表达"残甲不补甲"的节省方案，不要在 resultingLoadout 里做，那里只反映购买结果。

## 5. 结论与建议

| 优先级 | 缺口 | 建议 |
|---|---|---|
| P0 | sg553 / aug 不算步枪 → 持有者被重复推荐买 AK（产品语义 bug） | `RIFLE_FAMILY` 改为从武器表 class 派生（含 sg556/aug），或至少把两把加入族清单；补 `fulfillsLoadoutGoal` 单测 |
| P0 | defusekit 完全无规划（CT 高价值 $400 决策项） | `consume` 加 defuse_kit 分支（`hasDefuseKit` 感知）、bundle 加 CT 侧 kit 选项、`goalTargetCost` 视需要纳入 |
| P1 | 闪光弹上限、手雷数量无规则强制 | `planPurchases` 入口断言 flash ≤ 2 / 其余 ≤ 1 |
| P1 | side legality 无硬保证（模板约定） | rules 层加 side→可购武器表，`planPurchases`/`resolveItems` 硬断言 |
| P1 | molotov / incendiary 有引擎无入口；T/CT 归属缺失 | bundle 增加燃烧弹选项（含 side 解析），或显式标记暂不提供 |
| P2 | galil/famas/m4a1s/其他 SMG/paid pistols 只能满足不能购买 | 按产品路线扩展 bundle（p250 强起、m4a1s 偏好等）；扩展时**必须同时改 consume 与 resultingLoadout**（当前 paid pistol 分支缺失会静默失败） |
| P2 | sniper（ssg08/scar20/g3sg1）无任何支持 | 如产品要覆盖，先定 goal 语义（ssg08 是否算 "awp" 目标的廉价替代？）再实现 |

> 审计备注：`advisor.test.ts` 已覆盖的路径（ak47/m4a4/deagle/kevlar/kevlar_helmet/smoke/flash/he/awp、incremental cost、armor upgrade $350）均为 SUPPORTED 项；本审计未发现上述 SUPPORTED 项的行为错误，缺口集中在未覆盖武器与横切约束。
