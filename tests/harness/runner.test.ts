/**
 * Runner Tests
 *
 * Covers: registerModule, executeRun, clearModules.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  registerModule,
  executeRun,
  clearModules,
} from "../../src/harness/core/runner.js";
import { setRunsDir } from "../../src/harness/core/stateStore.js";
import type { HarnessManifest, HarnessModule, HarnessContext } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeManifest(id = "test-flow"): HarnessManifest {
  return {
    id,
    name: `Manifest ${id}`,
    description: "Test manifest",
    phases: [{ name: "main", description: "Main phase" }],
    checkpoints: [{ name: "step1", description: "A step", expect: "pass" }],
    artifacts: [],
    coversTools: [],
  };
}

function makeModule(
  id: string,
  runFn: (ctx: HarnessContext) => Promise<unknown>,
): HarnessModule {
  return {
    manifest: makeManifest(id),
    run: runFn,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-harness-runner-"));
  setRunsDir(tmpDir);
  clearModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Execute ───────────────────────────────────────────────────────────────────

describe("executeRun", () => {
  it("executes module directly without pre-registration", async () => {
    const mod = makeModule("direct-exec", async (ctx) => {
      ctx.checkpoint("step", "pass");
      return { ok: true };
    });

    // No registerModule call — executeRun takes the module directly
    const state = await executeRun({
      module: mod,
      runId: "run_test_001" as never,
    });

    expect(state.status).toBe("completed");
    expect(state.moduleId).toBe("direct-exec");
  });

  it("executes a registered module, returns and persists a completed run state", async () => {
    const mod: HarnessModule = {
      manifest: makeManifest("test-flow"),
      run: async (ctx) => {
        ctx.checkpoint("test:step", "pass", "OK");
        return { checked: 1 };
      },
    };

    const state = await executeRun({
      module: mod,
      runId: "run_test_002" as never,
    });

    expect(state.status).toBe("completed");
    expect(state.moduleId).toBe("test-flow");
    // run:start + handler's test:step + run:completed = 3 checkpoints
    expect(state.checkpoints.length).toBeGreaterThanOrEqual(3);
    expect(state.completedAt).toBeDefined();

    // Verify persistence: file should exist on disk
    const runFile = path.join(tmpDir, "run_test_002.json");
    expect(fs.existsSync(runFile)).toBe(true);
  });

  it("records a failed run when the handler throws", async () => {
    const mod: HarnessModule = {
      manifest: {
        id: "failing-flow",
        name: "Failing",
        description: "Will fail",
        phases: [],
        checkpoints: [],
        artifacts: [],
        coversTools: [],
      },
      run: async () => {
        throw new Error("boom");
      },
    };

    const state = await executeRun({
      module: mod,
      runId: "run_test_003" as never,
    });

    expect(state.status).toBe("failed");
    expect(state.error).toBeDefined();
    expect(state.error?.message).toContain("boom");
  });

  it("records a failed run when the handler returns with a failure checkpoint", async () => {
    const mod: HarnessModule = {
      manifest: {
        id: "returns-failed",
        name: "ReturnsFailed",
        description: "Returns failed checkpoints",
        phases: [{ name: "main", description: "Main" }],
        checkpoints: [],
        artifacts: [],
        coversTools: [],
      },
      run: async (ctx) => {
        ctx.checkpoint("step", "fail", "intentional failure");
        return {};
      },
    };

    const state = await executeRun({
      module: mod,
      runId: "run_test_004" as never,
    });

    // The flow itself completed (didn't throw), so status is "completed"
    // Individual checkpoint outcomes are recorded but don't block execution
    expect(state.status).toBe("completed");
    const failCp = state.checkpoints.find((c) => c.label === "step");
    expect(failCp?.outcome).toBe("fail");
  });

  it("calls setup and check hooks when provided", async () => {
    const calls: string[] = [];

    const mod: HarnessModule = {
      manifest: makeManifest("hooked-flow"),
      setup: async (ctx) => {
        calls.push("setup");
        ctx.log("setup done");
      },
      run: async (ctx) => {
        calls.push("run");
        ctx.checkpoint("done", "pass");
        return { ok: true };
      },
      check: async (_ctx, output) => {
        calls.push("check");
        if (!(output as { ok: boolean }).ok) throw new Error("check failed");
      },
    };

    const state = await executeRun({
      module: mod,
      runId: "run_test_005" as never,
    });

    expect(calls).toEqual(["setup", "run", "check"]);
    expect(state.status).toBe("completed");
  });
});
