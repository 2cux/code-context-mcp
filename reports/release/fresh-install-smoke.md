# Fresh Install Package Smoke Report

**Generated**: 2026-07-14T09:04:58.054Z

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
| npm tarball | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-Bc8CDt\code-context-mcp-1.0.0.tgz` |
| install root | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-Bc8CDt\install` |
| HOME / USERPROFILE | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-Bc8CDt\fresh-home` |
| database directory | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-Bc8CDt\fresh-home\.code-context-mcp` |

## Summary

PASS 10 | FAIL 0 | SKIP 0 | 26697ms

## Steps

| # | Step | Status | Duration | Detail |
|---:|---|---:|---:|---|
| 1 | Build package artifacts | PASS | 3362ms | dist/index.js created |
| 2 | npm pack | PASS | 1712ms | code-context-mcp-1.0.0.tgz (513 files) |
| 3 | Install packed tgz in temporary project | PASS | 19031ms | installed code-context-mcp-1.0.0.tgz into C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-Bc8CDt\install |
| 4 | Isolation preflight: fresh HOME and empty database directory | PASS | 0ms | developer DB exists but is isolated; fresh HOME=C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-Bc8CDt\fresh-home |
| 5 | code-context --version | PASS | 229ms | version 1.0.0 |
| 6 | code-context doctor --json | PASS | 532ms | 7 checks passed |
| 7 | code-context demo --json | PASS | 1022ms | reports: C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-Bc8CDt\install\reports\demo\first-run-value.md, C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-Bc8CDt\install\reports\demo\first-run-value.json |
| 8 | code-context value --json | PASS | 387ms | tokens saved: 5862 |
| 9 | code-context-server first startup | PASS | 413ms | server responded with 7 agent tools |
| 10 | Isolation postflight: database created only under fresh HOME | PASS | 0ms | fresh database: C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-Bc8CDt\fresh-home\.code-context-mcp\code-context.sqlite |

## Artifacts

- `reports/release/fresh-install-smoke.json` - structured data
- `reports/release/fresh-install-smoke.md` - this report
