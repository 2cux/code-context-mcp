# CodeContext Stable Release Gate

**GeneratedAt**: 2026-07-15T10:05:29.556Z
**Release source commit**: eb4d67a760ee1cd3d01497fb4bd56f4e94c00cfd
**Git dirty**: false
**tgz SHA-256**: db77fee0086e568d3fe79d7d0c92b2467ccd157de223baed3516f23223e0932f
**Package file count**: 524
**Project**: code-context-mcp v1.0.0

## Verdict: **PASS** ✅

## Required Stable Release Revalidation

| Requirement | Status | Evidence |
|---|---|---|
| TypeScript 0 errors | PASS | `npx tsc --noEmit` exited 0 |
| Vitest 0 failures | PASS | 1611 passed, 66 test files, 0 failures |
| Compression Quality Gate | PASS | 8/8 passed |
| Memory Recall Quality Gate | PASS | 53 passed, 0 failures |
| Fast Path Boundary Gate | PASS | 29 checks, 0 blockers |
| Agent mode exactly 7 tools | PASS | `current_scope`, `compress_context`, `retrieve_original`, `remember_context`, `recall_context`, `forget_context`, `run_context_flow` |
| Fresh install | PASS | 11 steps passed, 0 failed, isolated HOME and database |
| MCP `compress_context` | PASS | Actual packed MCP stdio call returned `compressed=true`, `tokensSaved=1817` |
| `retrieve_original` hash | PASS | Full content SHA-256 matched: `fef9fc53e2b97b54d4a83862e7e9b15bc7c79f63687c29352c50c1bca18949ef` |
| Memory save / recall / deduplicate / replace | PASS | Packed MCP save/recall passed; focused lifecycle run passed 168/168 tests including `action=deduplicated` and atomic `action=replaced` |
| Packed Markdown links | PASS | Explicit packed-tgz link checker exited 0; 0 broken relative links |
| Git dirty | PASS | Release-candidate provenance recorded `dirty=false` |
| tgz SHA-256 identity | PASS | Report and actual file both `db77fee0086e568d3fe79d7d0c92b2467ccd157de223baed3516f23223e0932f` (524 package files) |

Release artifact validated: `C:\tmp\codecontext-stable-1784109488\code-context-mcp-1.0.0.tgz`.

## Summary

| Metric | Count |
|---|---|
| ✅ Pass | 12 |
| ⚠️ Warning | 0 |
| ❌ Fail | 0 |
| **Total** | **12** |
| MUST pass | 12 |
| MUST fail | 0 |
| Release blockers | 0 |
| Total duration | 421.4s |

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
| 1 | 1. Source reproducibility | ✅ pass | 🔴 MUST | 211264ms | clean tracked-source build and quality tests passed |

### build

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 2. TypeScript zero errors | ✅ pass | 🔴 MUST | 2740ms | tsc --noEmit returned zero errors |

### tests

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 3. Vitest zero failures | ✅ pass | 🔴 MUST | 143261ms | 1611 tests passed, 66 test files, 0 failures |

### quality

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 4. Compression Quality Gate | ✅ pass | 🔴 MUST | 548ms | Compression quality: 8/8 passed |
| 2 | 5. Memory Recall Quality Gate | ✅ pass | 🔴 MUST | 2935ms | 1 memory/recall test files, 0 failures |

### migration

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 6. Fingerprint migration tests | ✅ pass | 🔴 MUST | 2324ms | 4 fingerprint migration tests passed |

### boundary

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 7. Fast Path Boundary Gate | ✅ pass | 🔴 MUST | 5230ms | Fast path boundary gate has 0 blockers (29 checks) |

### tool-surface

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 8. Agent mode = 7 tools | ✅ pass | 🔴 MUST | 0ms | AGENT_TOOLS has exactly 7 entries: current_scope, compress_context, retrieve_original, remember_c... |
| 2 | 8. Dangerous tools not in agent mode | ✅ pass | 🔴 MUST | 0ms | Dangerous tools (delete_original, cleanup_originals) excluded from AGENT_TOOLS |

