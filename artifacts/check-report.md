# CodeContext Harness — Check Report

**Generated:** 2026-06-16T02:47:27.867Z
**Flows checked:** 7

## Batch Summary

| Metric | Count |
|--------|-------|
| Total checks | 105 |
| ✓ Pass | 73 |
| ✗ Fail | 5 |
| ⚠ Warn | 1 |
| ○ Skip | 26 |

---
## Flow: `cli-smoke-flow`

- **Runnable:** ✓ YES
- **Run ID:** run_20260616_mqg1kjgu_5cf40b_000
- **Timestamp:** 2026-06-16T02:47:27.673Z
- **Summary:** 10P / 0F / 0W / 5S

### Manifest Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `manifest.id.unique` | ✓ pass | id "cli-smoke-flow" is unique (7 total manifests) |
| `manifest.name.exists` | ✓ pass | name="CLI Smoke Flow" |
| `manifest.description.exists` | ✓ pass | description present |
| `manifest.inputSchema.valid` | ○ skip | no inputSchema declared (optional) |
| `manifest.outputSchema.valid` | ○ skip | no outputSchema declared (optional) |
| `manifest.phases.nonEmpty` | ✓ pass | 5 phases: [spawn_cli_commands, capture_stdout, capture_stderr, verify_exit_code, write_cli_report] |
| `manifest.coveredTools.real` | ○ skip | CLI smoke flow — no MCP tools to cover |
| `module.run.exists` | ✓ pass | module.run is a function |
| `module.check.exists` | ○ skip | no module.check declared (optional) |
| `example.input.valid` | ○ skip | no inputSchema declared — input validation skipped |

### Runtime Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `run.generates.stateJson` | ✓ pass | state.json present, status="completed" |
| `run.generates.outputJson` | ✓ pass | output.json present and contains output data |
| `run.generates.logsJsonl` | ✓ pass | logs.jsonl has 30 entries, checkpoints.jsonl has 17 entries |
| `run.generates.receipt` | ✓ pass | receipt log entry found |
| `artifacts.asExpected` | ✓ pass | all 2 declared artifacts produced: [cli-smoke-results, cli-report] |

---
## Flow: `compression-flow`

- **Runnable:** ✓ YES
- **Run ID:** run_20260616_mqg1kji2_02540b_001
- **Timestamp:** 2026-06-16T02:47:27.729Z
- **Summary:** 8P / 3F / 1W / 3S

### Manifest Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `manifest.id.unique` | ✓ pass | id "compression-flow" is unique (7 total manifests) |
| `manifest.name.exists` | ✓ pass | name="Compression Flow" |
| `manifest.description.exists` | ✓ pass | description present |
| `manifest.inputSchema.valid` | ○ skip | no inputSchema declared (optional) |
| `manifest.outputSchema.valid` | ✓ pass | outputSchema type="object" |
| `manifest.phases.nonEmpty` | ✓ pass | 6 phases: [resolve_scope, compress_input, verify_ccr, retrieve_original, verify_receipt, write_report] |
| `manifest.coveredTools.real` | ✗ fail | Unknown tools: [get_receipt] — not in TOOL_DEFINITIONS |
| `module.run.exists` | ✓ pass | module.run is a function |
| `module.check.exists` | ○ skip | no module.check declared (optional) |
| `example.input.valid` | ○ skip | no inputSchema declared — input validation skipped |

### Runtime Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `run.generates.stateJson` | ✓ pass | state.json present, status="failed" |
| `run.generates.outputJson` | ✗ fail | output.json missing or empty after run |
| `run.generates.logsJsonl` | ✓ pass | logs.jsonl has 3 entries, checkpoints.jsonl has 3 entries |
| `run.generates.receipt` | ⚠ warn | no receipt evidence in logs — verify receipt creation |
| `artifacts.asExpected` | ✗ fail | missing: [compression-results, compression-report]; extra: [] |

---
## Flow: `full-context-flow`

- **Runnable:** ✓ YES
- **Run ID:** run_20260616_mqg1kjjl_e99873_002
- **Timestamp:** 2026-06-16T02:47:27.766Z
- **Summary:** 11P / 1F / 0W / 3S

