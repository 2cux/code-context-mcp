/**
 * Reporter Tests
 *
 * Covers: summarizeRun, detailRun, jsonRun.
 */

import { describe, it, expect } from "vitest";
import { summarizeRun, detailRun, jsonRun } from "../../src/harness/core/reporter.js";
import type { RunState } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "run_20260615_abc_001" as never,
    moduleId: "test-flow",
    status: "completed",
    currentPhase: "verify",
    input: {},
    artifacts: [
      { name: "results", path: "run_abc/results", size: 1024 },
    ],
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:01.000Z",
    completedAt: "2026-06-15T00:00:01.000Z",
    checkpoints: [
      { seq: 0, timestamp: "2026-06-15T00:00:00.000Z", phase: "setup", label: "run:start", outcome: "pass" },
      { seq: 1, timestamp: "2026-06-15T00:00:00.500Z", phase: "compress", label: "test:step1", outcome: "pass" },
      { seq: 2, timestamp: "2026-06-15T00:00:00.800Z", phase: "compress", label: "test:step2", outcome: "fail", message: "expected X, got Y" },
      { seq: 3, timestamp: "2026-06-15T00:00:01.000Z", phase: "verify", label: "run:completed", outcome: "pass" },
    ],
    ...overrides,
  };
}

// ── summarizeRun ──────────────────────────────────────────────────────────────

describe("summarizeRun", () => {
  it("produces a one-line summary with correct counts", () => {
    const summary = summarizeRun(makeState());
    expect(summary).toContain("[COMPLETED]");
    expect(summary).toContain("test-flow");
    expect(summary).toContain("cp:4");
    expect(summary).toContain("P:3 F:1 W:0 S:0");
    expect(summary).toContain("artifacts:1");
  });

  it("shows FAILED for failed runs", () => {
    const summary = summarizeRun(makeState({ status: "failed" }));
    expect(summary).toContain("[FAILED]");
  });
});

// ── detailRun ─────────────────────────────────────────────────────────────────

describe("detailRun", () => {
  it("produces a multi-line report with checkpoints", () => {
    const detail = detailRun(makeState());
    expect(detail).toContain("Run:        run_20260615_abc_001");
    expect(detail).toContain("Module:     test-flow");
    expect(detail).toContain("Status:     completed");
    expect(detail).toContain("Phase:      verify");
    expect(detail).toContain("Artifacts:  results");
    // Checkpoints include phase prefix
    expect(detail).toContain("compress/test:step1");
    expect(detail).toContain("compress/test:step2");
  });
});

// ── jsonRun ───────────────────────────────────────────────────────────────────

describe("jsonRun", () => {
  it("produces valid parsable JSON", () => {
    const json = jsonRun(makeState());
    const parsed = JSON.parse(json) as RunState;
    expect(parsed.runId).toBe("run_20260615_abc_001");
    expect(parsed.status).toBe("completed");
    expect(parsed.checkpoints).toHaveLength(4);
  });
});
