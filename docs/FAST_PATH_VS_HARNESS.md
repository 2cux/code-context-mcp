# Fast MCP Path vs Harness Workflow Path

> **基线日期**: 2026-06-17
> **状态**: 已确认，已固化
> **上一阶段**: [reports/architecture/fast-path-baseline.md](../reports/architecture/fast-path-baseline.md)

---

## 1. Why This Boundary Exists

AI coding agents call MCP tools at high frequency — every tool call is on the critical path of an agent's reasoning loop. Routing all tools through a heavyweight execution pipeline adds latency that compounds across every turn.

The Harness system (workflow execution, state persistence, artifact storage, reporting) provides essential audit and debugging capabilities, but it is NOT the right execution layer for fast, high-frequency agent tools.

The architecture has two equally valid but distinct paths:

| Path | Purpose | Latency Target | Execution Model |
|------|---------|---------------|-----------------|
| **Fast MCP Path** | Agent daily use — compress, recall, remember, scope | <200ms p95 | Direct handler → domain service → DB |
| **Harness Workflow Path** | Developer/CI use — workflow runs, audits, smoke tests | No hard cap | HarnessRunner → 14-step pipeline → run receipt |

**Core principle:**

```
Fast MCP tools must not route through HarnessRunner by default.
Harness is for workflow / report / audit / debug, not the default execution layer for agent tools.
```

---

## 2. Fast MCP Path

### Call chain

```
MCP Client (Agent)
    │
    ▼
MCP Server (server.ts)
    │
    ├─ profile gate (toolMode.ts)
    │   └─ agent mode: 7 tools  |  dev mode: 18 tools  |  test mode: 18 tools
    │
    ├─ direct handler (toolRegistry.ts)
    │   └─ handleXxx(ctx, args)  or  handleXxx(args)
    │
    ├─ domain service
    │   └─ CompressedStore | MemoryService | RecallEngine | ...
    │
    ├─ persistDb()
    │
    └─ compact response (JSON)
```

### Characteristics

- **No HarnessRunner involvement** — handler calls domain services directly
- **No runId generation** — no run directory, no state machine transitions
- **No artifact persistence** — no `runs/` directory writes
- **Receipt optional** — receipts are created inline by handlers, not by the runner
- **Fail-open** — errors return original content or error JSON, never block the agent
- **Compact response** — return only the data the agent needs, no run metadata

### Fast MCP tools (CodeContext MCP)

These 7 tools are the **agent-mode surface** — always fast path:

| Tool | Handler | Domain Services |
|------|---------|-----------------|
| `current_scope` | `handleCurrentScope` | `resolveScope()`, `scopes` table |
| `compress_context` | `handleCompressContext` | `ContentRouter`, `SafetyLayer`, `CompressedStore`, `OriginalStore` |
| `retrieve_original` | `handleRetrieveOriginal` | `OriginalStore` |
| `remember_context` | `handleRememberContext` | `MemoryService`, `ProfileService`, `MemoryFtsIndex` |
| `recall_context` | `handleRecallContext` | `RecallEngine`, `ProfileService`, `MemoryFtsIndex` |
| `forget_context` | `handleForgetContext` | `MemoryService` |
| `run_context_flow` | `handleRunContextFlow` | All services (direct, NOT via HarnessRunner) |

These 11 additional tools are **dev/test-mode only** — also fast path (no HarnessRunner):

| Tool | Handler |
|------|---------|
| `list_context` | `handleListContext` |
| `list_compressions` | `handleListCompressions` |
| `analyze_context` | `handleAnalyzeContext` |
| `list_failures` | `handleListFailures` |
| `failure_stats` | `handleFailureStats` |
| `list_harness_flows` | `handleListHarnessFlows` (ctx-less) |
| `check_harness_flow` | `handleCheckHarnessFlow` (ctx-less) |
| `get_harness_run` | `handleGetHarnessRun` |
| `delete_original` | `handleDeleteOriginal` |
| `cleanup_originals` | `handleCleanupOriginals` |

### Fast MCP tools (CodeGraph MCP — external project)

These tools are the CodeGraph fast path and must remain direct-dispatch:

```
codegraph_repo_status
codegraph_find
codegraph_explain
codegraph_pre_edit_check
codegraph_coverage_gaps
codegraph_build_context_pack
```

Source is in a separate repository (CodeGraph index at `.codegraph/` is gitignored here).

---

## 3. Harness Workflow Path

### Call chain