### packaging

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 9. Fresh npm install smoke | ✅ pass | 🔴 MUST | 48631ms | fresh HOME install/CLI/MCP smoke passed for release source commit eb4d67a760ee1cd3d01497fb4bd56f4e94c00cfd and tgz db77fee0086e568d3fe79d7d0c92b2467ccd157de223baed3516f23223e0932f |

### cli

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 10. demo / value / doctor runnable | ✅ pass | 🔴 MUST | 4504ms | doctor: allPass=true; demo: ok; value: ok |

### docs

| # | Check | Status | Severity | Duration | Detail |
|---|---|---|---|---:|---|
| 1 | 11. Version and documentation consistency | ✅ pass | 🔴 MUST | 2ms | All sources consistent at v1.0.0 |

## Subcommand Output Summaries

| Command | Exit | Status | Output summary |
|---|---:|---|---|
| node scripts/release/source-reproducibility.mjs | 0 | PASS | { //   "verdict": "PASS", //   "trackedFiles": 433, //   "commands": [ //     [ //       "initialize temporary git metadata", //       "pass" //     ], //     [ //       "create temporary git branch", //       "pass" //     ], //     [ //   |
| npx tsc --noEmit | 0 | PASS |  |
| npx vitest run --reporter=json 2>&1 | 0 | PASS | warning: in the working copy of 'scripts/release/clean-release-gate.mjs', LF will be replaced by CRLF the next time Git touches it // {"numTotalTestSuites":549,"numPassedTestSuites":549,"numFailedTestSuites":0,"numPendingTestSuites":0,"numT |
| node scripts/release/compression-quality-check.mjs | 0 | PASS | PASS test_output //   key facts:       PASS 11/11 //   no invention:    PASS 0 invented //   token savings:   PASS ratio=0.335 need>=0.300 (345/1030 tokens) //   retrieval proof: PASS length=2544/2544 sha256=PASS // PASS log //   key facts: |
| npx vitest run tests/quality/recallQualityGate.test.ts --reporter=json 2>&1 | 0 | PASS | {"numTotalTestSuites":8,"numPassedTestSuites":8,"numFailedTestSuites":0,"numPendingTestSuites":0,"numTotalTests":53,"numPassedTests":53,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"snapshot":{"added":0,"failure":false,"filesAdde |
| npx vitest run tests/memoryFingerprintMigration.test.ts --reporter=json 2>&1 | 0 | PASS | {"numTotalTestSuites":2,"numPassedTestSuites":2,"numFailedTestSuites":0,"numPendingTestSuites":0,"numTotalTests":4,"numPassedTests":4,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"snapshot":{"added":0,"failure":false,"filesAdded" |
| node scripts/release/fast-path-boundary-check.mjs | 0 | PASS | ═══════════════════════════════════════════ //   Fast Path Boundary Release Gate //   Verdict: PASS //   Pass: 29  Warning: 0  Fail: 0 // ═══════════════════════════════════════════ //   Report: reports\release\fast-path-boundary-check.json |
| node scripts/release/clean-install-smoke.mjs | 0 | PASS | CodeContext MCP - Fresh Install Package Smoke //  //   Use release gate tgz... OK 0ms //   Verify tgz provenance... OK 1ms //   Install packed tgz in temporary project... OK 44987ms //   Isolation preflight: fresh HOME and empty database di |
| node dist/cli/index.js doctor | 0 | PASS | { //   "timestamp": "2026-07-15T10:05:26.051Z", //   "nodeVersion": "v24.13.0", //   "platform": "win32 x64", //   "checks": [ //     { //       "name": "node-version", //       "label": "Node version", //       "status": "pass", //       " |
| node dist/cli/index.js demo | 0 | PASS | { //   "reportPath": "D:\\project\\CodeContext\\reports\\demo\\first-run-value.md", //   "jsonPath": "D:\\project\\CodeContext\\reports\\demo\\first-run-value.json", //   "summary": { //     "compress": "5862 tokens saved (86.5% ratio)", // |
| node dist/cli/index.js value | 0 | PASS | { //   "scopeId": "repo_ce1c6bc9", //   "summary": { //     "totalCompressions": 1, //     "totalEstimatedTokensSaved": 5862, //     "averageCompressionRatio": 0.8646, //     "cacheHits": 0, //     "totalRetrieves": 0, //     "memoriesSaved |

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
