/**
 * CLI Harness Tests
 *
 * Covers: cliSmokeFlow execution with the cliSmokeFlow manifest,
 * and the CliAdapter factory.
 */

import { describe, it, expect } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { cliSmokeFlow } from "../../src/harness/flows/cliSmokeFlow.js";
import type { CliSmokeFlowInput } from "../../src/harness/flows/cliSmokeFlow.js";
import { cliSmokeFlowManifest } from "../../src/harness/manifests/cliSmokeFlow.manifest.js";
import { createCliAdapter } from "../../src/harness/adapters/cliAdapter.js";
import type { CliAdapter, CliResult } from "../../src/harness/adapters/cliAdapter.js";
import type { HarnessModule } from "../../src/harness/core/types.js";

// ── Mock CLI Adapter ────────────────────────────────────────────────────────────

function createMockCliAdapter(): CliAdapter {
  return {
    async run(args: string[]): Promise<CliResult> {
      const cmd = args.join(" ");
      return {
        stdout: `Mock stdout for: ${cmd}`,
        stderr: "",
        exitCode: 0,
      };
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("cliSmokeFlow", () => {
  it("executes all 15 CLI smoke checks with mock adapter", async () => {
    const adapter = createMockCliAdapter();

    const input: CliSmokeFlowInput = { adapter };

    const mod: HarnessModule<CliSmokeFlowInput> = {
      manifest: cliSmokeFlowManifest,
      run: cliSmokeFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_cli_mock" as never,
      input,
    });

    expect(state.status).toBe("completed");

    // Verify output
    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    if (output) {
      expect(output.totalCommands).toBe(15);
      expect(output.passed).toBe(15);
      expect(output.failed).toBe(0);
      expect(Array.isArray(output.results)).toBe(true);
      expect((output.results as Array<unknown>).length).toBe(15);
    }

    // Verify all checkpoints
    const stepCheckpoints = state.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:completed",
    );
    expect(stepCheckpoints.length).toBe(cliSmokeFlowManifest.checkpoints.length);

    for (const cp of stepCheckpoints) {
      expect(cp.outcome).toBe("pass");
    }
  });

  it("records failures for non-zero exit codes", async () => {
    const failingAdapter: CliAdapter = {
      async run(_args: string[]): Promise<CliResult> {
        return {
          stdout: "",
          stderr: "Command not found",
          exitCode: 1,
        };
      },
    };

    const input: CliSmokeFlowInput = { adapter: failingAdapter };

    const mod: HarnessModule<CliSmokeFlowInput> = {
      manifest: cliSmokeFlowManifest,
      run: cliSmokeFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_cli_failing" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    if (output) {
      expect(output.failed).toBe(15);
      expect(output.passed).toBe(0);
    }

    const stepCheckpoints = state.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:completed",
    );
    for (const cp of stepCheckpoints) {
      expect(cp.outcome).toBe("fail");
    }
  });

  it("records failures when adapter throws", async () => {
    const throwingAdapter: CliAdapter = {
      async run(_args: string[]): Promise<CliResult> {
        throw new Error("Spawn failed");
      },
    };

    const input: CliSmokeFlowInput = { adapter: throwingAdapter };

    const mod: HarnessModule<CliSmokeFlowInput> = {
      manifest: cliSmokeFlowManifest,
      run: cliSmokeFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_cli_throw" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    if (output) {
      expect(output.failed).toBe(15);
    }
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
