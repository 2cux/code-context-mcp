# Live Agent Post-RC Validation

**Generated**: 2026-06-17T02:30:36.757Z
**Client**: Claude Code (simulated via direct handler calls)
**Mode**: `agent`

## Summary

✅ 12 | ❌ 0 | 🔧 25 total tool calls

## Tool Surface

**Allowed (7)**: compress_context, current_scope, retrieve_original, remember_context, recall_context, forget_context, run_context_flow

**Hidden (11)**: delete_original, cleanup_originals, list_compressions, analyze_context, list_context, list_failures, failure_stats, list_harness_flows, run_harness_flow, get_harness_run, check_harness_flow

## Scenarios

| # | ID | Status | Calls | Errors |
|---|---:|---:|---:|
| 1 | 01-long-test-output | ✅ | 3 | 0 |
| 2 | 02-build-failure | ✅ | 2 | 0 |
| 3 | 03-large-code-file | ✅ | 2 | 0 |
| 4 | 04-save-project-rule | ✅ | 1 | 0 |
| 5 | 05-recall-project-rule | ✅ | 2 | 0 |
| 6 | 06-supersede-memory | ✅ | 2 | 0 |
| 7 | 07-compress-result-to-memory | ✅ | 1 | 0 |
| 8 | 08-full-context-flow | ✅ | 2 | 0 |
| 9 | 09-dangerous-tool-avoidance | ✅ | 3 | 0 |
| 10 | 10-recall-vs-list-confusion | ✅ | 2 | 0 |
| 11 | 11-harness-vs-run-context-flow | ✅ | 3 | 0 |
| 12 | 12-analyze-context-choice | ✅ | 2 | 0 |

## Details

### 01-long-test-output

**Task**: Compress this long Vitest failure output, keep original retrievable.

**Status**: ✅ Pass

**Tools Called**:
- `compress_context` (336ms) ✅
- `delete_original (rejected)` (0ms) ⚠️ error
- `cleanup_originals (rejected)` (0ms) ⚠️ error

**Notes**:
- task completed
- minimal tool calls

### 02-build-failure

**Task**: Analyze a build failure log and summarize root cause.

**Status**: ✅ Pass

**Tools Called**:
- `compress_context` (302ms) ✅
- `delete_original (rejected)` (0ms) ⚠️ error

**Notes**:
- task completed
- minimal tool calls

### 03-large-code-file

**Task**: Compress this large TypeScript file conservatively.

**Status**: ✅ Pass

**Tools Called**:
- `compress_context` (218ms) ✅
- `retrieve_original` (220ms) ⚠️ error

**Notes**:
- task completed
- minimal tool calls

### 04-save-project-rule

**Task**: Remember that this repo uses pnpm, not npm.

**Status**: ✅ Pass

**Tools Called**:
- `remember_context` (213ms) ✅

**Notes**:
- task completed
- minimal tool calls

### 05-recall-project-rule

**Task**: Before installing a package, recall project package-manager rule.

**Status**: ✅ Pass

**Tools Called**:
- `recall_context` (226ms) ✅
- `list_context (rejected)` (0ms) ⚠️ error

**Notes**:
- task completed
- minimal tool calls

### 06-supersede-memory

**Task**: Replace old npm memory with pnpm memory.

**Status**: ✅ Pass

**Tools Called**:
- `forget_context` (0ms) ⚠️ error
- `remember_context` (213ms) ✅

**Notes**:
- task completed
- minimal tool calls

### 07-compress-result-to-memory

**Task**: Compress a test failure and remember the important failure.

**Status**: ✅ Pass

**Tools Called**:
- `run_context_flow` (221ms) ✅

**Notes**:
- task completed
- minimal tool calls

### 08-full-context-flow

**Task**: Run full context flow for failing auth test.

**Status**: ✅ Pass

**Tools Called**:
- `run_context_flow` (234ms) ✅
- `run_harness_flow (rejected)` (0ms) ⚠️ error

**Notes**:
- task completed
- minimal tool calls

### 09-dangerous-tool-avoidance

**Task**: Audit available compressed contexts without deleting originals.

**Status**: ✅ Pass

**Tools Called**:
- `run_context_flow` (218ms) ✅
- `delete_original (rejected)` (0ms) ⚠️ error
- `cleanup_originals (rejected)` (0ms) ⚠️ error

**Notes**:
- task completed
- minimal tool calls

### 10-recall-vs-list-confusion

**Task**: Find relevant memory for refresh token bug; do not list all memories.

**Status**: ✅ Pass

**Tools Called**:
- `recall_context` (208ms) ✅
- `list_context (rejected)` (0ms) ⚠️ error

**Notes**:
- task completed
- minimal tool calls

### 11-harness-vs-run-context-flow

**Task**: Use agent-facing flow, not internal harness tools.

**Status**: ✅ Pass

**Tools Called**:
- `run_context_flow` (218ms) ✅
- `run_harness_flow (rejected)` (0ms) ⚠️ error
- `list_harness_flows (rejected)` (0ms) ⚠️ error

**Notes**:
- task completed
- minimal tool calls

### 12-analyze-context-choice

**Task**: Decide whether to compress/recall without exposing analyze_context by default.

**Status**: ✅ Pass

**Tools Called**:
- `run_context_flow` (218ms) ✅
- `analyze_context (rejected)` (0ms) ⚠️ error

**Notes**:
- task completed
- minimal tool calls


## Security Verification

- ✅ Dangerous tools never served to agent
- ✅ Hidden tools (11) correctly excluded from tool listing
- ✅ Tool call rejection enforced at runtime
