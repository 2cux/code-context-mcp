# MCP Tool Inventory

> Auto-generated from codebase inspection. Last updated: 2026-06-16.
>
> 范围：`src/mcp/tools/` + `src/mcp/toolSchemas.ts` + `src/mcp/server.ts`
>
> 不包含 CLI-only 命令（CLI 命令见 `docs/TOOL_SURFACE_DECISION_MATRIX.md` 的附录）。

---

## 总览：17 个 MCP Tool

| # | Tool Name | 模块 | 已注册 | 面向 Agent | 建议模式 | 危险 | 可隐藏 |
|---|-----------|------|--------|------------|----------|------|--------|
| 1 | `current_scope` | scope | ✅ | ✅ | agent | — | — |
| 2 | `compress_context` | compression | ✅ | ✅ | agent | — | — |
| 3 | `retrieve_original` | originals | ✅ | ✅ | agent | — | — |
| 4 | `delete_original` | originals | ✅ | — | dev/test | ⚠️ 不可逆删除 | ✅ |
| 5 | `cleanup_originals` | originals | ✅ | — | dev/test | ⚠️ 批量删除 | ✅ |
| 6 | `list_compressions` | compression | ✅ | ✅ | agent | — | — |
| 7 | `remember_context` | memory | ✅ | ✅ | agent | — | — |
| 8 | `recall_context` | memory | ✅ | ✅ | agent | — | — |
| 9 | `forget_context` | memory | ✅ | ✅ | agent | ⚠️ hard_delete 不可逆 | — |
| 10 | `list_context` | memory | ✅ | ✅ | agent | — | — |
| 11 | `analyze_context` | analysis | ✅ | ✅ | agent | — | — |
| 12 | `list_failures` | failure | ✅ | — | dev/internal | — | ✅ |
| 13 | `failure_stats` | failure | ✅ | — | dev/internal | — | ✅ |
| 14 | `list_harness_flows` | harness | ✅ | — | dev/test | — | ✅ |
| 15 | `run_harness_flow` | harness | ✅ | — | dev/test | ⚠️ 执行副作用 | ✅ |
| 16 | `get_harness_run` | harness | ✅ | — | dev/test | — | ✅ |
| 17 | `check_harness_flow` | harness | ✅ | — | dev/test | — | ✅ |

---

## 逐个 Tool 详情

### 1. `current_scope`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/currentScope.ts` |
| **Schema** | `TOOL_DEFINITIONS[1]` in `src/mcp/toolSchemas.ts` |
| **用途** | 解析当前项目 scope，返回 scopeId（优先 git remote + git root）。所有其他 tool 的前置依赖。 |
| **输入复杂度** | 极低。只有可选参数 `cwd`（覆盖当前工作目录）。 |
| **是否危险** | 否。纯读取，无副作用（会写入 scopes 表但属于幂等操作）。 |
| **是否可合并** | 不建议。scope 解析是独立概念，且其他工具依赖 scopeId。 |
| **CLI 替代** | `code-context scope [--cwd <path>]` |
| **Harness 使用** | `fullContextFlow`、`compressionFlow`、`mcpToolsSmokeFlow` |
| **测试覆盖** | `tests/phase1-acceptance.test.ts`、`tests/phase3-acceptance.test.ts`、`tests/scope.test.ts`、`tests/harness/fullContextFlow.test.ts`、`tests/harness/mcpHarness.test.ts` |
| **建议模式** | **agent** — 所有其他 agent 工具的前置依赖，Agent 必须能够调用。 |
| **理由** | 这是 scope 系统的唯一入口点。没有 scopeId，压缩、记忆、原始内容都无法操作。 |

---

