# Source Reproducibility Report

**Generated**: 2026-07-08T02:33:07.310Z

## Verdict

✅ **Reproducible** — clean-source build and quality tests pass.

## Environment

| Key | Value |
|---|---:|
| Node.js | v24.13.0 |
| Platform | win32 x64 |
| CPUs | 22 |
| Memory | 32373MB |

## Repository

| Key | Value |
|---|---:|
| Tracked files | 409 |
| Temp directory | `C:\Users\Lenovo\AppData\Local\Temp\codecontext-clean-1783477976731` |

## Summary

✅ 5 | ❌ 0 | ⏭️ 0 | ⏱️ 10681ms

## Steps

| # | Step | Status | Duration | Detail |
|---|---:|---:|---:|---:|
| 1 | Verify required source dirs are Git-tracked | ✅ | 101ms | 2 dirs present (src/memory/: 7 files, fixtures/quality-eval/memory/: 2 files) |
| 2 | Copy git ls-files to temp directory | ✅ | 1612ms | 409/409 files copied to C:\Users\Lenovo\AppData\Local\Temp\codecontext-clean-1783477976731 |
| 3 | pnpm install --frozen-lockfile | ✅ | 2807ms | dependencies installed |
| 4 | Build (tsc) | ✅ | 3180ms | dist/index.js created |
| 5 | npx vitest run tests/quality | ✅ | 2979ms | 3 passed (3) | 97 passed (97) |

## Quality Test Output

```

[1m[7m[36m RUN [39m[27m[22m [36mv2.1.9 [39m[90mC:/Users/Lenovo/AppData/Local/Temp/codecontext-clean-1783477976731[39m

 [32m✓[39m tests/quality/memoryQuality.test.ts [2m([22m[2m18 tests[22m[2m)[22m[90m 75[2mms[22m[39m
[90mstdout[2m | tests/quality/recallQualityGate.test.ts[2m > [22m[2mQuality Gate — Recall@1[2m > [22m[2mRecall@1 aggregate
[22m[39m
  Recall@1: 20/20 = 100.0%
  Recall@3 (precision set): 20/20 = 100.0%

[90mstdout[2m | tests/quality/recallQualityGate.test.ts[2m > [22m[2mQuality Gate — Recall@3[2m > [22m[2mRecall@3 aggregate
[22m[39m
  Recall@3: 10/10 = 100.0%

[90mstdout[2m | tests/quality/recallQualityGate.test.ts[2m > [22m[2mQuality Gate — False Recall Rate[2m > [22m[2mFalse recall aggregate
[22m[39m
  False recall rate: 0/5 = 0.0%

[90mstdout[2m | tests/quality/recallQualityGate.test.ts[2m > [22m[2mQuality Gate — Cross-Scope Leakage[2m > [22m[2mCross-scope aggregate
[22m[39m
  Cross-scope leakage: 0/5 queries leaked, 0 total leaked results

[90mstdout[2m | tests/quality/recallQualityGate.test.ts[2m > [22m[2mQuality Gate — Non-Active Memory Leakage[2m > [22m[2mNon-active leakage aggregate
[22m[39m
  Non-active leak: 0/5 targeted queries leaked, 0 unique leaked IDs

[90mstdout[2m | tests/quality/recallQualityGate.test.ts[2m > [22m[2mQuality Gate — Overall Verdict[2m > [22m[2mall thresholds pass
[22m[39m
======================================================================
  MEMORY RECALL QUALITY GATE — VERDICT
======================================================================
  Scorer config: base=0.2, weight=0.8, decay=60d, boost=0.5

  Recall@1:        100.0%  ✓ (target ≥ 80%)
  Recall@3:        100.0%  ✓ (target ≥ 95%)
  Cross-scope:     0 hits  ✓ (target = 0)
  Non-active leak: 0 IDs   ✓ (target = 0)
  Duplicate IDs:   0 sets  (informational)
======================================================================
  OVERALL:         ✓ PASS
======================================================================


 [32m✓[39m tests/quality/recallQualityGate.test.ts [2m([22m[2m53 tests[22m[2m)[22m[90m 129[2mms[22m[39m
[90mstderr[2m | tests/quality/compressionQuality.test.ts[2m > [22m[2mCompression Quality — code.ts[2m > [22m[2mrecords key fact retention
[22m[39m  [code.ts] Missing facts: Luhn, processing_error, invalid_amount, src/services/paymentService.ts

[90mstderr[2m | tests/quality/compressionQuality.test.ts[2m > [22m[2mCompression Quality — conversationHistory.txt[2m > [22m[2mrecords key fact retention
[22m[39m  [conversationHistory.txt] Missing facts: 5 requests, 60 seconds, Retry-After

[90mstderr[2m | tests/quality/compressionQuality.test.ts[2m > [22m[2mCompression Quality — testOutput.txt[2m > [22m[2mrecords key fact retention
[22m[39m  [testOutput.txt] Missing facts: tests/functional/listEmpty.test.tsx, should clear cookie on logout, should apply bulk discount correctly, should render empty state message, AssertionError, TypeError, 3 failed, 12 passed

[90mstderr[2m | tests/quality/compressionQuality.test.ts[2m > [22m[2mCompression Quality — markdown.md[2m > [22m[2mrecords key fact retention
[22m[39m  [markdown.md] Missing facts: Context Compression, Project Memory, Scope Isolation, Content Router, Compression Engine, Memory Service, SQLite, compress_context, retrieve_original, remember_context, recall_context, MAX_TOKENS

[90mstderr[2m | tests/quality/compressionQuality.test.ts[2m > [22m[2mCompression Quality — ragChunk.json[2m > [22m[2mrecords key fact retention
[22m[39m  [ragChunk.json] Missing facts: JWT, RS256, HTTP-only cookie, Redis, docs/auth/architecture.md, Token Management

[90mstdout[2m | tests/quality/compressionQuality.test.ts[2m > [22m[2mCompression Quality — Overall Baseline[2m > [22m[2mreports average retention rate
[22m[39m  Average key fact retention: 57.9%

[90mstdout[2m | tests/quality/compressionQuality.test.ts[2m > [22m[2mCompression Quality — Overall Baseline[2m > [22m[2mreports average token savings
[22m[39m  Average token savings: 56.0%

 [32m✓[39m tests/quality/compressionQuality.test.ts [2m([22m[2m26 tests[22m[2m)[22m[90m 155[2mms[22m[39m

[2m Test Files [22m [1m[32m3 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[32m97 passed[39m[22m[90m (97)[39m
[2m   Start at [22m 10:33:05
[2m   Duration [22m 1.39s[2m (transform 294ms, setup 0ms, collect 669ms, tests 358ms, environment 0ms, prepare 539ms)[22m



```

## Artifacts

- `reports/release/source-reproducibility.json` — structured data
- `reports/release/source-reproducibility.md` — this report
