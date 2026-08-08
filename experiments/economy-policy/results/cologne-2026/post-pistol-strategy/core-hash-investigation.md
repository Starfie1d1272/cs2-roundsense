# Core Hash 不一致调查（core-hash-investigation）

状态：2026-08-08，branch `research/post-pistol-strategy`（独立审计任务 §7）。

## 结论摘要

- 旧 `results/cologne-2026/_core-sha256.json` 记录的 6 个 SHA-256 与
  `/tmp/roundsense-economy-analysis-final/`（生成时的临时目录）中 6 个同名文件
  **6/6 完全一致**。
- `/tmp` 目录文件与 0875db9 提交的仓库文件**内容逐行完全相同**（全部 4 个抽查
  文件 0 行差异），唯一差别是**行尾符**：`/tmp` 为 CRLF（`\r\n`），仓库 blob
  为 LF（`\n`）；将两边行尾归一化后字节完全一致。
- 判定：**选项 B（transformed/temporary representation）**——旧 metadata 哈希
  的是"同一内容的行尾转换表示"（/tmp 生成目录的 CRLF 状态），不是仓库中
  实际提交的 LF 状态。生成逻辑本身没有错（排除选项 C）。
- 确切的"谁在何时把 CRLF 版本拷入 /tmp、`_core-sha256.json` 由哪条命令生成"
  无法从仓库内证据完全追溯（仓库中不存在写出该 JSON 的代码，只有读取它的
  audit_research_evidence.py）——这部分标注 **UNKNOWN**。

## 证据链

1. 哈希对比（`_core-sha256.json` vs /tmp vs 0875db9 blob vs 工作树）：

   - 6/6 文件：`old_json == tmp_dir`（旧 metadata = /tmp 状态）
   - 6/6 文件：`old_json != repo_blob`（旧 metadata ≠ 提交内容）
   - 6/6 文件：`repo_blob == working_tree`（新基线，可复现验证）

2. 内容对比（逐行，UTF-8 解码后）：

   - economy-reference-surface.csv：21508 行，0 行差异
   - primary-distribution.csv：45071 行，0 行差异
   - conditional-loadouts.csv：65939 行，0 行差异
   - retained-coverage.csv：111 行，0 行差异

3. 字节层：

   - `/tmp/.../economy-reference-surface.csv`：21508 个 CRLF，0 个孤立 LF
   - `results/cologne-2026/economy-reference-surface.csv`：0 个 CRLF，21508 个 LF
   - `replace(b"\r\n", b"\n")` 后两者字节完全相等

4. `_meta.json`（排除分区、grenade 分布、weapon family 等元数据）两边完全一致，
   说明同一语料、同一 pipeline 状态。

## 术语说明

`frozen-core-sha256-0875db9.json` 中的字段名 `repo_blob_sha256_0875db9` 是
**内容 SHA-256**（对 `git show <rev>:<path>` 输出的原始字节直接做 SHA-256），
不是 Git 对象 ID（Git blob ID 是对象存储框架下的 SHA-1/SHA-256，含对象头，
与内容哈希不同）。字段名易误导，但取值含义已在 pp1 生成代码中明确
（`sha256_file` / `blob_sha256` 均为 `hashlib.sha256(bytes)`）。

## 对研究的影响

- 6 个冻结 core artifact 的实际内容在 0875db9 与当前工作树之间**未被修改**
  （blob == worktree，6/6）。
- 旧 `_core-sha256.json` 的差异不构成冻结失效：它只是哈希了同一数据的另一种
  字节表示（CRLF）。
- 本任务**不修改**旧 `_core-sha256.json`；冻结验证一律使用
  `metadata/frozen-core-sha256-0875db9.json` 基线（内容 SHA-256）。
- pp1–pp7 数字均不受影响。
