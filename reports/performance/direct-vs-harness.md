# Direct vs Harness Performance Report

**Generated**: 2026-06-17T08:31:17.564Z

## Summary

| Metric | Value |
|---|---|
| Total scenarios | 9 |
| Direct scenarios | 6 |
| Harness scenarios | 3 |
| Overall direct MCP p95 | **320ms** |
| Overall harness workflow p95 | **268ms** |
| Harness persistence overhead | **0ms** |

## Classification Rules Applied

- Enrichment cost (compact→enriched): 2ms (ratio: 1%)
- Direct MCP p95 is measured independently — NOT affected by harness workflow p95.
- Harness slow scenarios are classified as 'harness-heavy' — NOT as direct MCP regressions.
- Harness persistence overhead is measured separately — target < 100ms.

## Per-Scenario Latency

| Scenario | Tool | Path | N | p50 | p95 | Mean | Min | Max | Overhead | Overhead Ratio |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| repo_status | current_scope | direct | 30 | 246ms | 263ms | 248ms | 231ms | 294ms | 0ms | 0x |
| find_compact_limit_5 | recall_context | direct | 30 | 263ms | 296ms | 264ms | 244ms | 306ms | 0ms | 0x |
| explain_symbol | compress_context | direct | 20 | 3ms | 128ms | 10ms | 2ms | 128ms | 0ms | 0x |
| coverage_gaps | list_context | direct | 20 | 0ms | 2ms | 1ms | 0ms | 2ms | 0ms | 0x |
| build_context_pack | run_context_flow | direct | 20 | 251ms | 320ms | 257ms | 240ms | 320ms | 0ms | 0x |
| harness_list | list_harness_flows | harness | 20 | 0ms | 1ms | 0ms | 0ms | 1ms | 0ms | 0x |
| harness_run_workflow_compact | run_harness_flow | harness | 10 | 16ms | 27ms | 16ms | 14ms | 27ms | 25ms | 12.5x |
| workflow_find_compact | recall_context | direct | 10 | 249ms | 259ms | 250ms | 241ms | 259ms | 0ms | 0x |
| workflow_find_details | recall_context | harness-heavy | 5 | 250ms | 268ms | 252ms | 242ms | 268ms | 2ms | 0.01x |

## Phase Breakdown (mean ms)

| Scenario | profile gate | handler dispatch | direct handler | harness runner init | harness state load | harness checkpoint | harness artifact write | harness report write | harness persistence total | workflow find search | workflow find enrichment | workflow find markdown | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| repo_status | 0ms | 0ms | 248ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 248ms |
| find_compact_limit_5 | 0ms | 0ms | 264ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 264ms | 0ms | 0ms | 264ms |
| explain_symbol | 0ms | 0ms | 10ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 10ms |
| coverage_gaps | 0ms | 0ms | 1ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 1ms |
| build_context_pack | 0ms | 0ms | 257ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 257ms |
| harness_list | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms |
| harness_run_workflow_compact | 0ms | 0ms | 0ms | 1ms | 2ms | 1ms | 2ms | 2ms | 1ms | 0ms | 0ms | 0ms | 16ms |
| workflow_find_compact | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 250ms | 0ms | 0ms | 250ms |
| workflow_find_details | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 0ms | 250ms | 2ms | 0ms | 252ms |

## Thresholds

```json
{
  "directMcp": {
    "p95MsWarning": 300,
    "p95MsFail": 500
  },
  "harnessWorkflow": {
    "p95MsWarning": 3000,
    "p95MsPerfRisk": 6000
  },
  "harnessPersistence": {
    "p95MsWarning": 100,
    "p95MsFail": 200
  },
  "workflowFind": {
    "compactP95MsWarning": 2000,
    "detailsP95MsPerfRisk": 6000,
    "enrichmentCostRatioWarning": 0.5
  },
  "classificationRules": {
    "doNotFailDirectMcpBecauseHarnessIsSlow": true,
    "markHarnessSlowAsWorkflowHeavy": true,
    "markDetailsEnrichmentAsExplicitHeavyMode": true
  }
}
```
