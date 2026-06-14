# Examples

This directory contains configuration examples for various AI coding agents.

## MCP Configuration

The `mcp-config/` directory contains JSON config files for different editors:

| File | Editor |
|------|--------|
| `claude-code.json` | [Claude Code](https://claude.ai/code) |
| `cursor.json` | [Cursor](https://cursor.sh) |
| `cline-vscode.json` | [Cline (VS Code)](https://github.com/cline/cline) |

### Usage

Copy the config into your editor's MCP settings. For most editors, this is:

- **Claude Code**: `.claude/mcp.json` (project) or `~/.claude/mcp.json` (global)
- **Cursor**: `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)
- **Cline (VS Code)**: VS Code settings → `cline.mcpServers`

## Fixtures

Test fixtures are in `tests/fixtures/` — they demonstrate the 8 content types supported:

| Fixture | Content Type | Description |
|---------|-------------|-------------|
| `vitest-output.txt` | test_output | Failed test run output with errors and stack traces |
| `app-log.txt` | log | Application log with ERROR/WARN/INFO/debug lines |
| `build-output.txt` | command_output | Build command stdout with errors |
| `sample.ts` | code | TypeScript source code |
| `response.json` | json | JSON API response |
| `readme.md` | markdown | Markdown document |
| `rag-chunks.json` | rag_chunk | RAG retrieval results with scores |
| `conversation.json` | conversation_history | Chat conversation history |

Try compressing each with the CLI:

```bash
code-context compress tests/fixtures/vitest-output.txt
code-context compress tests/fixtures/app-log.txt
code-context compress tests/fixtures/response.json
```
