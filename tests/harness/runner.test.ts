/**
 * Runner Tests
 *
 * Covers: registerFlow, executeRun, clearFlows.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  registerFlow,
  executeRun,
  clearFlows,
} from "../../src/harness/core/runner.js";
import { setRunsDir } from "../../src/harness/core/stateStore.js";
import type { Manifest, RunStatus } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeManifest(name = "testFlow"): Manifest {
  return {
    name,
    description: "Test manifest",
    loopType: "compression",
    steps: [{ name: "step1", description: "A step", expect: "success" }],
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-harness-runner-"));
  setRunsDir(tmpDir);
  clearFlows();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Execute ───────────────────────────────────────────────────────────────────

describe("executeRun", () => {
  it("throws when no flow handler is registered", async () => {
    const manifest = makeManifest("noHandler");
    await expect(
      executeRun(manifest, "run_test_001" as never, "scope:test"),
    ).rejects.toThrow('No flow handler registered for manifest "noHandler".');
  });

  it("executes a registered flow, returns and persists a passed run record", async () => {
    registerFlow("testFlow", async (_ctx, log) => {
      log({ timestamp: new Date().toISOString(), label: "test:step", outcome: "pass" });
      return "passed" as RunStatus;
    });

    const manifest = makeManifest("testFlow");
    const record = await executeRun(manifest, "run_test_002" as never, "scope:test");

    expect(record.status).toBe("passed");
    expect(record.manifestName).toBe("testFlow");
    // run:start + handler's test:step + run:passed = 3 checkpoints
    expect(record.checkpoints.length).toBe(3);
    expect(record.completedAt).toBeDefined();

    // Verify persistence: file should exist on disk
    const runFile = path.join(tmpDir, "run_test_002.json");
    expect(fs.existsSync(runFile)).toBe(true);
  });

  it("records a failed run when the handler throws", async () => {
    registerFlow("failingFlow", async (_ctx, _log) => {
      throw new Error("boom");
    });

    const manifest: Manifest = {
      name: "failingFlow",
      description: "Will fail",
      loopType: "compression",
      steps: [],
    };

    const record = await executeRun(manifest, "run_test_003" as never, "scope:test");

    expect(record.status).toBe("failed");
    const errorCheckpoint = record.checkpoints.find((c) => c.label === "run:error");
    expect(errorCheckpoint).toBeDefined();
    expect(errorCheckpoint?.message).toContain("boom");
  });

  it("records a failed run when the handler returns failed", async () => {
    registerFlow("returnsFailed", async (_ctx, log) => {
      log({ timestamp: new Date().toISOString(), label: "step", outcome: "fail" });
      return "failed" as RunStatus;
    });

    const manifest: Manifest = {
      name: "returnsFailed",
      description: "Returns failed",
      loopType: "fullContext",
      steps: [],
    };

    const record = await executeRun(manifest, "run_test_004" as never, "scope:test");
    expect(record.status).toBe("failed");
  });
});

// ── Clear ─────────────────────────────────────────────────────────────────────

describe("clearFlows", () => {
  it("removes all registered flow handlers", async () => {
    registerFlow("testFlow", async () => "passed");
    clearFlows();

    const manifest = makeManifest("testFlow");
    await expect(
      executeRun(manifest, "run_test_005" as never, "scope:test"),
    ).rejects.toThrow("No flow handler registered");
  });
});
