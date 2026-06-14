# CodeContext MCP

> **Beta Release v0.2.0** — Context Compression + Project Memory

Local-first MCP server for AI coding agents. It solves two problems:

1. **Context is too long** → Compress logs, command output, code, JSON, RAG chunks, conversation history
2. **Project knowledge is forgotten** → Scoped, typed, auditable project memory

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 18.0.0
- **pnpm** (recommended) or npm

### Install

```bash
# Clone
git clone https://github.com/2cux/code-context-mcp.git
cd code-context-mcp

# Install & build
pnpm install
pnpm build

# Verify
pnpm cli scope
```

### MCP Configuration

Add to your AI coding agent's MCP config (e.g., Claude Code, Cursor):

```json
{
  "mcpServers": {
    "code-context": {
      "command": "node",
      "args": ["/absolute/path/to/code-context-mcp/dist/index.js"]
    }
  }
}
```

For Claude Code (`claude_desktop_config.json` or `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "code-context": {
      "command": "node",
      "args": ["D:/project/CodeContext/dist/index.js"]
    }
  }
}
```

---

## CLI Usage

```bash
# Show current repo scope
pnpm cli scope

# Compress a file (auto-detect content type)
pnpm cli compress tests/fixtures/vitest-output.txt

# Compress with specific type and low token budget
pnpm cli compress tests/fixtures/app-log.txt --type log --max-tokens 500

# Retrieve original content
pnpm cli retrieve orig_7b35451e

# Retrieve with pagination
pnpm cli retrieve orig_7b35451e --offset 0 --limit 200

# View token stats
pnpm cli stats

# List recent compressions
pnpm cli list-compressions --limit 10

# View a receipt
pnpm cli receipts --limit 5

# Cleanup expired originals
pnpm cli cleanup --originals

# ========== Memory Tools (Beta) ==========

# Remember project knowledge
pnpm cli remember --type project_rule --content "Use pnpm as the package manager" \
  --profile-target static --tags "build,convention"

# Remember current task
pnpm cli remember --type current_task --content "Refactoring auth module" \
  --profile-target dynamic --tags "refactor"

# Recall relevant context
pnpm cli recall "package manager"

# Recall with type and profile filter
pnpm cli recall "auth" --type project_rule --profile static

# List all memories
pnpm cli list-context --limit 20

# Filter by type and status
pnpm cli list-context --type project_rule --status active

# Forget (soft delete) a memory
pnpm cli forget mem_xxxxxxxx --mode soft_forget --reason "No longer relevant"

# Supersede old memory with new one
pnpm cli forget mem_old_xxxx --mode supersede --superseded-by mem_new_xxxx \
  --reason "Replaced by updated rule"

# View repo profile (static + dynamic layers)
pnpm cli profile

# View static/dynamic profile separately
pnpm cli profile --static
pnpm cli profile --dynamic
```

---

## MCP Tools

### Compression Tools

| Tool | Description |
|---|---|
| `current_scope` | Resolve stable scopeId for current repository |
| `compress_context` | Compress content with type detection, returns originalRef + receipt |
| `retrieve_original` | Retrieve full original content by originalRef, supports pagination |
| `delete_original` | Delete a single original content record |
| `cleanup_originals` | Remove all expired original content records |
| `list_compressions` | List compressed context records with token stats |

### Memory Tools (Beta)

| Tool | Description |
|---|---|
| `remember_context` | Store typed project memory (9 types) with profile targeting |
| `recall_context` | Search memories by query, type, status, or profile layer |
| `forget_context` | Soft-forget, supersede, expire, or hard-delete memories |
| `list_context` | List memories with filtering, pagination, and sorting |
| `repo_profile` | View repo profile split into `static` and `dynamic` layers |
| `list_receipts` | Audit trail — list receipts by operation, pagination supported |

---

## Content Types Supported

| Type | Compressor | Behavior |
|---|---|---|
| `test_output` | Test Output | Extract failed tests, errors, stack traces |
| `log` | Log | Preserve ERROR/FATAL lines, summarize INFO/WARN |
| `command_output` | Command Output | Preserve stderr, collapse repetitive output |
| `code` | Code | Keep function signatures, fold bodies, keep comments |
| `json` | JSON | Keep schema structure, truncate arrays/objects |
| `markdown` | Markdown | Keep headings, preserve code blocks |
| `rag_chunk` | RAG Chunk | Rank by score, deduplicate, keep top sources |
| `conversation_history` | Conversation | Preserve key context, collapse long exchanges |
| `plain_text` | Plain Text | General-purpose NLP compression |

Type detection is automatic when `contentType` is omitted.

---

## Memory Types

| Type | Description | Typical Profile |
|---|---|---|
| `project_rule` | Coding conventions, build rules | `static` |
| `decision` | Architecture decisions, trade-offs | `static` |
| `bug` | Known bugs, workarounds | `static` |
| `command` | Useful commands, scripts | `static` |
| `file_summary` | Key file descriptions | `static` |
| `user_preference` | User tooling preferences | `static` |
| `current_task` | What's being worked on now | `dynamic` |
| `test_failure` | Recent test failure context | `dynamic` |
| `api_contract` | API endpoint contracts | `static` |
| `dependency` | Dependency notes, versions | `static` |

---

## Memory Lifecycle

| Status | Meaning |
|---|---|
| `active` | Currently valid and searchable |
| `superseded` | Replaced by a newer memory |
| `forgotten` | Soft-deleted, excluded from recall |
| `expired` | Past its `expiresAt` timestamp |

Memories transition through these statuses via `forget_context` modes:
- `soft_forget` → marks as forgotten (recoverable)
- `supersede` → marks as replaced by another memory
- `expire` → marks as expired
- `hard_delete` → permanently removes from storage

---

## Repo Profile

Each repository has a two-layer profile:

| Layer | Content | Examples |
|---|---|---|
| `static` | Long-lived project knowledge | Coding conventions, architecture decisions, API contracts |
| `dynamic` | Current session/task context | What you're working on now, recent test failures |

Profile facts are auto-derived from `remember_context` calls and kept in sync.

---

## Key Design Principles

- **Local-first**: All data stays on your machine
- **Fail-open**: If compression fails, original content is returned
- **Scope isolation**: Each repo's data is isolated by git remote + root
- **Auditable**: Every operation generates a receipt
- **Recoverable**: Original content can be retrieved via `originalRef`
- **Forgettable**: Memory has a lifecycle — old knowledge won't pollute recall

---

## Architecture

```
AI Coding Agent
    ↓ MCP (stdio)
CodeContext MCP Server
    ├── Scope Resolver (git remote + root)
    ├── ContentRouter (9 detectors)
    ├── Compression Engine (9 strategies)
    ├── Original Content Store
    ├── Compressed Context Store
    ├── Memory Service (typed, lifecycle-managed)
    ├── Profile Service (static + dynamic layers)
    ├── Receipt Service (audit trail)
    ├── Token Stats Service
    ├── Safety Layer (timeout, size limit, chunking, fail-open)
    └── SQLite Storage (~/.code-context-mcp/)
```

---

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build TypeScript
pnpm test           # Run tests (775 tests)
pnpm test:watch     # Watch mode
pnpm lint           # ESLint
pnpm format         # Prettier
```

---

## Beta Known Limitations

### Compression
- Compression is **conservative by default** — content within token budget is kept intact
- Content type auto-detection confidence varies by content size (smaller inputs → lower confidence)
- Large files (>1MB) are chunked; very large files (>20 chunks) are truncated
- No image/binary compression support

### Memory
- FTS5 full-text search not yet enabled (using LIKE-based fallback with scoring)
- Memory lifecycle automation (auto-expire, auto-supersede) not yet implemented
- No automatic deduplication of similar memories
- Profile sync is one-way (memory → profile), no bidirectional sync

### General
- SQLite database is stored in `~/.code-context-mcp/` (cross-drive access may vary on Windows)
- No cloud sync, multi-user, or team features
- No transparent HTTP proxy or WebSocket interceptor
- No ML-based compression
- No automatic modification of `CLAUDE.md` or `AGENTS.md`

### What this Beta is NOT
- ❌ Not a transparent HTTP proxy
- ❌ Not a WebSocket interceptor
- ❌ Not a multi-provider auth layer
- ❌ Not an ML-based compressor
- ❌ Not a CLAUDE.md auto-modifier
- ❌ Not a cloud sync service

---

## License

MIT © 2cux
