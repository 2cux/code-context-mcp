/**
 * Memory Flow Tests
 *
 * Covers: memoryFlow execution with the memoryFlow manifest.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registerFlow, executeRun, clearFlows } from "../../src/harness/core/runner.js";
import { memoryFlow } from "../../src/harness/flows/memoryFlow.js";
import { memoryFlowManifest } from "../../src/harness/manifests/memoryFlow.manifest.js";

beforeEach(() => {
  clearFlows();
});

describe("memoryFlow", () => {
  it("executes all manifest steps without throwing", async () => {
    registerFlow("memoryFlow", memoryFlow);

    const record = await executeRun(
      memoryFlowManifest,
      "run_memory_test" as never,
      "scope:test",
    );

    expect(record.status).toBe("passed");
    const stepCheckpoints = record.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:passed" && c.label !== "run:error",
    );
    expect(stepCheckpoints.length).toBe(memoryFlowManifest.steps.length);
  });
});
