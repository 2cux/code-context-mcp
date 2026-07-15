# CodeContext MCP v1.0.0 Release Notes

> See [docs/releases/v0.3.0-rc.md](./docs/releases/v0.3.0-rc.md) for release candidate notes.

## Quick Reference

- **Agent Mode** (default): 7 safe tools for AI coding agents
- **Dev Mode**: 18 tools for debugging and maintenance
- **Test Mode**: 18 tools for schema/smoke/harness testing

Set via `MCP_TOOL_MODE` env var.

## MCP Tools vs CLI Commands

The following are CLI commands, not MCP tools:

| Capability | CLI command | MCP access |
|---|---|---|
| Token and compression statistics | `code-context stats` | No standalone MCP tool |
| Repository profile | `code-context profile` | Profile data is included by `recall_context` |
| Audit receipt listing | `code-context receipts` | No standalone MCP tool |

The historical names `get_stats`, `get_profile`, and `list_receipts` are not callable MCP tools in v1.0.0.

## Verification

```bash
# Type-check and run tests
pnpm test
# Expected: the discovered test suite completes with zero failures

# Run installation health checks
code-context doctor
```

## Known Limitations

- PERF_TEST_EXTREME requires >16GB RAM
- New-process cache hits include ~50-90ms DB reopen overhead
- No image/binary compression
- No cloud sync
