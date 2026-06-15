/**
 * File State Store Tests
 *
 * Covers: createRun, loadState, listRuns, updatePhase, updateCheckpoint,
 * writeOutput, markCompleted, markFailed, deleteRun, setRunsDir, getRunsDir.
 *
 * Directory-per-run structure:
 *   runs/<runId>/
 *     state.json
 *     input.json
 *     output.json
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createRun,
  loadState,
  listRuns,
  updatePhase,
  updateCheckpoint,
  writeOutput,
  markCompleted,
  markFailed,
  deleteRun,
  setRunsDir,
  getRunsDir,
  saveRun,
  loadRun,
} from "../../src/harness/core/stateStore.js";
import type { RunState, Checkpoint, SerializedError } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    seq: 0,
    timestamp: new Date().toISOString(),
    phase: "test",
    label: "test:cp",
    outcome: "pass",
    ...overrides,
  };
}

function makeError(overrides: Partial<SerializedError> = {}): SerializedError {
  return {
    name: "Error",
    message: "test error",
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-harness-state-"));
  setRunsDir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Create / Load ─────────────────────────────────────────────────────────────

describe("createRun and loadState", () => {
  it("creates a run directory with state.json and input.json", () => {
    const state = createRun("run_test_001" as never, "test-flow", { key: "value" });

    expect(state.status).toBe("created");
    expect(state.moduleId).toBe("test-flow");
    expect(state.runId).toBe("run_test_001");

    // Verify directory structure
    const runDir = path.join(tmpDir, "run_test_001");
    expect(fs.existsSync(runDir)).toBe(true);
    expect(fs.existsSync(path.join(runDir, "state.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "input.json"))).toBe(true);

    // Verify input.json content
    const inputRaw = fs.readFileSync(path.join(runDir, "input.json"), "utf-8");
    expect(JSON.parse(inputRaw)).toEqual({ key: "value" });
  });

  it("sets the initial phase when provided", () => {
    const state = createRun("run_phase" as never, "test-flow", {}, "setup");
    expect(state.currentPhase).toBe("setup");
  });

  it("loadState returns undefined for a nonexistent run", () => {
    expect(loadState("nonexistent" as never)).toBeUndefined();
  });

  it("loadState returns the saved state", () => {
    createRun("run_load" as never, "test-flow", {});
    const loaded = loadState("run_load" as never);
    expect(loaded).toBeDefined();
    expect(loaded?.runId).toBe("run_load");
    expect(loaded?.status).toBe("created");
  });
});

// ── List ──────────────────────────────────────────────────────────────────────

describe("listRuns", () => {
  it("returns an empty array when no runs exist", () => {
    expect(listRuns()).toEqual([]);
  });

  it("lists all run IDs in sorted order", () => {
    createRun("run_c" as never, "test", {});
    createRun("run_a" as never, "test", {});
    createRun("run_b" as never, "test", {});

    const ids = listRuns();
    expect(ids).toEqual(["run_a", "run_b", "run_c"]);
  });

  it("ignores non-directory entries in runs/", () => {
    createRun("run_dir" as never, "test", {});
    fs.writeFileSync(path.join(tmpDir, "not-a-run.txt"), "hello");
    const ids = listRuns();
    expect(ids).toContain("run_dir");
    expect(ids).not.toContain("not-a-run.txt");
  });
});

// ── Update Phase ──────────────────────────────────────────────────────────────

describe("updatePhase", () => {
  it("updates the current phase in state.json", () => {
    createRun("run_ph" as never, "test-flow", {});
    updatePhase("run_ph" as never, "compress");

    const state = loadState("run_ph" as never);
    expect(state?.currentPhase).toBe("compress");
  });

  it("throws when run does not exist", () => {
    expect(() => updatePhase("nonexistent" as never, "compress")).toThrow(
      "not found",
    );
  });
});

// ── Update Checkpoint ─────────────────────────────────────────────────────────

describe("updateCheckpoint", () => {
  it("appends a checkpoint to the state.json checkpoints array", () => {
    createRun("run_cp" as never, "test-flow", {});
    const cp = makeCheckpoint({ label: "test:first", outcome: "pass" });
    updateCheckpoint("run_cp" as never, cp);

    const state = loadState("run_cp" as never);
    expect(state?.checkpoints).toHaveLength(1);
    expect(state?.checkpoints[0].label).toBe("test:first");
  });

  it("appends multiple checkpoints in order", () => {
    createRun("run_cp2" as never, "test-flow", {});
    updateCheckpoint("run_cp2" as never, makeCheckpoint({ seq: 0, label: "cp:0" }));
    updateCheckpoint("run_cp2" as never, makeCheckpoint({ seq: 1, label: "cp:1" }));
    updateCheckpoint("run_cp2" as never, makeCheckpoint({ seq: 2, label: "cp:2" }));

    const state = loadState("run_cp2" as never);
    expect(state?.checkpoints).toHaveLength(3);
    expect(state?.checkpoints.map((c) => c.label)).toEqual(["cp:0", "cp:1", "cp:2"]);
  });

  it("throws when run does not exist", () => {
    expect(() =>
      updateCheckpoint("nonexistent" as never, makeCheckpoint()),
    ).toThrow("not found");
  });
});

// ── Write Output ──────────────────────────────────────────────────────────────

describe("writeOutput", () => {
  it("writes output.json and updates state.output", () => {
    createRun("run_out" as never, "test-flow", {});
    writeOutput("run_out" as never, { result: "ok" });

    const state = loadState("run_out" as never);
    expect(state?.output).toEqual({ result: "ok" });

    // Verify output.json on disk
    const runDir = path.join(tmpDir, "run_out");
    const outputRaw = fs.readFileSync(path.join(runDir, "output.json"), "utf-8");
    expect(JSON.parse(outputRaw)).toEqual({ result: "ok" });
  });

  it("throws when run does not exist", () => {
    expect(() => writeOutput("nonexistent" as never, {})).toThrow("not found");
  });
});

// ── Mark Completed ────────────────────────────────────────────────────────────

describe("markCompleted", () => {
  it("transitions status to completed and sets completedAt", () => {
    createRun("run_done" as never, "test-flow", {});
    // Manually set to running first
    const running = loadState("run_done" as never)!;
    running.status = "running";
    saveRun(running);

    const result = markCompleted("run_done" as never);
    expect(result.status).toBe("completed");
    expect(result.completedAt).toBeDefined();
  });

  it("throws when transitioning from created (invalid transition)", () => {
    createRun("run_bad" as never, "test-flow", {});
    expect(() => markCompleted("run_bad" as never)).toThrow(
      "Invalid status transition",
    );
  });
});

// ── Mark Failed ───────────────────────────────────────────────────────────────

describe("markFailed", () => {
  it("transitions status to failed, records error, and sets completedAt", () => {
    createRun("run_err" as never, "test-flow", {});
    // Manually set to running first
    const running = loadState("run_err" as never)!;
    running.status = "running";
    saveRun(running);

    const error = makeError({ name: "TypeError", message: "boom" });
    const result = markFailed("run_err" as never, error);
    expect(result.status).toBe("failed");
    expect(result.completedAt).toBeDefined();
    expect(result.error?.name).toBe("TypeError");
    expect(result.error?.message).toBe("boom");
  });

  it("throws when run does not exist", () => {
    expect(() => markFailed("nonexistent" as never, makeError())).toThrow(
      "not found",
    );
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

describe("deleteRun", () => {
  it("deletes the entire run directory and returns true", () => {
    createRun("run_del" as never, "test-flow", {});
    const runDir = path.join(tmpDir, "run_del");
    expect(fs.existsSync(runDir)).toBe(true);

    expect(deleteRun("run_del" as never)).toBe(true);
    expect(fs.existsSync(runDir)).toBe(false);
    expect(loadState("run_del" as never)).toBeUndefined();
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

// ── Backward Compatibility: saveRun / loadRun ────────────────────────────────

describe("saveRun and loadRun (backward compat)", () => {
  it("saves a run state and loads it back", () => {
    const state: RunState = {
      runId: "run_compat" as never,
      moduleId: "test-flow",
      status: "created",
      input: {},
      artifacts: [],
      checkpoints: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
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