```
MCP Client (Developer / CI)
    │
    ▼
MCP Server (server.ts)
    │
    ├─ profile gate (toolMode.ts)
    │   └─ harness tools ONLY in dev/test mode, NEVER in agent mode
    │
    ├─ run_harness_flow handler (runHarnessFlow.ts)
    │   └─ runModule(flowId, { input, receipts })
    │
    ├─ HarnessRunner (runner.ts) — 14-step pipeline
    │   ├─  1. registry.get(moduleId)
    │   ├─  2. validate input
    │   ├─  3. create runId
    │   ├─  4. write input.json
    │   ├─  5. create harness_run receipt
    │   ├─  6. execute setup
    │   ├─  7. execute run
    │   ├─  8. validate output
    │   ├─  9. execute check
    │   ├─ 10. write output.json
    │   ├─ 11. write artifacts
    │   ├─ 12. mark completed
    │   ├─ 13. update run receipt
    │   └─ 14. return RunState
    │
    ├─ State / Logs / Artifacts / Report
    │   └─ runs/<runId>/ (state.json, logs.jsonl, artifacts/*)
    │
    └─ Full response (runId, status, checkpoints, artifacts, receipts, error)
```

### Characteristics

- **Full 14-step execution pipeline** — validate → setup → run → check → persist → return
- **RunId generated** — `run_<date>_<random>_<seq>`
- **State persisted to disk** — `runs/<runId>/state.json`
- **Artifacts persisted** — `runs/<runId>/artifacts/`
- **Logs recorded** — `runs/<runId>/logs.jsonl`
- **Run receipt** — covers entire execution, references sub-receipts
- **Checkpoints recorded** — pass/fail/warn/skip outcomes per phase
- **Failure flow** — writes `error.json`, failed receipt, never throws
- **7 registered flows**: compression-flow, originals-flow, memory-flow, profile-flow, full-context-flow, mcp-tools-smoke-flow, cli-smoke-flow

### Harness-only tools (CodeContext MCP)

| Tool | Mode | Goes through HarnessRunner? |
|------|------|---------------------------|
| `run_harness_flow` | dev/test only | **Yes** — calls `runModule()` |
| `list_harness_flows` | dev/test only | No — reads from HarnessRegistry directly |
| `get_harness_run` | dev/test only | No — reads from stateStore/artifactStore directly |
| `check_harness_flow` | dev/test only | No — validates manifest via CheckEngine |

Only `run_harness_flow` actually executes through the 14-step pipeline. The other three are read-only harness tools that inspect registry/state without execution.

### Harness-only tools (CodeGraph MCP — external project)

```
codegraph_harness_list
codegraph_harness_run
codegraph_harness_status
codegraph_harness_artifacts
```

---

## 4. Profiles

### CodeContext MCP profiles

Profiles control which tools are exposed to the MCP client. Set via `MCP_TOOL_MODE` env var.

| Profile | Tools | Default | Harness Tools | Dangerous Tools |
|---------|-------|---------|---------------|-----------------|
| **agent** | 7 | ✅ Yes | ❌ None | ❌ None |
| **dev** | 18 | — | ✅ All 4 | ✅ 2 (delete_original, cleanup_originals) |
| **test** | 18 | — | ✅ All 4 | ✅ 2 |

#### Agent profile tools (7)

```
current_scope         — scope resolution (all tools depend on this)
compress_context      — compression (core #1)
retrieve_original     — original recovery
remember_context      — memory write (core #2)
recall_context        — memory search
forget_context        — memory lifecycle
run_context_flow      — unified compression/memory/full flow
```

#### Agent profile exclusions

The following are **intentionally excluded** from agent mode:

- **Harness tools** (4): `list_harness_flows`, `run_harness_flow`, `get_harness_run`, `check_harness_flow`
- **Dangerous tools** (2): `delete_original`, `cleanup_originals`
- **Audit/debug tools** (5): `list_context`, `list_compressions`, `analyze_context`, `list_failures`, `failure_stats`

### Profile rules

```
1. agent profile = fast path only — zero harness tools exposed
2. dev profile   = fast path + harness tools + dangerous tools
3. test profile  = all 18 tools (for CI schema/smoke validation)
4. Never expose harness tools in agent profile
5. Never expose dangerous tools in agent profile
```

---

## 5. Fast Tools List (Complete)

### Always fast path (all 18 tools)

Every tool in CodeContext MCP is fast-path EXCEPT `run_harness_flow`. Fast-path tools call domain services directly without any HarnessRunner involvement.

