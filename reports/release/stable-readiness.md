# CodeContext Stable Release Gate

**GeneratedAt**: 2026-07-14T09:34:14.681Z
**Git commit**: 2e0a5f21f157762db581d17e6b92ee0f537dd987
**Git dirty**: true
**Project**: code-context-mcp v1.0.0

## Verdict: **PASS** ✅

## Summary

| Metric | Count |
|---|---|
| ✅ Pass | 12 |
| ⚠️ Warning | 0 |
| ❌ Fail | 0 |
| **Total** | **12** |
| MUST pass | 12 |
| MUST fail | 0 |
| Total duration | 122.3s |

## Verdict Rules

### ❌ MUST (fail = release blocked)

- Source reproducibility
- TypeScript zero errors
- Vitest zero failures (all test files)
- Compression Quality Gate pass
- Memory Recall Quality Gate pass
- Fingerprint migration tests
- Fast Path Boundary Gate pass
- Agent mode = 7 tools
- Dangerous tools not in agent mode
- Fresh npm install smoke
- demo / value / doctor runnable
- Version and documentation consistency

### ⚠️ SHOULD (warning only — review but do not block)

- Performance fluctuations (non-critical, does not block release)
- Documentation warnings
- Cache hit latency

## Check Results

### reproducibility

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 1. Source reproducibility | ✅ pass | 🔴 MUST | 15769ms | clean tracked-source build and quality tests passed |

### build

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 2. TypeScript zero errors | ✅ pass | 🔴 MUST | 2415ms | tsc --noEmit returned zero errors |

### tests

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 3. Vitest zero failures | ✅ pass | 🔴 MUST | 51349ms | 1596 tests passed, 63 test files, 0 failures |

### quality

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 4. Compression Quality Gate | ✅ pass | 🔴 MUST | 348ms | Compression quality: 8/8 passed |
| 2 | 5. Memory Recall Quality Gate | ✅ pass | 🔴 MUST | 2724ms | 1 memory/recall test files, 0 failures |

### migration

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 6. Fingerprint migration tests | ✅ pass | 🔴 MUST | 2700ms | 4 fingerprint migration tests passed |

### boundary

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 7. Fast Path Boundary Gate | ✅ pass | 🔴 MUST | 5557ms | Fast path boundary gate passed |

### tool-surface

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 8. Agent mode = 7 tools | ✅ pass | 🔴 MUST | 1ms | AGENT_TOOLS has exactly 7 entries: current_scope, compress_context, retrieve_original, remember_c... |
| 2 | 8. Dangerous tools not in agent mode | ✅ pass | 🔴 MUST | 1ms | Dangerous tools (delete_original, cleanup_originals) excluded from AGENT_TOOLS |

### packaging

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 9. Fresh npm install smoke | ✅ pass | 🔴 MUST | 37883ms | fresh HOME npm pack/install/CLI/MCP smoke passed |

### cli

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 10. demo / value / doctor runnable | ✅ pass | 🔴 MUST | 3542ms | doctor: allPass=true; demo: ok; value: ok |

### docs

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---:|---:|
| 1 | 11. Version and documentation consistency | ✅ pass | 🔴 MUST | 3ms | All sources consistent at v1.0.0 |

## Subcommand Output Summaries

