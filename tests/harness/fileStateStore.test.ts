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
import type { RunState } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "run_test_001" as never,
    moduleId: "test-flow",
    status: "created",
    input: {},
    artifacts: [],
    checkpoints: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
  it("saves a run state and loads it back", () => {
    const state = makeState();
    saveRun(state);

    const loaded = loadRun(state.runId);
    expect(loaded).toBeDefined();
    expect(loaded?.runId).toBe(state.runId);
    expect(loaded?.moduleId).toBe("test-flow");
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
    saveRun(makeState({ runId: "run_c" as never }));
    saveRun(makeState({ runId: "run_a" as never }));
    saveRun(makeState({ runId: "run_b" as never }));

    const ids = listRuns();
    expect(ids).toEqual(["run_a", "run_b", "run_c"]);
  });
});

// ── Status Transitions ────────────────────────────────────────────────────────

describe("transitionStatus", () => {
  it("transitions from created to running", () => {
    saveRun(makeState({ runId: "run_t" as never, status: "created" }));
    const updated = transitionStatus("run_t" as never, "running");
    expect(updated.status).toBe("running");
  });

  it("transitions from running to completed and sets completedAt", () => {
    saveRun(makeState({ runId: "run_p" as never, status: "running" }));
    const updated = transitionStatus("run_p" as never, "completed");
    expect(updated.status).toBe("completed");
    expect(updated.completedAt).toBeDefined();
  });

  it("transitions from running to failed and sets completedAt", () => {
    saveRun(makeState({ runId: "run_f" as never, status: "running" }));
    const updated = transitionStatus("run_f" as never, "failed");
    expect(updated.status).toBe("failed");
    expect(updated.completedAt).toBeDefined();
  });

  it("throws on invalid transition", () => {
    saveRun(makeState({ runId: "run_x" as never, status: "completed" }));
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
    saveRun(makeState({ runId: "run_del" as never }));
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
