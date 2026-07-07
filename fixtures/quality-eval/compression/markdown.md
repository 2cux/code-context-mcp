/**
 * Markdown Fixture — Quality Eval
 *
 * A realistic project README/documentation snippet.
 */

# CodeContext MCP

A local-first MCP server for AI coding agents.

## Features

- **Context Compression** — Compress long logs, code files, and chat histories.
- **Project Memory** — Store and recall project-specific knowledge.
- **Scope Isolation** — Each repo has its own compression and memory namespace.

## Quick Start

```bash
npm install -g code-context-mcp
code-context-server
```

## Architecture

The project consists of several layers:

1. **Content Router** — Detects content type (code, log, test_output, etc.)
2. **Compression Engine** — Routes to type-specific compressors
3. **Storage Layer** — SQLite-backed compressed records and originals
4. **Memory Service** — Typed memory with FTS5 full-text search
5. **Receipt Service** — Audit trail for all operations

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_TOKENS` | 2000 | Max output tokens per compression |
| `TIMEOUT_MS` | 5000 | Compression timeout |
| `DB_PATH` | ~/.code-context-mcp/ | SQLite database path |

## API

### MCP Tools

| Tool | Description |
|------|-------------|
| `compress_context` | Compress content with type-aware strategies |
| `retrieve_original` | Retrieve original content by reference |
| `remember_context` | Store a typed memory record |
| `recall_context` | Search memories by query |

> **Note**: All MCP tools require an active MCP server connection. See [MCP SDK](https://github.com/modelcontextprotocol/sdk) for details.
