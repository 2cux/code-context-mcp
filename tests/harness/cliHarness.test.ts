/**
 * CLI Harness Tests
 *
 * Covers: cliSmokeFlow execution with the cliSmokeFlow manifest,
 * and the CliAdapter factory.
 */

import { describe, it, expect } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { cliSmokeFlow } from "../../src/harness/flows/cliSmokeFlow.js";
import { cliSmokeFlowManifest } from "../../src/harness/manifests/cliSmokeFlow.manifest.js";
import { createCliAdapter } from "../../src/harness/adapters/cliAdapter.js";
import type { HarnessModule } from "../../src/harness/core/types.js";

describe("cliSmokeFlow", () => {
  it("executes all manifest checkpoints without throwing", async () => {
    const mod: HarnessModule = {
      manifest: cliSmokeFlowManifest,
      run: cliSmokeFlow,
    };

    const state = await executeRun({
      module: mod,
      runId: "run_cli_test" as never,
    });

    expect(state.status).toBe("completed");
    const stepCheckpoints = state.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:completed",
    );
    expect(stepCheckpoints.length).toBe(cliSmokeFlowManifest.checkpoints.length);
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