### 2. `compress_context`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/compressContext.ts` |
| **Schema** | `TOOL_DEFINITIONS[0]` in `src/mcp/toolSchemas.ts` |
| **用途** | 压缩长上下文以降低 token 消耗。自动检测内容类型、应用类型特定压缩策略、处理超大输入（chunking）。返回压缩后内容 + token 统计 + originalRef + receipt。失败时返回原始内容（fail-open）。 |
| **输入复杂度** | 中等。2 个必填（scopeId, content），6 个可选（contentType, strategy, keepOriginal, maxTokens, timeoutMs, maxInputBytes, metadata）。 |
| **是否危险** | 否。fail-open 保证不会丢失内容。原始内容可恢复。 |
| **是否可合并** | 不建议。compression 是核心 value prop，合并会失去清晰度。 |
| **CLI 替代** | `code-context compress <file> [--type <type>] [--strategy conservative\|auto] [--no-keep-original] [--max-tokens <n>] [--timeout-ms <ms>]` |
| **Harness 使用** | `compressionFlow`、`originalsFlow`、`fullContextFlow`、`mcpToolsSmokeFlow` |
| **测试覆盖** | `tests/phase1-acceptance.test.ts`、`tests/phase4-compressContext-closed-loop.test.ts`、`tests/phase10-compression-memory-fusion.test.ts`、`tests/compressionEngine.test.ts`、`tests/contentRouter.test.ts`、`tests/safety.test.ts`、`tests/strategy.test.ts`、`tests/harness/compressionFlow.test.ts`、`tests/harness/fullContextFlow.test.ts` |
| **建议模式** | **agent** — 核心价值主张之一，Agent 日常使用频率最高。 |
| **理由** | 项目两大核心能力之一（context compression）。Agent 应默认可用。 |

---

### 3. `retrieve_original`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/retrieveOriginal.ts` |
| **Schema** | `TOOL_DEFINITIONS[2]` in `src/mcp/toolSchemas.ts` |
| **用途** | 通过 originalRef 检索原始（未压缩）内容。支持 offset/limit 分页。scope 隔离。递增 retrieveCount 并生成 retrieval receipt。 |
| **输入复杂度** | 低。2 个必填（scopeId, originalRef），2 个可选（offset, limit）。 |
| **是否危险** | 否。只读操作。 |
| **是否可合并** | 不建议。retrieve 是独立的用户需求（"展开查看原始内容"）。 |
| **CLI 替代** | `code-context retrieve <originalRef> [--offset <n>] [--limit <n>]` |
| **Harness 使用** | `compressionFlow`、`originalsFlow`、`fullContextFlow`、`mcpToolsSmokeFlow` |
| **测试覆盖** | `tests/originalStore.test.ts`、`tests/phase4-compressContext-closed-loop.test.ts`、`tests/phase10-compression-memory-fusion.test.ts`、`tests/harness/originalsFlow.test.ts`、`tests/harness/fullContextFlow.test.ts` |
| **建议模式** | **agent** — 压缩后必须能展开查看原文，是 compression 的配对操作。 |
| **理由** | 没有 retrieve，compress 就变成了单向的、不可逆的操作。配对存在才完整。 |

---

### 4. `delete_original`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/deleteOriginal.ts` |
| **Schema** | `TOOL_DEFINITIONS[3]` in `src/mcp/toolSchemas.ts` |
| **用途** | 通过 originalRef 删除单个原始内容记录。更新关联 CCR 的 canRetrieveOriginal 标记。scope 隔离。 |
| **输入复杂度** | 极低。2 个必填（scopeId, originalRef）。 |
| **是否危险** | ⚠️ 中等。删除后原始内容不可恢复（CCR 仍在但 original 永久丢失）。 |
| **是否可合并** | 可考虑与 `cleanup_originals` 合并为 `manage_originals`，但语义差异较大（单条删除 vs 批量清理）。 |
| **CLI 替代** | `code-context cleanup`（但 cleanup 是批量过期删除，delete 是精确单条删除，CLI 无精确等价命令）。 |
| **Harness 使用** | `originalsFlow`、`mcpToolsSmokeFlow` |
| **测试覆盖** | `tests/originalStore.test.ts`、`tests/harness/originalsFlow.test.ts` |
| **建议模式** | **dev/test** — 日常 Agent 不应随意删除原始内容。仅在明确要求或维护场景使用。 |
| **理由** | 普通 agent 使用场景不需要删除能力。这是管理操作，应默认隐藏以减少误操作风险。 |

---

