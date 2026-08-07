# 独立验证语料可用性（independent validation corpus）

> 审计日期：2026-08-08
> 目标：在 Cologne 2026 冻结语料之外，找到**格式兼容（v3 ZIP 或 player-economies 格式）的完整职业赛事 frozen corpus**，用于独立验证（规则/策略回放不依赖科隆数据）。
> 结论先行：**NO INDEPENDENT CORPUS AVAILABLE** —— 本机不存在除 IEM Cologne Major 2026 之外的任何"完整赛事"级冻结职业语料。

## 1. 检查过的路径（全部列出）

### 1.1 `~/GitHub/cs2-demo-analysis-kit/fixtures/`

| 路径 | 内容 | 判定 |
|---|---|---|
| `_bench/map-control-reference/events/` | `iem-cologne-major-2026-{stage1,stage2,stage3,playoff}.zip`（4 个赛事包，各含 `maps/*.zip` v3 单图包）+ `manifest.json`（带 sha256） | **Cologne，按任务排除** |
| `_bench/map-control-reference/maps/` | `p-r1-qf1-m1-de_dust2.zip` 等 playoff 单图 v3 包 | **Cologne 的展开副本，排除** |
| `events/cologne-major-2026/` | `spec.json` + `event-package.json` + `data/`（赛事制作中间产物） | **Cologne，排除** |
| `input/` | 13 个样本：`sample-2026-02-09_*`（Vitality/FURIA 3 图）、`sample-2026-05-17_*`（Spirit/Falcons 3 图）、`sample-pro-finals-2026.zip`、`cologne-major-2026-stage3-smoke-de_nuke.zip`（科隆单图）、`cs2dak-sanitized-de_ancient.zip`、`cohort/`（3 场） | 单场/跨赛事散样本，**非完整赛事** |
| `output/` | 空目录（生成物 gitignored，本地无产物） | 无 |
| `baselines/` | `rr-v2-pro-baseline-v0.json`（评分基线，非 demo 语料） | 不适用 |
| `demos/` | 不存在（AGENTS.md 描述的 `demos/pro/`、`demos/nju-rivals-2026/` 本地未检出） | 无 |

### 1.2 `~/GitHub/cs2-roundsense/fixtures/`

| 路径 | 内容 | 判定 |
|---|---|---|
| `demo-format/tiny-v3.zip` | 极小合成 v3 样本（validator smoke） | 非赛事 |
| `gsi/*.ndjson` | GSI 录制（restart-map / plant-defuse / pause 等 7 个场景） | GSI 格式，非 demo 语料 |
| `csweaponnameid/knife-ids.txt` | 武器枚举 fixture（2e606a0b 提取） | 非语料 |

### 1.3 相邻仓库（"或类似目录"）

| 路径 | 内容 | 判定 |
|---|---|---|
| `~/GitHub/rival-rating/fixtures/pro-20260611/zips/` | **52 个职业单场 v3 ZIP**（2026-01~06，跨多个赛事：PARIVISION/FURIA/MOUZ/Vitality/Spirit/Falcons/Navi 等；抽查确认含 `manifest.json` + `player-economies.json` 等 v3 必需文件；其中 5 个为 v2 会被 `parseDemoPackage` 严格拒绝） | **格式兼容 ✅，但非完整赛事 ❌**（跨赛事散场，无 event-package/赛事清单，覆盖 1-6 月多站比赛） |
| `~/GitHub/cs2-demo-format/fixtures/` | `v3-mid/`（v3 golden fixture，de_anubis 21 回合 1 场）+ `de_ancient-2026-05-17/`（legacy v1） | 单场样本，非赛事 |
| `~/GitHub/demoparser/` | 示例代码目录，无语料 | 无 |
| `~/GitHub/*` 全盘搜索 `event-package.json` | 仅命中 0 个（`find ~/GitHub -maxdepth 4`；科隆包名不含该文件，是 manifest.json） | 无其他赛事包 |

## 2. 结论与依据

**NO INDEPENDENT CORPUS AVAILABLE。**

- 本机所有**完整赛事级冻结语料 = 只有 IEM Cologne Major 2026**（4 个 stage/playoff 事件包，202 场，`_bench/map-control-reference/events/` 本地副本带 sha256 manifest）。
- 其余职业 demo 素材全部是**散场**：rival-rating 52 场（跨 1-6 月多赛事）与 DAK input 13 个样本，均无赛事完整性（无 event-package、无同赛事全赛程覆盖、无 sha256 frozen manifest）。
- 因此当前无法做"非科隆独立语料"的规则/策略交叉验证；现有验证（整数账本、科隆 policy audit、Cologne-only 基线）全部依赖同一份科隆数据，存在**单一语料偏差风险**。

## 3. 若需要独立验证，可选路径（按成本排序）

1. **rival-rating 52 场散场子集**（成本最低）：格式兼容（47 个 v3 + 5 个 v2 需剔除），可做"非科隆跨赛事"的规则核验（L1 整数账本）——但**不是完整赛事**，只能缓解"单一赛事"偏差，不能提供赛事级策略面。
2. **新赛事录制/导出**：Windows 台式机已有受控实验与录制管线（GSI ndjson；`D:\GitHub\cs2-research\corpus` 59 场解包 v3 目录可作补充——远程 Windows 语料，SSH 192.168.144.2）；用 `cs2df export-batch` 把新赛事 .dem 批量导出为 v3 并打 event-package（DAK `pnpm event:export` / `events:build` 管线现成）。
3. **R2 桶 `cs2dak-assets`**：与科隆包同结构的其他赛事资产若已发布（`aws s3 ls --endpoint-url`，凭证在 DAK `.env`），可先查再决定是否拉取——本审计未做云侧检查（无凭证上下文），列为待查项。

> 备注：本审计只覆盖本机文件系统（含远程 Windows 语料路径的引用，未实连验证）；云端 R2 与其他机器上的语料不在本次结论范围内。
