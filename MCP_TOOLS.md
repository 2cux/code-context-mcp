# CodeContext MCP — Tool Reference

Complete reference for all 18 MCP tools. Every tool is scope-isolated and generates audit receipts.

> **CLI boundary:** `code-context stats`, `code-context profile`, and `code-context receipts` are CLI commands, not MCP tools. There are no callable MCP tools named `get_stats`, `get_profile`, or `list_receipts`. MCP clients can receive repository profile data through `recall_context`; statistics and receipt listing are CLI-only operations.

---

## Table of Contents

- [Compression Tools](#compression-tools)
  - [`current_scope`](#current_scope)
  - [`compress_context`](#compress_context)
  - [`retrieve_original`](#retrieve_original)
  - [`delete_original`](#delete_original)
  - [`cleanup_originals`](#cleanup_originals)
  - [`list_compressions`](#list_compressions)
- [Memory Tools](#memory-tools)
  - [`remember_context`](#remember_context)
  - [`recall_context`](#recall_context)
  - [`forget_context`](#forget_context)
  - [`list_context`](#list_context)
- [Unified Tools](#unified-tools)
  - [`run_context_flow`](#run_context_flow)
- [Analysis & Failure Tools](#analysis--failure-tools)
  - [`analyze_context`](#analyze_context)
  - [`list_failures`](#list_failures)
  - [`failure_stats`](#failure_stats)
- [Harness Tools](#harness-tools) (dev/test only)
  - [`list_harness_flows`](#list_harness_flows)
  - [`check_harness_flow`](#check_harness_flow)
  - [`run_harness_flow`](#run_harness_flow)
  - [`get_harness_run`](#get_harness_run)

---

## Compression Tools

### `current_scope`

Resolve a stable `scopeId` for the current repository. All other tools use this id for scope isolation.

**Input:**

| Field | Type | Required | Description |
|---|---|---|---|
| `cwd` | `string` | No | Override working directory. Defaults to `process.cwd()`. |

**Output:**

```json
{
  "scopeId": "repo_a1b2c3d4",
  "gitRoot": "/path/to/repo",
  "remote": "https://github.com/user/repo.git",
  "branch": "main",
  "scopeStrategy": "gitRemote+gitRoot"
}
```

**Scope strategies** (in priority order):

| Strategy | Hash input | When |
|---|---|---|
| `gitRemote+gitRoot` | `hash(gitRemote + gitRoot)` | Git repo with origin remote |
| `gitRootOnly` | `hash(gitRoot)` | Git repo without remote |
| `cwdFallback` | `hash(cwd)` | Not inside a git repo |

The scope record is persisted (INSERT OR IGNORE) on each call. Scope resolution never throws.

---

### `compress_context`

Compress content to reduce token consumption. Automatically detects content type, applies type-specific compression, and handles oversized inputs via chunking. On failure, returns original content (fail-open).

**Input:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `scopeId` | `string` | No | auto-resolved | Scope id from `current_scope`. Auto-resolved when omitted. |
| `content` | `string` | **Yes** | — | The raw content to compress. |
| `contentType` | `string` | No | `"unknown"` | Content type hint. Auto-detected when `"unknown"` or omitted. |
| `strategy` | `string` | No | `"conservative"` | `"conservative"` or `"auto"`. |
| `keepOriginal` | `boolean` | No | `true` | Save original content for later retrieval via `originalRef`. |
| `maxTokens` | `number` | No | `2000` | Target max output tokens. |
| `timeoutMs` | `number` | No | `5000` | Compression timeout in milliseconds. |
| `maxInputBytes` | `number` | No | `1048576` (1 MB) | Max input size before chunking. |
| `metadata` | `object` | No | — | Optional metadata (source, command, filePath, etc.). |

**Valid `contentType` values:**

`test_output`, `log`, `command_output`, `code`, `json`, `markdown`, `plain_text`, `rag_chunk`, `file_summary`, `conversation_history`, `unknown`

**Output:**

```json
{
  "ccrId": "ccr_lz3abc_1a2b3c_000001",
  "compressed": true,
  "scopeId": "repo_a1b2c3d4",
  "contentType": "test_output",
  "strategy": "test_output_conservative_v1",
  "compressedContent": "## Test Results Summary\n...",
  "summary": "Vitest run: 3 failed, 12 passed",
  "originalRef": "orig_4d5e6f_7a8b9c_000002",
  "tokensBefore": 2450,
  "tokensAfter": 487,
  "tokensSaved": 1963,
  "compressionRatio": 0.8012,
  "canRetrieveOriginal": true,
  "receiptId": "rcp_lz3def_0d1e2f_000003",
  "warnings": [],
  "detection": { "method": "auto", "detectedAs": "test_output", "confidence": 0.85 }
}
```

**Failure output** (fail-open — original content returned):

```json
{
  "ccrId": "ccr_...",
  "compressed": false,
  "failed": true,
  "errorReason": "compression_timeout",
  "compressedContent": "<original content unchanged>",
  "tokensBefore": 2450,
  "tokensAfter": 2450,
  "tokensSaved": 0,
  "compressionRatio": 0,
  "warnings": ["Compression timed out after 5000ms — returning original content"]
}
```

**Pipeline:**

```
Validate inputs → ContentRouter auto-detect → Safety Layer
  (size limit → chunking → timeout → CompressionEngine → failOpen)
  → Persist CCR → Save original → Create receipt → Return result
```

**Compression strategy IDs** follow the pattern `{contentType}_{mode}_v{majorVersion}`. Example: `test_output_conservative_v1`.

---

### `retrieve_original`

Retrieve original (uncompressed) content by `originalRef`. Supports offset/limit pagination for large originals. Scope-isolated — only retrieves content within the given `scopeId`.

**Input:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `scopeId` | `string` | No | auto-resolved | Scope id from `current_scope`. Auto-resolved when omitted. |
| `originalRef` | `string` | **Yes** | — | The `originalRef` returned by `compress_context`. |
| `offset` | `number` | No | `0` | Character offset for pagination. |
| `limit` | `number` | No | `10000` | Max characters to return. |

**Output:**

```json
{
  "scopeId": "repo_a1b2c3d4",
  "originalRef": "orig_4d5e6f_7a8b9c_000002",
  "contentType": "test_output",
  "content": "FAIL src/auth.test.ts > login ...",
  "tokens": 2450,
  "metadata": { "autoDetectedContentType": "test_output" },
  "createdAt": "2026-06-14T10:30:00.000Z",
  "receiptId": "rcp_...",
  "offset": 0,
  "returnedChars": 5000,
  "totalChars": 12345,
  "hasMore": true
}
```

**Error responses** (all include receipts):

| Error code | Meaning |
|---|---|
| `original_not_found` | No record exists with that `originalRef` |
| `scope_mismatch` | Record exists but belongs to a different scope |
| `original_deleted` | Record was deleted or expired |
| `storage_error` | Unexpected DB error |

---

### `delete_original`

Delete a single original content record by `originalRef`. Updates the associated CCR to `canRetrieveOriginal = 0`.

**Input:**

| Field | Type | Required | Description |
|---|---|---|---|
| `scopeId` | `string` | **Yes** | Scope id from `current_scope`. |
| `originalRef` | `string` | **Yes** | The `originalRef` to delete. |

**Output:**

```json
{
  "scopeId": "repo_a1b2c3d4",
  "originalRef": "orig_4d5e6f_7a8b9c_000002",
  "deleted": true,
  "receiptId": "rcp_..."
}
```

Scope-isolated — only deletes within the given `scopeId`.

---

### `cleanup_originals`

Remove all expired original content records for a project scope. For each affected CCR that no longer has any originals, sets `canRetrieveOriginal = 0`.

**Input:**

| Field | Type | Required | Description |
|---|---|---|---|
| `scopeId` | `string` | **Yes** | Scope id from `current_scope`. |

**Output:**

```json
{
  "scopeId": "repo_a1b2c3d4",
  "deleted": 3,
  "affectedCcrIds": ["ccr_...", "ccr_..."],
  "message": "Cleaned up 3 expired original(s). 2 CCR(s) no longer have retrievable originals.",
  "receiptId": "rcp_..."
}
```

---

### `list_compressions`

List compressed context records for a project scope. Paginated with summaries and aggregate statistics.

**Input:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `scopeId` | `string` | **Yes** | — | Scope id from `current_scope`. |
| `contentType` | `string` | No | — | Filter by content type. |
| `limit` | `number` | No | `20` | Max records (1–100). |
| `offset` | `number` | No | `0` | Pagination offset. |

**Output:**

```json
{
  "scopeId": "repo_a1b2c3d4",
  "items": [
    {
      "ccrId": "ccr_...",
      "contentType": "test_output",
      "summary": "Vitest run: 3 failed, 12 passed",
      "originalRef": "orig_...",
      "tokensBefore": 2450,
      "tokensAfter": 487,
      "tokensSaved": 1963,
      "retrieveCount": 0,
      "failed": false,
      "createdAt": "2026-06-14T10:30:00.000Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0,
  "stats": {
    "totalSaved": 45230,
    "avgRatio": 0.72
  }
}
```

---

## Memory Tools

### `remember_context`

Save structured project memory. Creates a typed memory record scoped to the current repository, optionally writing to the project profile.

**Input:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `scopeId` | `string` | No | auto-resolved | Scope id from `current_scope`. |
| `type` | `string` | **Yes** | — | Memory type (see valid types below). |
| `content` | `string` | **Yes** | — | Full memory content. Max 256 KB. |
| `summary` | `string` | No | — | Short summary. Used as profile fact content when set. |
| `sourceRef` | `string` | No | — | Source reference. Standard formats: `user:manual`, `file:<path>`, `ccr:<id>`, `orig:<id>`, `command:<cmd>`. |
| `confidence` | `number` | No | `0.8` | Confidence score 0–1. |
| `profileTarget` | `string` | No | — | `"static"` for long-term facts, `"dynamic"` for transient context. No profile fact when omitted. |
| `expiresAt` | `string` | No | — | ISO 8601 expiration date. |
| `tags` | `string[]` | No | — | Tags for categorization. |

**Valid memory `type` values:**

`decision`, `bug`, `command`, `file_summary`, `project_rule`, `user_preference`, `current_task`, `test_failure`, `api_contract`, `dependency`

**Output:**

```json
{
  "memoryId": "mem_lz3ghi_7a8b9c_000012",
  "scopeId": "repo_a1b2c3d4",
  "type": "project_rule",
  "status": "active",
  "receiptId": "rcp_lz3jkl_0d1e2f_000013",
  "summary": "Use pnpm as the package manager",
  "sourceRef": "user:manual",
  "profileTarget": "static"
}
```

**Pipeline:**

```
Validate inputs → Resolve scope → Validate ccrId/originalRef (if provided)
  → MemoryService.remember()
    → INSERT memories → FTS sync → INSERT profile_facts (if profileTarget)
    → Create receipt → Return result
```

When `ccrId` is provided:
- Auto-derives `sourceRef` as `ccr:<id>` if not already set
- Auto-derives `summary` from the CCR if not already set
- Warns if memory type doesn't align with compression content type

When `originalRef` is provided:
- Validates the original exists and belongs to the same scope
- Auto-derives `sourceRef` as `orig:<id>` if not already set

---

### `recall_context`

Recall project profile, relevant memories, and related compressed context references for a given query.

**Input:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `scopeId` | `string` | No | auto-resolved | Scope id from `current_scope`. |
| `query` | `string` | **Yes** | — | Search query. Max 1000 chars. |
| `types` | `string[]` | No | — | Filter by memory types. |
| `status` | `string[]` | No | `["active"]` | Filter by status. |
| `includeInactive` | `boolean` | No | `false` | Include all statuses (superseded, forgotten, expired). |
| `limit` | `number` | No | `10` | Max memories (1–50). |
| `includeProfile` | `boolean` | No | `true` | Include repo profile in result. |
| `includeStatic` | `boolean` | No | = `includeProfile` | Include static profile facts. |
| `includeDynamic` | `boolean` | No | = `includeProfile` | Include dynamic profile facts. |
| `includeCompressedRefs` | `boolean` | No | `true` | Include related compressed contexts. |
| `retrieveOriginal` | `boolean` | No | `false` | Auto-retrieve original content for matched CCRs. |

**Output:**

```json
{
  "scopeId": "repo_a1b2c3d4",
  "profile": {
    "static": [
      {
        "id": "pf_...",
        "content": "Use pnpm as the package manager",
        "sourceMemoryId": "mem_...",
        "sourceRef": "user:manual",
        "confidence": 0.8,
        "updatedAt": "2026-06-14T10:30:00.000Z"
      }
    ],
    "dynamic": [
      {
        "id": "pf_...",
        "content": "Refactoring auth module",
        "sourceMemoryId": "mem_...",
        "sourceRef": "user:manual",
        "confidence": 0.8,
        "updatedAt": "2026-06-14T11:00:00.000Z"
      }
    ]
  },
  "memories": [
    {
      "id": "mem_lz3ghi_7a8b9c_000012",
      "type": "project_rule",
      "content": "Use pnpm as the package manager. No npm or yarn.",
      "summary": "Use pnpm as the package manager",
      "sourceRef": "user:manual",
      "confidence": 0.8,
      "status": "active",
      "score": 2.45,
      "canExpand": false,
      "createdAt": "2026-06-14T10:30:00.000Z",
      "updatedAt": "2026-06-14T10:30:00.000Z",
      "tags": ["build", "convention"]
    }
  ],
  "relatedCompressedContexts": [],
  "receiptId": "rcp_lz3mno_3f4g5h_000014"
}
```

**Search pipeline:**

```
Validate inputs → Resolve scope → RecallEngine.searchEnhanced()
  1. FTS search (BM25 or LIKE fallback with scoring)
  2. Resolve canExpand (linked compressed contexts)
  3. Confidence merge: mergedScore = score × confidence
  4. Recency weighting: exponential decay over 30 days, up to 30% boost
  5. Sort by finalScore descending → assign ranks
  → Merge profile facts (static + dynamic layers)
  → Find related CCRs (three-tier: ccr:<id> → orig:<id> → generic sourceRef)
  → Create recall receipt (always, even for empty results)
```

**CCR matching** (three-tier):

| Tier | Pattern | Lookup |
|---|---|---|
| 1 | `ccr:<id>` | Direct CCR lookup by id |
| 2 | `orig:<id>` | CCRs with matching `original_ref` |
| 3 | `file:<path>`, `command:<cmd>`, `user:manual`, legacy | Match on `source_ref` or `original_ref` |

---

### `forget_context`

Forget, supersede, or expire a project memory. Prevents stale information from polluting future recall results.

**Input:**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | **Yes** | Memory id to forget (from `remember_context` or `list_context`). |
| `mode` | `string` | **Yes** | `soft_forget`, `supersede`, `expire`, or `hard_delete`. |
| `reason` | `string` | No | Reason for forgetting. Max 2000 chars. Stored in receipt. |
| `supersededBy` | `string` | *for `supersede` | Id of the memory that replaces this one. |
| `scopeId` | `string` | No | Scope id from `current_scope`. Auto-resolved when omitted. |

**Modes:**

| Mode | Effect | Recoverable |
|---|---|---|
| `soft_forget` | Status → `forgotten` | Yes (reverse to `active`) |
| `supersede` | Status → `superseded`, sets `supersededBy` | Yes (reverse to `active`) |
| `expire` | Status → `expired` | Yes (reverse to `active`) |
| `hard_delete` | DELETE row + associated profile_facts | **No** (permanent) |

**Output:**

```json
{
  "memoryId": "mem_lz3ghi_7a8b9c_000012",
  "previousStatus": "active",
  "newStatus": "superseded",
  "supersededBy": "mem_new_xxxx_000015",
  "receiptId": "rcp_..."
}
```

**Lifecycle validation:** Invalid transitions (e.g., `superseded → forgotten`) throw an error. Valid transitions:

```
active → superseded, forgotten, expired
superseded → active
forgotten → active
expired → active
```

---

### `list_context`

List project memories with filtering, sorting, and pagination. Useful for auditing and browsing all memories regardless of status.

**Input:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `scopeId` | `string` | **Yes** | — | Scope id from `current_scope`. |
| `types` | `string[]` | No | all | Filter by memory types. |
| `status` | `string[]` | No | all | Filter by status. All statuses returned when omitted. |
| `limit` | `number` | No | `50` | Max records (1–100). |
| `offset` | `number` | No | `0` | Pagination offset. |
| `sortBy` | `string` | No | `"createdAt"` | `"createdAt"`, `"updatedAt"`, `"type"`, `"status"`, `"confidence"` |
| `sortOrder` | `string` | No | `"desc"` | `"asc"` or `"desc"`. |

**Output:**

```json
{
  "scopeId": "repo_a1b2c3d4",
  "items": [
    {
      "id": "mem_...",
      "type": "project_rule",
      "summary": "Use pnpm as the package manager",
      "status": "active",
      "sourceRef": "user:manual",
      "confidence": 0.8,
      "createdAt": "2026-06-14T10:30:00.000Z",
      "updatedAt": "2026-06-14T10:30:00.000Z"
    }
  ],
  "total": 15
}
```

Note: unlike `recall_context`, `list_context` returns all statuses by default (useful for auditing). The `status` field is not filtered unless explicitly provided.

---

## Unified Tools

### `run_context_flow`

Unified agent-facing entry point. Wraps compression, memory, and recall into a single call — reducing tool-selection overhead for AI coding agents.

**Three flow modes:**
- `compression` — compress content, optionally save memory and recall
- `memory` — remember and/or recall project context
- `full` — compress → remember → recall complete chain

**Input:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `flow` | `string` | **Yes** | — | `"compression"`, `"memory"`, or `"full"`. |
| `scopeId` | `string` | No | auto-resolved | Scope id from `current_scope`. |
| `goal` | `string` | No | — | What the agent is trying to accomplish. |
| `content` | `string` | * | — | Required for compression/full flows. |
| `contentType` | `string` | No | auto-detected | Content type hint. |
| `query` | `string` | No | — | Search query for recall step. |
| `options` | `object` | No | — | `{ keepOriginal, includeRecall, saveMemory, maxTokens }` |

**Output (full flow):**

```json
{
  "flow": "full",
  "status": "ok",
  "summary": "Compressed to CCR ccr_...; saved 28986 tokens; 3 memories processed",
  "runId": "flow_lz3abc_1a2b3c4d",
  "receiptId": "rcp_...",
  "ccrId": "ccr_...",
  "originalRef": "orig_...",
  "compressedContent": "...",
  "tokensBefore": 29250,
  "tokensAfter": 264,
  "tokensSaved": 28986,
  "compressionRatio": 0.99,
  "memories": [{ "id": "mem_...", "type": "file_summary", "status": "active" }],
  "profile": { "static": [...], "dynamic": [...] },
  "relatedCompressedContexts": [...],
  "warnings": []
}
```

All individual operations are fail-open — partial failures are reported with `status: "partial"` and warnings.

**Architecture:** `run_context_flow` reuses the same domain services as individual tools (CompressedStore, MemoryService, RecallEngine, ProfileService) without duplicating business logic. See `src/mcp/tools/runContextFlow.ts` and shared handler registry at `src/mcp/toolRegistry.ts`.

---

## Analysis & Failure Tools

### `analyze_context`

Read-only analysis tool that reviews the current project context and suggests which other tools to call next. It does not mutate storage.

**Typical uses:**

- Decide whether content should be compressed, remembered, recalled, or ignored
- Get human-readable reasoning before invoking mutation tools
- Inspect likely next steps without writing receipts for additional actions

### `list_failures`

List failure-learning events captured from compression, recall, and repeated original retrieval flows.

**Typical filters:**

- `eventType`: `compression_timeout`, `compression_error`, `oversized_input`, `poor_compression_ratio`, `recall_no_hit`, `recall_low_confidence`, `recall_wrong_memory`, `high_retrieve_count`
- `operation`: `compress`, `recall`, `retrieve_original`
- `limit` / `offset` for pagination

### `failure_stats`

Return aggregate failure statistics for the current scope so agents can spot recurring weak points in compression and recall behavior.

**Typical output includes:**

- Total failure events
- Counts by event type
- Counts by operation
- Scope id for the analyzed repository

---

## Harness Tools

> ⚠️ **Dev/Test mode only.** These tools are not exposed in default agent mode.
> Set `MCP_TOOL_MODE=dev` or `MCP_TOOL_MODE=test` to access them.

Harness tools manage CodeContext's internal test infrastructure. They inspect and execute Harness business flows for CI, smoke testing, and validation.

### `list_harness_flows`

List all registered Harness business-flow manifests. Returns flow id, name, description, phases, covered tools, and input schema.

**Input:** `{ tag?: string, capability?: string }` (optional filters)

### `check_harness_flow`

Validate a harness flow manifest without executing it. Checks structure, registration, input schema conformance, and artifact declarations.

**Input:** `{ flowId: string, exampleInput?: object }`

### `run_harness_flow`

Execute a registered Harness business flow. Runs the full pipeline: validate → setup → run → check → artifacts → receipt. Returns runId, status, and produced artifacts.

**Input:** `{ flowId: string, input?: object }`

### `get_harness_run`

Retrieve the full state of a previous harness run by runId. Returns checkpoint results, artifacts, event logs, and associated receipts.

**Input:** `{ runId: string }`

**7 registered flows:**
`compression-flow`, `originals-flow`, `memory-flow`, `profile-flow`, `full-context-flow`, `mcp-tools-smoke-flow`, `cli-smoke-flow`

---

## Shared Behaviors

### Scope Auto-Resolution

When a tool documents `scopeId` as optional, omitting it auto-resolves the scope using `current_scope` logic:
1. Detect git root and remote
2. Hash `gitRemote + gitRoot` (preferred) or `gitRoot` or `cwd`
3. Persist the scope record (best-effort, never blocks)

### Receipts

Every tool generates an audit receipt on completion. Receipts record:
- `id`, `operation`, `scopeId`
- Token statistics (for compression tools)
- Result/memory/CCR ids
- Failure status and error reason
- Timestamp (ISO 8601)

Receipt generation is non-blocking — if the receipt write fails, the tool still returns its result with a warning.

### Fail-Open

Compression failures return original content with `failed: true` and `errorReason` set. Memory search failures return empty results with warnings. The agent is never blocked by internal errors.

### Error Format

All tool errors follow this structure:

```json
{
  "content": [{ "type": "text", "text": "Error: <message>" }],
  "isError": true
}
```

### Persistence

After every mutation (compress, remember, forget, etc.), the SQLite database is persisted to disk via `persistDb()`. The database file is at `~/.code-context-mcp/code-context.sqlite`.