### 5. `cleanup_originals`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/cleanupOriginals.ts` |
| **Schema** | `TOOL_DEFINITIONS[4]` in `src/mcp/toolSchemas.ts` |
| **用途** | 删除 scope 下所有已过期的原始内容记录。对每个失去所有 original 的 CCR 设置 canRetrieveOriginal=0。日常维护工具。 |
| **输入复杂度** | 极低。1 个必填（scopeId）。 |
| **是否危险** | ⚠️ 中等。批量操作，一次性删除多条 original。 |
| **是否可合并** | 见 `delete_original`。 |
| **CLI 替代** | `code-context cleanup` |
| **Harness 使用** | `originalsFlow`、`mcpToolsSmokeFlow` |
| **测试覆盖** | `tests/originalStore.test.ts`、`tests/harness/originalsFlow.test.ts` |
| **建议模式** | **dev/test** — 维护操作用。Agent 不应在正常编码流程中调用。 |
| **理由** | 与 `delete_original` 同为管理操作。默认隐藏以避免 Agent 误触发批量清理。 |

---

### 6. `list_compressions`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/listCompressions.ts` |
| **Schema** | `TOOL_DEFINITIONS[5]` in `src/mcp/toolSchemas.ts` |
| **用途** | 列出 scope 下的压缩上下文记录（CCR）。支持 contentType 过滤、分页、聚合统计。 |
| **输入复杂度** | 低。1 个必填（scopeId），3 个可选（contentType, limit, offset）。 |
| **是否危险** | 否。只读。 |
| **是否可合并** | 不建议。list 是独立的浏览/审计需求。 |
| **CLI 替代** | `code-context list-compressions [--type <type>] [--limit <n>] [--offset <n>]` |
| **Harness 使用** | `compressionFlow`、`fullContextFlow`、`mcpToolsSmokeFlow` |
| **测试覆盖** | `tests/compressedStore.test.ts`、`tests/phase10-compression-memory-fusion.test.ts`、`tests/harness/compressionFlow.test.ts` |
| **建议模式** | **agent** — Agent 可能需要浏览已压缩的内容来理解上下文。 |
| **理由** | 压缩后的内容检索入口。Agent 需要知道自己压缩过什么、能否展开。 |

---

### 7. `remember_context`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/rememberContext.ts` |
| **Schema** | `TOOL_DEFINITIONS[6]` in `src/mcp/toolSchemas.ts` |
| **用途** | 保存结构化项目记忆。创建 scope 隔离的类型化记忆记录。可选写入 project profile（static 长期事实 / dynamic 瞬态上下文）。每次操作生成审计 receipt。10 种类型：decision, bug, command, file_summary, project_rule, user_preference, current_task, test_failure, api_contract, dependency。 |
| **输入复杂度** | 高。2 个必填（type, content），9 个可选（scopeId, summary, sourceRef, confidence, profileTarget, expiresAt, tags, ccrId, originalRef）。 |
| **是否危险** | 否。可逆操作（可通过 forget_context 修正）。 |
| **是否可合并** | 不建议。remember 是独立的核心能力。 |
| **CLI 替代** | `code-context remember --type <type> --content <text>\|--file <path> [--summary <text>] [--source-ref <ref>] [--confidence <0-1>] [--profile-target static\|dynamic] [--expires-at <ISO>] [--tags <t1,t2>]` |
| **Harness 使用** | `memoryFlow`、`profileFlow`、`fullContextFlow`、`mcpToolsSmokeFlow` |
| **测试覆盖** | `tests/phase5-rememberContext.test.ts`、`tests/phase10-compression-memory-fusion.test.ts`、`tests/memory.test.ts`、`tests/harness/memoryFlow.test.ts`、`tests/harness/fullContextFlow.test.ts`、`tests/harness/profileFlow.test.ts` |
| **建议模式** | **agent** — 项目两大核心能力之一（project memory）。Agent 必须能够保存记忆。 |
| **理由** | 没有 remember，project memory 系统就不存在。是 recall 的写入端。 |

---