```
current_scope          → resolveScope() → scopes table
compress_context       → ContentRouter → SafetyLayer → CompressedStore
retrieve_original      → OriginalStore
delete_original        → OriginalStore (dev/test only)
cleanup_originals      → OriginalStore (dev/test only)
list_compressions      → CompressedStore
remember_context       → MemoryService + ProfileService
recall_context         → RecallEngine + ProfileService
forget_context         → MemoryService
list_context           → MemoryService
analyze_context        → ContentRouter + heuristics
list_failures          → FailureStore (dev/test only)
failure_stats          → FailureStore (dev/test only)
list_harness_flows     → HarnessRegistry (dev/test only, read-only)
check_harness_flow     → CheckEngine (dev/test only, read-only)
get_harness_run        → stateStore + artifactStore (dev/test only, read-only)
run_context_flow       → All services direct (NOT through HarnessRunner)
```

### CodeGraph MCP fast tools (external)

```
codegraph_repo_status
codegraph_find
codegraph_explain
codegraph_pre_edit_check
codegraph_coverage_gaps
codegraph_build_context_pack
```

---

## 6. Harness-Only Tools List (Complete)

### CodeContext MCP

| Tool | Profile | Execution | Purpose |
|------|---------|-----------|---------|
| `run_harness_flow` | dev/test | HarnessRunner 14-step | Execute a registered business flow |
| `list_harness_flows` | dev/test | HarnessRegistry read | Discover available flows |
| `get_harness_run` | dev/test | stateStore/artifactStore read | Inspect a past run |
| `check_harness_flow` | dev/test | CheckEngine validate | Pre-flight manifest validation |

### CodeGraph MCP (external)

```
codegraph_harness_list
codegraph_harness_run
codegraph_harness_status
codegraph_harness_artifacts
```

---

## 7. workflow.find — Compact vs Details Behavior

> **Note**: `workflow.find` is a CodeGraph MCP internal function. It does **not** exist in CodeContext MCP. This section documents the CodeGraph behavior for reference.

### Default behavior (with enrichment — slow path)

```
workflow.find(query, { include_details: true })  // DEFAULT
    │
    ├─ search_symbols(query)           // ~185ms  (fast, indexed)
    │
    ├─ for each result:               // ~5500ms (77% of total)
    │   └─ get_symbol(id)             // per-result enrichment
    │       └─ full source snippet
    │       └─ callers/callees
    │       └─ docstrings, tags
    │
    └─ return enriched results        // p95 ≈ 7194ms
```

### Compact behavior (fast path)

```
workflow.find(query, { include_details: false })
    │
    ├─ search_symbols(query)           // ~185ms
    │
    └─ return compact results          // p95 ≈ 185ms
```

### Root cause

The ~7194ms p95 is caused by **per-result `get_symbol()` enrichment**, not by Harness persistence. Each `get_symbol()` call adds source snippet retrieval, relationship traversal, and metadata lookup. With 10+ results, this compounds to 5000-5500ms of enrichment overhead.

**Harness persistence itself adds <100ms** — it's the cheapest part of the pipeline.

### Rule

```
workflow.find must NOT default to include_details: true.
Callers who need enrichment should opt in explicitly.
Agent tools that call workflow.find should use include_details: false by default.
```

---

## 8. Performance Interpretation

### Measured latencies (CodeGraph MCP)

| Path | p95 | What's in it |
|------|-----|-------------|
| Direct MCP | **185ms** | Search only, no enrichment |
| Harness MCP | **5,787ms** | Search + HarnessRunner pipeline + enrichment |
| workflow.find default | **7,194ms** | Search + per-result get_symbol() enrichment |
| Harness persistence | **<100ms** | State write, artifact write, receipt create |

### Key insight

```
workflow.find 慢的主因是 get_symbol enrichment（占约 77%），不是 Harness persistence。
Harness persistence < 100ms — 不是瓶颈。
```

### Impact on architecture decisions

1. **Don't optimize Harness persistence** — it's already fast. The bottleneck is enrichment.
2. **Don't default to enrichment** — `include_details: false` should be the default for any tool that searches or lists.
3. **Don't route fast tools through HarnessRunner** — the pipeline overhead compounds with enrichment overhead.
4. **Keep fast tools direct** — direct handler dispatch has no pipeline overhead.

### CodeContext MCP performance (in-process, warm)

| Operation | Latency |
|-----------|---------|
| compress 100KB | ~108ms p95 |
| compress cache hit | ~2ms |
| retrieve_original 100KB | ~3ms |
| recall 100 memories | ~5ms |
| run_context_flow full 100KB | ~92ms |

CodeContext MCP tools are all fast-path (direct handler dispatch). The HarnessRunner is only invoked by `run_harness_flow`, which is excluded from agent mode.

