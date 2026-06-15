/**
 * Memory Flow Tests
 *
 * Covers: memoryFlow execution with the memoryFlow manifest.
 */

import { describe, it, expect } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { memoryFlow } from "../../src/harness/flows/memoryFlow.js";
import { memoryFlowManifest } from "../../src/harness/manifests/memoryFlow.manifest.js";
import type { HarnessModule } from "../../src/harness/core/types.js";

describe("memoryFlow", () => {
  it("executes all manifest checkpoints without throwing", async () => {
    const mod: HarnessModule = {
      manifest: memoryFlowManifest,
      run: memoryFlow,
    };

    const state = await executeRun({
      module: mod,
      runId: "run_memory_test" as never,
    });

    expect(state.status).toBe("completed");
    const stepCheckpoints = state.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:completed",
    );
    expect(stepCheckpoints.length).toBe(memoryFlowManifest.checkpoints.length);
  });
});