### 8. `recall_context`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/recallContext.ts` |
| **Schema** | `TOOL_DEFINITIONS[7]` in `src/mcp/toolSchemas.ts` |
| **用途** | 通过 BM25 全文搜索 + 置信度合并 + 新近度加权召回项目记忆和相关压缩上下文。返回匹配记忆（含 relevance score）、合并后的 profile facts（static rules + dynamic context）、关联 CCR。始终生成审计 receipt（即使无结果）。 |
| **输入复杂度** | 中高。1 个必填（query），11 个可选（scopeId, types, status, includeInactive, limit, includeProfile, includeStatic, includeDynamic, includeCompressedRefs, retrieveOriginal）。 |
| **是否危险** | 否。只读。 |
| **是否可合并** | 不建议。recall 是独立的检索入口。 |
| **CLI 替代** | `code-context recall <query> [--types <t1,t2>] [--status <s1,s2>] [--limit <n>] [--no-profile] [--no-related-ccrs]` |
| **Harness 使用** | `memoryFlow`、`profileFlow`、`fullContextFlow`、`mcpToolsSmokeFlow` |
| **测试覆盖** | `tests/phase7-recallContext.test.ts`、`tests/phase10-compression-memory-fusion.test.ts`、`tests/memory.test.ts`、`tests/harness/memoryFlow.test.ts`、`tests/harness/fullContextFlow.test.ts`、`tests/harness/profileFlow.test.ts` |
| **建议模式** | **agent** — 记忆的读取端，与 remember 配对。Agent 在每个任务开始时可能需要 recall。 |
| **理由** | 没有 recall，remember 写入的记忆就无法被检索。是 memory 系统的读取入口。 |

---

### 9. `forget_context`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/forgetContext.ts` |
| **Schema** | `TOOL_DEFINITIONS[8]` in `src/mcp/toolSchemas.ts` |
| **用途** | 遗忘/取代/过期/删除一条项目记忆，防止过期信息污染未来 recall 结果。4 种模式：soft_forget（标记遗忘）、supersede（被新记忆取代，需 supersededBy）、expire（标记过期）、hard_delete（永久删除）。每次操作生成审计 receipt。 |
| **输入复杂度** | 低。2 个必填（id, mode），3 个可选（reason, supersededBy, scopeId）。 |
| **是否危险** | ⚠️ hard_delete 不可逆。soft_forget/supersede/expire 可逆（可通过 list_context 找到并手动处理）。 |
| **是否可合并** | 不建议。forget 是记忆生命周期管理的独立操作。 |
| **CLI 替代** | `code-context forget <id> --mode soft_forget\|supersede\|expire\|hard_delete [--reason <text>] [--superseded-by <id>]` |
| **Harness 使用** | `memoryFlow`、`fullContextFlow`、`mcpToolsSmokeFlow` |
| **测试覆盖** | `tests/phase8-forgetContext.test.ts`、`tests/phase10-compression-memory-fusion.test.ts`、`tests/memory.test.ts`、`tests/harness/memoryFlow.test.ts`、`tests/harness/fullContextFlow.test.ts` |
| **建议模式** | **agent** — 记忆系统需要遗忘能力来保持清洁。Agent 应在发现记忆过时时主动 forget。 |
| **理由** | "Old memory must not silently pollute future recall" 是核心设计原则。forget 是实现这条原则的机制。 |

---

### 10. `list_context`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/listContext.ts` |
| **Schema** | `TOOL_DEFINITIONS[9]` in `src/mcp/toolSchemas.ts` |
| **用途** | 列出项目记忆，支持按类型、状态过滤，支持排序和分页。可查看 active/superseded/forgotten/expired 各类记忆。始终生成审计 receipt。 |
| **输入复杂度** | 低。1 个必填（scopeId），6 个可选（types, status, limit, offset, sortBy, sortOrder）。 |
| **是否危险** | 否。只读。 |
| **是否可合并** | 不建议。list 是审计/浏览需求，与 recall（搜索）不同。 |
| **CLI 替代** | `code-context list-context [--types <t1,t2>] [--status <s1,s2>] [--limit <n>] [--offset <n>] [--sort-by <field>] [--sort-order asc\|desc]` |
| **Harness 使用** | `memoryFlow`、`fullContextFlow`、`mcpToolsSmokeFlow` |
| **测试覆盖** | `tests/phase9-listContext.test.ts`、`tests/phase10-compression-memory-fusion.test.ts`、`tests/harness/memoryFlow.test.ts` |
| **建议模式** | **agent** — Agent 需要浏览记忆清单来做审计或找到要 forget 的记忆 id。 |
| **理由** | list 是 recall 的补充——recall 用于语义搜索，list 用于结构化浏览。 |

---