| Command | Exit | Status | Output summary |
|---|---:|---|---|
| node scripts/release/source-reproducibility.mjs | 0 | PASS | CodeContext MCP — Source Reproducibility Check    Verify required source dirs are Git-tracked... ✅ 107ms   Copy git ls-files to temp directory... ✅ 1998ms   pnpm install --frozen-lockfile... ✅ 2914ms   Build (tsc)... ✅ 3182ms   npx vitest r |
| npx tsc --noEmit | 0 | PASS |  |
| npx vitest run --reporter=json 2>&1 | 0 | PASS | {"numTotalTestSuites":543,"numPassedTestSuites":543,"numFailedTestSuites":0,"numPendingTestSuites":0,"numTotalTests":1624,"numPassedTests":1596,"numFailedTests":0,"numPendingTests":28,"numTodoTests":0,"snapshot":{"added":0,"failure":false," |
| node scripts/release/compression-quality-check.mjs | 0 | PASS | PASS test_output   key facts:       PASS 11/11   no invention:    PASS 0 invented   token savings:   PASS ratio=0.335 need>=0.300 (345/1030 tokens)   retrieval proof: PASS length=2544/2544 sha256=PASS PASS log   key facts:       PASS 13/13  |
| npx vitest run tests/quality/recallQualityGate.test.ts --reporter=json 2>&1 | 0 | PASS | {"numTotalTestSuites":8,"numPassedTestSuites":8,"numFailedTestSuites":0,"numPendingTestSuites":0,"numTotalTests":53,"numPassedTests":53,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"snapshot":{"added":0,"failure":false,"filesAdde |
| npx vitest run tests/memoryFingerprintMigration.test.ts --reporter=json 2>&1 | 0 | PASS | {"numTotalTestSuites":2,"numPassedTestSuites":2,"numFailedTestSuites":0,"numPendingTestSuites":0,"numTotalTests":4,"numPassedTests":4,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"snapshot":{"added":0,"failure":false,"filesAdded" |
| node scripts/release/fast-path-boundary-check.mjs | 0 | PASS | ═══════════════════════════════════════════   Fast Path Boundary Release Gate   Verdict: PASS   Pass: 29  Warning: 0  Fail: 0 ═══════════════════════════════════════════   Report: reports\release\fast-path-boundary-check.json   Report: repo |
| node scripts/release/clean-install-smoke.mjs | 0 | PASS | CodeContext MCP - Fresh Install Package Smoke    Build package artifacts... OK 3521ms   npm pack... OK 1850ms   Install packed tgz in temporary project... OK 29660ms   Isolation preflight: fresh HOME and empty database directory... OK 1ms   |
| node dist/cli/index.js doctor | 0 | PASS | {   "timestamp": "2026-07-14T09:34:11.808Z",   "nodeVersion": "v24.13.0",   "platform": "win32 x64",   "checks": [     {       "name": "node-version",       "label": "Node version",       "status": "pass",       "message": "v24.13.0 (>= 18. |
| node dist/cli/index.js demo | 0 | PASS | {   "reportPath": "D:\\project\\CodeContext\\reports\\demo\\first-run-value.md",   "jsonPath": "D:\\project\\CodeContext\\reports\\demo\\first-run-value.json",   "summary": {     "compress": "5862 tokens saved (86.5% ratio)",     "remember" |
| node dist/cli/index.js value | 0 | PASS | {   "scopeId": "repo_ce1c6bc9",   "summary": {     "totalCompressions": 1,     "totalEstimatedTokensSaved": 5862,     "averageCompressionRatio": 0.8646,     "cacheHits": 0,     "totalRetrieves": 0,     "memoriesSaved": 1,     "memoriesRecal |
| git rev-parse HEAD | 0 | PASS | 2e0a5f21f157762db581d17e6b92ee0f537dd987 |
| git status --porcelain | 0 | PASS | M artifacts/check-report.json  M artifacts/check-report.md  M reports/demo/first-run-value.json  M reports/demo/first-run-value.md  M reports/release/fast-path-boundary-check.json  M reports/release/fast-path-boundary-check.md  M reports/re |

## ✅ Ready for Stable Release

All checks pass. The release is ready.

Next steps:
```bash
# 1. Review this report one final time
# 2. Create git tag:
git tag -a v1.0.0 -m "Release v1.0.0"
# 3. Push tag:
git push origin v1.0.0
# 4. Publish to npm:
npm publish
```

## Non-Scope

This gate does NOT:
- Execute `npm publish`
- Create git tags
- Push to remote
- Upload to any external service
- Check image/binary compression (explicit non-goal)