---

## 9. Do / Don't Rules

### ✅ DO

| Rule | Reason |
|------|--------|
| Keep fast MCP tools as direct handlers | Direct dispatch has no pipeline overhead. 17 of 18 tools already follow this. |
| Gate harness tools behind dev/test profile | Agent mode (default) must never expose harness tools. Already enforced by `toolMode.ts`. |
| Default `include_details` to `false` in search/list tools | Per-result enrichment is the dominant latency source (~77% of workflow.find). |
| Let callers opt into enrichment explicitly | Agents that need full details can pass the flag. Most don't. |
| Treat HarnessRunner as a specialized execution path | It exists for workflow/report/audit/debug — not for high-frequency agent tool calls. |
| Document which tools go through which path | This document is the canonical reference. Keep it updated. |
| Use profiles to enforce the boundary | `agent` profile = no harness tools. `dev`/`test` = harness allowed. Don't blur this line. |

### ❌ DON'T

| Rule | Reason |
|------|--------|
| **Don't route all MCP tools through HarnessRunner by default** | This would add 14-step pipeline overhead to every agent tool call. HarnessRunner is for workflow execution, not general tool dispatch. |
| **Don't sacrifice agent high-frequency path performance for architectural uniformity** | Having two paths (fast + harness) is intentional. Unifying them under HarnessRunner would make every tool call pay the pipeline cost. |
| **Don't expose harness tools in agent/full profile** | Agent profile is for daily coding. Harness tools are for developer debugging and CI. Mixing them adds noise and risk. |
| **Don't let workflow.find default to details enrichment** | Per-result `get_symbol()` calls dominate latency. Make enrichment opt-in. |
| **Don't add HarnessRunner calls to existing fast-path tools** | Tools like `compress_context`, `recall_context`, `run_context_flow` are fast because they skip the pipeline. Don't regress them. |
| **Don't create new profiles that blur the boundary** | If a new profile is needed, define its tool list explicitly. Don't create a "full" profile that mixes fast and harness tools without clear rules. |
| **Don't assume HarnessRunner is slow** | Harness persistence is <100ms. The pipeline is not the bottleneck — enrichment is. If a harness flow is slow, profile it before blaming the runner. |

---

## Appendix A: File Reference

| Concern | File |
|---------|------|
| Profile definitions | `src/mcp/toolMode.ts` |
| Tool schemas | `src/mcp/toolSchemas.ts` |
| Handler registry | `src/mcp/toolRegistry.ts` |
| Server dispatch | `src/mcp/server.ts` |
| HarnessRunner engine | `src/harness/core/runner.ts` |
| Harness flow registration | `src/harness/register.ts` |
| Harness manifests | `src/harness/manifests/*.manifest.ts` |
| run_harness_flow handler | `src/mcp/tools/runHarnessFlow.ts` |
| Performance reports | `reports/performance/` |
| Baseline report | `reports/architecture/fast-path-baseline.md` |
| Tool inventory | `docs/TOOL_INVENTORY.md` |
| Tool surface config | `docs/TOOL_SURFACE.md` |

## Appendix B: Current Boundary Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     MCP Client (stdio)                        │
└───────────────────────────┬──────────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │    Profile Gate            │
              │    (toolMode.ts)           │
              │                            │
              │  agent (7)  ──► fast only  │
              │  dev   (18) ──► fast +     │
              │                harness     │
              │  test  (18) ──► all        │
              └─────────────┬─────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
  ┌───────▼────────┐                 ┌────────▼──────────┐
  │  FAST PATH      │                 │  HARNESS PATH      │
  │  (17 tools)     │                 │  (1 tool)          │
  │                 │                 │                    │
  │  Direct handler │                 │  run_harness_flow  │
  │       │         │                 │       │            │
  │  Domain service │                 │  runModule()       │
  │       │         │                 │       │            │
  │  SQLite DB      │                 │  14-step pipeline  │
  │       │         │                 │       │            │
  │  Compact JSON   │                 │  runs/<id>/        │
  │                 │                 │  state/logs/       │
  │  p50: <10ms     │                 │  artifacts/report  │
  │  p95: <200ms    │                 │                    │
  └─────────────────┘                 └────────────────────┘
          │                                   │
          │     NEVER agent mode              │     ONLY dev/test mode
          │     NEVER HarnessRunner           │     ALWAYS HarnessRunner
          │                                   │
          └─────────────┬─────────────────────┘
                        │
              ┌─────────▼─────────┐
              │   MCP Response    │
              └───────────────────┘
```
