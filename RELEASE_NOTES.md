# CodeContext MCP v0.3.0-rc Release Notes

> See [docs/releases/v0.3.0-rc.md](./docs/releases/v0.3.0-rc.md) for full release notes.

## Quick Reference

- **Agent Mode** (default): 7 safe tools for AI coding agents
- **Dev Mode**: 18 tools for debugging and maintenance
- **Test Mode**: 18 tools for schema/smoke/harness testing

Set via `MCP_TOOL_MODE` env var.

## Verification

```bash
npx tsc --noEmit && npx vitest run
# Expected: 42 test files, 1285 tests, zero failures
```

## Known Limitations

- PERF_TEST_EXTREME requires >16GB RAM
- New-process cache hits include ~50-90ms DB reopen overhead
- No image/binary compression
- No cloud sync
