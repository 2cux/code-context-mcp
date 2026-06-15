/**
 * Reporter Tests
 *
 * Covers: recordPhase, recordLog, recordCheckpoint, recordArtifact,
 * recordError, recordCompleted, readLogs, readCheckpoints,
 * summarizeRun, detailRun, jsonRun.
 *
 * Events are written to:
 *   runs/<runId>/logs.jsonl        — phase, log, artifact, error, completed
 *   runs/<runId>/checkpoints.jsonl  — checkpoints
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { setRunsDir } from "../../src/harness/core/stateStore.js";
import {
  recordPhase,
  recordLog,
  recordCheckpoint,
  recordArtifact,
  recordError,
  recordCompleted,
  readLogs,
  readCheckpoints,
  summarizeRun,
  detailRun,
  jsonRun,
} from "../../src/harness/core/reporter.js";
import { logsJsonlPath, checkpointsJsonlPath } from "../../src/harness/utils/runPaths.js";
import type { RunState, Checkpoint, ArtifactEntry, SerializedError } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "run_20260615_abc_001" as never,
    moduleId: "test-flow",
    status: "completed",
    currentPhase: "verify",
    input: {},
    artifacts: [
      { name: "results", path: "run_abc/artifacts/results", size: 1024 },
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

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    seq: 0,
    timestamp: new Date().toISOString(),
    phase: "test",
    label: "test:check",
    outcome: "pass",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<ArtifactEntry> = {}): ArtifactEntry {
  return {
    name: "output.json",
    path: "run_id/artifacts/output.json",
    size: 100,
    ...overrides,
  };
}

function makeError(overrides: Partial<SerializedError> = {}): SerializedError {
  return {
    name: "Error",
    message: "something went wrong",
    ...overrides,
  };
}

function readJsonlFile(filePath: string): Record<string, unknown>[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (raw.length === 0) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let tmpDir: string;
const runId = "run_reporter_test" as never;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-harness-reporter-"));
  setRunsDir(tmpDir);
  // Create the run directory so reporter can write into it
  fs.mkdirSync(path.join(tmpDir, runId), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Record Phase ──────────────────────────────────────────────────────────────

describe("recordPhase", () => {
  it("appends a phase entry to logs.jsonl", () => {
    recordPhase(runId, "compress");

    const entries = readJsonlFile(logsJsonlPath(tmpDir, runId));
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("phase");
    expect(entries[0].phase).toBe("compress");
    expect(entries[0].ts).toBeDefined();
  });

  it("appends multiple phase entries in order", () => {
    recordPhase(runId, "setup");
    recordPhase(runId, "compress");
    recordPhase(runId, "verify");

    const entries = readJsonlFile(logsJsonlPath(tmpDir, runId));
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.phase)).toEqual(["setup", "compress", "verify"]);
  });
});

// ── Record Log ────────────────────────────────────────────────────────────────

describe("recordLog", () => {
  it("appends a log entry to logs.jsonl", () => {
    recordLog(runId, "Running setup hook");

    const entries = readJsonlFile(logsJsonlPath(tmpDir, runId));
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("log");
    expect(entries[0].message).toBe("Running setup hook");
  });
});

// ── Record Checkpoint ─────────────────────────────────────────────────────────

describe("recordCheckpoint", () => {
  it("appends a checkpoint entry to checkpoints.jsonl", () => {
    const cp = makeCheckpoint({ label: "compress:code", outcome: "pass" });
    recordCheckpoint(runId, cp);

    const entries = readJsonlFile(checkpointsJsonlPath(tmpDir, runId));
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("compress:code");
    expect(entries[0].outcome).toBe("pass");
    expect(entries[0].phase).toBe("test");
  });

  it("includes optional message and metadata", () => {
    const cp = makeCheckpoint({
      label: "test:fail",
      outcome: "fail",
      message: "expected X, got Y",
      metadata: { expected: "X", got: "Y" },
    });
    recordCheckpoint(runId, cp);

    const entries = readJsonlFile(checkpointsJsonlPath(tmpDir, runId));
    expect(entries[0].message).toBe("expected X, got Y");
    expect(entries[0].metadata).toEqual({ expected: "X", got: "Y" });
  });
});

// ── Record Artifact ───────────────────────────────────────────────────────────

describe("recordArtifact", () => {
  it("appends an artifact entry to logs.jsonl", () => {
    const art = makeArtifact({ name: "results.json", size: 2048 });
    recordArtifact(runId, art);

    const entries = readJsonlFile(logsJsonlPath(tmpDir, runId));
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("artifact");
    expect(entries[0].name).toBe("results.json");
    expect(entries[0].size).toBe(2048);
  });

  it("includes contentType when provided", () => {
    const art = makeArtifact({ contentType: "application/json" });
    recordArtifact(runId, art);

    const entries = readJsonlFile(logsJsonlPath(tmpDir, runId));
    expect(entries[0].contentType).toBe("application/json");
  });
});

// ── Record Error ──────────────────────────────────────────────────────────────

describe("recordError", () => {
  it("appends an error entry to logs.jsonl", () => {
    const err = makeError({ name: "TypeError", message: "boom" });
    recordError(runId, err);

    const entries = readJsonlFile(logsJsonlPath(tmpDir, runId));
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("error");
    expect(entries[0].name).toBe("TypeError");
    expect(entries[0].message).toBe("boom");
  });

  it("includes stack trace when provided", () => {
    const err = makeError({ stack: "at foo (bar.ts:1:2)" });
    recordError(runId, err);

    const entries = readJsonlFile(logsJsonlPath(tmpDir, runId));
    expect(entries[0].stack).toBe("at foo (bar.ts:1:2)");
  });
});

// ── Record Completed ──────────────────────────────────────────────────────────

describe("recordCompleted", () => {
  it("appends a completed entry to logs.jsonl", () => {
    recordCompleted(runId);

    const entries = readJsonlFile(logsJsonlPath(tmpDir, runId));
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("completed");
    expect(entries[0].runId).toBe(runId);
  });
});

// ── Read Helpers ──────────────────────────────────────────────────────────────

describe("readLogs", () => {
  it("returns empty array when logs.jsonl does not exist", () => {
    const logs = readLogs("nonexistent" as never);
    expect(logs).toEqual([]);
  });

  it("reads all log entries in order", () => {
    recordPhase(runId, "setup");
    recordLog(runId, "hello");
    recordPhase(runId, "verify");

    const logs = readLogs(runId);
    expect(logs).toHaveLength(3);
    expect(logs[0].type).toBe("phase");
    expect(logs[1].type).toBe("log");
    expect(logs[2].type).toBe("phase");
  });
});

describe("readCheckpoints", () => {
  it("returns empty array when checkpoints.jsonl does not exist", () => {
    const cps = readCheckpoints("nonexistent" as never);
    expect(cps).toEqual([]);
  });

  it("reads all checkpoint entries in order", () => {
    recordCheckpoint(runId, makeCheckpoint({ seq: 0, label: "cp:0" }));
    recordCheckpoint(runId, makeCheckpoint({ seq: 1, label: "cp:1" }));

    const cps = readCheckpoints(runId);
    expect(cps).toHaveLength(2);
    expect(cps[0].label).toBe("cp:0");
    expect(cps[1].label).toBe("cp:1");
  });
});

// ── Multiple Event Types in logs.jsonl ────────────────────────────────────────

describe("interleaved events in logs.jsonl", () => {
  it("records different event types in chronological order", () => {
    recordPhase(runId, "setup");
    recordLog(runId, "starting work");
    recordPhase(runId, "compress");
    recordArtifact(runId, makeArtifact({ name: "out.json" }));
    recordError(runId, makeError({ message: "fail" }));
    recordCompleted(runId);

    const entries = readJsonlFile(logsJsonlPath(tmpDir, runId));
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.type)).toEqual([
      "phase",
      "log",
      "phase",
      "artifact",
      "error",
      "completed",
    ]);
  });
});

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
