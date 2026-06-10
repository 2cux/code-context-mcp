# CodeContext MCP

> **Alpha Release v0.1.0** — Context Compression + Original Content Recovery

Local-first MCP server for AI coding agents. It solves two problems:

1. **Context is too long** → Compress logs, command output, code, JSON, RAG chunks
2. **Project knowledge is forgotten** → Scoped project memory (_V1 roadmap_)

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
pnpm cli receipt rcp_xxxxxxxx

# Cleanup expired originals
pnpm cli cleanup --originals
```

---

## MCP Tools (Alpha)

| Tool | Description |
|---|---|
| `current_scope` | Resolve stable scopeId for current repository |
| `compress_context` | Compress content with type detection, returns originalRef + receipt |
| `retrieve_original` | Retrieve full original content by originalRef, supports pagination |
| `delete_original` | Delete a single original content record |
| `cleanup_originals` | Remove all expired original content records |
| `list_compressions` | List compressed context records with token stats |

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

## Key Design Principles

- **Local-first**: All data stays on your machine
- **Fail-open**: If compression fails, original content is returned
- **Scope isolation**: Each repo's data is isolated by git remote + root
- **Auditable**: Every operation generates a receipt
- **Recoverable**: Original content can be retrieved via `originalRef`

---

## Alpha Limitations

### Not yet implemented (planned for v0.2.0+)
- `remember_context` / `recall_context` / `forget_context` / `list_context` — memory tools
- `repo_profile.static` / `repo_profile.dynamic` — profile service
- FTS5 full-text search (currently uses LIKE-based fallback)
- Memory lifecycle automation (auto-expire, auto-supersede)

### Known Alpha issues
- Compression is **conservative by default** — content within token budget is kept intact
- Content type auto-detection confidence varies by content size (smaller inputs → lower confidence)
- CLI does not expose `delete_original` as a standalone command (use MCP tool directly)
- SQLite database is stored in `~/.code-context-mcp/` (cross-drive access may vary on Windows)
- Large files (>1MB) are chunked; very large files (>20 chunks) are truncated
- No image/binary compression support
- No cloud sync, multi-user, or team features

### What this Alpha is NOT
- ❌ Not a transparent HTTP proxy
- ❌ Not a WebSocket interceptor
- ❌ Not a multi-provider auth layer
- ❌ Not an ML-based compressor
- ❌ Not a CLAUDE.md auto-modifier
- ❌ Not a cloud sync service

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
    ├── Receipt Service
    ├── Token Stats Service
    ├── Safety Layer (timeout, size limit, chunking, fail-open)
    └── SQLite Storage (~/.code-context-mcp/)
```

---

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build TypeScript
pnpm test           # Run tests (420 tests)
pnpm test:watch     # Watch mode
pnpm lint           # ESLint
pnpm format         # Prettier
```

---

## License

MIT © 2cux
