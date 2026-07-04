# CodeContext Harness — Check Report

**Generated:** 2026-07-04T12:15:10.145Z
**Flows checked:** 1

## Batch Summary

| Metric | Count |
|--------|-------|
| Total checks | 15 |
| ✓ Pass | 6 |
| ✗ Fail | 0 |
| ⚠ Warn | 0 |
| ○ Skip | 9 |

---
## Flow: `json-report-flow`

- **Runnable:** ✓ YES
- **Run ID:** —
- **Timestamp:** 2026-07-04T12:15:10.145Z
- **Summary:** 6P / 0F / 0W / 9S

### Manifest Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `manifest.id.unique` | ✓ pass | id "json-report-flow" is unique (1 total manifests) |
| `manifest.name.exists` | ✓ pass | name="Check Test Flow" |
| `manifest.description.exists` | ✓ pass | description present |
| `manifest.inputSchema.valid` | ○ skip | no inputSchema declared (optional) |
| `manifest.outputSchema.valid` | ○ skip | no outputSchema declared (optional) |
| `manifest.phases.nonEmpty` | ✓ pass | 1 phases: [main] |
| `manifest.coveredTools.real` | ✓ pass | 2 tools all valid: [compress_context, retrieve_original] |
| `module.run.exists` | ✓ pass | module.run is a function |
| `module.check.exists` | ○ skip | no module.check declared (optional) |
| `example.input.valid` | ○ skip | no inputSchema declared — input validation skipped |

### Runtime Checks

| Rule | Outcome | Message |
|------|---------|---------|
| `run.generates.stateJson` | ○ skip | manifestOnly mode — runtime checks skipped |
| `run.generates.outputJson` | ○ skip | manifestOnly mode — runtime checks skipped |
| `run.generates.logsJsonl` | ○ skip | manifestOnly mode — runtime checks skipped |
| `run.generates.receipt` | ○ skip | manifestOnly mode — runtime checks skipped |
| `artifacts.asExpected` | ○ skip | manifestOnly mode — runtime checks skipped |
