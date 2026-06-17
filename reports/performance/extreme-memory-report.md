# Extreme Memory Report

**Generated**: 2026-06-17T02:15:26.863Z

## Memory Status

| Metric | Value |
|---|---:|
| Total Memory | 32373MB |
| Free Memory | 7813MB |
| Heap Used | 19MB |
| Mode | **FULL** |
| PERF_TEST_EXTREME | not set |

## Thresholds

| Threshold | Value |
|---|---:|
| Standard Minimum | 4096MB |
| Extreme Recommended | 16384MB |
| Skip Below | 8192MB |
| Sample Ratio | 0.2 |

## Case Eligibility

| Case | Size | Min Mem | Status |
|---|---:|---:|---:|
| 132KB RAG chunks | 132,009B | 4096MB | full |
| 218KB TypeScript | 218,117B | 4096MB | full |
| 500KB test output | 512,000B | 8192MB | full |
| 1MB test output | 1,048,576B | 16384MB | full |
| 604KB JSON | 604,035B | 4096MB | full |

## Notes

- Total memory (32373MB) meets extreme recommendation. Full extreme suite available.
- PERF_TEST_EXTREME=not set — extreme tests skipped (set PERF_TEST_EXTREME=1 to enable).

## Running

```bash
# Standard (always safe)
PERF_TEST=1 npx vitest run tests/performance/

# Extreme (16GB+ recommended)
PERF_TEST=1 PERF_TEST_EXTREME=1 node --max-old-space-size=16384 node_modules/vitest/vitest.mjs run tests/performance/
```
