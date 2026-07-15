# Fresh Install Package Smoke Report

**Generated**: 2026-07-15T08:23:56.797Z

## Environment

| Key | Value |
|---|---:|
| Node.js | v24.13.0 |
| Platform | win32 x64 |
| CPUs | 22 |
| Memory | 32373MB |

## Fresh Install Isolation

| Key | Value |
|---|---|
| npm tarball | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-toLniK\code-context-mcp-1.0.0.tgz` |
| install root | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-toLniK\install` |
| HOME / USERPROFILE | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-toLniK\fresh-home` |
| database directory | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-toLniK\fresh-home\.code-context-mcp` |

## Summary

PASS 11 | FAIL 0 | SKIP 0 | 48915ms

## Steps

| # | Step | Status | Duration | Detail |
|---:|---|---:|---:|---|
| 1 | Build package artifacts | PASS | 7517ms | dist/index.js created |
| 2 | npm pack | PASS | 3975ms | code-context-mcp-1.0.0.tgz (517 files) |
| 3 | Install packed tgz in temporary project | PASS | 32512ms | installed code-context-mcp-1.0.0.tgz into C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-toLniK\install |
| 4 | Isolation preflight: fresh HOME and empty database directory | PASS | 1ms | developer DB exists but is isolated; fresh HOME=C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-toLniK\fresh-home |
| 5 | code-context --version | PASS | 335ms | version 1.0.0 |
| 6 | code-context doctor --json | PASS | 843ms | 7 checks passed |
| 7 | code-context demo --json | PASS | 1981ms | reports: C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-toLniK\install\reports\demo\first-run-value.md, C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-toLniK\install\reports\demo\first-run-value.json |
| 8 | code-context value --json | PASS | 632ms | tokens saved: 5862 |
| 9 | Packed run_context_flow bypasses HarnessRunner | PASS | 1ms | installed handler has no HarnessRunner import or entrypoint reference |
| 10 | MCP stdio initialize and real agent business flow | PASS | 1106ms | 7 tools; scope=cwd_2fbee02c; tokensSaved=1817; originalSha256=fef9fc53e2b97b54d4a83862e7e9b15bc7c79f63687c29352c50c1bca18949ef; memory=mem_mrltcyu0_5f048b_000001; flow=flow_mrltcyuf_b77656e9 |
| 11 | Isolation postflight: database created only under fresh HOME | PASS | 0ms | fresh database: C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-toLniK\fresh-home\.code-context-mcp\code-context.sqlite |

## Artifacts

- `reports/release/fresh-install-smoke.json` - structured data
- `reports/release/fresh-install-smoke.md` - this report
