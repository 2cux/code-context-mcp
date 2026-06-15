/**
 * Reporter Tests
 *
 * Covers: summarizeRun, detailRun, jsonRun.
 */

import { describe, it, expect } from "vitest";
import { summarizeRun, detailRun, jsonRun } from "../../src/harness/core/reporter.js";
import type { RunRecord } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run_20260615_abc_001" as never,
    manifestName: "testFlow",
    scopeId: "scope:test",
    status: "passed",
    createdAt: "2026-06-15T00:00:00.000Z",
    completedAt: "2026-06-15T00:00:01.000Z",
    checkpoints: [
      { seq: 0, timestamp: "2026-06-15T00:00:00.000Z", label: "run:start", outcome: "pass" },
      { seq: 1, timestamp: "2026-06-15T00:00:00.500Z", label: "test:step1", outcome: "pass" },
      { seq: 2, timestamp: "2026-06-15T00:00:00.800Z", label: "test:step2", outcome: "fail", message: "expected X, got Y" },
      { seq: 3, timestamp: "2026-06-15T00:00:01.000Z", label: "run:passed", outcome: "pass" },
    ],
    subReceiptIds: ["rcp_001", "rcp_002"],
    tags: ["smoke", "compression"],
    metadata: {},
    ...overrides,
  };
}

// ── summarizeRun ──────────────────────────────────────────────────────────────

describe("summarizeRun", () => {
  it("produces a one-line summary with correct counts", () => {
    const summary = summarizeRun(makeRecord());
    expect(summary).toContain("[PASSED]");
    expect(summary).toContain("testFlow");
    expect(summary).toContain("cp:4");
    expect(summary).toContain("P:3 F:1 W:0 S:0");
  });

  it("shows FAILED for failed runs", () => {
    const summary = summarizeRun(makeRecord({ status: "failed" }));
    expect(summary).toContain("[FAILED]");
  });
});

// ── detailRun ─────────────────────────────────────────────────────────────────

describe("detailRun", () => {
  it("produces a multi-line report with checkpoints", () => {
    const detail = detailRun(makeRecord());
    expect(detail).toContain("Run:       run_20260615_abc_001");
    expect(detail).toContain("Manifest:  testFlow");
    expect(detail).toContain("Status:    passed");
    expect(detail).toContain("✓ [1] test:step1");
    expect(detail).toContain("✗ [2] test:step2");
    expect(detail).toContain("Sub-Receipts: rcp_001, rcp_002");
  });
});

// ── jsonRun ───────────────────────────────────────────────────────────────────

describe("jsonRun", () => {
  it("produces valid parsable JSON", () => {
    const json = jsonRun(makeRecord());
    const parsed = JSON.parse(json) as RunRecord;
    expect(parsed.runId).toBe("run_20260615_abc_001");
    expect(parsed.status).toBe("passed");
    expect(parsed.checkpoints).toHaveLength(4);
  });
});
