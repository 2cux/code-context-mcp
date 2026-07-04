# Usage Value Report

## Overview

The `code-context value` command generates a comprehensive usage report that shows the value CodeContext provides to your project. It aggregates data from compression operations, memory storage, and retrieval activities to demonstrate token savings and productivity gains.

## Command

```bash
code-context value [--json]
```

## Output

The command generates two files in `reports/usage/`:

1. **value-report.md** — Human-readable Markdown report
2. **value-report.json** — Machine-readable JSON data

## Report Contents

### 1. Summary Statistics

- **Total Compressions**: Number of compression operations performed
- **Total Estimated Tokens Saved**: Cumulative token reduction across all compressions
- **Average Compression Ratio**: Mean compression ratio (0 = no compression, 1 = 100% reduction)
- **Cache Hits**: Number of times cached compressions were reused
- **Total Retrieves**: Number of original content retrievals
- **Memories Saved**: Number of project memories stored
- **Memories Recalled**: Number of memory recall operations
- **Memories Forgotten**: Number of memories soft-deleted or superseded

### 2. Top 5 Highest Token-Saving Compressions

Shows the compression operations that saved the most tokens, including:
- CCR ID (compressed context record identifier)
- Content type (log, code, test_output, etc.)
- Tokens saved
- Compression ratio
- Creation timestamp

### 3. Recent Project Memories

Lists the 10 most recent active project memories, including:
- Memory ID
- Memory type (project_rule, decision, bug, etc.)
- Summary
- Creation timestamp
- Status

### 4. Local-First Data

Confirms that:
- All data is stored locally in SQLite
- No data is uploaded to external services

## Example Output

```bash
$ code-context value

{
  "scopeId": "repo_ce1c6bc9",
  "summary": {
    "totalCompressions": 456,
    "totalEstimatedTokensSaved": 569580,
    "averageCompressionRatio": 0.04,
    "cacheHits": 364,
    "totalRetrieves": 370,
    "memoriesSaved": 1118,
    "memoriesRecalled": 760,
    "memoriesForgotten": 272
  },
  "reportPaths": {
    "markdown": "D:\\project\\CodeContext\\reports\\usage\\value-report.md",
    "json": "D:\\project\\CodeContext\\reports\\usage\\value-report.json"
  },
  "message": "Value report generated. Total tokens saved: 569,580"
}
```

## Use Cases

### 1. Demonstrate Value

Show stakeholders the concrete token savings and productivity improvements CodeContext provides:

```bash
code-context value
cat reports/usage/value-report.md
```

### 2. Monitor Usage

Track how compression and memory features are being utilized over time:

```bash
# Generate report weekly
code-context value --json > weekly-report-$(date +%Y-%m-%d).json
```

### 3. Optimize Workflows

Identify which content types benefit most from compression to optimize your workflow:

```bash
code-context value
# Review "Top 5 Highest Token-Saving Compressions" section
```

## Empty Data

When no compressions or memories exist yet, the report displays friendly zero counts and a helpful message:

```
No usage data yet. Compress some content or save memories to see value metrics.
```

## Integration

The value report can be:

- Shared with team members to demonstrate tool adoption
- Included in weekly/monthly status reports
- Used as input for analytics dashboards
- Tracked over time to show cumulative savings

## Design Principles

1. **Read-only**: Never modifies data, only queries
2. **Friendly for empty state**: Returns zeros, not errors
3. **Local-first**: Emphasizes that no data leaves your machine
4. **Observability**: Inspired by Headroom's token savings approach

## Related Commands

- `code-context stats` — High-level token and operation statistics
- `code-context demo` — First-run demonstration of core features
- `code-context receipts` — Detailed audit trail of all operations
- `code-context list-compressions` — List all compression records
- `code-context list-context` — List all project memories

## Notes

- Report generation is fast (typically < 100ms)
- All data comes from local SQLite database
- No network requests are made
- Reports are overwritten on each run (not archived)
- Token savings are estimates based on compression ratios
