# CodeContext Stable Release Gate

**GeneratedAt**: 2026-07-15T06:59:59.946Z
**Git commit**: bb0868e57e10a0c02c44365f728d4363d9827232
**Git dirty**: true
**Project**: code-context-mcp v1.0.0

## Verdict: **FAIL** ❌

## Summary

| Metric | Count |
|---|---|
| ✅ Pass | 11 |
| ⚠️ Warning | 1 |
| ❌ Fail | 1 |
| **Total** | **13** |
| MUST pass | 11 |
| MUST fail | 1 |
| Release blockers | 1 |
| Total duration | 325.4s |

## ❌ Release Blockers

| MUST check | Category | Detail |
|---|---|---|
| 1. Source reproducibility | reproducibility | subprocess exit 1; generated report verdict FAIL; 1 failed subcommand(s): cmd /d /s /c npx vitest run; npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. // X [ERROR] Cannot read directory "../../../..": Access is denied. //  // X [ERROR] Could not resolve "C:\\Users\\Lenovo\\AppData\\Local\\Temp\\CodeContext-source-repro-1784098476207\\vitest.config.ts" //  // failed to load config from C:\Users\Lenovo\AppData\Local\Temp\CodeContext-source-repro-1784098476207\vitest.config.ts //  // ⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯ // Error: Build failed with 2 errors: // error: Cannot read dir |

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
|---|---|---|---|---:|---|
| 1 | 1. Source reproducibility | ❌ fail | 🔴 MUST | 34152ms | subprocess exit 1; generated report verdict FAIL; 1 failed subcommand(s): cmd /d /s /c npx vitest... |

### build

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 2. TypeScript zero errors | ✅ pass | 🔴 MUST | 5837ms | tsc --noEmit returned zero errors |

### tests

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 3. Vitest zero failures | ✅ pass | 🔴 MUST | 211377ms | 1596 tests passed, 63 test files, 0 failures |

### quality

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 4. Compression Quality Gate | ✅ pass | 🔴 MUST | 509ms | Compression quality: 8/8 passed |
| 2 | 5. Memory Recall Quality Gate | ✅ pass | 🔴 MUST | 3410ms | 1 memory/recall test files, 0 failures |

### migration

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 6. Fingerprint migration tests | ✅ pass | 🔴 MUST | 3795ms | 4 fingerprint migration tests passed |

### boundary

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 7. Fast Path Boundary Gate | ✅ pass | 🔴 MUST | 8460ms | Fast path boundary gate has 0 blockers (29 checks) |
| 2 | 7a. Fast Path warnings | ⚠️ warning | 🟡 SHOULD | 0ms | vitest: could not execute boundary tests: Command failed: npx vitest run tests/profileBoundary.te... |

### tool-surface

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 8. Agent mode = 7 tools | ✅ pass | 🔴 MUST | 1ms | AGENT_TOOLS has exactly 7 entries: current_scope, compress_context, retrieve_original, remember_c... |
| 2 | 8. Dangerous tools not in agent mode | ✅ pass | 🔴 MUST | 1ms | Dangerous tools (delete_original, cleanup_originals) excluded from AGENT_TOOLS |

### packaging

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 9. Fresh npm install smoke | ✅ pass | 🔴 MUST | 51093ms | fresh HOME npm pack/install/CLI/MCP smoke passed |

### cli

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 10. demo / value / doctor runnable | ✅ pass | 🔴 MUST | 6045ms | doctor: allPass=true; demo: ok; value: ok |

### docs

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 11. Version and documentation consistency | ✅ pass | 🔴 MUST | 4ms | All sources consistent at v1.0.0 |

## Subcommand Output Summaries

