# Clean Install & Package Smoke Report

**Generated**: 2026-06-17T02:23:53.718Z

## Environment

| Key | Value |
|---|---:|
| Node.js | v24.13.0 |
| Platform | win32 x64 |
| CPUs | 22 |
| Memory | 32373MB |

## Summary

✅ 9 | ❌ 0 | ⏭️ 0 | ⏱️ 8603ms

## Steps

| # | Step | Status | Duration | Detail |
|---|---:|---:|---:|---:|
| 1 | Clean install | ✅ | 541ms | pnpm install done |
| 2 | Build (tsc) | ✅ | 3063ms | dist/index.js created |
| 3 | TypeScript check (tsc --noEmit) | ✅ | 2213ms | zero errors |
| 4 | CLI version | ✅ | 183ms | version: 1.0.0 |
| 5 | CLI help | ✅ | 181ms | help displayed |
| 6 | MCP server: agent mode tools | ✅ | 352ms | 7 tools (agent mode): compress_context, current_scope, retrieve_original, remember_context, recall_context, forget_context, run_context_flow |
| 7 | MCP server: dev mode tools | ✅ | 356ms | 18 tools (dev mode, 4 harness) |
| 8 | npm pack: tarball content check | ✅ | 1711ms | no forbidden files in 938 packaged files |
| 9 | Package version | ✅ | 0ms | v1.0.0 |

## Artifacts

- `reports/release/clean-install-smoke.json` — structured data
- `reports/release/clean-install-smoke.md` — this report
