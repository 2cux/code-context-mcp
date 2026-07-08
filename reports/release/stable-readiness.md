# CodeContext Stable Release Gate

**Generated**: 2026-07-08T02:07:33.384Z
**Project**: code-context-mcp v1.0.0

## Verdict: **FAIL** ❌

## Summary

| Metric | Count |
|---|---|
| ✅ Pass | 9 |
| ⚠️ Warning | 0 |
| ❌ Fail | 1 |
| **Total** | **10** |
| MUST pass | 9 |
| MUST fail | 1 |
| Total duration | 364.4s |

## Verdict Rules

### ❌ MUST (fail = release blocked)

- TypeScript zero errors
- Vitest zero failures (all test files)
- Compression Quality Gate pass
- Memory Recall Quality Gate pass
- Fast Path Boundary Gate pass
- Agent mode = 7 tools
- Dangerous tools not in agent mode
- demo / value / doctor runnable
- npm pack install + CLI / MCP server startable
- README / version / CHANGELOG consistency

### ⚠️ SHOULD (warning only — review but do not block)

- Performance fluctuations (non-critical, does not block release)
- Documentation warnings
- Cache hit latency

## Check Results

### build

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 1. TypeScript zero errors | ✅ pass | 🔴 MUST | 2242ms | tsc --noEmit returned zero errors |

### tests

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 2. Vitest zero failures | ❌ fail | 🔴 MUST | 54291ms | 4 failures out of 1609 tests, 58 test files |

### quality

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 3. Compression Quality Gate | ✅ pass | 🔴 MUST | 285ms | Compression quality: 8/8 passed |
| 2 | 4. Memory Recall Quality Gate | ✅ pass | 🔴 MUST | 53954ms | 11 memory/recall test files, 0 failures |

### boundary

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 5. Fast Path Boundary Gate | ✅ pass | 🔴 MUST | 5766ms | Fast path boundary gate passed |

### tool-surface

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 6. Agent mode = 7 tools | ✅ pass | 🔴 MUST | 1ms | AGENT_TOOLS has exactly 7 entries: current_scope, compress_context, retrieve_original, remember_c... |
| 2 | 7. Dangerous tools not in agent mode | ✅ pass | 🔴 MUST | 1ms | Dangerous tools (delete_original, cleanup_originals) excluded from AGENT_TOOLS |

### cli

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 8. demo / value / doctor runnable | ✅ pass | 🔴 MUST | 3100ms | doctor: ok; demo: ok; value: ok |

### packaging

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 9. npm pack install + CLI / MCP server startable | ✅ pass | 🔴 MUST | 244805ms | Pack OK (no forbidden files), dry-run clean, install OK, CLI v1.0.0, MCP server 7 tools |

### docs

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 10. README / version / CHANGELOG consistency | ✅ pass | 🔴 MUST | 3ms | All sources consistent at v1.0.0 |

## ❌ Failed Checks (Detail)

### 2. Vitest zero failures

- **Severity**: MUST
- **Category**: tests
- **Detail**: 4 failures out of 1609 tests, 58 test files
- **Duration**: 54291ms

## ❌ Action Required

One or more MUST checks failed. **Do NOT release until resolved.**

Fix the failed MUST checks above and re-run:
```bash
node scripts/release/stable-readiness-check.mjs
```

## Non-Scope

This gate does NOT:
- Execute `npm publish`
- Create git tags
- Push to remote
- Upload to any external service
- Check image/binary compression (explicit non-goal)
