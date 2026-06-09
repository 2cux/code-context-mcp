# CodeContext MCP

> Local-first MCP server for AI coding agents — context compression and project-scoped memory.

## Overview

CodeContext MCP is a local-first context service layer for AI coding agents. It provides two core capabilities:

1. **Context Compression** — compress long logs, test output, command output, code files, JSON, and RAG chunks
2. **Project Memory** — store, recall, and forget project-scoped knowledge with lifecycle management

## Installation

```bash
pnpm add code-context-mcp
```

Or install globally:

```bash
pnpm add -g code-context-mcp
```

## Quick Start

### 1. Configure MCP

Add to your AI coding agent's MCP configuration:

```json
{
  "mcpServers": {
    "code-context": {
      "command": "code-context",
      "args": ["start"]
    }
  }
}
```

### 2. Compress Test Output

When your agent runs tests and gets a long output, it can compress:

```json
{
  "tool": "compress_context",
  "input": {
    "content": "... 30000 tokens of test output ...",
    "contentType": "test_output"
  }
}
```

The server returns:
- **Failed test names and files**
- **Assertion Expected/Received**
- **Key stack trace portions**
- **Token savings statistics**
- **Original reference** for later retrieval

### 3. Save Project Memory

```json
{
  "tool": "remember_context",
  "input": {
    "type": "project_rule",
    "content": "This project uses pnpm, never npm."
  }
}
```

### 4. Recall When Needed

```json
{
  "tool": "recall_context",
  "input": {
    "query": "package manager"
  }
}
```

## Design Principles

- **Local-first** — all data stays on your machine
- **Conservative compression** — code semantics never altered
- **Scope isolation** — data scoped by git repository
- **Auditable** — every operation generates a receipt
- **Fail-open** — compression failures return original content unmodified

## Supported Content Types

| Type | Description |
|------|-------------|
| `test_output` | Test runner output (vitest, jest, pytest) |
| `log` | Application and server logs |
| `command_output` | Build, shell command output |
| `code` | Source code files |
| `json` | JSON responses and data |
| `markdown` | Documentation and markdown |
| `rag_chunk` | RAG retrieval results |
| `conversation_history` | Agent conversation logs |

## Configuration

See [docs/10-config-security-and-errors.md](docs/10-config-security-and-errors.md) for full configuration options.

```json
{
  "storagePath": "~/.code-context-mcp/code-context.sqlite",
  "originalsRetentionDays": 30,
  "defaultKeepOriginal": true,
  "maxInputBytes": 1048576,
  "maxOutputTokens": 2000,
  "compressionTimeoutMs": 5000
}
```

## FAQ

### What does this do that a plain text summarizer doesn't?

CodeContext MCP understands content types. Test output compression preserves assertion details; code compression preserves type signatures; log compression preserves stack traces. Generic summarizers lose these.

### Does it upload my code anywhere?

No. Everything stays local. The server does not make outbound network requests.

### Can I recover the original content after compression?

Yes. Every compression returns an `originalRef` that can be retrieved with `retrieve_original`.

### What happens if compression fails?

The server returns the original content unchanged (fail-open). Your agent is never blocked by compression errors.

## License

MIT
