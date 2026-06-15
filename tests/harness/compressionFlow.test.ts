/**
 * Compression Flow Tests
 *
 * Covers: compressionFlow execution with the compressionFlow manifest.
 */

import { describe, it, expect } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { compressionFlow } from "../../src/harness/flows/compressionFlow.js";
import { compressionFlowManifest } from "../../src/harness/manifests/compressionFlow.manifest.js";
import type { HarnessModule } from "../../src/harness/core/types.js";

describe("compressionFlow", () => {
  it("executes all manifest checkpoints without throwing", async () => {
    const mod: HarnessModule = {
      manifest: compressionFlowManifest,
      run: compressionFlow,
    };

    const state = await executeRun({
      module: mod,
      runId: "run_compress_test" as never,
    });

    expect(state.status).toBe("completed");
    // There should be a checkpoint for each declared checkpoint + run:start + run:completed
    const stepCheckpoints = state.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:completed",
    );
    expect(stepCheckpoints.length).toBe(compressionFlowManifest.checkpoints.length);
    for (const cp of stepCheckpoints) {
      expect(cp.outcome).toBe("pass");
    }
  });
});
