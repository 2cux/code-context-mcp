# MCP Configuration Examples

These JSON files show how to configure different AI coding agents. Copy the content into your editor's MCP settings.

## npx (recommended — always latest)

```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["-y", "code-context-mcp"]
    }
  }
}
```

## Global install

```bash
npm install -g code-context-mcp
```

```json
{
  "mcpServers": {
    "code-context": {
      "command": "code-context-server",
      "args": []
    }
  }
}
```

## Editor-specific locations

| Editor | Config file |
|--------|------------|
| Claude Code | `.claude/mcp.json` (project) or `~/.claude/mcp.json` (global) |
| Cursor | `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global) |
| Cline (VS Code) | VS Code settings → `cline.mcpServers` |