### 11. `analyze_context`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/analyzeContext.ts` |
| **Schema** | `TOOL_DEFINITIONS[10]` in `src/mcp/toolSchemas.ts` |
| **用途** | 分析内容和/或查询，推荐上下文管理操作。返回 shouldCompress / shouldRecall / shouldSaveMemory / shouldRetrieveOriginal 决策（含置信度和理由）。**仅提供建议**，不自动调用其他工具。Agent 自行决定是否执行。 |
| **输入复杂度** | 中等。0 个必填（全部可选），4 个可选（content, contentType, query, source, metadata）。但至少需要 content 或 query 之一才能产出有意义的分析。 |
| **是否危险** | 否。纯建议，无副作用。 |
| **是否可合并** | ⚠️ **工具混淆风险**：Agent 可能误认为 analyze_context 会自动执行压缩/召回，实际它只返回建议。名称 `analyze_context` 可能暗示分析+执行。 |
| **CLI 替代** | 无直接等价命令。 |
| **Harness 使用** | 无（未在任何 harness flow 中直接使用）。 |
| **测试覆盖** | `tests/phase10-compression-memory-fusion.test.ts`（部分）、`tests/contentRouter.test.ts`（相关 content type detection） |
| **建议模式** | **agent** — 但需在 description 中明确标注 "SUGGESTIONS ONLY"。Agent 可在决策前使用 analyze 获取建议。 |
| **理由** | 作为决策辅助工具有价值，但名称和用途之间的 gap 是风险点。建议在 description 中保持醒目的 NOTE 标记。 |

---

### 12. `list_failures`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/listFailures.ts` |
| **Schema** | `TOOL_DEFINITIONS[11]` in `src/mcp/toolSchemas.ts` |
| **用途** | 列出 Failure Learning 系统（§33）记录的失败事件。支持按 eventType（8 种）和 operation（3 种）过滤。 |
| **输入复杂度** | 低。0 个必填（scopeId 可选），4 个可选（scopeId, eventType, operation, limit, offset）。 |
| **是否危险** | 否。只读。 |
| **是否可合并** | 可考虑与 `failure_stats` 合并为 `failure_dashboard`。两个工具共享同一数据源，分开只是粒度不同。 |
| **CLI 替代** | `code-context failures list [--event-type <type>] [--operation <op>] [--limit <n>] [--offset <n>]` |
| **Harness 使用** | 无。 |
| **测试覆盖** | 间接（failureStore 在 cli.test.ts 中有测试，但 list_failures MCP tool 本身测试覆盖较弱）。 |
| **建议模式** | **dev/internal** — 开发者调试工具。Agent 在日常编码中不需要。 |
| **理由** | Failure Learning 是内部可观测性系统。终端用户 Agent 不应被失败统计干扰。后续可考虑完全隐藏。 |

---

### 13. `failure_stats`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/failureStats.ts` |
| **Schema** | `TOOL_DEFINITIONS[12]` in `src/mcp/toolSchemas.ts` |
| **用途** | 展示 scope 的失败事件统计（§33.5）。返回事件总数、按 eventType 和 operation 的细分、最近 24h 事件、失败次数最多的 CCR。 |
| **输入复杂度** | 极低。0 个必填（scopeId 可选）。 |
| **是否危险** | 否。只读聚合。 |
| **是否可合并** | 见 `list_failures`。 |
| **CLI 替代** | `code-context failures stats` |
| **Harness 使用** | 无。 |
| **测试覆盖** | 间接（failureStore 测试），MCP tool 本身测试覆盖较弱。 |
| **建议模式** | **dev/internal** — 与 `list_failures` 相同理由。 |
| **理由** | 聚合统计是调试工具。不应暴露给日常工作 Agent。 |

---

### 14. `list_harness_flows`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/listHarnessFlows.ts` |
| **Schema** | `TOOL_DEFINITIONS[13]` in `src/mcp/toolSchemas.ts` |
| **用途** | 列出所有已注册的 Harness 业务 Flow 清单。返回 flowId、name、description、phases、coveredTools、inputSchema。可选按 tag 或 capability 过滤。 |
| **输入复杂度** | 极低。0 个必填，2 个可选（tag, capability）。 |
| **是否危险** | 否。只读。 |
| **是否可合并** | 不建议。Harness 工具已有良好的职责分离（list / run / get / check）。 |
| **CLI 替代** | `code-context harness list` |
| **Harness 使用** | 无（它是 Harness 自己的发现机制）。 |
| **测试覆盖** | `tests/harness/registry.test.ts`、`tests/harness/mcpHarness.test.ts`、`tests/mcpSchema.test.ts` |
| **建议模式** | **dev/test** — Harness 是开发/测试工具链。Agent 不需要在编码时浏览 flow 清单。 |
| **理由** | Flow 发现是开发和 CI 阶段的需求。在日常 Agent 使用中暴露这些工具是噪音。 |

