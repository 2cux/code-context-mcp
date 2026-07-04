# MCP Resources and Prompts

**Release**: v1.0.0  
**PRD Reference**: §11 (Agent Mode 7 tools)  
**Status**: ✅ Implemented

---

## Overview

CodeContext MCP now exposes **project context via MCP resources and prompts**, allowing agents to discover project state **without making tool calls**.

### What Changed

- **Added**: 2 MCP resources
- **Added**: 1 MCP prompt
- **No new tools**: Agent mode 7 tools remain unchanged
- **Fast path**: Resources/prompts bypass HarnessRunner and tool registry

---

## MCP Resources

### `codecontext://project-profile`

**Full project context snapshot**

Returns:
```json
{
  "scope": {
    "scopeId": "repo-abc123",
    "scopeStrategy": "git_root",
    "gitRoot": "/path/to/project",
    "remote": "origin",
    "branch": "main"
  },
  "memory": {
    "total": 42,
    "active": 38,
    "byType": {
      "project_rule": 12,
      "decision": 8,
      "current_task": 5
    },
    "recentSummaries": [
      { "type": "project_rule", "summary": "Use pnpm", "confidence": 0.95 },
      ...
    ]
  },
  "compression": {
    "totalCompressed": 156,
    "recoverableOriginals": 142,
    "tokensSaved": 89234,
    "compressionRatio": 0.73
  },
  "staticProfile": {
    "topRules": [
      { "type": "project_rule", "summary": "TypeScript strict", "confidence": 0.9 }
    ]
  },
  "hint": "Agent: use recall_context to search project memory, compress_context to save tokens."
}
```

**Use case**: Agent needs quick project orientation without calling `recall_context`.

---

### `codecontext://project-stats`

**Token savings, compression, and memory counts**

Returns:
```json
{
  "scopeId": "repo-abc123",
  "memory": {
    "total": 42,
    "active": 38,
    "superseded": 2,
    "forgotten": 1,
    "expired": 1
  },
  "compression": {
    "totalCCRs": 156,
    "recoverableOriginals": 142
  },
  "tokens": {
    "totalCompressions": 156,
    "totalRetrieves": 23,
    "totalMemories": 42,
    "totalRecalls": 18,
    "totalTokensBefore": 122450,
    "totalTokensAfter": 33216,
    "totalTokensSaved": 89234,
    "averageCompressionRatio": 0.728
  }
}
```

**Use case**: Monitoring dashboards, agent status checks.

---

## MCP Prompts

### `project_context_brief`

**Brief project context summary for agent orientation**

Returns a formatted markdown prompt:

```markdown
# CodeContext Project Brief

## Scope
- Project: `repo-abc123`
- Strategy: git_root
- Git root: /path/to/project
- Branch: main

## Memory
- Active memories: 38 / 42 total
- Recent context:
  - [project_rule] Use pnpm for package management (confidence: 0.95)
  - [decision] Vitest for testing (confidence: 0.90)
  - [current_task] Implement authentication (confidence: 0.85)

## Compression
- Compressed contexts: 156
- Token savings: 89,234 tokens saved
- Average compression: 72.8%

## Project Rules (Static Profile)
- [project_rule] Use TypeScript strict mode
- [project_rule] Use pnpm for package management
- [decision] Vitest for unit tests

## Agent Tips
- Use `recall_context` to search project memory
- Use `compress_context` to compress long outputs and save tokens
- Use `remember_context` to save important project facts
- All context is scoped to this repository
```

**Use case**: Inject into agent context window at session start.

---

## Design Decisions

### 1. No New Tools

Resources and prompts are **not** MCP tools. Agents discover them via:
- `ListResourcesRequest` → returns 2 resources
- `ReadResourceRequest` → reads resource content
- `ListPromptsRequest` → returns 1 prompt
- `GetPromptRequest` → reads prompt content

This keeps agent mode 7 tools stable (no breaking changes).

---

### 2. Fast Path (No HarnessRunner)

Resources and prompts **do not** go through:
- ❌ `toolRegistry.ts`
- ❌ `toolMode.ts`
- ❌ HarnessRunner

They directly query the database and return JSON or markdown.

**Why**: Discovery operations should be instant and not create receipts.

---

### 3. Scope Isolation

All resource/prompt data is **scoped to current repository**.  
`resolveScope()` is called internally — no `cwd` parameter needed.

---

### 4. Read-Only

Resources and prompts are **read-only**. They never mutate state or create receipts.

---

## Implementation

### Files Added

```
src/mcp/resourceHandlers.ts   (listResources, readResource)
src/mcp/promptHandlers.ts     (listPrompts, getPrompt)
```

### Files Modified

```
src/mcp/server.ts              (register resource/prompt handlers)
```

### Tests Added

```
tests/mcp/resourceHandlers.test.ts    (4 tests)
tests/mcp/promptHandlers.test.ts      (4 tests)
tests/mcp/serverIntegration.test.ts   (6 tests)
```

---

## Verification

### Type Check
```bash
npx tsc --noEmit
# ✅ No errors
```

### Tests
```bash
npx vitest run
# ✅ 1432 passed (all tests)
```

### Agent Fast Path Test
```bash
npx vitest run tests/mcp/serverIntegration.test.ts
# ✅ 6 passed
```

---

## Usage Example

### Agent Discovery Flow

1. **Agent connects** to CodeContext MCP
2. **Agent calls** `ListResourcesRequest`
   - Response: 2 resources (project-profile, project-stats)
3. **Agent calls** `ReadResourceRequest` with `codecontext://project-profile`
   - Response: Full project context JSON
4. **Agent orients** itself using memory counts, recent rules, compression stats
5. **Agent decides** whether to call `recall_context` or proceed directly

**Result**: Agent gets project overview **without burning a tool call** or creating a receipt.

---

## Acceptance Criteria

- [x] 2 MCP resources registered (`codecontext://project-profile`, `codecontext://project-stats`)
- [x] 1 MCP prompt registered (`project_context_brief`)
- [x] No new agent-facing tools added
- [x] Agent mode 7 tools unchanged
- [x] Resources/prompts bypass HarnessRunner (fast path)
- [x] All data scoped to current repository
- [x] No data uploaded to cloud
- [x] `npx tsc --noEmit` passes
- [x] `npx vitest run` passes (all tests green)
- [x] Resource/prompt discovery tests pass
- [x] Agent fast path test passes

---

## Future Enhancements

1. **Resource**: `codecontext://recent-failures` — last 5 compression/recall failures
2. **Resource**: `codecontext://cache-stats` — cache hit rate per content type
3. **Prompt**: `project_rules_only` — static profile rules without stats
4. **Prompt**: `current_tasks` — dynamic profile active tasks

All deferred to v1.1.0+.
