# CodeContext MCP

[![npm version](https://img.shields.io/npm/v/code-context-mcp?color=blue)](https://www.npmjs.com/package/code-context-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/tests-1285%20passing-brightgreen)](./tests)

> **v1.0.0** — Context Compression + Project Memory, dual-core.

CodeContext MCP is a **local-first MCP server** for AI coding agents (Claude Code, Cursor, etc.). It solves two core problems in long coding sessions:

1. **Context gets too long** — Compress logs, command output, code, JSON, RAG chunks, conversation history, and more.
2. **Project knowledge is forgotten** — Remember, recall, and forget typed, scoped, auditable project memory across sessions.

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 18.0.0
- **pnpm** (recommended) or npm

### Install

```bash
# npm
npm install -g code-context-mcp

# Or from source
git clone https://github.com/2cux/code-context-mcp.git
cd code-context-mcp

pnpm install
pnpm build
npm run build

# Verify
node dist/cli/index.js scope
```

### MCP Configuration

Add to your AI coding agent's MCP config. The default mode is **agent** (7 safe tools):

```json
{
  "mcpServers": {
    "code-context": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "MCP_TOOL_MODE": "agent"
      }
    }
  }
}
```

For full tool access during development, use `dev` mode (18 tools):

```json
{
  "mcpServers": {
    "code-context": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "MCP_TOOL_MODE": "dev"
      }
    }
  }
}
```

**Tool Surface by Mode:**

| Mode | Tools | Includes |
|---|---|---|
| `agent` | 7 | compress, retrieve, remember, recall, forget, scope, run_context_flow |
| `dev` | 18 | All tools including dangerous (delete_original, cleanup_originals) and harness |
| `test` | 18 | All tools, no restrictions (for schema/smoke/harness testing) |

---

## CLI Usage

```bash
# Show current repo scope
code-context scope

# Run first-run value demo
code-context demo

# Generate usage value report
code-context value

# Compress a file (auto-detect content type)
code-context compress tests/fixtures/vitest-output.txt

# Compress with type override and token budget
code-context compress tests/fixtures/app-log.txt --type log --max-tokens 500

# Retrieve original content by ref
code-context retrieve orig_7b35451e

# Retrieve with pagination
code-context retrieve orig_7b35451e --offset 0 --limit 200

# View token stats
code-context stats

# List recent compressions
code-context list-compressions --limit 10

# View receipts (audit trail)
code-context receipts --limit 5

# Inspect a single receipt
code-context receipt rcp_xxxxxxxx

# Cleanup expired originals
code-context cleanup --originals

# ========== Memory Tools ==========

# Remember project knowledge
code-context remember --type project_rule --content "Use pnpm as the package manager" \
  --profile-target static --tags "build,convention"

# Remember current task
code-context remember --type current_task --content "Refactoring auth module" \
  --profile-target dynamic --tags "refactor"

# Recall relevant context
code-context recall "package manager"

# Recall with type and profile filter
code-context recall "auth" --type project_rule --profile static

# List all memories
code-context list-context --limit 20

# Filter by type and status
code-context list-context --type project_rule --status active

# Forget (soft delete) a memory
code-context forget mem_xxxxxxxx --mode soft_forget --reason "No longer relevant"

# Supersede old memory with new one
code-context forget mem_old_xxxx --mode supersede --superseded-by mem_new_xxxx \
  --reason "Replaced by updated rule"

# View repo profile (static + dynamic layers)
code-context profile
code-context profile --static
code-context profile --dynamic

# Cache inspection
code-context cache stats
code-context cache list --limit 10

# Failure diagnostics
code-context failures list --limit 10
code-context failures stats
```

---

## Content Types Supported

| Type | Compressor | Behavior |
|---|---|---|
| `test_output` | Test Output | Extract failed tests, errors, expected/received, stack traces |
| `log` | Log | Preserve ERROR/WARN lines, collapse repeated INFO/debug |
| `command_output` | Command Output | Preserve stderr, collapse repetitive stdout |
| `code` | Code | Keep function signatures, imports, fold bodies, preserve semantics |
| `json` | JSON | Keep schema structure, truncate large arrays/objects |
| `markdown` | Markdown | Keep headings, preserve code blocks |
| `rag_chunk` | RAG Chunk | Rank by score, deduplicate, keep top sources |
| `conversation_history` | Conversation | Preserve key context, collapse long exchanges |
| `plain_text` | Plain Text | Section scoring, repeat folding, token-aware truncation |

Type detection is automatic when `contentType` is omitted. The ContentRouter runs all 8 detectors and picks the best match by confidence.

---

## Memory Types

| Type | Description | Typical Profile |
|---|---|---|
| `project_rule` | Coding conventions, build rules | `static` |
| `decision` | Architecture decisions, trade-offs | `static` |
| `bug` | Known bugs, workarounds | `static` |
| `command` | Useful commands, scripts | `static` |
| `file_summary` | Key file descriptions | `static` |
| `user_preference` | User tooling/coding preferences | `static` |
| `current_task` | What's being worked on now | `dynamic` |
| `test_failure` | Recent test failure context | `dynamic` |
| `api_contract` | API endpoint contracts | `static` |
| `dependency` | Dependency notes, versions | `static` |

---

## Memory Lifecycle

| Status | Meaning |
|---|---|
| `active` | Currently valid and returned in recall |
| `superseded` | Replaced by a newer memory |
| `forgotten` | Soft-deleted, excluded from recall by default |
| `expired` | Past its `expiresAt` timestamp |

Transitions via `forget_context` modes: `soft_forget` → forgotten, `supersede` → superseded (requires `supersededBy`), `expire` → expired, `hard_delete` → permanently removed.

Valid reversals: `superseded → active`, `forgotten → active`, `expired → active`.

---

## Repo Profile

Each repository has a two-layer profile:

| Layer | Content | Examples |
|---|---|---|
| `static` | Long-lived project knowledge | Coding conventions, architecture decisions, API contracts |
| `dynamic` | Current session/task context | What you're working on now, recent test failures |

Profile facts are derived from `remember_context` calls with `profileTarget` and included in `recall_context` results.

---

## Key Design Principles

- **Local-first**: All data stays on your machine in SQLite (`~/.code-context-mcp/`)
- **Fail-open**: If compression fails, original content is returned
- **Scope isolation**: Each repo's data is isolated by `hash(gitRemote + gitRoot)`
- **Auditable**: Every operation generates a receipt
- **Recoverable**: Original content can be retrieved via `originalRef` when saved
- **Forgettable**: Memory has a lifecycle — old knowledge won't pollute future recall

---

## Architecture

```
AI Coding Agent
    ↓ MCP (stdio)
CodeContext MCP Server
    ├── Scope Resolver (git remote + root)
    ├── ContentRouter (8 detectors)
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

For full architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Demos

### Compression Demo

```bash
# Compress a long test output (auto-detected)
$ code-context compress tests/fixtures/vitest-output.txt --max-tokens 500
{
  "ccrId": "ccr_lz3abc_1a2b3c_000001",
  "compressed": true,
  "contentType": "test_output",
  "tokensBefore": 2450,
  "tokensAfter": 487,
  "tokensSaved": 1963,
  "compressionRatio": 0.8012,
  "canRetrieveOriginal": true,
  "receiptId": "rcp_lz3def_4d5e6f_000002"
}
```

### Memory Demo

```bash
# Remember a project rule
$ code-context remember --type project_rule \
  --content "Use pnpm as the package manager. No npm or yarn." \
  --profile-target static --tags "build,convention"
{
  "memoryId": "mem_lz3ghi_7a8b9c_000012",
  "scopeId": "repo_a1b2c3d4",
  "type": "project_rule",
  "status": "active",
  "receiptId": "rcp_lz3jkl_0d1e2f_000013"
}

# Recall it
$ code-context recall "package manager"
{
  "profile": { "static": [...], "dynamic": [...] },
  "memories": [
    {
      "id": "mem_lz3ghi_7a8b9c_000012",
      "type": "project_rule",
      "content": "Use pnpm as the package manager. No npm or yarn.",
      "confidence": 0.8,
      "status": "active",
      "score": 2.45
    }
  ],
  "receiptId": "rcp_lz3mno_3f4g5h_000014"
}
```

### Scope Isolation Demo

```bash
# Project A
$ cd /projects/backend && code-context scope
{ "scopeId": "repo_a1b2c3d4" }

# Project B — completely isolated
$ cd /projects/frontend && code-context scope
{ "scopeId": "repo_e5f6a7b8" }
```

Memories and compressions saved in one repo are invisible from the other.

### Receipt Demo

```bash
$ code-context receipts --limit 5
[
  { "id": "rcp_...", "operation": "remember", "timestamp": "..." },
  { "id": "rcp_...", "operation": "compress", "tokensSaved": 1963, "timestamp": "..." },
  { "id": "rcp_...", "operation": "recall", "query": "package manager", "timestamp": "..." }
]
```

Every operation leaves an audit trail. For a complete walkthrough, see [DEMO.md](./DEMO.md).

---

## Documentation

| Document | Content |
|---|---|
| [MCP_TOOLS.md](./MCP_TOOLS.md) | All 18 MCP tools — input/output, schemas, error handling |
| [TOOL_SURFACE.md](./docs/TOOL_SURFACE.md) | Tool surface modes — agent (7), dev (18), test (18) |
| [TOOL_INVENTORY.md](./docs/TOOL_INVENTORY.md) | Full 18-tool inventory with module, risk, and mode assignments |
| [VALUE_REPORT.md](./docs/VALUE_REPORT.md) | Usage value report — token savings, compression stats, memory metrics |
| [mcp-resources-and-prompts.md](./docs/mcp-resources-and-prompts.md) | MCP resources and prompts documentation |
| [agent-resource-usage.md](./examples/agent-resource-usage.md) | Example: agent using MCP resources |
| [PERFORMANCE.md](./docs/PERFORMANCE.md) | Performance guide: test tiers, memory guard, thresholds |
| [HARNESS.md](./docs/14-harness.md) | Harness framework — flows, runner, adapters |
| [USABILITY.md](./reports/usability/agent-usability-report.md) | Agent usability evaluation — 3-mode comparison |
| [DATA_MODEL.md](./DATA_MODEL.md) | Data models, record types, SQLite schema |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Architecture, module responsibilities, data flows |
| [SECURITY.md](./SECURITY.md) | Security model, data directory, privacy, encryption |
| [DEMO.md](./DEMO.md) | End-to-end demo walkthrough with all features |

PRD documents are in [`docs/`](./docs/INDEX.md).

---

## Non-Goals

- ❌ Not a transparent HTTP proxy
- ❌ Not a WebSocket interceptor
- ❌ Not a multi-provider auth layer
- ❌ Not an ML-based compressor
- ❌ Not a CLAUDE.md auto-modifier
- ❌ Not a cloud sync service
- ❌ Not a multi-user permission system
- ❌ No image/binary compression support
- ❌ No complex UI or dashboard

---

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build TypeScript
npm run build       # Cross-platform build (Windows/macOS/Linux)
pnpm test           # Run tests (1285 tests)
pnpm test:watch     # Watch mode
pnpm lint           # ESLint
pnpm format         # Prettier

Windows notes:
The build is cross-platform. `npm run build` and `pnpm build` both use a Node-based cleanup step instead of `rm -rf dist/`.
```

---

## Harness Testing

CodeContext uses a **Harness** — a unified business closed-loop execution and verification framework. Every business capability (compression, memory, profile, originals) has a corresponding Harness flow that exercises its full lifecycle.

### Test Architecture

| Layer | Location | Tests | Adapter | Purpose |
|-------|----------|-------|---------|---------|
| **Core Unit** | `tests/harness/*.test.ts` | ~200 | — | types, registry, runner, state store, artifact store, reporter, check, validate, checkEngine, mockAdapters |
| **Flow Integration** | `tests/harness/*Flow.test.ts` | ~40 | real + mock | 7 business-capability closed loops |
| **MCP Tools** | `tests/harness/mcpHarness.test.ts` | 26 | mock + **real** | smoke + real adapter for harness MCP tools |
| **CLI** | `tests/cli.test.ts` + `tests/harness/cliHarness.test.ts` | 73 | mock | CLI command smoke + integration |
| **Regression** | `tests/phase*.test.ts` | ~500 | real in-memory DB | compression, memory, profile, acceptance |
| **Schema** | `tests/mcpSchema.test.ts` | 37 | — | MCP tool schema validation |

### Adapter Strategy

| Flow | Adapter | Type | Notes |
|------|---------|------|-------|
| `compression-flow` | `CodeContextAdapter` | **Real** (in-memory SQLite) | Full compression loop |
| `originals-flow` | `CodeContextAdapter` | **Real** (in-memory SQLite) | Originals lifecycle |
| `memory-flow` | `CodeContextAdapter` | **Real** (in-memory SQLite) | Memory lifecycle |
| `profile-flow` | `CodeContextAdapter` | **Real** (in-memory SQLite) | Profile closed loop |
| `full-context-flow` | `CodeContextAdapter` | **Real** (in-memory SQLite) | Total value chain |
| `mcp-tools-smoke-flow` | `McpAdapter` | **Real** (4 harness tools) + **Mock** (9 prod tools) | Harness tools call real handlers; prod tools return unsupported |
| `cli-smoke-flow` | `CliAdapter` | **Mock** (tests) / Real (CLI) | CLI commands |

### Harness MCP Tools (Real Adapter)

The real `McpAdapter` supports 4 harness MCP tools backed by in-memory SQLite:

- **`list_harness_flows`** — Lists all 7 registered flows with filtering by tag/capability
- **`check_harness_flow`** — Validates manifest structure without execution (15 rules)
- **`run_harness_flow`** — Executes a full flow via the 14-step runner pipeline
- **`get_harness_run`** — Retrieves a previous run's full state (artifacts, logs, checkpoints)

### Verification Command

```bash
pnpm test
```

Expected: **42 test files, 1285 tests, all passing.** (Performance tests run separately with `PERF_TEST=1`)

---

## License

MIT © 2cux
