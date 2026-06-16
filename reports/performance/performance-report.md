# Performance Report

**Generated**: 2026-06-16T11:07:23.561Z

| Scenario | Size | Runs | Input | p50 | p95 | Max | Tokens Saved | Ratio |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| compress/10KB test output | 10KB test output | 1 | 10,240B | 110ms | 110ms | 110ms | 2,707 | 0.92 |
| compress/100KB test output | 100KB test output | 1 | 102,400B | 96ms | 96ms | 96ms | 28,986 | 0.99 |
| compress/100KB server log | 100KB server log | 1 | 102,400B | 124ms | 124ms | 124ms | 33,740 | 0.94 |
| compress/100KB build failure | 100KB build failure | 1 | 102,400B | 93ms | 93ms | 93ms | 34,748 | 0.99 |
| compress/cache_miss_100KB | 100KB cache miss | 1 | 102,400B | 186ms | 186ms | 186ms | 28,986 | 0.99 |
| compress/cache_hit_100KB | 100KB cache hit | 1 | 102,400B | 2ms | 2ms | 2ms | 28,986 | 0.99 |
| retrieve_original/100KB | 100KB | 1 | 102,400B | 2ms | 2ms | 2ms | 0 | 0 |
| recall/100 memories | 100 memories | 1 | 37,824B | 5ms | 5ms | 5ms | 0 | 0 |
| run_context_flow/full_100KB | 100KB pipeline | 1 | 102,400B | 88ms | 88ms | 88ms | 28,986 | 0.99 |

## Performance Targets

| Target | Threshold | Scenario | p50 | p95 | Status |
|---|---:|---:|---:|---:|---:|
| compress 100KB | — | compress/100KB test output | 96ms | 96ms | N/A |
| compress 1MB | — | N/A | —ms | —ms | N/A |
| retrieve | — | retrieve_original/100KB | 2ms | 2ms | N/A |
| recall 100 | — | recall/100 memories | 5ms | 5ms | N/A |
| recall 1000 | — | N/A | —ms | —ms | N/A |
| run_context_flow | — | run_context_flow/full_100KB | 88ms | 88ms | N/A |

## Notes
- In-memory SQLite for speed
- Single run per scenario
