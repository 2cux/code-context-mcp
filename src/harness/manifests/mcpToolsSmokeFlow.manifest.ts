/**
 * MCP Tools Smoke Manifest
 *
 * Declares the MCP tools smoke test: every one of the 13 MCP tools
 * must respond with valid structured output and no unhandled errors.
 *
 * PRD §34 / §9.6: MCP tools 验收 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const mcpToolsSmokeFlowManifest: HarnessManifest = {
  id: "mcp-tools-smoke-flow",
  name: "MCP Tools Smoke Flow",
  description:
    "Smoke test for all 13 MCP tools — every tool must respond with " +
    "valid structured output and no unhandled errors",
  phases: [
    { name: "call_each_tool_with_minimal_valid_input", description: "Call each of the 13 MCP tools with valid minimal input" },
    { name: "verify_no_unhandled_error", description: "Verify no tool returns an unhandled error" },
    { name: "verify_structured_output", description: "Verify each tool returns valid structured output" },
    { name: "write_tool_matrix", description: "Write per-tool pass/fail matrix artifact" },
  ],
  checkpoints: [
    { name: "mcp:current_scope", description: "Call current_scope tool", expect: "pass" },
    { name: "mcp:compress_context", description: "Call compress_context tool", expect: "pass" },
    { name: "mcp:retrieve_original", description: "Call retrieve_original tool", expect: "pass" },
    { name: "mcp:delete_original", description: "Call delete_original tool", expect: "pass" },
    { name: "mcp:cleanup_originals", description: "Call cleanup_originals tool", expect: "pass" },
    { name: "mcp:list_compressions", description: "Call list_compressions tool", expect: "pass" },
    { name: "mcp:remember_context", description: "Call remember_context tool", expect: "pass" },
    { name: "mcp:recall_context", description: "Call recall_context tool", expect: "pass" },
    { name: "mcp:forget_context", description: "Call forget_context tool", expect: "pass" },
    { name: "mcp:list_context", description: "Call list_context tool", expect: "pass" },
    { name: "mcp:analyze_context", description: "Call analyze_context tool", expect: "pass" },
    { name: "mcp:list_failures", description: "Call list_failures tool", expect: "pass" },
    { name: "mcp:failure_stats", description: "Call failure_stats tool", expect: "pass" },
  ],
  artifacts: [
    { name: "mcp-smoke-results", description: "Per-tool smoke test results", contentType: "application/json" },
    { name: "mcp-tool-matrix", description: "Pass/fail matrix for all 13 tools", contentType: "application/json" },
  ],
  coversTools: [
    "current_scope",
    "compress_context",
    "retrieve_original",
    "delete_original",
    "cleanup_originals",
    "list_compressions",
    "remember_context",
    "recall_context",
    "forget_context",
    "list_context",
    "analyze_context",
    "list_failures",
    "failure_stats",
  ],
  tags: ["smoke", "mcp", "acceptance"],
  capability: "smoke-test",
};
