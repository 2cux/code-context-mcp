# CodeContext MCP — Data Model

Complete data model reference: record types, their fields, relationships, and the underlying SQLite schema.

---

## Table of Contents

- [ScopeRecord](#scoperecord)
- [CompressedContextRecord (CCR)](#compressedcontextrecord-ccr)
- [OriginalContentRecord](#originalcontentrecord)
- [MemoryRecord](#memoryrecord)
- [RepoProfile](#repoprofile)
- [Receipt](#receipt)
- [SQLite Schema](#sqlite-schema)

---

## ScopeRecord

Represents a resolved project scope. One row per repository that CodeContext has interacted with.

| Field | Type | Description |
|---|---|---|
| `scopeId` | `string` | Primary key. Form: `repo_<8-char-sha256>` or `cwd_<8-char-sha256>`. |
| `gitRoot` | `string?` | Absolute path to git root directory. |
| `remote` | `string?` | Git origin remote URL. |
| `branch` | `string?` | Current git branch name. |
| `cwd` | `string` | Working directory when the scope was resolved. |
| `scopeStrategy` | `enum` | Resolution strategy: `gitRemote+gitRoot`, `gitRootOnly`, `cwdFallback`. |
| `createdAt` | `ISO 8601` | When the scope was first resolved. |
| `updatedAt` | `ISO 8601` | When the scope was last re-resolved. |

**Scope ID generation:**

```
gitRemote+gitRoot:  scopeId = "repo_" + SHA256(gitRemote + gitRoot)[0:8]
gitRootOnly:        scopeId = "repo_" + SHA256(gitRoot)[0:8]
cwdFallback:        scopeId = "cwd_"  + SHA256(cwd)[0:8]
```

**Example:**

```json
{
  "scopeId": "repo_a1b2c3d4",
  "gitRoot": "/home/user/projects/backend",
  "remote": "https://github.com/org/backend.git",
  "branch": "main",
  "cwd": "/home/user/projects/backend",
  "scopeStrategy": "gitRemote+gitRoot",
  "createdAt": "2026-06-14T10:00:00.000Z",
  "updatedAt": "2026-06-14T12:00:00.000Z"
}
```

---

## CompressedContextRecord (CCR)

The result of a `compress_context` call. Every compression produces exactly one CCR.

| Field | Type | Description |
|---|---|---|
| `id` (ccrId) | `string` | Primary key. Form: `ccr_<timestamp-base36>_<rand-3bytes-hex>_<6-digit-seq>`. |
| `scopeId` | `string` | FK → `scopes.scope_id`. Isolates this CCR to a repo. |
| `contentType` | `enum` | Detected or user-specified content type (11 values). |
| `strategy` | `string` | Compression strategy id, e.g. `test_output_conservative_v1`. |
| `compressedContent` | `string` | The compressed output. |
| `summary` | `string?` | Short summary extracted during compression. |
| `originalRef` | `string?` | FK → `original_contents.id`. For retrieving the original. |
| `sourceRef` | `string?` | Source hint: `file:path`, `command:cmd`, etc. |
| `metadata` | `JSON string?` | Detection confidence, safety warnings, user metadata. |
| `tokensBefore` | `number` | Token count of original content. |
| `tokensAfter` | `number` | Token count of compressed content. |
| `tokensSaved` | `number` | `tokensBefore - tokensAfter`. |
| `compressionRatio` | `number (float)` | `tokensSaved / tokensBefore`, rounded to 4 decimals. |
| `canRetrieveOriginal` | `0 \| 1` | Whether the original content is still available. Set to 0 after cleanup. |
| `retrieveCount` | `number` | How many times `retrieve_original` was called for this CCR. |
| `failed` | `0 \| 1` | Whether compression failed (fail-open). |
| `errorReason` | `string?` | Error message when `failed = 1`. |
| `createdAt` | `ISO 8601` | When the compression was created. |
| `updatedAt` | `ISO 8601` | Last modified timestamp. |
| `expiresAt` | `ISO 8601?` | Optional expiration date. |

**Valid `contentType` values:**

`test_output`, `log`, `command_output`, `code`, `json`, `markdown`, `plain_text`, `rag_chunk`, `file_summary`, `conversation_history`, `unknown`

**Example:**

```json
{
  "id": "ccr_lz3abc_1a2b3c_000001",
  "scopeId": "repo_a1b2c3d4",
  "contentType": "test_output",
  "strategy": "test_output_conservative_v1",
  "compressedContent": "## Test Results Summary\n**Command:** npx vitest run\n...",
  "summary": "Vitest run: 3 failed, 12 passed",
  "originalRef": "orig_4d5e6f_7a8b9c_000002",
  "tokensBefore": 2450,
  "tokensAfter": 487,
  "tokensSaved": 1963,
  "compressionRatio": 0.8012,
  "canRetrieveOriginal": 1,
  "retrieveCount": 0,
  "failed": 0,
  "createdAt": "2026-06-14T10:30:00.000Z"
}
```

---

## OriginalContentRecord

The full, uncompressed original content saved during compression. Linked one-to-one with a CCR via `ccrId`.

| Field | Type | Description |
|---|---|---|
| `id` (originalRef) | `string` | Primary key. Form: `orig_<timestamp-base36>_<rand-3bytes-hex>_<6-digit-seq>`. |
| `scopeId` | `string` | FK → `scopes.scope_id`. |
| `ccrId` | `string` | FK → `compressed_contexts.id`. The CCR this original belongs to. |
| `contentType` | `string` | Content type at time of compression. |
| `content` | `string` | The full original content. |
| `contentHash` | `string` | SHA-256 hash of `content` for integrity verification. |
| `tokens` | `number` | Token count of the original content. |
| `metadata` | `JSON string?` | Detection and metadata from compression. |
| `createdAt` | `ISO 8601` | When the original was saved. |
| `expiresAt` | `ISO 8601?` | Optional expiration date. |

**Example:**

```json
{
  "id": "orig_4d5e6f_7a8b9c_000002",
  "scopeId": "repo_a1b2c3d4",
  "ccrId": "ccr_lz3abc_1a2b3c_000001",
  "contentType": "test_output",
  "content": "FAIL src/auth.test.ts > login ...\n...",
  "contentHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "tokens": 2450,
  "createdAt": "2026-06-14T10:30:00.000Z"
}
```

---

## MemoryRecord

A typed, lifecycle-managed project memory entry. Memories are scope-isolated and have four statuses with validated transitions.

| Field | Type | Description |
|---|---|---|
| `id` (memoryId) | `string` | Primary key. Form: `mem_<timestamp-base36>_<rand-3bytes-hex>_<6-digit-seq>`. |
| `scopeId` | `string` | FK → `scopes.scope_id`. |
| `type` | `enum` | Memory type (10 values). |
| `content` | `string` | Full memory content. Max 256 KB. |
| `summary` | `string?` | Short summary for display and profile. |
| `sourceRef` | `string?` | Source reference. Standard: `user:manual`, `file:<path>`, `ccr:<id>`, `orig:<id>`, `command:<cmd>`. |
| `confidence` | `number` | Confidence score 0.0–1.0. Default 0.8. |
| `status` | `enum` | Lifecycle status: `active`, `superseded`, `forgotten`, `expired`. |
| `supersededBy` | `string?` | FK → `memories.id`. Set when this memory is superseded by another. |
| `tags` | `JSON array?` | Array of tag strings. |
| `createdAt` | `ISO 8601` | When the memory was created. |
| `updatedAt` | `ISO 8601` | Last modified timestamp. |
| `expiresAt` | `ISO 8601?` | Optional expiration date. |
| `supersedes` | `string[]` | **Computed** (reverse of `supersededBy`). All memory IDs this memory supersedes. Not stored — resolved at query time. |

**Valid memory `type` values:**

`decision`, `bug`, `command`, `file_summary`, `project_rule`, `user_preference`, `current_task`, `test_failure`, `api_contract`, `dependency`

**Status lifecycle:**

```
active ──────────────► superseded ──► active (reversal)
active ──────────────► forgotten  ──► active (reversal)
active ──────────────► expired    ──► active (reversal)
any    ──[hard_delete]──► permanently removed
```

**Example:**

```json
{
  "id": "mem_lz3ghi_7a8b9c_000012",
  "scopeId": "repo_a1b2c3d4",
  "type": "project_rule",
  "content": "Use pnpm as the package manager. No npm or yarn.",
  "summary": "Use pnpm as the package manager",
  "sourceRef": "user:manual",
  "confidence": 0.8,
  "status": "active",
  "supersededBy": null,
  "supersedes": [],
  "tags": ["build", "convention"],
  "createdAt": "2026-06-14T10:30:00.000Z",
  "updatedAt": "2026-06-14T10:30:00.000Z"
}
```

---

## RepoProfile

A repository's profile merged from `static` and `dynamic` layers. Not a distinct table — derived from `profile_facts`.

**Layer: `static`** — Long-lived project knowledge:
- `project_rule`, `decision`, `dependency`, `api_contract`, `bug`, `command`, `file_summary`, `user_preference`

**Layer: `dynamic`** — Current session/task context:
- `current_task`, `test_failure`, `bug`, `command`

Each `profile_facts` row:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Primary key. Form: `pf_<timestamp-base36>_<rand-3bytes-hex>_<6-digit-seq>`. |
| `scopeId` | `string` | FK → `scopes.scope_id`. |
| `layer` | `"static" \| "dynamic"` | Which profile layer this fact belongs to. |
| `content` | `string` | The fact content (uses memory's `summary` or `content`). |
| `sourceMemoryId` | `string?` | FK → `memories.id`. The memory that produced this fact. |
| `sourceRef` | `string?` | Source reference from the originating memory. |
| `confidence` | `number` | Confidence score, inherited from the memory. |
| `createdAt` | `ISO 8601` | When the fact was created. |
| `updatedAt` | `ISO 8601` | Last modified. |
| `expiresAt` | `ISO 8601?` | Optional expiration. |

**Example result from `repo_profile`:**

```json
{
  "static": [
    { "id": "pf_...", "content": "Use pnpm as the package manager", "confidence": 0.8, ... },
    { "id": "pf_...", "content": "SQLite chosen for local-first storage", "confidence": 0.9, ... }
  ],
  "dynamic": [
    { "id": "pf_...", "content": "Refactoring auth module", "confidence": 0.8, ... }
  ]
}
```

Profile facts are automatically cleaned up when their source memory is hard-deleted.

---

## Receipt

An immutable audit record for every operation. Receipts never contain private content — only hashes, ids, and statistics.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Primary key. Form: `rcp_<timestamp-base36>_<rand-3bytes-hex>_<6-digit-seq>`. |
| `operation` | `enum` | Operation type: `compress`, `retrieve_original`, `delete_original`, `cleanup_originals`, `remember`, `recall`, `forget`, `list`. |
| `scopeId` | `string` | FK → `scopes.scope_id`. |
| `inputHash` | `string?` | SHA-256 hash of the input content (compression tools). |
| `query` | `string?` | Search query (recall tool). |
| `resultIds` | `JSON array?` | CCR or result ids produced. |
| `memoryIds` | `JSON array?` | Memory ids affected. |
| `ccrIds` | `JSON array?` | Compressed context ids involved. |
| `originalRefs` | `JSON array?` | Original content references involved. |
| `tokensBefore` | `number?` | Token count before compression. |
| `tokensAfter` | `number?` | Token count after. |
| `tokensSaved` | `number?` | Tokens saved. |
| `compressionRatio` | `number?` | Compression ratio. |
| `compressed` | `0 \| 1?` | Whether compression produced CCRs. |
| `retrievedOriginal` | `0 \| 1?` | Whether retrieval returned original content. |
| `failed` | `0 \| 1` | Whether the operation failed. Default 0. |
| `errorReason` | `string?` | Error description when `failed = 1`. |
| `timestamp` | `ISO 8601` | When the operation occurred. |

**Example:**

```json
{
  "id": "rcp_lz3def_0d1e2f_000003",
  "operation": "compress",
  "scopeId": "repo_a1b2c3d4",
  "inputHash": "e3b0c442...",
  "ccrIds": ["ccr_lz3abc_1a2b3c_000001"],
  "originalRefs": ["orig_4d5e6f_7a8b9c_000002"],
  "tokensBefore": 2450,
  "tokensAfter": 487,
  "tokensSaved": 1963,
  "compressionRatio": 0.8012,
  "compressed": 1,
  "failed": 0,
  "timestamp": "2026-06-14T10:30:00.000Z"
}
```

---

## SQLite Schema

All tables are in a single SQLite database at `~/.code-context-mcp/code-context.sqlite`. All tables are scoped by `scope_id` with foreign keys to `scopes`. Timestamps use ISO 8601 strings.

### Table: `scopes`

```sql
CREATE TABLE scopes (
    scope_id       TEXT PRIMARY KEY,
    git_root       TEXT,
    remote         TEXT,
    branch         TEXT,
    cwd            TEXT NOT NULL,
    scope_strategy TEXT NOT NULL CHECK (scope_strategy IN (
                        'gitRemote+gitRoot', 'gitRootOnly', 'cwdFallback'
                    )),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
```

### Table: `compressed_contexts`

```sql
CREATE TABLE compressed_contexts (
    id                    TEXT PRIMARY KEY,
    scope_id              TEXT NOT NULL,
    content_type          TEXT NOT NULL CHECK (content_type IN (
                              'test_output', 'log', 'command_output',
                              'code', 'json', 'markdown', 'plain_text',
                              'rag_chunk', 'file_summary',
                              'conversation_history', 'unknown'
                          )),
    strategy              TEXT NOT NULL,
    compressed_content    TEXT NOT NULL,
    summary               TEXT,
    original_ref          TEXT,
    source_ref            TEXT,
    metadata              TEXT,
    tokens_before         INTEGER NOT NULL,
    tokens_after          INTEGER NOT NULL,
    tokens_saved          INTEGER NOT NULL,
    compression_ratio     REAL NOT NULL,
    can_retrieve_original INTEGER NOT NULL DEFAULT 1,
    retrieve_count        INTEGER NOT NULL DEFAULT 0,
    failed                INTEGER NOT NULL DEFAULT 0,
    error_reason          TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    expires_at            TEXT,
    FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);

CREATE INDEX idx_ccr_scope       ON compressed_contexts(scope_id);
CREATE INDEX idx_ccr_type        ON compressed_contexts(content_type);
CREATE INDEX idx_ccr_created     ON compressed_contexts(created_at);
CREATE INDEX idx_ccr_original_ref ON compressed_contexts(original_ref);
```

### Table: `original_contents`

```sql
CREATE TABLE original_contents (
    id           TEXT PRIMARY KEY,
    scope_id     TEXT NOT NULL,
    ccr_id       TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content      TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    tokens       INTEGER NOT NULL,
    metadata     TEXT,
    created_at   TEXT NOT NULL,
    expires_at   TEXT,
    FOREIGN KEY (scope_id) REFERENCES scopes(scope_id),
    FOREIGN KEY (ccr_id)   REFERENCES compressed_contexts(id)
);

CREATE INDEX idx_orig_scope ON original_contents(scope_id);
CREATE INDEX idx_orig_ccr   ON original_contents(ccr_id);
CREATE INDEX idx_orig_hash  ON original_contents(content_hash);
```

### Table: `memories`

```sql
CREATE TABLE memories (
    id            TEXT PRIMARY KEY,
    scope_id      TEXT NOT NULL,
    type          TEXT NOT NULL CHECK (type IN (
                       'decision', 'bug', 'command', 'file_summary',
                       'project_rule', 'user_preference', 'current_task',
                       'test_failure', 'api_contract', 'dependency'
                   )),
    content       TEXT NOT NULL,
    summary       TEXT,
    source_ref    TEXT,
    confidence    REAL NOT NULL DEFAULT 0.8,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                       'active', 'superseded', 'forgotten', 'expired'
                   )),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    expires_at    TEXT,
    superseded_by TEXT,
    tags          TEXT,
    FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);

CREATE INDEX idx_mem_scope   ON memories(scope_id);
CREATE INDEX idx_mem_type    ON memories(type);
CREATE INDEX idx_mem_status  ON memories(status);
CREATE INDEX idx_mem_created ON memories(created_at);
```

### Table: `profile_facts`

```sql
CREATE TABLE profile_facts (
    id               TEXT PRIMARY KEY,
    scope_id         TEXT NOT NULL,
    layer            TEXT NOT NULL CHECK (layer IN ('static', 'dynamic')),
    content          TEXT NOT NULL,
    source_memory_id TEXT,
    source_ref       TEXT,
    confidence       REAL NOT NULL DEFAULT 0.8,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    expires_at       TEXT,
    FOREIGN KEY (scope_id)         REFERENCES scopes(scope_id),
    FOREIGN KEY (source_memory_id) REFERENCES memories(id)
);

CREATE INDEX idx_pf_scope ON profile_facts(scope_id);
CREATE INDEX idx_pf_layer ON profile_facts(layer);
```

### Table: `receipts`

```sql
CREATE TABLE receipts (
    id                  TEXT PRIMARY KEY,
    operation           TEXT NOT NULL CHECK (operation IN (
                            'compress', 'retrieve_original', 'delete_original',
                            'cleanup_originals', 'remember',
                            'recall', 'forget', 'list'
                        )),
    scope_id            TEXT NOT NULL,
    input_hash          TEXT,
    query               TEXT,
    result_ids          TEXT,
    memory_ids          TEXT,
    ccr_ids             TEXT,
    original_refs       TEXT,
    tokens_before       INTEGER,
    tokens_after        INTEGER,
    tokens_saved        INTEGER,
    compression_ratio   REAL,
    compressed          INTEGER,
    retrieved_original  INTEGER,
    failed              INTEGER DEFAULT 0,
    error_reason        TEXT,
    timestamp           TEXT NOT NULL,
    FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);

CREATE INDEX idx_rcp_scope     ON receipts(scope_id);
CREATE INDEX idx_rcp_operation ON receipts(operation);
CREATE INDEX idx_rcp_time      ON receipts(timestamp);
```

### Notes

- **FTS5 not yet used**: FTS5 virtual table is not created by default because the sql.js WASM build doesn't include the FTS5 extension. Full-text search currently uses LIKE-based fallback with a custom relevance scorer.
- **JSON columns**: `metadata`, `tags`, `result_ids`, `memory_ids`, `ccr_ids`, `original_refs` are stored as JSON strings and parsed at the application layer.
- **Foreign keys**: SQLite FK constraints are enforced (sql.js supports them). `hard_delete` on memories cascades to `profile_facts` via application-level DELETE.
- **Migrations**: Schema changes are handled by `src/storage/migrations.ts` which runs after database initialization. The receipts CHECK constraint is dynamically migrated when new operation types are added.
