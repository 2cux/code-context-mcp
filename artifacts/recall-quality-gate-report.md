# Memory Recall Quality Gate — Baseline Report

**Generated:** 2026-07-08
**Status:** ✓ PASS — All thresholds met

## Architecture

The quality gate evaluates 6 metrics against a fixed 35-memory fixture set
across 3 scopes. No embeddings or external models are used.

### Files

| Path | Role |
|------|------|
| `fixtures/quality-eval/memory/qualityGateFixtures.ts` | 35-seed memory set: 24 active (scope A), 5 non-active, 8 distractor (scope B) |
| `src/memory/recallScorer.ts` | Configurable BM25 × confidence × recency scoring function |
| `src/memory/recallEngine.ts` | Uses `recallScorer` with `DEFAULT_SCORER_CONFIG` |
| `src/memory/memoryFts.ts` | FTS5 / LIKE fallback — score-before-limit fix + improved LIKE scoring |
| `tests/quality/recallQualityGate.test.ts` | 53-test quality gate suite |

### Scoring Formula

```
effectiveConfidence = confidenceBase + confidence × confidenceWeight
mergedScore        = bm25Score × effectiveConfidence
recencyBoost       = exp(-ageDays / recencyDecayDays)
finalScore         = mergedScore × (1 + recencyBoost × recencyMaxBoost)
```

### Tuned Weights (`DEFAULT_SCORER_CONFIG`)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `confidenceBase` | 0.2 | Even low-confidence (0.3) memories retain ~44% score weight |
| `confidenceWeight` | 0.8 | Raw confidence matters but doesn't zero out results |
| `recencyDecayDays` | 60 | Slower decay than original 30d; month-old memories retain ~0.61 boost |
| `recencyMaxBoost` | 0.5 | Stronger recency signal (was 0.3) |

### LIKE Fallback Fix

The LIKE search previously applied `LIMIT N ORDER BY created_at DESC`
**before** scoring, which could drop the best TF-match if it was older.
Fix: fetch all matches (capped at 200), score them, then apply limit.

LIKE scoring improvements:
- Summary matches get double weight (summaries are discriminative)
- Very short terms (<3 chars) get half weight
- Exact phrase match in summary gets 4.0 bonus (vs 3.0 in content)
- Content density bonus for shorter documents

## Results

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Recall@1 | 100.0% | ≥ 80% | ✓ |
| Recall@3 | 100.0% | ≥ 95% | ✓ |
| Cross-scope leakage | 0 hits | = 0 | ✓ |
| Non-active leakage | 0 IDs | = 0 | ✓ |
| Duplicate result IDs | 0 | — | ✓ |
| False recall rate | 0% | — | Informational |

### Coverage

| Type | Active | Non-active | Queries (R@1) | Queries (R@3) |
|------|--------|------------|---------------|---------------|
| project_rule | 4 | 1 superseded | 3 | 2 |
| decision | 4 | 1 superseded | 3 | 2 |
| bug | 4 | 1 forgotten | 4 | 1 |
| current_task | 4 | 1 forgotten | 2 | 1 |
| dependency | 4 | 1 expired | 4 | 2 |
| test_failure | 4 | — | 4 | 2 |

## Running

```bash
npx vitest run tests/quality/recallQualityGate.test.ts
```

The quality gate is part of the CI suite. Threshold failures block merges.
