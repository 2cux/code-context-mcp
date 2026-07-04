# Fast Path Baseline Report

**Generated**: 2026-06-17
**Scope**: CodeContext MCP — Phase 00 基线确认与边界冻结
**Principle**: 不改业务逻辑，只确认当前实现位置与硬边界

---

## 1. Fast MCP Tools — Current Call Path

### In CodeContext MCP

All 17 non-harness tools follow a direct dispatch path:

```
MCP Client (stdio)
  → server.ts: CallToolRequestSchema handler
    → isToolAllowed(name, mode)   // mode gate
    → tools[name](args)            // direct handler invocation
      → domain service             // CompressedStore, MemoryService, etc.
      → persistDb()                // after mutation
      → return CallToolResult
```

**Direct-path tools** (17 of 18):

| # | Tool | Handler | Goes through HarnessRunner? |
|---|------|---------|---------------------------|
| 1 | `current_scope` | `handleCurrentScope(ctx, args)` | No |
| 2 | `compress_context` | `handleCompressContext(ctx, args)` | No |
| 3 | `retrieve_original` | `handleRetrieveOriginal(ctx, args)` | No |
| 4 | `delete_original` | `handleDeleteOriginal(ctx, args)` | No |
| 5 | `cleanup_originals` | `handleCleanupOriginals(ctx, args)` | No |
| 6 | `list_compressions` | `handleListCompressions(ctx, args)` | No |
| 7 | `remember_context` | `handleRememberContext(ctx, args)` | No |
| 8 | `recall_context` | `handleRecallContext(ctx, args)` | No |
| 9 | `forget_context` | `handleForgetContext(ctx, args)` | No |
| 10 | `list_context` | `handleListContext(ctx, args)` | No |
| 11 | `analyze_context` | `handleAnalyzeContext(ctx, args)` | No |
| 12 | `list_failures` | `handleListFailures(ctx, args)` | No |
| 13 | `failure_stats` | `handleFailureStats(ctx, args)` | No |
| 14 | `list_harness_flows` | `handleListHarnessFlows(args)` *(ctx-less)* | No |
| 15 | `check_harness_flow` | `handleCheckHarnessFlow(args)` *(ctx-less)* | No |
| 16 | `get_harness_run` | `handleGetHarnessRun(ctx, args)` | No |
| 17 | `run_context_flow` | `handleRunContextFlow(ctx, args)` | No |

### In CodeGraph MCP (external project — not in this repo)

Fast MCP tools declared for protection:
- `codegraph_repo_status`
- `codegraph_find`
- `codegraph_explain`
- `codegraph_pre_edit_check`
- `codegraph_coverage_gaps`
- `codegraph_build_context_pack`

**Source not in this repository** — cannot confirm call paths. CodeGraph index stored at `.codegraph/` (gitignored). These are invoked as external MCP tools via the `mcp__codegraph__*` namespace in this session.

---

## 2. Harness Tools — Current Call Path

### In CodeContext MCP

Only **1 tool** goes through HarnessRunner:

```
MCP Client (stdio)
  → server.ts: CallToolRequestSchema handler
    → isToolAllowed(name, mode)
    → handleRunHarnessFlow(ctx, args)
      → runModule(flowId, { input, receipts })   // ← HarnessRunner entry
        → 14-step pipeline (validate → setup → run → check → write → complete)
        → return RunState
      → build JSON response
      → return CallToolResult
```

**Harness-path tool**:

| Tool | Entry Point | Calls |
|------|-------------|-------|
| `run_harness_flow` | `src/mcp/tools/runHarnessFlow.ts` | `runModule()` from `src/harness/core/runner.ts` |

### Harness-only tools in agent mode:

None. All 4 harness tools (`list_harness_flows`, `run_harness_flow`, `get_harness_run`, `check_harness_flow`) are **excluded from agent mode**. They are only available in `dev` and `test` modes.

### In CodeGraph MCP (external project — not in this repo)

