# Tool Surface Decision Matrix

> 决策矩阵：哪些 MCP Tool 应该默认对 Agent 可见，哪些应该隐藏、合并或仅在特定模式下暴露。
>
> 基于 `TOOL_INVENTORY.md` 的完整盘点。Last updated: 2026-06-16.

---

## 决策框架

每个工具的最终 exposure 决策基于 5 个维度加权评估：

| 维度 | 权重 | 说明 |
|------|------|------|
| **Agent 价值** | 最高 | Agent 在日常编码中是否需要这个工具来完成任务？ |
| **核心路径** | 高 | 是否在 compression→memory 主价值链上？ |
| **安全性** | 高 | 误用风险有多高？不可逆操作权重大。 |
| **替代路径** | 中 | 是否有 CLI/其他工具可替代？如果 CLI 已覆盖，MCP exposure 可降低。 |
| **噪音成本** | 中 | 暴露此工具会增加多少 tool list 噪音？Agent 选择工具的认知负担。 |

### 决策矩阵符号

| 符号 | 含义 |
|------|------|
| ✅ **Surface** | 默认对 Agent 可见 |
| ⚠️ **Conditional** | 特定条件下可见（如 dev 模式、用户显式请求） |
| ❌ **Hide** | 默认隐藏，仅在 dev/test/internal 模式可用 |
| 🔀 **Merge** | 建议与另一个工具合并 |
| 🗑️ **Deprecate** | 建议未来版本移除或重构 |

---

## 17 工具决策矩阵

| # | Tool | Agent 价值 | 核心路径 | 安全性 | CLI 替代 | 噪音成本 | **决策** | 建议模式 |
|---|------|-----------|----------|--------|----------|----------|----------|----------|
| 1 | `current_scope` | ★★★★★ | ✅ | ✅ 只读 | 有 | 低 | ✅ Surface | agent |
| 2 | `compress_context` | ★★★★★ | ✅ | ✅ fail-open | 有 | 低 | ✅ Surface | agent |
| 3 | `retrieve_original` | ★★★★☆ | ✅ | ✅ 只读 | 有 | 低 | ✅ Surface | agent |
| 4 | `delete_original` | ★☆☆☆☆ | — | ⚠️ 不可逆 | 部分 | 中 | ❌ Hide | dev/test |
| 5 | `cleanup_originals` | ★☆☆☆☆ | — | ⚠️ 批量删除 | 有 | 中 | ❌ Hide | dev/test |
| 6 | `list_compressions` | ★★★☆☆ | ✅ | ✅ 只读 | 有 | 低 | ✅ Surface | agent |
| 7 | `remember_context` | ★★★★★ | ✅ | ✅ 可逆 | 有 | 低 | ✅ Surface | agent |
| 8 | `recall_context` | ★★★★★ | ✅ | ✅ 只读 | 有 | 低 | ✅ Surface | agent |
| 9 | `forget_context` | ★★★★☆ | ✅ | ⚠️ hard_delete | 有 | 低 | ✅ Surface | agent |
| 10 | `list_context` | ★★★☆☆ | ✅ | ✅ 只读 | 有 | 低 | ✅ Surface | agent |
| 11 | `analyze_context` | ★★★☆☆ | — | ✅ 无副作用 | — | 中 | ⚠️ Conditional | agent（需标注） |
| 12 | `list_failures` | ★☆☆☆☆ | — | ✅ 只读 | 有 | 高 | ❌ Hide | dev/internal |
| 13 | `failure_stats` | ★☆☆☆☆ | — | ✅ 只读 | 有 | 高 | ❌ Hide | dev/internal |
| 14 | `list_harness_flows` | ★☆☆☆☆ | — | ✅ 只读 | 有 | 高 | ❌ Hide | dev/test |
| 15 | `run_harness_flow` | ★☆☆☆☆ | — | ⚠️ 副作用 | 有 | 高 | ❌ Hide | dev/test |
| 16 | `get_harness_run` | ★☆☆☆☆ | — | ✅ 只读 | 有 | 高 | ❌ Hide | dev/test |
| 17 | `check_harness_flow` | ★☆☆☆☆ | — | ✅ 只读 | 有 | 高 | ❌ Hide | dev/test |

---

## 分类汇总

### ✅ Surface — 默认可见（9 个）

这些是 CodeContext MCP 的核心价值主张。Agent 在任何编码会话中都应能访问：

```
current_scope          ← scope 解析，所有操作的前置
compress_context       ← 压缩上下文（核心能力 #1）
retrieve_original      ← 恢复原文（compress 的配对）
list_compressions      ← 浏览压缩历史
remember_context       ← 保存记忆（核心能力 #2）
recall_context         ← 检索记忆（remember 的配对）
forget_context         ← 管理记忆生命周期
list_context           ← 审计浏览记忆
analyze_context        ← 决策辅助（附条件）
```

### ❌ Hide — 默认隐藏（7 个）

这些工具在开发/测试/CI 场景有价值，但对日常 Agent 使用是噪音甚至风险：