### Manifest Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `manifest.id.unique` | ✓ pass | id "full-context-flow" is unique (7 total manifests) |
| `manifest.name.exists` | ✓ pass | name="Full Context Flow" |
| `manifest.description.exists` | ✓ pass | description present |
| `manifest.inputSchema.valid` | ○ skip | no inputSchema declared (optional) |
| `manifest.outputSchema.valid` | ✓ pass | outputSchema type="object" |
| `manifest.phases.nonEmpty` | ✓ pass | 10 phases: [resolve_scope, compress_test_output, retrieve_original, save_test_failure_as_memory, recall_related_memory, verify_related_compressed_context, supersede_memory, list_audit, verify_receipts, write_final_report] |
| `manifest.coveredTools.real` | ✗ fail | Unknown tools: [get_receipt] — not in TOOL_DEFINITIONS |
| `module.run.exists` | ✓ pass | module.run is a function |
| `module.check.exists` | ○ skip | no module.check declared (optional) |
| `example.input.valid` | ○ skip | no inputSchema declared — input validation skipped |

### Runtime Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `run.generates.stateJson` | ✓ pass | state.json present, status="completed" |
| `run.generates.outputJson` | ✓ pass | output.json present and contains output data |
| `run.generates.logsJsonl` | ✓ pass | logs.jsonl has 27 entries, checkpoints.jsonl has 15 entries |
| `run.generates.receipt` | ✓ pass | run completed — receipt created by runner pipeline |
| `artifacts.asExpected` | ✓ pass | all 4 declared artifacts produced: [full-compression-results, full-memory-records, full-receipt-audit, full-final-report] |

---
## Flow: `mcp-tools-smoke-flow`

- **Runnable:** ✓ YES
- **Run ID:** run_20260616_mqg1kjkm_509383_003
- **Timestamp:** 2026-06-16T02:47:27.795Z
- **Summary:** 11P / 0F / 0W / 4S

### Manifest Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `manifest.id.unique` | ✓ pass | id "mcp-tools-smoke-flow" is unique (7 total manifests) |
| `manifest.name.exists` | ✓ pass | name="MCP Tools Smoke Flow" |
| `manifest.description.exists` | ✓ pass | description present |
| `manifest.inputSchema.valid` | ○ skip | no inputSchema declared (optional) |
| `manifest.outputSchema.valid` | ○ skip | no outputSchema declared (optional) |
| `manifest.phases.nonEmpty` | ✓ pass | 4 phases: [call_each_tool_with_minimal_valid_input, verify_no_unhandled_error, verify_structured_output, write_tool_matrix] |
| `manifest.coveredTools.real` | ✓ pass | 13 tools all valid: [current_scope, compress_context, retrieve_original, delete_original, cleanup_originals, list_compressions, remember_context, recall_context, forget_context, list_context, analyze_context, list_failures, failure_stats] |
| `module.run.exists` | ✓ pass | module.run is a function |
| `module.check.exists` | ○ skip | no module.check declared (optional) |
| `example.input.valid` | ○ skip | no inputSchema declared — input validation skipped |

### Runtime Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `run.generates.stateJson` | ✓ pass | state.json present, status="completed" |
| `run.generates.outputJson` | ✓ pass | output.json present and contains output data |
| `run.generates.logsJsonl` | ✓ pass | logs.jsonl has 26 entries, checkpoints.jsonl has 15 entries |
| `run.generates.receipt` | ✓ pass | run completed — receipt created by runner pipeline |
| `artifacts.asExpected` | ✓ pass | all 2 declared artifacts produced: [mcp-smoke-results, mcp-tool-matrix] |

---
## Flow: `memory-flow`

- **Runnable:** ✓ YES
- **Run ID:** run_20260616_mqg1kjlf_33afc0_004
- **Timestamp:** 2026-06-16T02:47:27.825Z
- **Summary:** 12P / 0F / 0W / 3S

### Manifest Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `manifest.id.unique` | ✓ pass | id "memory-flow" is unique (7 total manifests) |
| `manifest.name.exists` | ✓ pass | name="Memory Flow" |
| `manifest.description.exists` | ✓ pass | description present |
| `manifest.inputSchema.valid` | ○ skip | no inputSchema declared (optional) |
| `manifest.outputSchema.valid` | ✓ pass | outputSchema type="object" |
| `manifest.phases.nonEmpty` | ✓ pass | 7 phases: [remember_project_rule, recall_project_rule, remember_new_rule, supersede_old_rule, recall_after_supersede, list_context_audit, write_report] |
| `manifest.coveredTools.real` | ✓ pass | 4 tools all valid: [remember_context, recall_context, forget_context, list_context] |
| `module.run.exists` | ✓ pass | module.run is a function |
| `module.check.exists` | ○ skip | no module.check declared (optional) |
| `example.input.valid` | ○ skip | no inputSchema declared — input validation skipped |