Harness-only tools declared:
- `codegraph_harness_list`
- `codegraph_harness_run`
- `codegraph_harness_status`
- `codegraph_harness_artifacts`

**Source not in this repository** — cannot confirm.

---

## 3. workflow.find — Default include_details Behavior

### In CodeContext MCP

**`workflow.find` does not exist in this project.** Zero matches in full-text search.

The closest analogues:

1. **`codegraph_find`** (external MCP tool) — has `mode` parameter: `"quick"` (lightweight, default) or `"review"` (richer details with snippets). Has `include_details` (default `true`) and `include_snippets` (default `false`) parameters for controlling enrichment depth.

2. **`recall_context`** (CodeContext MCP tool) — has `includeProfile` (default `true`), `includeStatic`, `includeDynamic`, `includeCompressedRefs` parameters that control return payload enrichment. No single `include_details` flag.

3. **`codegraph_search_symbols`** (external MCP tool) — search without auto-enrichment. Enrichment happens when the caller separately invokes `codegraph_get_symbol` per result.

The performance fact stated:
> `workflow.find default p95 ≈ 7194ms`
> `workflow.find 主要瓶颈：逐结果 get_symbol() enrichment，占约 77%`

This implies CodeGraph's `workflow.find` defaults to calling `get_symbol()` on each result (enrichment path), which accounts for ~77% of its latency. This is a **CodeGraph MCP internal behavior** and cannot be verified from this repo.

---

## 4. HarnessRunner — Which Tools Call It

### Current callers in CodeContext MCP

| Caller | File | How |
|--------|------|-----|
| `handleRunHarnessFlow` | `src/mcp/tools/runHarnessFlow.ts:67` | `runModule(flowId, {input, receipts})` |
| `src/index.ts` (indirect, via `registerAllFlows()`) | `src/index.ts:12` → `server.ts:30` | Registers 7 flows into registry at startup |
| `cli/harnessCommands.ts` | `src/cli/harnessCommands.ts` | CLI harness commands (not MCP path) |

**No other MCP tool calls HarnessRunner.** Specifically:
- `run_context_flow` does NOT use HarnessRunner — it instantiates domain services directly (CompressedStore, MemoryService, RecallEngine, etc.) in its own handler.
- `list_harness_flows`, `check_harness_flow`, `get_harness_run` read from HarnessRegistry/stateStore directly — they do not execute runs.

### HarnessRunner internals

| Component | File | Role |
|-----------|------|------|
| `runModule()` | `src/harness/core/runner.ts:100` | Public entry: registry lookup + runId generation → 14-step pipeline |
| `executeRun()` | `src/harness/core/runner.ts:152` | Low-level entry: caller provides module + runId |
| `_executeRun()` | `src/harness/core/runner.ts:183` | Shared engine: validate → setup → run → check → output → complete |
| `_handleFailure()` | `src/harness/core/runner.ts:386` | Failure flow: write logs, mark failed, receipt, error artifact |

### 7 registered Harness flows

| Flow ID | Covers Tools | Capability |
|---------|-------------|------------|
| `compression-flow` | current_scope, compress_context, retrieve_original, list_compressions | compression |
| `originals-flow` | compress_context, retrieve_original, delete_original, cleanup_originals | originals |
| `memory-flow` | remember_context, recall_context, forget_context, list_context | memory |
| `profile-flow` | remember_context, recall_context, list_context | profile |
| `full-context-flow` | current_scope, compress_context, retrieve_original, remember_context, recall_context, forget_context, list_context | full-context |
| `mcp-tools-smoke-flow` | All 13 core MCP tools | smoke-test |
| `cli-smoke-flow` | (CLI commands only) | smoke-test |

---

## 5. Current Profiles: Tool Lists per Mode

### CodeContext MCP defines 3 modes (NOT agent/full/harness/debug)

**Actual profiles**: `agent` | `dev` | `test`
**Config**: `MCP_TOOL_MODE` env var, default `agent`
**Implementation**: `src/mcp/toolMode.ts`

