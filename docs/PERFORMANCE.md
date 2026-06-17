# Performance Guide

## Test Tiers

CodeContext MCP has three performance test tiers:

| Tier | Command | Memory Required | Description |
|---|---|---|---|
| **Standard** | `PERF_TEST=1 npx vitest run tests/performance/` | ≥4GB | All compression, pipeline, and cache warm tests |
| **Extreme (full)** | `PERF_TEST=1 PERF_TEST_EXTREME=1 node --max-old-space-size=16384 node_modules/vitest/vitest.mjs run tests/performance/` | ≥16GB | +500KB, 1MB, 604KB extreme cases at full size |
| **Extreme (sampled)** | Same as above, ≤16GB | 8–16GB | Auto-degrades to sampled mode: 20% representative slices, largest cases skipped |

## Memory Guard

The memory guard (`src/safety/memoryGuard.ts`) automatically:

1. **Detects** system memory at extreme test startup
2. **Skips** all extreme tests if total memory < 8GB (with clear skip reason)
3. **Samples** if memory is 8–16GB (20% representative slices, 1MB+ cases skipped)
4. **Runs full** if memory ≥ 16GB

Thresholds are configurable via `fixtures/rc-hardening/extreme-perf/memory-thresholds.json`:

```json
{
  "standardMinMemoryMb": 4096,
  "extremeRecommendedMemoryMb": 16384,
  "skipBelowMemoryMb": 8192,
  "sampleRatioWhenLowMemory": 0.2
}
```

## Known Limitations

- **Extreme 1MB+ compression**: Requires >16GB RAM. The memory overhead is ~5x input size (UTF-16 string + TextEncoder buffer + compression working set + in-memory SQLite storage).
- **8GB machines**: Standard perf tests run normally. Extreme tests auto-skip (not a failure — explicitly skipped with reason in the report).
- **OOM on extreme**: If you see OOM despite memory guard, reduce `--max-old-space-size` or run standard tests only.

## Performance Reports

| Report | Description |
|---|---|
| `reports/performance/performance-report.md` | Standard + pipeline perf results |
| `reports/performance/cache-warm-analysis.md` | Cold/warm cache performance breakdown |
| `reports/performance/extreme-memory-report.md` | Extreme test memory status and eligibility |
| `reports/performance/compress-report.json` | Raw compression metrics (JSON) |
| `reports/performance/raw-results.jsonl` | Raw per-test metrics (JSONL) |

## Performance Targets

| Target | Threshold | Typical | Classification |
|---|---|---|---|
| compress 100KB | 1000ms | ~100ms | ❄️ Cold-start |
| compress 1MB | 5000ms | varies | ❄️ Cold-start (extreme) |
| cache hit (same-process) | 20ms | ~1ms | 🔥 Warm |
| cache hit (new-process) | 200ms | ~80ms | 🔄 Cold persistent |
| retrieve original | 1000ms | ~5ms | 🔥 Warm |
| recall 100 memories | 1000ms | ~8ms | 🔥 Warm |
| run_context_flow | 8000ms | ~100ms | ❄️ Cold-start |
