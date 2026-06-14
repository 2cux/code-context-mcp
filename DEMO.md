# CodeContext MCP — Demo

End-to-end walkthrough demonstrating all features of CodeContext MCP v0.2.0-beta.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [1. Scope & Setup](#1-scope--setup)
- [2. Compress Long Test Logs](#2-compress-long-test-logs)
- [3. Compress Other Content Types](#3-compress-other-content-types)
- [4. Retrieve Original Content](#4-retrieve-original-content)
- [5. View Token Stats](#5-view-token-stats)
- [6. Save Project Rules (Memory)](#6-save-project-rules-memory)
- [7. Recall Project Rules](#7-recall-project-rules)
- [8. Supersede Old Memory](#8-supersede-old-memory)
- [9. List All Memories](#9-list-all-memories)
- [10. Repo Profile (Static + Dynamic)](#10-repo-profile-static--dynamic)
- [11. Receipt Audit Trail](#11-receipt-audit-trail)
- [12. Original Content Cleanup](#12-original-content-cleanup)

---

## Prerequisites

```bash
# Clone and build
git clone https://github.com/2cux/code-context-mcp.git
cd code-context-mcp
pnpm install
pnpm build

# Verify installation
pnpm cli scope
```

---

## 1. Scope & Setup

```bash
$ pnpm cli scope
```

**Output:**
```json
{
  "scopeId": "repo_a1b2c3d4",
  "gitRoot": "D:/project/CodeContext",
  "remote": "https://github.com/2cux/code-context-mcp.git",
  "branch": "main",
  "cwd": "D:/project/CodeContext",
  "scopeStrategy": "gitRemote+gitRoot"
}
```

The `scopeId` is a SHA-256 hash of `gitRemote + gitRoot`, truncated to 8 hex characters. It's stable across sessions and survives repo directory moves. All subsequent operations are scoped to this repo.

---

## 2. Compress Long Test Logs

```bash
$ pnpm cli compress tests/fixtures/vitest-output.txt --max-tokens 500
```

**Output:**
```json
{
  "ccrId": "ccr_lz3abc_1a2b3c_000001",
  "compressed": true,
  "scopeId": "repo_a1b2c3d4",
  "contentType": "test_output",
  "strategy": "test_output_conservative_v1",
  "compressedContent": "## Test Results Summary\n**Command:** npx vitest run\n...\n### Failed Tests (3)\n...",
  "summary": "Vitest run: 3 failed, 12 passed",
  "originalRef": "orig_4d5e6f_7a8b9c_000002",
  "tokensBefore": 2450,
  "tokensAfter": 487,
  "tokensSaved": 1963,
  "compressionRatio": 0.8012,
  "canRetrieveOriginal": true,
  "receiptId": "rcp_lz3def_0d1e2f_000003",
  "warnings": [],
  "detection": {
    "method": "auto",
    "detectedAs": "test_output",
    "confidence": 0.85
  }
}
```

**What happened:**
1. Content type was auto-detected as `test_output` (confidence 0.85)
2. The test output compressor extracted failed test names, assertions, expected/received values, and stack traces
3. 1963 tokens saved (80.12% reduction)
4. Original content saved with ref `orig_4d5e6f_7a8b9c_000002`
5. A receipt was created for audit

---

## 3. Compress Other Content Types

### Application Log

```bash
$ pnpm cli compress tests/fixtures/app-log.txt --type log --max-tokens 300
```

```json
{
  "ccrId": "ccr_lz3ghi_7a8b9c_000004",
  "contentType": "log",
  "strategy": "log_conservative_v1",
  "tokensBefore": 1800,
  "tokensAfter": 278,
  "tokensSaved": 1522,
  "compressionRatio": 0.8456,
  "summary": "App log: 2 ERROR, 5 WARN, 120 INFO",
  "canRetrieveOriginal": true
}
```

The log compressor preserves ERROR/WARN lines, exception types, and stack traces while folding repeated INFO/heartbeat lines.

### TypeScript Code

```bash
$ pnpm cli compress tests/fixtures/sample.ts --max-tokens 300
```

```json
{
  "ccrId": "ccr_lz3jkl_0d1e2f_000005",
  "contentType": "code",
  "strategy": "code_conservative_v1",
  "tokensBefore": 1200,
  "tokensAfter": 295,
  "tokensSaved": 905,
  "compressionRatio": 0.7542,
  "summary": "TypeScript module: exports 3 functions, 2 interfaces"
}
```

The code compressor keeps imports, exports, function/class signatures, and TODOs while folding function bodies.

### JSON Response

```bash
$ pnpm cli compress tests/fixtures/response.json --max-tokens 300
```

```json
{
  "ccrId": "ccr_lz3mno_3f4g5h_000006",
  "contentType": "json",
  "tokensBefore": 3200,
  "tokensAfter": 290,
  "tokensSaved": 2910,
  "compressionRatio": 0.9094
}
```

### RAG Chunks

```bash
$ pnpm cli compress tests/fixtures/rag-chunks.json --max-tokens 300
```

```json
{
  "ccrId": "ccr_lz3pqr_6g7h8i_000007",
  "contentType": "rag_chunk",
  "tokensBefore": 5000,
  "tokensAfter": 295,
  "tokensSaved": 4705,
  "compressionRatio": 0.941
}
```

---

## 4. Retrieve Original Content

```bash
# Full retrieval
$ pnpm cli retrieve orig_4d5e6f_7a8b9c_000002
```

```json
{
  "scopeId": "repo_a1b2c3d4",
  "originalRef": "orig_4d5e6f_7a8b9c_000002",
  "content": "FAIL src/auth.test.ts > login ...\n... (full original)",
  "contentType": "test_output",
  "tokens": 2450,
  "createdAt": "2026-06-14T10:30:00.000Z",
  "receiptId": "rcp_...",
  "offset": 0,
  "returnedChars": 12345,
  "totalChars": 12345,
  "hasMore": false
}
```

```bash
# Paginated retrieval (first 100 characters)
$ pnpm cli retrieve orig_4d5e6f_7a8b9c_000002 --offset 0 --limit 100
```

```json
{
  "offset": 0,
  "returnedChars": 100,
  "totalChars": 12345,
  "hasMore": true
}
```

---

## 5. View Token Stats

```bash
$ pnpm cli stats
```

```json
{
  "scopeId": "repo_a1b2c3d4",
  "totalCompressions": 5,
  "totalTokensBefore": 13650,
  "totalTokensAfter": 1645,
  "totalTokensSaved": 12005,
  "overallCompressionRatio": 0.8795,
  "byContentType": {
    "test_output": { "count": 1, "tokensSaved": 1963, "avgRatio": 0.8012 },
    "log": { "count": 1, "tokensSaved": 1522, "avgRatio": 0.8456 },
    "code": { "count": 1, "tokensSaved": 905, "avgRatio": 0.7542 },
    "json": { "count": 1, "tokensSaved": 2910, "avgRatio": 0.9094 },
    "rag_chunk": { "count": 1, "tokensSaved": 4705, "avgRatio": 0.941 }
  }
}
```

---

## 6. Save Project Rules (Memory)

```bash
# Save a project rule
$ pnpm cli remember --type project_rule \
  --content "Use pnpm as the package manager. No npm or yarn." \
  --profile-target static --tags "build,convention"
```

```json
{
  "memoryId": "mem_lz3ghi_7a8b9c_000012",
  "scopeId": "repo_a1b2c3d4",
  "type": "project_rule",
  "status": "active",
  "receiptId": "rcp_lz3jkl_0d1e2f_000013"
}
```

```bash
# Save an architecture decision
$ pnpm cli remember --type decision \
  --content "SQLite chosen for local-first storage. No server required." \
  --profile-target static --tags "architecture,storage"
```

```json
{
  "memoryId": "mem_lz3stu_9j0k1l_000014",
  "type": "decision",
  "status": "active",
  "receiptId": "rcp_..."
}
```

```bash
# Save current task (dynamic context)
$ pnpm cli remember --type current_task \
  --content "Implementing Beta v0.2.0 features — compression + memory dual-core" \
  --profile-target dynamic --tags "beta,development"
```

```json
{
  "memoryId": "mem_lz3vwx_2m3n4o_000015",
  "type": "current_task",
  "status": "active",
  "receiptId": "rcp_..."
}
```

---

## 7. Recall Project Rules

```bash
# Free-text search
$ pnpm cli recall "package manager"
```

```json
{
  "scopeId": "repo_a1b2c3d4",
  "profile": {
    "static": [
      {
        "id": "pf_...",
        "content": "Use pnpm as the package manager. No npm or yarn.",
        "sourceMemoryId": "mem_lz3ghi_7a8b9c_000012",
        "confidence": 0.8,
        "updatedAt": "2026-06-14T10:35:00.000Z"
      },
      {
        "id": "pf_...",
        "content": "SQLite chosen for local-first storage. No server required.",
        "sourceMemoryId": "mem_lz3stu_9j0k1l_000014",
        "confidence": 0.8,
        "updatedAt": "2026-06-14T10:36:00.000Z"
      }
    ],
    "dynamic": [
      {
        "id": "pf_...",
        "content": "Implementing Beta v0.2.0 features — compression + memory dual-core",
        "sourceMemoryId": "mem_lz3vwx_2m3n4o_000015",
        "confidence": 0.8,
        "updatedAt": "2026-06-14T10:37:00.000Z"
      }
    ]
  },
  "memories": [
    {
      "id": "mem_lz3ghi_7a8b9c_000012",
      "type": "project_rule",
      "content": "Use pnpm as the package manager. No npm or yarn.",
      "confidence": 0.8,
      "status": "active",
      "score": 2.45,
      "canExpand": false,
      "createdAt": "2026-06-14T10:35:00.000Z",
      "tags": ["build", "convention"]
    }
  ],
  "relatedCompressedContexts": [],
  "receiptId": "rcp_lz3yza_5p6q7r_000016"
}
```

**What happened:**
1. FTS (LIKE-based) search found the "package manager" memory with score 2.45
2. Confidence merge: `2.45 × 0.8 = 1.96`
3. Recency boost applied (brand-new memory gets ~30% boost)
4. Profile facts (static + dynamic) included in response
5. Receipt generated even though no CCRs were linked

```bash
# Filter by type and profile layer
$ pnpm cli recall "TypeScript" --type project_rule --profile static
```

```bash
# Search dynamic context only
$ pnpm cli recall "Beta" --type current_task --profile dynamic
```

---

## 8. Supersede Old Memory

```bash
# First, save a new, updated rule
$ pnpm cli remember --type project_rule \
  --content "Use pnpm v9+ only. No npm or yarn." \
  --profile-target static --tags "build,convention"
# → memoryId: mem_new_xxxx_000017

# Then supersede the old rule with the new one
$ pnpm cli forget mem_lz3ghi_7a8b9c_000012 --mode supersede \
  --superseded-by mem_new_xxxx_000017 \
  --reason "Updated package manager version policy"
```

```json
{
  "memoryId": "mem_lz3ghi_7a8b9c_000012",
  "previousStatus": "active",
  "newStatus": "superseded",
  "supersededBy": "mem_new_xxxx_000017",
  "receiptId": "rcp_..."
}
```

Now the old rule is excluded from recall by default. The new rule (`mem_new_xxxx_000017`) will show the old one in its `supersedes` list:

```bash
$ pnpm cli recall "package manager"
# Only returns the new rule (status: active, score includes recency boost)
```

```bash
# Soft-forget a memory (recoverable)
$ pnpm cli forget mem_lz3vwx_2m3n4o_000015 --mode soft_forget \
  --reason "Task completed"
```

```json
{
  "memoryId": "mem_lz3vwx_2m3n4o_000015",
  "previousStatus": "active",
  "newStatus": "forgotten",
  "receiptId": "rcp_..."
}
```

---

## 9. List All Memories

```bash
# List everything
$ pnpm cli list-context --limit 10
```

```json
{
  "scopeId": "repo_a1b2c3d4",
  "items": [
    {
      "id": "mem_new_xxxx_000017",
      "type": "project_rule",
      "summary": null,
      "status": "active",
      "sourceRef": "user:manual",
      "confidence": 0.8,
      "createdAt": "2026-06-14T10:40:00.000Z",
      "updatedAt": "2026-06-14T10:40:00.000Z"
    },
    {
      "id": "mem_lz3vwx_2m3n4o_000015",
      "type": "current_task",
      "summary": null,
      "status": "forgotten",
      "sourceRef": "user:manual",
      "confidence": 0.8,
      "createdAt": "2026-06-14T10:37:00.000Z"
    },
    {
      "id": "mem_lz3stu_9j0k1l_000014",
      "type": "decision",
      "summary": null,
      "status": "active",
      "sourceRef": "user:manual",
      "confidence": 0.8,
      "createdAt": "2026-06-14T10:36:00.000Z"
    },
    {
      "id": "mem_lz3ghi_7a8b9c_000012",
      "type": "project_rule",
      "summary": null,
      "status": "superseded",
      "sourceRef": "user:manual",
      "confidence": 0.8,
      "createdAt": "2026-06-14T10:35:00.000Z"
    }
  ],
  "total": 4
}
```

```bash
# Filter by type and status
$ pnpm cli list-context --type project_rule --status active
```

```bash
# Sort by confidence descending
$ pnpm cli list-context --sort-by confidence --sort-order desc --limit 5
```

---

## 10. Repo Profile (Static + Dynamic)

```bash
$ pnpm cli profile
```

```json
{
  "scopeId": "repo_a1b2c3d4",
  "static": [
    {
      "id": "pf_...",
      "content": "Use pnpm v9+ only. No npm or yarn.",
      "sourceMemoryId": "mem_new_xxxx_000017",
      "confidence": 0.8,
      "updatedAt": "2026-06-14T10:40:00.000Z"
    },
    {
      "id": "pf_...",
      "content": "SQLite chosen for local-first storage. No server required.",
      "sourceMemoryId": "mem_lz3stu_9j0k1l_000014",
      "confidence": 0.8,
      "updatedAt": "2026-06-14T10:36:00.000Z"
    }
  ],
  "dynamic": []
}
```

```bash
# View layers separately
$ pnpm cli profile --static
$ pnpm cli profile --dynamic
```

Note: The dynamic profile is empty because the current_task was soft-forgotten (and profile_facts from forgotten memories are not automatically cleaned — they persist until the source memory is hard-deleted).

---

## 11. Receipt Audit Trail

```bash
# List all receipts
$ pnpm cli receipts --limit 10
```

```json
[
  {
    "id": "rcp_lz3yza_5p6q7r_000016",
    "operation": "recall",
    "query": "package manager",
    "timestamp": "2026-06-14T10:38:00.000Z"
  },
  {
    "id": "rcp_...",
    "operation": "remember",
    "memoryIds": ["mem_new_xxxx_000017"],
    "timestamp": "2026-06-14T10:40:00.000Z"
  },
  {
    "id": "rcp_...",
    "operation": "forget",
    "memoryIds": ["mem_lz3ghi_7a8b9c_000012"],
    "timestamp": "2026-06-14T10:41:00.000Z"
  },
  {
    "id": "rcp_...",
    "operation": "compress",
    "tokensSaved": 1963,
    "compressionRatio": 0.8012,
    "timestamp": "2026-06-14T10:30:00.000Z"
  }
]
```

```bash
# Filter by operation
$ pnpm cli receipts --operation compress --limit 5
$ pnpm cli receipts --operation remember --limit 5
$ pnpm cli receipts --operation forget --limit 5
```

```bash
# View a specific receipt
$ pnpm cli receipt rcp_lz3def_0d1e2f_000003
```

Every operation — compress, retrieve, remember, recall, forget, list, cleanup — leaves a receipt. This proves what happened without storing private content.

---

## 12. Original Content Cleanup

```bash
$ pnpm cli cleanup --originals
```

```json
{
  "scopeId": "repo_a1b2c3d4",
  "deleted": 0,
  "affectedCcrIds": [],
  "message": "No expired originals found.",
  "receiptId": "rcp_..."
}
```

Originals expire based on the `expiresAt` field (set during compression). If no originals have `expiresAt < NOW`, nothing is deleted.

---

## Demo Summary

| Step | Feature | Command |
|---|---|---|
| 1 | Scope | `pnpm cli scope` |
| 2 | Compress test output | `pnpm cli compress tests/fixtures/vitest-output.txt --max-tokens 500` |
| 3 | Compress log/code/JSON/RAG | `pnpm cli compress ... --type X --max-tokens 300` |
| 4 | Retrieve original | `pnpm cli retrieve orig_xxxxxxxx` |
| 5 | Token stats | `pnpm cli stats` |
| 6 | Save memory | `pnpm cli remember --type project_rule --content "..." --profile-target static` |
| 7 | Recall memory | `pnpm cli recall "package manager"` |
| 8 | Supersede memory | `pnpm cli forget mem_xxx --mode supersede --superseded-by mem_yyy` |
| 9 | List memories | `pnpm cli list-context --limit 20` |
| 10 | View profile | `pnpm cli profile` |
| 11 | Audit receipts | `pnpm cli receipts --limit 10` |
| 12 | Cleanup originals | `pnpm cli cleanup --originals` |

---

## Scope Isolation Demo

```bash
# Project A
$ cd /projects/backend
$ pnpm -C /path/to/code-context-mcp cli scope
# → scopeId: "repo_a1b2c3d4"

# Project B — completely isolated
$ cd /projects/frontend
$ pnpm -C /path/to/code-context-mcp cli scope
# → scopeId: "repo_e5f6a7b8"

# Save a memory in Project A
$ cd /projects/backend
$ pnpm -C /path/to/code-context-mcp cli remember \
  --type project_rule --content "Backend uses PostgreSQL" --profile-target static

# Recall in Project B — the backend memory is invisible
$ cd /projects/frontend
$ pnpm -C /path/to/code-context-mcp cli recall "PostgreSQL"
# → No results
```

Each repository's data is completely isolated. The `scopeId` is derived from `hash(gitRemote + gitRoot)`, so two different repos always have different scopes.

---

## Running the Full Test Suite

```bash
$ pnpm test
```

775 tests covering compression strategies, content type detection, safety layer, memory service, recall engine, receipts, scope resolution, and CLI commands.
