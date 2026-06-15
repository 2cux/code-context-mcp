/**
 * MCP Harness Tests
 *
 * Covers: mcpToolsSmokeFlow execution with the mcpToolsSmokeFlow manifest,
 * and the McpAdapter factory.
 */

import { describe, it, expect } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { mcpToolsSmokeFlow } from "../../src/harness/flows/mcpToolsSmokeFlow.js";
import { mcpToolsSmokeFlowManifest } from "../../src/harness/manifests/mcpToolsSmokeFlow.manifest.js";
import { createMcpAdapter } from "../../src/harness/adapters/mcpAdapter.js";
import type { HarnessModule } from "../../src/harness/core/types.js";

describe("mcpToolsSmokeFlow", () => {
  it("executes all 13 MCP tool smoke checks", async () => {
    const mod: HarnessModule = {
      manifest: mcpToolsSmokeFlowManifest,
      run: mcpToolsSmokeFlow,
    };

    const state = await executeRun({
      module: mod,
      runId: "run_mcp_test" as never,
    });

    expect(state.status).toBe("completed");
    const stepCheckpoints = state.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:completed",
    );
    expect(stepCheckpoints.length).toBe(mcpToolsSmokeFlowManifest.checkpoints.length);
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