---

### 15. `run_harness_flow`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/runHarnessFlow.ts` |
| **Schema** | `TOOL_DEFINITIONS[14]` in `src/mcp/toolSchemas.ts` |
| **用途** | 执行已注册的 Harness 业务 Flow。完整闭环：验证输入 → 执行 setup/run/check hooks → 写入 artifacts → 记录 run receipt。返回 runId、status、output、receiptId、artifacts。失败时 run state 包含错误详情，调用本身不抛异常。 |
| **输入复杂度** | 低。1 个必填（flowId），1 个可选（input object，必须符合 flow 的 inputSchema）。 |
| **是否危险** | ⚠️ 中等。执行 Flow 可能产生副作用（写入 artifacts、修改状态）。取决于具体 Flow。 |
| **是否可合并** | 不建议。与 `check_harness_flow` 职责不同（执行 vs 验证）。 |
| **CLI 替代** | `code-context harness run <flowId> [--input <file.json>] [--runs-dir <path>]` |
| **Harness 使用** | 无（它是 Harness 的执行机制）。 |
| **测试覆盖** | `tests/harness/runner.test.ts`、`tests/harness/mcpHarness.test.ts`、`tests/harness/compressionFlow.test.ts`、`tests/harness/fullContextFlow.test.ts` 等 |
| **建议模式** | **dev/test** — 仅在开发、测试、CI 场景使用。Agent 不应在编码流程中执行 Harness Flow。 |
| **理由** | Harness Flow 执行是开发者主导的操作。Agent 触发 Flow 执行可能产生意外的 artifacts 和状态变更。 |

---

### 16. `get_harness_run`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/getHarnessRun.ts` |
| **Schema** | `TOOL_DEFINITIONS[15]` in `src/mcp/toolSchemas.ts` |
| **用途** | 通过 runId 检索之前 Harness 运行的完整状态。返回 run state（status, checkpoints, artifacts）、关联 receipts、event logs、artifact 内容。 |
| **输入复杂度** | 极低。1 个必填（runId）。 |
| **是否危险** | 否。只读。 |
| **是否可合并** | 不建议。 |
| **CLI 替代** | `code-context harness show <runId>` + `code-context harness logs <runId>` + `code-context harness artifacts <runId>` |
| **Harness 使用** | 无。 |
| **测试覆盖** | `tests/harness/mcpHarness.test.ts`、`tests/harness/runner.test.ts` |
| **建议模式** | **dev/test** — 查看 Harness 运行结果。Agent 不需要。 |
| **理由** | 与 `run_harness_flow` 配对，仅开发/测试场景使用。 |

---

### 17. `check_harness_flow`

| 属性 | 值 |
|------|-----|
| **文件** | `src/mcp/tools/checkHarnessFlow.ts` |
| **Schema** | `TOOL_DEFINITIONS[16]` in `src/mcp/toolSchemas.ts` |
| **用途** | 验证 Harness Flow manifest 而不执行。检查 manifest 结构、flow 已注册、示例输入符合 inputSchema、artifact 声明有效。返回结构化 check result。 |
| **输入复杂度** | 低。1 个必填（flowId），1 个可选（exampleInput）。 |
| **是否危险** | 否。纯验证，无副作用。 |
| **是否可合并** | 不建议。 |
| **CLI 替代** | `code-context harness check <flowId> [--manifest-only]` |
| **Harness 使用** | 无。 |
| **测试覆盖** | `tests/harness/checkEngine.test.ts`、`tests/harness/mcpHarness.test.ts` |
| **建议模式** | **dev/test** — Flow 验证是 CI/开发工具。 |
| **理由** | 与 `run_harness_flow` 配套，pre-flight check。开发/测试场景专用。 |

---

## 工具混淆风险

