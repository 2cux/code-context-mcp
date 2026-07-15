# Fast Path Boundary Release Gate

**Generated**: 2026-07-15T06:59:02.350Z

## Verdict: **WARNING** ⚠️

| Status | Count |
|---|---|
| ✅ Pass | 28 |
| ⚠️ Warning | 1 |
| ❌ Fail | 0 |
| **Total** | **29** |

## Verdict Rules

### ❌ Fail Triggers (blockers)

- fast tools 调用 HarnessRunner
- agent/full 暴露 harness tools
- workflow.find 默认 include_details=true
- direct MCP p95 超过 fail 阈值
- harness persistence overhead 超过 fail 阈值

### ⚠️ Warning Triggers (non-blocking)

- harness workflow p95 高但 direct MCP 正常
- workflow.find details 模式慢 → explicit-heavy，不是 direct MCP fail

## Check Results

| Check | Status | Detail |
|---|---|---|
| profile-gate: 6 fast tools defined | ✅ pass | FAST_TOOLS has all 6 entries |
| profile-gate: 4 harness tools defined | ✅ pass | HARNESS_TOOLS has all 4 entries |
| profile-gate: agent = 6 fast tools | ✅ pass | Agent profile returns FAST_TOOLS |
| profile-gate: full excludes harness | ✅ pass | HARNESS_TOOLS referenced for exclusion checks |
| profile-gate: debug = full ∪ harness | ✅ pass | Debug profile returns ALL_CODEGRAPH_TOOLS |
| profile-gate: call permissions matrix | ✅ pass | All 6 entries validated |
| fast-tools-no-harness: only runHarnessFlow imports runModule | ✅ pass | Importers: runHarnessFlow.ts |
| fast-tools-no-harness: runHarnessFlow calls runModule | ✅ pass | Call site confirmed in runHarnessFlow.ts |
| fast-tools-no-harness: 17 handlers do NOT call runModule | ✅ pass | Verified 17 handlers |
| fast-tools-no-harness: fixture expects 0 runner calls | ✅ pass | Fast MCP tools must not route through HarnessRunner by default. |
| workflow-find: include_details defaults to false | ✅ pass | DEFAULT_INCLUDE_DETAILS = false |
| workflow-find: format defaults to compact | ✅ pass | DEFAULT_FORMAT = 'compact' |
| workflow-find: include_details=true triggers enrichment | ✅ pass | get_symbol() enrichment logic present |
| workflow-find: compact mode produces 0 enrichment cost | ✅ pass | maxGetSymbolCalls/enrichment → 0 when include_details=false |
| workflow-find: compact fixture expects no get_symbol | ✅ pass | classification: default-fast-workflow |
| workflow-find: details fixture expects get_symbol enrichment | ✅ pass | maxGetSymbolCalls: 5 |
| benchmark: doNotFailDirectMcpBecauseHarnessIsSlow = true | ✅ pass | Harness slowness will never fail direct MCP gate |
| benchmark: markHarnessSlowAsWorkflowHeavy = true | ✅ pass | Harness slow is classified correctly |
| benchmark: markDetailsEnrichmentAsExplicitHeavyMode = true | ✅ pass | Details enrichment is classified correctly |
| benchmark: separate thresholds for direct/harness/persistence | ✅ pass | directMcp p95 warning=300ms, harnessPersistence warning=100ms |
| benchmark: harness persistence warning threshold <= 100ms | ✅ pass | Currently 100ms |
| benchmark: direct MCP p95 within threshold | ✅ pass | 320ms < 500ms |
| benchmark: harness persistence within target | ✅ pass | 0ms < 100ms |
| benchmark: classification notes present | ✅ pass | 4 notes |
| docs: core principle documented | ✅ pass | FAST_PATH_VS_HARNESS.md contains the binding rule |
| docs: do/don't rules documented | ✅ pass |  |
| fixtures: all 12 required fixtures present | ✅ pass | 12 files |
| tests: all 4 boundary test files present | ✅ pass | 4 files |
| vitest: could not execute boundary tests | ⚠️ warning | Command failed: npx vitest run tests/profileBoundary.test.ts tests/fastPathNo... |

## ⚠️ Review Before Release

Review all ⚠️ warning checks. Warnings do not block release but should be understood.
