/**
 * Harness Types Tests
 *
 * Covers: RunId, RunStatus, RunRecord, Checkpoint, Manifest, ManifestStep,
 * LoopType, RunContext, and RUN_STATUS_TRANSITIONS.
 */

import { describe, it, expect } from "vitest";
import { RUN_STATUS_TRANSITIONS } from "../../src/harness/core/types.js";
import type { Manifest, RunRecord, RunStatus } from "../../src/harness/core/types.js";

// ── RunStatus Transitions ─────────────────────────────────────────────────────

describe("RUN_STATUS_TRANSITIONS", () => {
  it("created can transition to running or aborted", () => {
    expect(RUN_STATUS_TRANSITIONS.created).toEqual(["running", "aborted"]);
  });

  it("running can transition to passed, failed, or aborted", () => {
    expect(RUN_STATUS_TRANSITIONS.running).toEqual(["passed", "failed", "aborted"]);
  });

  it("terminal states have no valid transitions", () => {
    const terminals: RunStatus[] = ["passed", "failed", "aborted"];
    for (const status of terminals) {
      expect(RUN_STATUS_TRANSITIONS[status]).toEqual([]);
    }
  });
});

// ── Manifest Shape ────────────────────────────────────────────────────────────

describe("Manifest (type-level shape validation)", () => {
  it("accepts a valid manifest object", () => {
    const m: Manifest = {
      name: "testFlow",
      description: "A test manifest",
      loopType: "compression",
      steps: [
        { name: "step1", description: "First step", expect: "success" },
        { name: "step2", description: "Second step", expect: "any" },
      ],
      tags: ["smoke"],
    };
    expect(m.name).toBe("testFlow");
    expect(m.steps).toHaveLength(2);
    expect(m.loopType).toBe("compression");
  });
});

// ── RunRecord Shape ───────────────────────────────────────────────────────────

describe("RunRecord (type-level shape validation)", () => {
  it("accepts a valid run record object", () => {
    const r: RunRecord = {
      runId: "run_20260615_abc123_001" as never,
      manifestName: "testFlow",
      scopeId: "test-scope",
      status: "created",
      createdAt: new Date().toISOString(),
      checkpoints: [],
      subReceiptIds: [],
      tags: [],
      metadata: {},
    };
    expect(r.status).toBe("created");
    expect(r.checkpoints).toHaveLength(0);
  });
});
