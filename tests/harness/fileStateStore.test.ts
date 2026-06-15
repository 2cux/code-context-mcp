/**
 * File State Store Tests
 *
 * Covers: saveRun, loadRun, listRuns, transitionStatus, deleteRun,
 * setRunsDir, getRunsDir, runFilePath.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  saveRun,
  loadRun,
  listRuns,
  transitionStatus,
  deleteRun,
  setRunsDir,
  getRunsDir,
} from "../../src/harness/core/stateStore.js";
import type { RunRecord } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run_test_001" as never,
    manifestName: "testFlow",
    scopeId: "scope:test",
    status: "created",
    createdAt: new Date().toISOString(),
    checkpoints: [],
    subReceiptIds: [],
    tags: [],
    metadata: {},
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-harness-test-"));
  setRunsDir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Save / Load ───────────────────────────────────────────────────────────────

describe("saveRun and loadRun", () => {
  it("saves a run record and loads it back", () => {
    const record = makeRecord();
    saveRun(record);

    const loaded = loadRun(record.runId);
    expect(loaded).toBeDefined();
    expect(loaded?.runId).toBe(record.runId);
    expect(loaded?.manifestName).toBe("testFlow");
    expect(loaded?.status).toBe("created");
  });

  it("returns undefined for a nonexistent run", () => {
    expect(loadRun("nonexistent" as never)).toBeUndefined();
  });
});

// ── List ──────────────────────────────────────────────────────────────────────

describe("listRuns", () => {
  it("returns an empty array when no runs exist", () => {
    expect(listRuns()).toEqual([]);
  });

  it("lists all saved run IDs in sorted order", () => {
    saveRun(makeRecord({ runId: "run_c" as never }));
    saveRun(makeRecord({ runId: "run_a" as never }));
    saveRun(makeRecord({ runId: "run_b" as never }));

    const ids = listRuns();
    expect(ids).toEqual(["run_a", "run_b", "run_c"]);
  });
});

// ── Status Transitions ────────────────────────────────────────────────────────

describe("transitionStatus", () => {
  it("transitions from created to running", () => {
    saveRun(makeRecord({ runId: "run_t" as never, status: "created" }));
    const updated = transitionStatus("run_t" as never, "running");
    expect(updated.status).toBe("running");
  });

  it("transitions from running to passed and sets completedAt", () => {
    saveRun(makeRecord({ runId: "run_p" as never, status: "running" }));
    const updated = transitionStatus("run_p" as never, "passed");
    expect(updated.status).toBe("passed");
    expect(updated.completedAt).toBeDefined();
  });

  it("throws on invalid transition", () => {
    saveRun(makeRecord({ runId: "run_x" as never, status: "passed" }));
    expect(() => transitionStatus("run_x" as never, "running")).toThrow(
      "Invalid status transition",
    );
  });

  it("throws when run does not exist", () => {
    expect(() => transitionStatus("nonexistent" as never, "running")).toThrow(
      "not found",
    );
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

describe("deleteRun", () => {
  it("deletes a run and returns true", () => {
    saveRun(makeRecord({ runId: "run_del" as never }));
    expect(deleteRun("run_del" as never)).toBe(true);
    expect(loadRun("run_del" as never)).toBeUndefined();
  });

  it("returns false for a nonexistent run", () => {
    expect(deleteRun("nonexistent" as never)).toBe(false);
  });
});

// ── Runs Dir ──────────────────────────────────────────────────────────────────

describe("setRunsDir / getRunsDir", () => {
  it("reflects the overridden runs directory", () => {
    setRunsDir("/custom/runs");
    expect(getRunsDir()).toBe("/custom/runs");
  });
});