### Runtime Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `run.generates.stateJson` | ✓ pass | state.json present, status="completed" |
| `run.generates.outputJson` | ✓ pass | output.json present and contains output data |
| `run.generates.logsJsonl` | ✓ pass | logs.jsonl has 27 entries, checkpoints.jsonl has 10 entries |
| `run.generates.receipt` | ✓ pass | run completed — receipt created by runner pipeline |
| `artifacts.asExpected` | ✓ pass | all 3 declared artifacts produced: [memory-records, recall-results, memory-report] |

---
## Flow: `originals-flow`

- **Runnable:** ✓ YES
- **Run ID:** run_20260616_mqg1kjma_015522_005
- **Timestamp:** 2026-06-16T02:47:27.840Z
- **Summary:** 10P / 1F / 0W / 4S

### Manifest Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `manifest.id.unique` | ✓ pass | id "originals-flow" is unique (7 total manifests) |
| `manifest.name.exists` | ✓ pass | name="Originals Flow" |
| `manifest.description.exists` | ✓ pass | description present |
| `manifest.inputSchema.valid` | ○ skip | no inputSchema declared (optional) |
| `manifest.outputSchema.valid` | ○ skip | no outputSchema declared (optional) |
| `manifest.phases.nonEmpty` | ✓ pass | 6 phases: [compress_with_original, retrieve_before_delete, delete_original, retrieve_after_delete, verify_canRetrieveOriginal, write_report] |
| `manifest.coveredTools.real` | ✓ pass | 4 tools all valid: [compress_context, retrieve_original, delete_original, cleanup_originals] |
| `module.run.exists` | ✓ pass | module.run is a function |
| `module.check.exists` | ○ skip | no module.check declared (optional) |
| `example.input.valid` | ○ skip | no inputSchema declared — input validation skipped |

### Runtime Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `run.generates.stateJson` | ✓ pass | state.json present, status="completed" |
| `run.generates.outputJson` | ✓ pass | output.json present and contains output data |
| `run.generates.logsJsonl` | ✓ pass | logs.jsonl has 6 entries, checkpoints.jsonl has 4 entries |
| `run.generates.receipt` | ✓ pass | run completed — receipt created by runner pipeline |
| `artifacts.asExpected` | ✗ fail | missing: [originals-retrieval-log, originals-deletion-log, originals-report]; extra: [] |

---
## Flow: `profile-flow`

- **Runnable:** ✓ YES
- **Run ID:** run_20260616_mqg1kjmo_3e6c74_006
- **Timestamp:** 2026-06-16T02:47:27.866Z
- **Summary:** 11P / 0F / 0W / 4S

### Manifest Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `manifest.id.unique` | ✓ pass | id "profile-flow" is unique (7 total manifests) |
| `manifest.name.exists` | ✓ pass | name="Profile Flow" |
| `manifest.description.exists` | ✓ pass | description present |
| `manifest.inputSchema.valid` | ○ skip | no inputSchema declared (optional) |
| `manifest.outputSchema.valid` | ○ skip | no outputSchema declared (optional) |
| `manifest.phases.nonEmpty` | ✓ pass | 6 phases: [save_static_fact, save_dynamic_context, recall_with_profile, verify_static_profile, verify_dynamic_profile, write_report] |
| `manifest.coveredTools.real` | ✓ pass | 3 tools all valid: [remember_context, recall_context, list_context] |
| `module.run.exists` | ✓ pass | module.run is a function |
| `module.check.exists` | ○ skip | no module.check declared (optional) |
| `example.input.valid` | ○ skip | no inputSchema declared — input validation skipped |

### Runtime Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `run.generates.stateJson` | ✓ pass | state.json present, status="completed" |
| `run.generates.outputJson` | ✓ pass | output.json present and contains output data |
| `run.generates.logsJsonl` | ✓ pass | logs.jsonl has 26 entries, checkpoints.jsonl has 8 entries |
| `run.generates.receipt` | ✓ pass | run completed — receipt created by runner pipeline |
| `artifacts.asExpected` | ✓ pass | all 2 declared artifacts produced: [profile-snapshot, profile-report] |