| # | 风险 | 严重程度 | 说明 |
|---|------|----------|------|
| 1 | `analyze_context` ≠ 自动执行 | **中** | Agent 可能认为 analyze 会自动调用 compress/recall/remember。实际上只返回 JSON 建议。description 中已有 NOTE，但名称仍有歧义。建议：重命名为 `suggest_context_actions` 或在 Agent system prompt 中明确标注。 |
| 2 | `recall_context` vs `list_context` | **低** | recall 做语义搜索（BM25），list 做结构化浏览（过滤+排序）。Agent 可能在需要 list 时调用 recall（或反之）。description 足够清晰，但两个工具的返回值结构不同。 |
| 3 | `retrieve_original` 只返回原文，不返回压缩版 | **低** | Agent 可能期望 retrieve_original 同时返回压缩版和原文。实际上 CCR 的压缩版在 compress_context 的返回值中，retrieve_original 只处理原文。 |
| 4 | `delete_original` vs `cleanup_originals` | **低** | 单条删除 vs 批量过期清理。Agent 可能混淆两者的触发条件。 |
| 5 | `forget_context` 的 `hard_delete` 不可逆 | **低** | description 已标注，但 Agent 可能不读 description。建议：hard_delete 需要额外确认参数。 |
| 6 | `run_harness_flow` 不返回流式输出 | **低** | Agent 可能期望流式返回，实际是同步等待 Flow 完成后返回结果。 |
| 7 | Harness tools 对 Agent 可见 | **中** | 4 个 Harness tools（list/run/get/check）和 2 个 Failure tools（list_failures/failure_stats）对 Agent 可见但日常编码不需要。增加了 tool list 的噪音。 |

---

## 建议默认 Agent 工具（7 个）

依照任务规格，以下 7 个工具应默认对 Agent 可见：

| Tool | 理由 |
|------|------|
| `current_scope` | 所有 scope-isolated 操作的前置依赖 |
| `compress_context` | 核心能力：上下文压缩 |
| `retrieve_original` | 核心能力：原文恢复，compression 配对操作 |
| `remember_context` | 核心能力：项目记忆写入 |
| `recall_context` | 核心能力：项目记忆检索 |
| `forget_context` | 核心能力：记忆生命周期管理 |
| `run_context_flow` | _注：此工具尚未实现。任务规格中提到但当前代码中不存在。可能是 `run_harness_flow` 的别名或计划中的高层封装。_ |

额外建议默认可见：

| Tool | 理由 |
|------|------|
| `list_compressions` | 压缩内容浏览，与 compress_context 配套 |
| `list_context` | 记忆审计浏览，与 recall_context 互补 |
| `analyze_context` | 决策辅助，帮助 Agent 判断何时压缩/召回/记忆 |

---

## 测试覆盖摘要

| 覆盖等级 | 工具 |
|----------|------|
| **高**（多个测试文件，harness flow 覆盖） | `current_scope`, `compress_context`, `retrieve_original`, `remember_context`, `recall_context`, `forget_context`, `list_context` |
| **中**（单测试文件或间接覆盖） | `list_compressions`, `delete_original`, `cleanup_originals`, `analyze_context`, `list_harness_flows`, `run_harness_flow`, `check_harness_flow`, `get_harness_run` |
| **低**（仅间接覆盖） | `list_failures`, `failure_stats` |

---

## 附录：模块归属

```
src/mcp/
  server.ts                          ← 注册点（17 个 handler）
  toolSchemas.ts                     ← 所有 Tool Schema 定义
  tools/
    currentScope.ts                  ← current_scope
    compressContext.ts               ← compress_context
    retrieveOriginal.ts              ← retrieve_original
    deleteOriginal.ts                ← delete_original
    cleanupOriginals.ts              ← cleanup_originals
    listCompressions.ts              ← list_compressions
    rememberContext.ts               ← remember_context
    recallContext.ts                  ← recall_context
    forgetContext.ts                 ← forget_context
    listContext.ts                   ← list_context
    analyzeContext.ts                ← analyze_context
    listFailures.ts                  ← list_failures
    failureStats.ts                  ← failure_stats
    listHarnessFlows.ts              ← list_harness_flows
    runHarnessFlow.ts                ← run_harness_flow
    getHarnessRun.ts                 ← get_harness_run
    checkHarnessFlow.ts              ← check_harness_flow
```
