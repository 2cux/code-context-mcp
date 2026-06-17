# Performance Report

**Generated**: 2026-06-17T02:03:44.815Z

| Scenario | Size | Runs | Input | p50 | p95 | Max | Tokens Saved | Ratio |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| compress/10KB test output | 10KB test output | 1 | 10,240B | 141ms | 141ms | 141ms | 2,707 | 0.92 |
| compress/100KB test output | 100KB test output | 1 | 102,400B | 122ms | 122ms | 122ms | 28,986 | 0.99 |
| compress/100KB server log | 100KB server log | 1 | 102,400B | 146ms | 146ms | 146ms | 33,740 | 0.94 |
| compress/100KB build failure | 100KB build failure | 1 | 102,400B | 126ms | 126ms | 126ms | 34,748 | 0.99 |
| compress/cache_miss_100KB | 100KB cache miss | 1 | 102,400B | 206ms | 206ms | 206ms | 28,986 | 0.99 |
| compress/cache_hit_100KB | 100KB cache hit | 1 | 102,400B | 2ms | 2ms | 2ms | 28,986 | 0.99 |
| retrieve_original/100KB | 100KB | 1 | 102,400B | 5ms | 5ms | 5ms | 0 | 0 |
| recall/100 memories | 100 memories | 1 | 37,824B | 8ms | 8ms | 8ms | 0 | 0 |
| run_context_flow/full_100KB | 100KB pipeline | 1 | 102,400B | 105ms | 105ms | 105ms | 28,986 | 0.99 |

## Performance Targets

| Target | Threshold | Scenario | p50 | p95 | Status |
|---|---:|---:|---:|---:|---:|
| compress 100KB | — | compress/100KB test output | 122ms | 122ms | N/A |
| compress 1MB | — | N/A | —ms | —ms | N/A |
| retrieve | — | retrieve_original/100KB | 5ms | 5ms | N/A |
| recall 100 | — | recall/100 memories | 8ms | 8ms | N/A |
| recall 1000 | — | N/A | —ms | —ms | N/A |
| run_context_flow | — | run_context_flow/full_100KB | 105ms | 105ms | N/A |

## Notes
- In-memory SQLite for speed
- Cold-start includes DB init (disk read, migration checks)
- Warm same-process hits are sub-millisecond SQLite lookups
- New-process persistent hits include DB reopen overhead (~50-90ms normal)
- See reports/performance/cache-warm-analysis.md for detailed cold/warm breakdown
