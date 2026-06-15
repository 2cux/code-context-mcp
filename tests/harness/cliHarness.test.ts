/**
 * CLI Harness Tests
 *
 * Covers: cliSmokeFlow execution with the cliSmokeFlow manifest,
 * and the CliAdapter factory.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registerFlow, executeRun, clearFlows } from "../../src/harness/core/runner.js";
import { cliSmokeFlow } from "../../src/harness/flows/cliSmokeFlow.js";
import { cliSmokeFlowManifest } from "../../src/harness/manifests/cliSmokeFlow.manifest.js";
import { createCliAdapter } from "../../src/harness/adapters/cliAdapter.js";

beforeEach(() => {
  clearFlows();
});

describe("cliSmokeFlow", () => {
  it("executes all manifest steps without throwing", async () => {
    registerFlow("cliSmokeFlow", cliSmokeFlow);

    const record = await executeRun(
      cliSmokeFlowManifest,
      "run_cli_test" as never,
      "scope:test",
    );

    expect(record.status).toBe("passed");
    const stepCheckpoints = record.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:passed" && c.label !== "run:error",
    );
    expect(stepCheckpoints.length).toBe(cliSmokeFlowManifest.steps.length);
  });
});

describe("createCliAdapter", () => {
  it("creates an adapter with default options", () => {
    const adapter = createCliAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.run).toBe("function");
  });

  it("creates an adapter with custom options", () => {
    const adapter = createCliAdapter({ timeout: 5000, cliPath: "node dist/cli/index.js" });
    expect(adapter).toBeDefined();
  });
});