#### Agent Mode (7 tools — default for AI coding agents)

```
current_scope        — scope resolution (prerequisite)
compress_context     — context compression (core #1)
retrieve_original    — original content recovery
remember_context     — project memory write (core #2)
recall_context       — project memory search
forget_context       — memory lifecycle management
run_context_flow     — unified compression/memory/full flow
```

**Excluded from agent mode**: harness tools (4), dangerous tools (2: delete_original, cleanup_originals), browse/audit tools (4: list_context, list_compressions, analyze_context, list_failures, failure_stats)

#### Dev Mode (18 tools — full access)

All 18 registered tools. Agent tools (7) +:
```
list_context         — memory audit browsing
list_compressions    — compression history browsing
analyze_context      — decision assistance
list_failures        — failure event list
failure_stats        — failure statistics
list_harness_flows   — harness flow discovery
run_harness_flow     — harness flow execution ← only tool through HarnessRunner
get_harness_run      — harness run inspection
check_harness_flow   — harness manifest validation
delete_original      — original content deletion (dangerous)
cleanup_originals    — batch cleanup (dangerous)
```

#### Test Mode (18 tools — all, for CI/schema validation)

Functionally identical to dev mode. Uses a dynamic `isTestModeTool()` that returns `true` for all tool names.

### Note on user-specified profiles

User referenced profiles: `agent / full / harness / debug`. These do **not** exist in CodeContext MCP. The actual profiles are `agent / dev / test`. Mapping:
- `agent` → same name, 7 tools
- `full` → no equivalent; closest is `dev` mode (18 tools)
- `harness` → no standalone profile; harness tools are subset of `dev` mode
- `debug` → no equivalent; closest is `dev` mode

---

## 6. Performance Benchmark / Reports Output Location

### Reports directory structure

```
reports/
├── architecture/          ← target for this report
│   └── fast-path-baseline.md
├── performance/
│   ├── performance-report.json
│   ├── performance-report.md
│   ├── cache-warm-analysis.json
│   ├── cache-warm-analysis.md
│   ├── extreme-memory-report.json
│   ├── extreme-memory-report.md
│   ├── compress-report.json
│   └── raw-results.jsonl
├── usability/
│   ├── agent-usability-report.json
│   ├── agent-usability-report.md
│   ├── live-agent-validation.json
│   ├── live-agent-validation.md
│   └── README.md
├── release/
│   ├── release-readiness.json
│   ├── release-readiness.md
│   ├── clean-install-smoke.json
│   ├── clean-install-smoke.md
│   ├── release-artifacts-check.json
│   └── release-artifacts-check.md
└── tool-surface/
    └── tool-prune-recommendation.md
```

### Known performance metrics (from existing reports)

| Metric | Value |
|--------|-------|
| compress/100KB (warm) | ~108ms p95 |
| compress/cache hit | ~2ms |
| retrieve_original/100KB | ~3ms |
| recall/100 memories | ~5ms |
| run_context_flow/full 100KB | ~92ms |

---

## 7. Potential Risk Points

### Risk 1: `run_context_flow` duplicates domain logic outside HarnessRunner

`run_context_flow` (`src/mcp/tools/runContextFlow.ts`) is a 700-line handler that directly instantiates `CompressedStore`, `OriginalStore`, `MemoryService`, `MemoryFtsIndex`, `RecallEngine`, `ProfileService`, `FailureStore` — the SAME services that Harness flows exercise through adapters. This creates two code paths for the same business logic:

- **Compression path**: `run_context_flow` direct vs `compression-flow` harness → different validation, different error handling
- **Memory path**: `run_context_flow` direct vs `memory-flow` harness → different lifecycle tracking
- **Risk**: Bug fixes or behavior changes in one path may not reach the other.

**Mitigation**: `run_context_flow` is in agent mode (7 tools); Harness flows are only in dev/test mode. The fast path is protected from Harness overhead. But the duplication means Harness tests don't fully validate the agent's actual execution path.

