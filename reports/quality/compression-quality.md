# Compression Quality Report

GeneratedAt: 2026-07-14T07:58:22.110Z
Git commit: 36b901ce61b2c99153d2ea4ba31db120d33eb12a
Git dirty: true
Fixture version/hash: compression-baseline-and-release-gate-v1 / 83068cc5b804f1995794f05dea9f60398384d73d2af970a25b02294b8dfde81b
Repeatable command: `npm run quality:reports`

## Baseline Measurement

Threshold: none enforced (baseline measurement only).
Measured result: average key fact retention 57.9%, average token savings 56.0%.
Verdict: MEASURED

| Fixture | Type | Before | After | Savings | Facts | Retention | Verdict |
|---|---|---:|---:|---:|---:|---:|---|
| code.ts | code | 1136 | 353 | 68.9% | 9/13 | 69.2% | MEASURED |
| log.ts | log | 2470 | 741 | 70.0% | 10/10 | 100.0% | MEASURED |
| conversationHistory.txt | conversation_history | 2034 | 708 | 65.2% | 6/9 | 66.7% | MEASURED |
| commandOutput.txt | command_output | 357 | 178 | 50.1% | 9/9 | 100.0% | MEASURED |
| testOutput.txt | test_output | 495 | 178 | 64.0% | 2/10 | 20.0% | MEASURED |
| markdown.md | markdown | 358 | 75 | 79.0% | 1/13 | 7.7% | MEASURED |
| json.json | json | 184 | 184 | 0.0% | 6/6 | 100.0% | MEASURED |
| ragChunk.json | rag_chunk | 159 | 79 | 50.3% | 0/6 | 0.0% | MEASURED |

## Release Gate Result

Threshold: mustKeep all retained, mustNotInvent absent, token savings >= fixture threshold, original retrieval sha256/length proof passes.
Measured result: 8/8 passed, 0 failed, 0 skipped.
Verdict: PASS

| Fixture | Type | Threshold Savings | Measured Savings | Missing Facts | Invented | Retrieval | Verdict |
|---|---|---:|---:|---:|---:|---|---|
| test_output | test_output | 30.0% | 33.5% | 0 | 0 | PASS | PASS |
| log | log | 10.0% | 10.1% | 0 | 0 | PASS | PASS |
| command_output | command_output | 0.0% | 0.0% | 0 | 0 | PASS | PASS |
| code | code | 45.0% | 53.2% | 0 | 0 | PASS | PASS |
| json | json | 10.0% | 10.1% | 0 | 0 | PASS | PASS |
| markdown | markdown | 40.0% | 49.2% | 0 | 0 | PASS | PASS |
| rag_chunk | rag_chunk | 35.0% | 44.0% | 0 | 0 | PASS | PASS |
| conversation_history | conversation_history | 50.0% | 57.5% | 0 | 0 | PASS | PASS |

This report separates current baseline measurements from the release gate. Baseline values are not release results.
