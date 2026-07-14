# CodeContext Context Quality Report

GeneratedAt: 2026-07-14T07:58:22.110Z
Git commit: 36b901ce61b2c99153d2ea4ba31db120d33eb12a
Git dirty: true
Repeatable command: `npm run quality:reports`

## Fixture Versions

- Compression: compression-baseline-and-release-gate-v1 / 83068cc5b804f1995794f05dea9f60398384d73d2af970a25b02294b8dfde81b
- Recall: recall-quality-gate-v1 / b1a9dbd3ef2d43eb5c557bf4fe62c527d33c151aacd4b16513281d1ec8f3fe6a

## Baseline Measurement

Threshold: none enforced; baseline measurements are current observations only.
Measured result: compression retention 57.9%, compression savings 56.0%, recall@1 100.0%, recall@3 100.0%.
Verdict: MEASURED

## Release Gate Result

Threshold: compression per-fixture gate and recall gate thresholds from the child reports.
Measured result: compression 8/8 passed; recall@1 100.0%, recall@3 100.0%, cross-scope hits 0, non-active leaked IDs 0.
Verdict: PASS

See `reports/quality/compression-quality.md` and `reports/quality/recall-quality.md` for detailed measured results.
