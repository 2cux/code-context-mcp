# Performance Report

**Generated**: 2026-06-17T02:15:27.016Z

| Scenario | Size | Runs | Input | p50 | p95 | Max | Tokens Saved | Ratio |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| compress/10KB test output | 10KB test output | 1 | 10,240B | 122ms | 122ms | 122ms | 2,707 | 0.92 |
| compress/100KB test output | 100KB test output | 1 | 102,400B | 108ms | 108ms | 108ms | 28,986 | 0.99 |
| compress/100KB server log | 100KB server log | 1 | 102,400B | 133ms | 133ms | 133ms | 33,740 | 0.94 |
| compress/100KB build failure | 100KB build failure | 1 | 102,400B | 104ms | 104ms | 104ms | 34,748 | 0.99 |
| compress/cache_miss_100KB | 100KB cache miss | 1 | 102,400B | 195ms | 195ms | 195ms | 28,986 | 0.99 |
| compress/cache_hit_100KB | 100KB cache hit | 1 | 102,400B | 2ms | 2ms | 2ms | 28,986 | 0.99 |
| retrieve_original/100KB | 100KB | 1 | 102,400B | 3ms | 3ms | 3ms | 0 | 0 |
| recall/100 memories | 100 memories | 1 | 37,824B | 5ms | 5ms | 5ms | 0 | 0 |
| run_context_flow/full_100KB | 100KB pipeline | 1 | 102,400B | 92ms | 92ms | 92ms | 28,986 | 0.99 |

## Performance Targets

| Target | Threshold | Scenario | p50 | p95 | Status |
|---|---:|---:|---:|---:|---:|
| compress 100KB | — | compress/100KB test output | 108ms | 108ms | N/A |
| compress 1MB | — | N/A | —ms | —ms | N/A |
| retrieve | — | retrieve_original/100KB | 3ms | 3ms | N/A |
| recall 100 | — | recall/100 memories | 5ms | 5ms | N/A |
| recall 1000 | — | N/A | —ms | —ms | N/A |
| run_context_flow | — | run_context_flow/full_100KB | 92ms | 92ms | N/A |

## Notes
- In-memory SQLite for speed
- Cold-start includes DB init (disk read, migration checks)
- Warm same-process hits are sub-millisecond SQLite lookups
- New-process persistent hits include DB reopen overhead (~50-90ms normal)
- See reports/performance/cache-warm-analysis.md for detailed cold/warm breakdown
