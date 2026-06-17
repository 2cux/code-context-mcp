# Cache Warm Performance Analysis

**Generated**: 2026-06-17T02:03:44.945Z

## Cold vs Warm Split

| Category | Avg Latency | Count | Threshold | Status |
|---|---:|---:|---:|---:|
| Cold cache | 66.86ms | 7 | 1000ms | ✅ |
| Warm same-process | 1.17ms | 6 | 200ms | ✅ |
| Persistent new-process | 77.67ms | 3 | 20ms | ❌ |

## Per-Step Breakdown

### per-step/cold
| Step | Avg Latency |
|---|---:|
| contentHash | 1ms |
| strategyResolution | 0ms |
| computeCacheKey | 0ms |
| findByCacheKey | 0ms |
| fullCompress | 243ms |

### per-step/warm-same-process
| Step | Avg Latency |
|---|---:|
| cacheHit | 2ms |

### cold/cold-compress-100kb
| Step | Avg Latency |
|---|---:|
| compress+save | 107ms |

### warm/warm-hit-same-process
| Step | Avg Latency |
|---|---:|
| hit_1 | 1ms |
| hit_2 | 1ms |
| hit_3 | 1ms |
| hit_4 | 1ms |
| hit_5 | 1ms |

### persistent/cold-in-first-process
| Step | Avg Latency |
|---|---:|
| compress | 117ms |

### persistent/new-process-hit
| Step | Avg Latency |
|---|---:|
| hit_1 | 79ms |
| hit_2 | 82ms |
| hit_3 | 72ms |

## Notes
- Cold cache = first compression in process (includes init + compress + save)
- Warm same-process = second call, cache hit from in-memory SQLite
- Persistent new-process = separate DB connection, simulating process restart
- Thresholds from fixtures/rc-hardening/cache-warm/cache-thresholds.json
