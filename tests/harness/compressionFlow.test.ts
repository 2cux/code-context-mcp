/**
 * Compression Flow Tests
 *
 * Covers: compressionFlow execution with the compressionFlow manifest.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registerFlow, executeRun, clearFlows } from "../../src/harness/core/runner.js";
import { compressionFlow } from "../../src/harness/flows/compressionFlow.js";
import { compressionFlowManifest } from "../../src/harness/manifests/compressionFlow.manifest.js";

beforeEach(() => {
  clearFlows();
});

describe("compressionFlow", () => {
  it("executes all manifest steps without throwing", async () => {
    registerFlow("compressionFlow", compressionFlow);

    const record = await executeRun(
      compressionFlowManifest,
      "run_compress_test" as never,
      "scope:test",
    );

    expect(record.status).toBe("passed");
    // There should be a checkpoint for each manifest step
    const stepCheckpoints = record.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:passed" && c.label !== "run:error",
    );
    expect(stepCheckpoints.length).toBe(compressionFlowManifest.steps.length);
    for (const cp of stepCheckpoints) {
      expect(cp.outcome).toBe("pass");
    }
  });
});
