/**
 * MCP Tools Smoke Manifest
 *
 * Declares the MCP tools smoke test: every MCP tool must respond
 * without crashing.
 *
 * PRD §34: MCP tools 验收 Manifest。
 */

import type { Manifest } from "../core/types.js";

export const mcpToolsSmokeFlowManifest: Manifest = {
  name: "mcpToolsSmokeFlow",
  description: "Smoke test for all 13 MCP tools — every tool must respond without crashing",
  loopType: "mcpToolsSmoke",
  tags: ["mcp", "smoke", "closed-loop"],
  steps: [
    { name: "current_scope", description: "Call current_scope tool", expect: "success" },
    { name: "compress_context", description: "Call compress_context tool with each content type", expect: "success" },
    { name: "retrieve_original", description: "Call retrieve_original tool", expect: "success" },
    { name: "delete_original", description: "Call delete_original tool", expect: "success" },
    { name: "list_compressions", description: "Call list_compressions tool", expect: "success" },
    { name: "remember_context", description: "Call remember_context tool", expect: "success" },
    { name: "recall_context", description: "Call recall_context tool", expect: "success" },
    { name: "forget_context", description: "Call forget_context tool", expect: "success" },
    { name: "list_context", description: "Call list_context tool", expect: "success" },
    { name: "analyze_context", description: "Call analyze_context tool", expect: "success" },
    { name: "cleanup_originals", description: "Call cleanup_originals tool", expect: "success" },
    { name: "list_failures", description: "Call list_failures tool", expect: "success" },
    { name: "failure_stats", description: "Call failure_stats tool", expect: "success" },
  ],
};
