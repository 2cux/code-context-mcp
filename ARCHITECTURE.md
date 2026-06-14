# CodeContext MCP — Architecture

System architecture, module responsibilities, and key data flows.

---

## Table of Contents

- [Overall Architecture](#overall-architecture)
- [Module Responsibilities](#module-responsibilities)
- [Data Flows](#data-flows)
  - [Compression Flow](#compression-flow)
  - [Memory Flow](#memory-flow)
  - [Receipt Flow](#receipt-flow)
  - [Scope Isolation Flow](#scope-isolation-flow)
- [Directory Structure](#directory-structure)

---

## Overall Architecture

```
┌─────────────────────────────────────────┐
│            AI Coding Agent               │
│    (Claude Code / Cursor / etc.)         │
└──────────────┬──────────────────────────┘
               │ MCP Protocol (stdio / JSON-RPC)
               ▼
┌──────────────────────────────────────────┐
│         MCP Server (src/mcp/)            │
│                                          │
│  Tool Handlers:                          │
│  current_scope  compress_context         │
│  retrieve_original  delete_original      │
│  cleanup_originals  list_compressions    │
│  remember_context  recall_context        │
│  forget_context  list_context            │
└──┬───────┬───────┬───────┬──────┬───────┘
   │       │       │       │      │
   ▼       ▼       ▼       ▼      ▼
┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐
│Scope ││Comp- ││Memory││Re-   ││Safety│
│Resol-││ress- ││      ││ceipts││Layer │
│ver   ││ion   ││      ││      ││      │
└──┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬───┘
   │       │       │       │      │
   └───────┴───────┴───────┴──────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│          SQLite (sql.js WASM)            │
│     ~/.code-context-mcp/                 │
│                                          │
│  Tables: scopes, compressed_contexts,    │
│  original_contents, memories,            │
│  profile_facts, receipts                 │
└──────────────────────────────────────────┘
```

The server communicates with AI agents over stdio using the MCP protocol (`@modelcontextprotocol/sdk`). All data is stored locally in a SQLite database via `sql.js` (SQLite compiled to WASM). No network calls.

---

## Module Responsibilities

### `src/index.ts` — Entry Point
- Calls `startServer()` from `src/mcp/server.ts`
- Starts the MCP server with stdio transport

### `src/mcp/server.ts` — MCP Server
- Initializes SQLite database and runs migrations
- Creates `ServerContext` (`{ db, receipts }`)
- Registers all 10 tool handlers with their JSON Schema input definitions
- Dispatches `CallToolRequest` to the correct handler
- Calls `persistDb()` after every mutation
- Wraps handler errors in `isError: true` responses

### `src/scope/` — Scope Resolution
- **`resolveScope.ts`**: Detects git root, remote, branch → computes stable `scopeId` via SHA-256
- **`git.ts`**: Wraps `git rev-parse`, `git remote`, `git branch` CLI calls
- Scope resolution never throws — always falls back to `cwdFallback`

### `src/router/` — Content Type Detection
- **`contentRouter.ts`**: Runs all 8 detectors, picks best match by confidence then priority
- **`detectors/`**: One detector per content type (testOutput, log, commandOutput, code, json, markdown, ragChunk, conversationHistory)
- Each detector uses regex signal matching + `computeConfidence()` (linear scaling, min 2 signals)

### `src/compression/` — Compression Engine
- **`compressionEngine.ts`**: Strategy lookup by `{contentType}_{mode}_v{version}`, fallback to `plain_text`, token counting via tiktoken
- **`registerStrategies.ts`**: Registers all 9 strategies at startup
- **`strategies/`**: One strategy per content type. All implement `CompressionStrategy` interface

### `src/safety/` — Safety Layer
- **`safetyLayer.ts`**: Orchestrates the full safety pipeline
- **`sizeLimit.ts`**: UTF-8 safe truncation at `maxInputBytes`
- **`chunking.ts`**: Content-type-aware chunking (code by declarations, logs by timestamps, text by paragraphs)
- **`timeout.ts`**: Promise-based timeout wrapper (5s per chunk, 30s overall)
- **`failOpen.ts`**: Try/catch wrapper — on any failure, returns original content with `failed: true`

### `src/compressed/` — Compressed Context Store
- **`compressedStore.ts`**: CRUD for `compressed_contexts` table, list with pagination

### `src/originals/` — Original Content Store
- **`originalStore.ts`**: Save/retrieve/delete/cleanup for `original_contents` table, scope validation

### `src/memory/` — Memory System
- **`types.ts`**: TypeScript types: `MemoryType`, `MemoryStatus`, `MemoryRecord`, `ForgetMode`, etc.
- **`memoryService.ts`**: Core CRUD — remember, get, list, forget (4 modes), status transitions, profile fact sync
- **`recallEngine.ts`**: Search pipeline — FTS search → BM25/LIKE scoring → confidence merge → recency decay → CCR linking
- **`memoryFts.ts`**: Full-text search index. Attempts FTS5, falls back to LIKE-based substring matching with custom scorer
- **`lifecycle.ts`**: Valid status transitions (`active → superseded`, `superseded → active`, etc.), bulk expiration
- **`sourceRef.ts`**: Standardized source reference parsing (`user:`, `file:`, `ccr:`, `orig:`, `command:`)

### `src/profile/` — Profile Service
- **`profileService.ts`**: Static/dynamic profile fact CRUD, merged profile retrieval

### `src/receipts/` — Receipt Service
- **`receiptService.ts`**: Create/get/list receipt records. Every operation generates a receipt

### `src/stats/` — Token Statistics
- **`tokenStats.ts`**: Aggregate token statistics from receipts table

### `src/storage/` — Storage Layer
- **`db.ts`**: sql.js init, database persistence, query helpers (`queryOne`, `queryAll`, `runStmt`)
- **`migrations.ts`**: Schema creation + migration runner (receipts CHECK constraint migration)
- **`schema.sql`**: Full DDL for all 7 tables

### `src/utils/` — Utilities
- **`hash.ts`**: SHA-256 (short 8-char, full, content hash)
- **`tokenCount.ts`**: tiktoken `cl100k_base` counter with fallback to character-based estimation
- **`time.ts`**: ISO 8601 timestamp helpers

### `src/cli/` — CLI
- **`index.ts`**: Argument parsing and dispatch
- **`commands.ts`**: All CLI command implementations (scope, compress, retrieve, stats, remember, recall, forget, list-context, profile, receipts, cleanup)

---

## Data Flows

### Compression Flow

```
User / Agent calls compress_context(content, contentType?, ...)
│
├─ 1. Input Validation
│   ├─ Auto-resolve scopeId (git remote + root hash)
│   ├─ Validate content is non-empty
│   └─ Validate contentType / strategy
│
├─ 2. Content Type Detection (if contentType is "unknown")
│   └─ ContentRouter runs 8 detectors → picks best by confidence
│
├─ 3. Safety Layer Pipeline
│   ├─ Size Limit: if content > maxInputBytes → truncate or chunk
│   ├─ Chunking: split by content-type-aware boundaries
│   ├─ Timeout: wrap each chunk in 5s timeout (30s overall)
│   └─ Compression Engine: apply {contentType}_{mode}_v1 strategy
│
├─ 4. Fail-Open
│   └─ On any failure → return original content, set failed=true
│
├─ 5. Persist Results
│   ├─ Save CCR to compressed_contexts table
│   ├─ Optionally save original to original_contents table
│   └─ Create receipt in receipts table
│
└─ 6. Return Result
    ├─ ccrId, compressedContent, token stats, originalRef
    ├─ detection info (auto vs user, confidence)
    └─ warnings, safety actions
```

### Memory Flow

**Remember:**

```
User / Agent calls remember_context(type, content, ...)
│
├─ 1. Input Validation
│   ├─ Validate type (10 valid values)
│   ├─ Validate content (>0, ≤256KB)
│   ├─ Validate confidence (0–1)
│   ├─ Validate ccrId/originalRef if provided (scope match, existence)
│   └─ Auto-derive sourceRef from ccrId/originalRef
│
├─ 2. Persist
│   ├─ INSERT INTO memories (status=active)
│   ├─ Sync to FTS index (or LIKE fallback)
│   └─ If profileTarget: INSERT INTO profile_facts
│
├─ 3. Create receipt
│
└─ 4. Return { memoryId, type, status, receiptId }
```

**Recall:**

```
User / Agent calls recall_context(query, ...)
│
├─ 1. Input Validation
│   ├─ Validate query (>0, ≤1000 chars)
│   ├─ Validate types / status filters
│   └─ Resolve scope
│
├─ 2. Search Pipeline (RecallEngine)
│   ├─ FTS search (LIKE-based with scoring)
│   ├─ Resolve canExpand (linked CCRs)
│   ├─ Confidence merge: mergedScore = score × confidence
│   ├─ Recency decay: exponential over 30 days, up to 30% boost
│   └─ Sort by finalScore → assign ranks
│
├─ 3. Profile Merge (if includeProfile)
│   ├─ Fetch static profile facts
│   └─ Fetch dynamic profile facts
│
├─ 4. Related CCRs (if includeCompressedRefs)
│   ├─ Tier 1: ccr:<id> → direct CCR lookup
│   ├─ Tier 2: orig:<id> → match on original_ref
│   └─ Tier 3: generic sourceRef → match on source_ref or original_ref
│
├─ 5. Create receipt (always, even for empty results)
│
└─ 6. Return { profile, memories[], relatedCompressedContexts[], receiptId }
```

**Forget:**

```
User / Agent calls forget_context(id, mode, ...)
│
├─ 1. Validate mode
│
├─ 2. Fetch existing memory (scope-validated)
│
├─ 3. Execute forget mode
│   ├─ soft_forget: UPDATE status = 'forgotten'
│   ├─ supersede: UPDATE status = 'superseded', superseded_by = <replacementId>
│   ├─ expire: UPDATE status = 'expired'
│   └─ hard_delete: DELETE FROM memories, DELETE FROM profile_facts WHERE source_memory_id = id
│
├─ 4. Create receipt
│
└─ 5. Return { memoryId, previousStatus, newStatus, receiptId }
```

### Receipt Flow

Every tool invocation creates a receipt:

```
Any tool handler
│
├─ Before: capture input state (content hash, query, scopeId)
├─ During: collect result ids (ccrIds, memoryIds, originalRefs)
├─ After: record token stats, failure status
│
└─ ReceiptService.create()
    ├─ Generate id: rcp_<ts-base36>_<rand-3bytes-hex>_<6-digit-seq>
    ├─ INSERT INTO receipts (...)
    └─ Return receipt record
```

Receipts are non-blocking — if receipt write fails, the tool still returns its result with a warning.

Relevant receipts can be queried via the CLI:
```bash
pnpm cli receipts --limit 10
pnpm cli receipts --operation compress --limit 5
pnpm cli receipt <receiptId>
```

### Scope Isolation Flow

```
Any tool call with scopeId
│
├─ If scopeId not provided:
│   ├─ Run git rev-parse --show-toplevel
│   ├─ Run git remote get-url origin
│   ├─ Compute scopeId = "repo_" + SHA256(remote + root)[0:8]
│   └─ Persist (INSERT OR IGNORE) scope record
│
├─ All DB queries filter by scope_id:
│   ├─ SELECT ... WHERE scope_id = ?
│   ├─ UPDATE ... WHERE scope_id = ?
│   └─ DELETE ... WHERE scope_id = ?
│
├─ Cross-scope access rejected:
│   ├─ retrieve_original: checks scope match, returns scope_mismatch error
│   └─ remember_context with ccrId/originalRef: checks scope match
│
└─ Each repo has its own scopeId → complete data isolation
```

---

## Directory Structure

```
src/
├── index.ts                      # Entry point
├── cli/
│   ├── index.ts                  # CLI argument parsing
│   └── commands.ts               # All CLI commands
├── mcp/
│   ├── server.ts                 # MCP server setup, tool registration
│   └── tools/                    # Tool handlers (one per tool)
│       ├── currentScope.ts
│       ├── compressContext.ts
│       ├── retrieveOriginal.ts
│       ├── deleteOriginal.ts
│       ├── cleanupOriginals.ts
│       ├── listCompressions.ts
│       ├── rememberContext.ts
│       ├── recallContext.ts
│       ├── forgetContext.ts
│       └── listContext.ts
├── scope/
│   ├── resolveScope.ts           # Scope resolution
│   └── git.ts                    # Git CLI wrappers
├── router/
│   ├── contentRouter.ts          # Content type detection
│   └── detectors/                # 8 content type detectors
├── compression/
│   ├── compressionEngine.ts      # Core compression engine
│   ├── registerStrategies.ts     # Strategy registration
│   └── strategies/               # 9 compression strategies
├── safety/
│   ├── safetyLayer.ts            # Orchestrator
│   ├── sizeLimit.ts              # UTF-8 safe truncation
│   ├── chunking.ts               # Content-aware chunking
│   ├── timeout.ts                # Timeout wrapper
│   └── failOpen.ts               # Fail-open wrapper
├── compressed/
│   └── compressedStore.ts        # CCR persistence
├── originals/
│   └── originalStore.ts          # Original content persistence
├── memory/
│   ├── types.ts                  # Memory types
│   ├── memoryService.ts          # Memory CRUD
│   ├── memoryFts.ts              # Full-text search
│   ├── recallEngine.ts           # Search + scoring
│   ├── lifecycle.ts              # Status transitions
│   └── sourceRef.ts              # Source reference parsing
├── profile/
│   └── profileService.ts         # Profile fact CRUD
├── receipts/
│   └── receiptService.ts         # Receipt CRUD
├── stats/
│   └── tokenStats.ts             # Token statistics
├── storage/
│   ├── db.ts                     # Database init + helpers
│   ├── migrations.ts             # Migration runner
│   └── schema.sql                # Full DDL
└── utils/
    ├── hash.ts                   # SHA-256
    ├── tokenCount.ts             # Token counting
    └── time.ts                   # Timestamp helpers
```

---

## Key Design Decisions

### Why SQLite + sql.js (WASM)?
- **Zero install**: No native binaries needed — runs anywhere Node.js runs
- **Local-first**: Database file at `~/.code-context-mcp/code-context.sqlite`
- **Scope isolation**: FK constraints ensure referential integrity per scope
- **Portable**: Database can be backed up, moved, or deleted as a single file

### Why Fail-Open Everywhere?
- Compression failures must not block the agent from working
- If the compressor crashes, the agent still gets the original content
- DB write failures produce warnings, not errors
- Scope resolution never throws

### Why Conservative Compression?
- Code compression preserves semantics: imports, exports, type definitions, signatures, TODOs
- Test output preserves: failed test names, assertions, expected/received, stack traces
- Logs preserve: ERROR/WARN lines, exceptions, stack trace tops and bottoms
- Content within token budget is kept intact (only oversized content is compressed)

### Why Memory Lifecycle?
- Old memories must not silently pollute future recall
- Status transitions are validated (no `superseded → forgotten`)
- Reversals are possible (`superseded → active`) for recovery
- `hard_delete` is the only truly destructive operation

### Why Receipts for Everything?
- Audit trail proves what happened without storing private content
- Token savings can be aggregated from receipts
- Errors are recorded even when the operation fails
- Receipts are scope-scoped — each repo has its own audit trail
