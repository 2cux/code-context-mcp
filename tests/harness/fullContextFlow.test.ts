/**
 * Full Context Flow Tests
 *
 * Covers: fullContextFlow execution with the fullContextFlow manifest.
 */

import { describe, it, expect } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { fullContextFlow } from "../../src/harness/flows/fullContextFlow.js";
import { fullContextFlowManifest } from "../../src/harness/manifests/fullContextFlow.manifest.js";
import type { HarnessModule } from "../../src/harness/core/types.js";

describe("fullContextFlow", () => {
  it("executes all manifest checkpoints without throwing", async () => {
    const mod: HarnessModule = {
      manifest: fullContextFlowManifest,
      run: fullContextFlow,
    };

    const state = await executeRun({
      module: mod,
      runId: "run_full_test" as never,
    });

    expect(state.status).toBe("completed");
    const stepCheckpoints = state.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:completed",
    );
    expect(stepCheckpoints.length).toBe(fullContextFlowManifest.checkpoints.length);
  });
});
