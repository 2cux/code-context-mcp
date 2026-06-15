/**
 * MCP Tools Smoke Manifest
 *
 * Declares the MCP tools smoke test: every MCP tool must respond
 * without crashing.
 *
 * PRD §34: MCP tools 验收 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const mcpToolsSmokeFlowManifest: HarnessManifest = {
  id: "mcp-tools-smoke-flow",
  name: "MCP Tools Smoke Flow",
  description:
    "Smoke test for all 13 MCP tools — every tool must respond without crashing",
  phases: [
    { name: "compression_tools", description: "Smoke test compression-related MCP tools" },
    { name: "memory_tools", description: "Smoke test memory-related MCP tools" },
    { name: "utility_tools", description: "Smoke test utility MCP tools" },
  ],
  checkpoints: [
    { name: "mcp:current_scope", description: "Call current_scope tool", expect: "pass" },
    { name: "mcp:compress_context", description: "Call compress_context tool", expect: "pass" },
    { name: "mcp:retrieve_original", description: "Call retrieve_original tool", expect: "pass" },
    { name: "mcp:delete_original", description: "Call delete_original tool", expect: "pass" },
    { name: "mcp:list_compressions", description: "Call list_compressions tool", expect: "pass" },
    { name: "mcp:remember_context", description: "Call remember_context tool", expect: "pass" },
    { name: "mcp:recall_context", description: "Call recall_context tool", expect: "pass" },
    { name: "mcp:forget_context", description: "Call forget_context tool", expect: "pass" },
    { name: "mcp:list_context", description: "Call list_context tool", expect: "pass" },
    { name: "mcp:analyze_context", description: "Call analyze_context tool", expect: "pass" },
    { name: "mcp:cleanup_originals", description: "Call cleanup_originals tool", expect: "pass" },
    { name: "mcp:list_failures", description: "Call list_failures tool", expect: "pass" },
    { name: "mcp:failure_stats", description: "Call failure_stats tool", expect: "pass" },
  ],
  artifacts: [
    { name: "mcp-smoke-results", description: "Per-tool smoke test results", contentType: "application/json" },
  ],
  coversTools: [
    "current_scope",
    "compress_context",
    "retrieve_original",
    "delete_original",
    "list_compressions",
    "remember_context",
    "recall_context",
    "forget_context",
    "list_context",
    "analyze_context",
    "cleanup_originals",
    "list_failures",
    "failure_stats",
    "get_receipt",
  ],
  tags: ["smoke", "mcp", "acceptance"],
  capability: "smoke-test",
};
