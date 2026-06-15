/**
 * MCP Harness Tests
 *
 * Covers: mcpToolsSmokeFlow execution with the mcpToolsSmokeFlow manifest,
 * and the McpAdapter factory.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registerFlow, executeRun, clearFlows } from "../../src/harness/core/runner.js";
import { mcpToolsSmokeFlow } from "../../src/harness/flows/mcpToolsSmokeFlow.js";
import { mcpToolsSmokeFlowManifest } from "../../src/harness/manifests/mcpToolsSmokeFlow.manifest.js";
import { createMcpAdapter } from "../../src/harness/adapters/mcpAdapter.js";

beforeEach(() => {
  clearFlows();
});

describe("mcpToolsSmokeFlow", () => {
  it("executes all 13 MCP tool smoke checks", async () => {
    registerFlow("mcpToolsSmokeFlow", mcpToolsSmokeFlow);

    const record = await executeRun(
      mcpToolsSmokeFlowManifest,
      "run_mcp_test" as never,
      "scope:test",
    );

    expect(record.status).toBe("passed");
    const stepCheckpoints = record.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:passed" && c.label !== "run:error",
    );
    expect(stepCheckpoints.length).toBe(mcpToolsSmokeFlowManifest.steps.length);
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
