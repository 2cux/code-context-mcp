/**
 * MCP Harness Tests
 *
 * Covers: mcpToolsSmokeFlow execution with the mcpToolsSmokeFlow manifest,
 * and the McpAdapter factory.
 */

import { describe, it, expect } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { mcpToolsSmokeFlow } from "../../src/harness/flows/mcpToolsSmokeFlow.js";
import type { McpToolsSmokeFlowInput } from "../../src/harness/flows/mcpToolsSmokeFlow.js";
import { mcpToolsSmokeFlowManifest } from "../../src/harness/manifests/mcpToolsSmokeFlow.manifest.js";
import { createMcpAdapter } from "../../src/harness/adapters/mcpAdapter.js";
import type { McpAdapter, McpCallResult } from "../../src/harness/adapters/mcpAdapter.js";
import type { HarnessModule } from "../../src/harness/core/types.js";

// ── Mock MCP Adapter ────────────────────────────────────────────────────────────

function createMockMcpAdapter(): McpAdapter {
  return {
    async callTool(toolName: string, _args: Record<string, unknown>): Promise<McpCallResult> {
      return {
        toolName,
        content: [{ type: "text", text: `Mock response for ${toolName}` }],
        isError: false,
      };
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("mcpToolsSmokeFlow", () => {
  it("executes all 13 MCP tool smoke checks with mock adapter", async () => {
    const adapter = createMockMcpAdapter();

    const input: McpToolsSmokeFlowInput = { adapter };

    const mod: HarnessModule<McpToolsSmokeFlowInput> = {
      manifest: mcpToolsSmokeFlowManifest,
      run: mcpToolsSmokeFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_mcp_mock" as never,
      input,
    });

    expect(state.status).toBe("completed");

    // Verify output
    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    if (output) {
      expect(output.totalTools).toBe(13);
      expect(output.passed).toBe(13);
      expect(output.failed).toBe(0);
      expect(Array.isArray(output.results)).toBe(true);
      expect((output.results as Array<unknown>).length).toBe(13);
    }

    // Verify all checkpoints
    const stepCheckpoints = state.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:completed",
    );
    expect(stepCheckpoints.length).toBe(mcpToolsSmokeFlowManifest.checkpoints.length);

    for (const cp of stepCheckpoints) {
      expect(cp.outcome).toBe("pass");
    }
  });

  it("records failures when adapter throws", async () => {
    const failingAdapter: McpAdapter = {
      async callTool(_toolName: string, _args: Record<string, unknown>): Promise<McpCallResult> {
        throw new Error("Simulated tool failure");
      },
    };

    const input: McpToolsSmokeFlowInput = { adapter: failingAdapter };

    const mod: HarnessModule<McpToolsSmokeFlowInput> = {
      manifest: mcpToolsSmokeFlowManifest,
      run: mcpToolsSmokeFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_mcp_failing" as never,
      input,
    });

    expect(state.status).toBe("completed"); // Flow doesn't abort on failures

    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    if (output) {
      expect(output.totalTools).toBe(13);
      // All should have failed
      expect(output.failed).toBe(13);
      expect(output.passed).toBe(0);
    }

    // Verify all checkpoints are fail
    const stepCheckpoints = state.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:completed",
    );
    for (const cp of stepCheckpoints) {
      expect(cp.outcome).toBe("fail");
    }
  });
});

describe("createMcpAdapter", () => {
  it("creates an adapter (stub — throws on callTool)", () => {
    const adapter = createMcpAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.callTool).toBe("function");
  });

  it("throws when callTool is invoked (not yet implemented)", async () => {
    const adapter = createMcpAdapter();
    await expect(
      adapter.callTool("current_scope", {}),
    ).rejects.toThrow("not yet implemented");
  });
});