| Command | Exit | Status | Output summary |
|---|---:|---|---|
| node scripts/release/source-reproducibility.mjs | 1 | FAIL | { //   "verdict": "FAIL", //   "trackedFiles": 425, //   "commands": [ //     [ //       "initialize temporary git metadata", //       "pass" //     ], //     [ //       "create temporary git branch", //       "pass" //     ], //     [ //   |
| npx tsc --noEmit | 0 | PASS |  |
| npx vitest run --reporter=json 2>&1 | 0 | PASS | {"numTotalTestSuites":543,"numPassedTestSuites":543,"numFailedTestSuites":0,"numPendingTestSuites":0,"numTotalTests":1624,"numPassedTests":1596,"numFailedTests":0,"numPendingTests":28,"numTodoTests":0,"snapshot":{"added":0,"failure":false," |
| node scripts/release/compression-quality-check.mjs | 0 | PASS | PASS test_output //   key facts:       PASS 11/11 //   no invention:    PASS 0 invented //   token savings:   PASS ratio=0.335 need>=0.300 (345/1030 tokens) //   retrieval proof: PASS length=2544/2544 sha256=PASS // PASS log //   key facts: |
| npx vitest run tests/quality/recallQualityGate.test.ts --reporter=json 2>&1 | 0 | PASS | {"numTotalTestSuites":8,"numPassedTestSuites":8,"numFailedTestSuites":0,"numPendingTestSuites":0,"numTotalTests":53,"numPassedTests":53,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"snapshot":{"added":0,"failure":false,"filesAdde |
| npx vitest run tests/memoryFingerprintMigration.test.ts --reporter=json 2>&1 | 0 | PASS | {"numTotalTestSuites":2,"numPassedTestSuites":2,"numFailedTestSuites":0,"numPendingTestSuites":0,"numTotalTests":4,"numPassedTests":4,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"snapshot":{"added":0,"failure":false,"filesAdded" |
| node scripts/release/fast-path-boundary-check.mjs | 0 | PASS | ═══════════════════════════════════════════ //   Fast Path Boundary Release Gate //   Verdict: WARNING //   Pass: 28  Warning: 1  Fail: 0 // ═══════════════════════════════════════════ //   Report: reports\release\fast-path-boundary-check.j |
| node scripts/release/clean-install-smoke.mjs | 0 | PASS | CodeContext MCP - Fresh Install Package Smoke //  //   Build package artifacts... OK 6925ms //   npm pack... OK 3929ms //   Install packed tgz in temporary project... OK 36078ms //   Isolation preflight: fresh HOME and empty database direct |
| node dist/cli/index.js doctor | 0 | PASS | { //   "timestamp": "2026-07-15T06:59:54.442Z", //   "nodeVersion": "v24.13.0", //   "platform": "win32 x64", //   "checks": [ //     { //       "name": "node-version", //       "label": "Node version", //       "status": "pass", //       " |
| node dist/cli/index.js demo | 0 | PASS | { //   "reportPath": "D:\\project\\CodeContext\\reports\\demo\\first-run-value.md", //   "jsonPath": "D:\\project\\CodeContext\\reports\\demo\\first-run-value.json", //   "summary": { //     "compress": "5862 tokens saved (86.5% ratio)", // |
| node dist/cli/index.js value | 0 | PASS | { //   "scopeId": "repo_ce1c6bc9", //   "summary": { //     "totalCompressions": 1, //     "totalEstimatedTokensSaved": 5862, //     "averageCompressionRatio": 0.8646, //     "cacheHits": 0, //     "totalRetrieves": 0, //     "memoriesSaved |
| git rev-parse HEAD | 0 | PASS | bb0868e57e10a0c02c44365f728d4363d9827232 |
| git status --porcelain | 0 | PASS | M artifacts/check-report.json //  M artifacts/check-report.md // A  examples/first-run/sample-error.log //  M reports/release/fast-path-boundary-check.json //  M reports/release/fast-path-boundary-check.md //  M reports/release/fresh-instal |

## ❌ Failed Subcommand Error Summaries

| Check | Command | Exit | Error summary |
|---|---|---:|---|
| direct subcommand | node scripts/release/source-reproducibility.mjs | 1 | Command failed: node "D:\project\CodeContext\scripts\release\source-reproducibility.mjs" \| "verdict": "FAIL", \| "fail" |
| 1. Source reproducibility | cmd /d /s /c npx vitest run | 1 | X [ERROR] Cannot read directory "../../../..": Access is denied. \| X [ERROR] Could not resolve "C:\\Users\\Lenovo\\AppData\\Local\\Temp\\CodeContext-source-repro-1784098476207\\vitest.config.ts" \| failed to load config from C:\Users\Lenovo\AppData\Local\Temp\CodeContext-source-repro-1784098476207\vitest.config.ts \| ⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯ \| Error: Build failed with 2 errors: \| error: Cannot read directory "../../../..": Access is denied. \| error: Could not resolve "C:\\Users\\Lenovo\\AppData\\Local\\Temp\\CodeContext-source-repro-1784098476207\\vitest.config.ts" |

## ❌ Failed Checks (Detail)

### 1. Source reproducibility

- **Severity**: MUST
- **Category**: reproducibility
- **Detail**: subprocess exit 1; generated report verdict FAIL; 1 failed subcommand(s): cmd /d /s /c npx vitest run; npm warn Unknown env config "store-dir". This will stop working in the next major version of npm.
X [ERROR] Cannot read directory "../../../..": Access is denied.

X [ERROR] Could not resolve "C:\\Users\\Lenovo\\AppData\\Local\\Temp\\CodeContext-source-repro-1784098476207\\vitest.config.ts"

failed to load config from C:\Users\Lenovo\AppData\Local\Temp\CodeContext-source-repro-1784098476207\vitest.config.ts

⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯
Error: Build failed with 2 errors:
error: Cannot read dir
- **Duration**: 34152ms

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