```
delete_original        ← 不可逆删除，Agent 不应主动调用
cleanup_originals      ← 批量维护操作
list_failures          ← 内部可观测性
failure_stats          ← 内部可观测性
list_harness_flows     ← Harness 开发工具
run_harness_flow       ← Harness 执行，有副作用
get_harness_run        ← Harness 结果查看
check_harness_flow     ← Harness 验证
```

### 🔀 合并建议（2 组）

| 合并方案 | 涉及工具 | 新工具名 | 优先级 |
|----------|----------|----------|--------|
| `delete_original` + `cleanup_originals` | #4, #5 | `manage_originals`（含 mode: delete_single / cleanup_expired） | 低 — 当前 API 清晰度 OK |
| `list_failures` + `failure_stats` | #12, #13 | `failure_dashboard`（含 mode: list / stats） | 低 — 可等 Failure Learning 系统成熟后再合并 |

### 🗑️ 潜在将来移除

| Tool | 理由 |
|------|------|
| `analyze_context` | 如果 Agent 足够智能可以自行判断何时压缩/记忆，analyze 就是多余的中间层。当前保留因为它是显式的 decision-support 工具。 |

---

## Surface 模式详解

### 模式 1: `agent` — 默认 Agent 可见（9 个工具）

**触发条件：** 所有 MCP Agent 会话。

**可见工具：**
```
current_scope, compress_context, retrieve_original, list_compressions,
remember_context, recall_context, forget_context, list_context, analyze_context
```

**设计理由：**
- 覆盖 compression + memory 完整闭环
- analyze_context 保留但需在 Agent system prompt 中标注 "SUGGESTIONS ONLY"
- forget_context 保留因为记忆清洁是核心设计原则

### 模式 2: `dev` — 开发者模式（+8 个工具 = 17 个全部）

**触发条件：** 开发者调试、运行测试、CI 环境。

**额外可见：**
```
delete_original, cleanup_originals,
list_failures, failure_stats,
list_harness_flows, run_harness_flow, get_harness_run, check_harness_flow
```

**设计理由：**
- 开发者需要完整的系统可见性
- Harness 工具在 CI 中用于验证 MCP 工具和 CLI 的正确性
- Failure 工具帮助调试压缩/召回问题

### 模式 3: `test` — 测试模式（与 dev 相同 17 个）

**触发条件：** Harness Flow 执行中。

与 dev 模式工具集相同，但通过 Harness 的 McpAdapter 注入调用（而非 Agent 直接调用）。

### 模式 4: `internal` — 内部模式（2 个工具）

**触发条件：** 系统自监控、自动清理 cron。

**仅可见：**
```
list_failures, failure_stats
```

---

## 工具混淆风险与缓解

| 风险 | 影响工具 | 缓解措施 |
|------|----------|----------|
| Agent 误以为 `analyze_context` 会自动执行操作 | `analyze_context` | ① description 中已标注 NOTE。② 建议 Agent system prompt 强调 "analyze_context ONLY returns suggestions"。③ 长期：重命名为 `suggest_context_actions`。 |
| Agent 在需要搜索时调用 `list_context`（或反之） | `recall_context`, `list_context` | ① 两个 description 已区分 "search" vs "browse"。② 建议 Agent system prompt 给出使用指南。 |
| Agent 误用 `forget_context` 的 `hard_delete` | `forget_context` | ① description 已标注不可逆。② 建议 `hard_delete` 增加确认参数 `confirmHardDelete: true`。 |
| Agent 被 Harness/Failure 工具噪音干扰 | `list_harness_flows`, `run_harness_flow`, `get_harness_run`, `check_harness_flow`, `list_failures`, `failure_stats` | ① 默认隐藏（Hide 决策）。② 仅在 dev/test 模式暴露。 |
| Agent 绕过 `current_scope` 直接调用其他工具 | 所有 scope-isolated 工具 | ① 当前实现中 scopeId 为必填参数（多数工具），天然强制。② `remember_context`, `recall_context`, `forget_context` 中 scopeId 可选（auto-resolve）——这降低了门槛但也降低了隔离保证。 |

---

## `run_context_flow` 缺口

任务规格要求 `run_context_flow` 作为默认 Agent 工具，但当前代码中**不存在此工具**。

**推测：** `run_context_flow` 可能是以下之一：
1. `run_harness_flow` 的别名（计划重命名）
2. 尚未实现的高层封装——自动串联 `current_scope → compress_context → remember_context → recall_context`
3. Full Context Flow（`fullContextFlow` manifest）的 MCP 入口

**建议：**
- 如果意图是 #2（高层封装），应实现为新的 MCP tool，自动执行完整的 context flow
- 如果意图是 #1（Harness Flow 别名），可在 Agent system prompt 中将 `run_context_flow` 映射到 `run_harness_flow`
- 无论哪种情况，当前 17 个工具清单中不存在此工具，应在下一版本处理

---

## 附录 A：CLI 命令完整清单

以下 CLI 命令不受 MCP Surface 决策影响——它们始终可用。列出仅供参考，用于理解 MCP Tool ↔ CLI 映射关系。

