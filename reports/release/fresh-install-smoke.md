# Fresh Install Package Smoke Report

**Generated**: 2026-07-15T06:59:53.453Z

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
| npm tarball | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-6U45uw\code-context-mcp-1.0.0.tgz` |
| install root | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-6U45uw\install` |
| HOME / USERPROFILE | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-6U45uw\fresh-home` |
| database directory | `C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-6U45uw\fresh-home\.code-context-mcp` |

## Summary

PASS 10 | FAIL 0 | SKIP 0 | 50912ms

## Steps

| # | Step | Status | Duration | Detail |
|---:|---|---:|---:|---|
| 1 | Build package artifacts | PASS | 6925ms | dist/index.js created |
| 2 | npm pack | PASS | 3929ms | code-context-mcp-1.0.0.tgz (513 files) |
| 3 | Install packed tgz in temporary project | PASS | 36078ms | installed code-context-mcp-1.0.0.tgz into C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-6U45uw\install |
| 4 | Isolation preflight: fresh HOME and empty database directory | PASS | 1ms | developer DB exists but is isolated; fresh HOME=C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-6U45uw\fresh-home |
| 5 | code-context --version | PASS | 353ms | version 1.0.0 |
| 6 | code-context doctor --json | PASS | 807ms | 7 checks passed |
| 7 | code-context demo --json | PASS | 1564ms | reports: C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-6U45uw\install\reports\demo\first-run-value.md, C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-6U45uw\install\reports\demo\first-run-value.json |
| 8 | code-context value --json | PASS | 569ms | tokens saved: 5862 |
| 9 | code-context-server first startup | PASS | 673ms | server responded with 7 agent tools |
| 10 | Isolation postflight: database created only under fresh HOME | PASS | 0ms | fresh database: C:\Users\Lenovo\AppData\Local\Temp\code-context-fresh-smoke-6U45uw\fresh-home\.code-context-mcp\code-context.sqlite |

## Artifacts

- `reports/release/fresh-install-smoke.json` - structured data
- `reports/release/fresh-install-smoke.md` - this report