### Risk 2: No `workflow.find` equivalent in CodeContext MCP

This project has no workflow orchestration layer that enriches results item-by-item. The performance concern about `get_symbol()` enrichment (~77% of workflow.find latency) does not apply here because CodeContext MCP tools return results directly without per-item enrichment loops.

However, if a CodeGraph-like `workflow.find` were to be added in the future, the same enrichment bottleneck pattern would need to be avoided in the fast path.

### Risk 3: Documentation vs code mismatch on tool count

- `docs/TOOL_INVENTORY.md` lists **17 tools** (missing `run_context_flow`), states it's "not yet implemented"
- `docs/TOOL_SURFACE.md` says dev mode has **18 tools** (correct)
- `src/mcp/toolMode.ts` code comment says **"Dev mode — 17 tools"** (incorrect — actually 18)
- `src/mcp/toolRegistry.ts` exports `ALL_TOOL_NAMES` with **18 entries** (correct, ground truth)

**Risk**: Inconsistent documentation may cause confusion about tool surface boundaries.

### Risk 4: Agent mode includes `run_context_flow` which internally calls compression + memory

`run_context_flow` is an "uber-tool" that wraps compression, memory, and recall into one call. It's in agent mode alongside the individual tools (`compress_context`, `remember_context`, `recall_context`). Agents could:
- Call `run_context_flow` instead of individual tools (bypassing finer-grained control)
- Call both `run_context_flow` AND individual tools (duplicate operations)

This is by design (the tool is meant to reduce tool-selection overhead), but the overlap with individual tools creates a fuzzy boundary.

### Risk 5: HarnessRunner is the ONLY tool that goes through the 14-step pipeline

Only `run_harness_flow` uses the full harness pipeline (validate → setup → run → check → artifacts → receipt). All other tools (including `run_context_flow`) bypass this entirely. This means:

- Harness artifacts, checkpoints, and run receipts are only generated for explicit harness runs
- Normal agent operations produce individual receipts but no aggregated run record
- The audit trail for agent operations is at the individual tool level, not the "task" level

This is acceptable for the current architecture but worth noting if cross-tool auditing becomes a requirement.

### Risk 6: No `include_details` toggle in CodeContext MCP tools

CodeContext MCP tools don't have a unified `include_details` parameter. Each tool has its own enrichment controls:
- `recall_context`: `includeProfile`, `includeStatic`, `includeDynamic`, `includeCompressedRefs`
- `list_context`: pagination only (no optional enrichment)
- `get_harness_run`: always returns full state (artifacts, logs, checkpoints, receipts)

There's no standard pattern for "light/fast mode vs full/enriched mode" across tools. If latency becomes a concern, each tool would need individual tuning rather than a global `include_details=false` flag.

### Risk 7: Boundary between Fast Path and Harness Path is clean but undocumented

The architectural boundary is enforced by `toolMode.ts` but not documented as an explicit architectural decision:
- **Agent mode** = fast path only (no harness tools exposed)
- **Dev/Test mode** = fast path + harness tools

This boundary is correct (agent tools never go through HarnessRunner), but it's enforced implicitly through the mode filter, not through an explicit "fast path" vs "harness path" dispatch distinction. If someone adds a new tool and places it in agent mode but internally calls HarnessRunner, the boundary would be silently violated.

---

## 8. Architecture Summary Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Client (Agent)                       │
└──────────────────────────┬──────────────────────────────────┘
                           │ stdio