### 业务命令

| CLI 命令 | 等价 MCP Tool |
|----------|---------------|
| `code-context scope` | `current_scope` |
| `code-context compress <file>` | `compress_context` |
| `code-context retrieve <ref>` | `retrieve_original` |
| `code-context cleanup` | `cleanup_originals` |
| `code-context list-compressions` | `list_compressions` |
| `code-context remember --type ...` | `remember_context` |
| `code-context recall <query>` | `recall_context` |
| `code-context forget <id> --mode ...` | `forget_context` |
| `code-context list-context` | `list_context` |
| `code-context stats` | （无直接 MCP 等价，部分数据在 `list_compressions` 中） |
| `code-context receipt <id>` | （无 MCP 等价，receipt 只在其他 tool 的返回值中） |

### 缓存命令（无 MCP 等价）

| CLI 命令 | 说明 |
|----------|------|
| `code-context cache stats` | CacheAligner 缓存统计 |
| `code-context cache list` | 列出缓存条目 |
| `code-context cache clear` | 清除缓存 |

### 故障命令（有 MCP 等价）

| CLI 命令 | 等价 MCP Tool |
|----------|---------------|
| `code-context failures list` | `list_failures` |
| `code-context failures stats` | `failure_stats` |

### 审计命令（无 MCP 等价）

| CLI 命令 | 说明 |
|----------|------|
| `code-context receipts` | 列出所有 receipt |
| `code-context profile` | 查看 repo profile |

### Harness 命令（有 MCP 等价）

| CLI 命令 | 等价 MCP Tool |
|----------|---------------|
| `code-context harness list` | `list_harness_flows` |
| `code-context harness run <flowId>` | `run_harness_flow` |
| `code-context harness check <flowId>` | `check_harness_flow` |
| `code-context harness check-all` | （无 MCP 等价，批量操作） |
| `code-context harness runs` | （无 MCP 等价，列出所有 runs） |
| `code-context harness show <runId>` | `get_harness_run` |
| `code-context harness logs <runId>` | （无 MCP 等价，`get_harness_run` 可部分覆盖） |
| `code-context harness artifacts <runId>` | （无 MCP 等价，`get_harness_run` 可部分覆盖） |

---

## 附录 B：Harness Flow 覆盖矩阵

7 个 Harness Flow 对 17 个 MCP Tool 的覆盖情况：

| Harness Flow | 覆盖的 MCP Tools |
|-------------|-----------------|
| `compressionFlow` | `current_scope`, `compress_context`, `retrieve_original`, `list_compressions`, `get_receipt`（注：`get_receipt` 无独立 MCP tool） |
| `originalsFlow` | `compress_context`, `retrieve_original`, `delete_original`, `cleanup_originals` |
| `memoryFlow` | `remember_context`, `recall_context`, `forget_context`, `list_context` |
| `profileFlow` | `remember_context`, `recall_context`（含 static/dynamic profile） |
| `fullContextFlow` | 全部 9 个 agent-surface 工具 |
| `mcpToolsSmokeFlow` | 全部 17 个 MCP tool（smoke test） |
| `cliSmokeFlow` | 全部 CLI 命令（smoke test） |

### 未覆盖缺口

| Tool | 被哪个 Harness Flow 使用 |
|------|------------------------|
| `analyze_context` | **无** |
| `list_failures` | **无** |
| `failure_stats` | **无** |

这三个工具未在任何 Harness Flow 中使用，建议在下一版本中为它们添加 Flow 覆盖（或确认它们不需要 Harness 覆盖）。

---

## 附录 C：工具名称与 MCP 注册名对照

确保文档中的工具名与 `server.ts` 中注册的 handler key 一致：

| 文档名称 | Handler Key (server.ts) | Handler 函数 |
|----------|------------------------|-------------|
| `current_scope` | `current_scope` | `handleCurrentScope` |
| `compress_context` | `compress_context` | `handleCompressContext` |
| `retrieve_original` | `retrieve_original` | `handleRetrieveOriginal` |
| `delete_original` | `delete_original` | `handleDeleteOriginal` |
| `cleanup_originals` | `cleanup_originals` | `handleCleanupOriginals` |
| `list_compressions` | `list_compressions` | `handleListCompressions` |
| `remember_context` | `remember_context` | `handleRememberContext` |
| `recall_context` | `recall_context` | `handleRecallContext` |
| `forget_context` | `forget_context` | `handleForgetContext` |
| `list_context` | `list_context` | `handleListContext` |
| `analyze_context` | `analyze_context` | `handleAnalyzeContext` |
| `list_failures` | `list_failures` | `handleListFailures` |
| `failure_stats` | `failure_stats` | `handleFailureStats` |
| `list_harness_flows` | `list_harness_flows` | `handleListHarnessFlows` |
| `run_harness_flow` | `run_harness_flow` | `handleRunHarnessFlow` |
| `get_harness_run` | `get_harness_run` | `handleGetHarnessRun` |
| `check_harness_flow` | `check_harness_flow` | `handleCheckHarnessFlow` |
