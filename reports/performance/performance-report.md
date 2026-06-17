# Performance Report

**Generated**: 2026-06-16T12:15:04.974Z

| Scenario | Size | Runs | Input | p50 | p95 | Max | Tokens Saved | Ratio |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| compress/10KB test output | 10KB test output | 1 | 10,240B | 163ms | 163ms | 163ms | 2,707 | 0.92 |
| compress/100KB test output | 100KB test output | 1 | 102,400B | 142ms | 142ms | 142ms | 28,986 | 0.99 |
| compress/100KB server log | 100KB server log | 1 | 102,400B | 190ms | 190ms | 190ms | 33,740 | 0.94 |
| compress/100KB build failure | 100KB build failure | 1 | 102,400B | 160ms | 160ms | 160ms | 34,748 | 0.99 |
| compress/cache_miss_100KB | 100KB cache miss | 1 | 102,400B | 263ms | 263ms | 263ms | 28,986 | 0.99 |
| compress/cache_hit_100KB | 100KB cache hit | 1 | 102,400B | 2ms | 2ms | 2ms | 28,986 | 0.99 |
| retrieve_original/100KB | 100KB | 1 | 102,400B | 2ms | 2ms | 2ms | 0 | 0 |
| recall/100 memories | 100 memories | 1 | 37,824B | 6ms | 6ms | 6ms | 0 | 0 |
| run_context_flow/full_100KB | 100KB pipeline | 1 | 102,400B | 141ms | 141ms | 141ms | 28,986 | 0.99 |

## Performance Targets

| Target | Threshold | Scenario | p50 | p95 | Status |
|---|---:|---:|---:|---:|---:|
| compress 100KB | — | compress/100KB test output | 142ms | 142ms | N/A |
| compress 1MB | — | N/A | —ms | —ms | N/A |
| retrieve | — | retrieve_original/100KB | 2ms | 2ms | N/A |
| recall 100 | — | recall/100 memories | 6ms | 6ms | N/A |
| recall 1000 | — | N/A | —ms | —ms | N/A |
| run_context_flow | — | run_context_flow/full_100KB | 141ms | 141ms | N/A |

## Notes
- In-memory SQLite for speed
- Single run per scenario