┌──────────────────────────▼──────────────────────────────────┐
│  server.ts (startServer)                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Mode Filter (toolMode.ts)                            │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │   │
│  │  │  agent   │  │   dev    │  │   test   │           │   │
│  │  │ 7 tools  │  │ 18 tools │  │ 18 tools │           │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘           │   │
│  └───────┼─────────────┼─────────────┼─────────────────┘   │
│          │             │             │                      │
│  ┌───────▼─────────────▼─────────────▼─────────────────┐   │
│  │  Tool Handlers (toolRegistry.ts)                     │   │
│  │                                                      │   │
│  │  ┌──────────────────────┐  ┌────────────────────┐   │   │
│  │  │  Fast Path (17)      │  │  Harness Path (1)  │   │   │
│  │  │  Direct → Domain     │  │  run_harness_flow  │   │   │
│  │  │  Services → DB       │  │  → runModule()     │   │   │
│  │  │                      │  │  → 14-step pipe    │   │   │
│  │  │  current_scope       │  │  → HarnessContext  │   │   │
│  │  │  compress_context    │  │  → RunState        │   │   │
│  │  │  retrieve_original   │  └────────────────────┘   │   │
│  │  │  ... (14 more)       │                            │   │
│  │  └──────────────────────┘                            │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│  ┌─────────────────────────▼───────────────────────────┐    │
│  │  Domain Services                                     │    │
│  │  CompressedStore | OriginalStore | MemoryService     │    │
│  │  RecallEngine | ProfileService | FailureStore        │    │
│  │  ReceiptService | ContentRouter | SafetyLayer        │    │
│  └─────────────────────────┬───────────────────────────┘    │
│                            │                                 │
│  ┌─────────────────────────▼───────────────────────────┐    │
│  │  SQLite (db.ts)                                      │    │
│  │  scopes | ccrs | originals | memories | receipts     │    │
│  │  profile_facts | failures                            │    │
│  └──────────────────────────────────────────────────────┘    │
│                            │                                 │
│  ┌─────────────────────────▼───────────────────────────┐    │
│  │  Harness Runner (runner.ts)                           │    │
│  │  RunModule → ExecuteRun → 14-step pipeline            │    │
│  │  StateStore | ArtifactStore | Reporter | Validate     │    │
│  │  7 Flows (register.ts)                                │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Key file index

| Concern | File | Lines |
|---------|------|-------|
| Profile/mode definitions | `src/mcp/toolMode.ts` | 1–97 |
| Tool schema definitions | `src/mcp/toolSchemas.ts` | 1–821 |
| Handler registry | `src/mcp/toolRegistry.ts` | 1–104 |
| Server dispatch | `src/mcp/server.ts` | 1–112 |
| HarnessRunner (runModule) | `src/harness/core/runner.ts` | 100–125 |
| HarnessRunner (engine) | `src/harness/core/runner.ts` | 183–361 |
| Harness flow registration | `src/harness/register.ts` | 1–204 |
| run_harness_flow handler | `src/mcp/tools/runHarnessFlow.ts` | 1–115 |
| run_context_flow handler | `src/mcp/tools/runContextFlow.ts` | 1–698 |
| Performance reports | `reports/performance/*.md` | — |
| Entry point | `src/index.ts` | 1–15 |

---

## 9. Verification

```bash
npx tsc --noEmit
npx vitest run
```

*(Run these commands to verify baseline stability — see terminal output.)*

---

## 10. Summary

| Item | Status | Detail |
|------|--------|--------|
| Profile/tool mode location | ✅ Confirmed | `src/mcp/toolMode.ts` — `agent`/`dev`/`test` (NOT `agent`/`full`/`harness`/`debug`) |
| Tool registry/handler dispatch | ✅ Confirmed | `src/mcp/toolRegistry.ts` + `src/mcp/server.ts` |
| HarnessRunner entry | ✅ Confirmed | `src/mcp/tools/runHarnessFlow.ts` → `runModule()` in `src/harness/core/runner.ts` — only 1 tool uses it |
| workflow.find & include_details | ❌ Not in this repo | CodeGraph MCP internal — `.codegraph/` is gitignored, source is external |
| Performance reports location | ✅ Confirmed | `reports/performance/` (6 report pairs: JSON + MD) |
| Fast/Harness boundary | ✅ Clean | Agent mode excludes all harness tools; only `run_harness_flow` goes through HarnessRunner |
