/**
 * Full Context Flow Tests
 *
 * Covers: fullContextFlow execution with the fullContextFlow manifest.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registerFlow, executeRun, clearFlows } from "../../src/harness/core/runner.js";
import { fullContextFlow } from "../../src/harness/flows/fullContextFlow.js";
import { fullContextFlowManifest } from "../../src/harness/manifests/fullContextFlow.manifest.js";

beforeEach(() => {
  clearFlows();
});

describe("fullContextFlow", () => {
  it("executes all manifest steps without throwing", async () => {
    registerFlow("fullContextFlow", fullContextFlow);

    const record = await executeRun(
      fullContextFlowManifest,
      "run_full_test" as never,
      "scope:test",
    );

    expect(record.status).toBe("passed");
    const stepCheckpoints = record.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:passed" && c.label !== "run:error",
    );
    expect(stepCheckpoints.length).toBe(fullContextFlowManifest.steps.length);
  });
});
