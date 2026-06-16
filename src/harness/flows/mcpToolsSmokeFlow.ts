/**
 * MCP Tools Smoke Flow
 *
 * Smoke test for all 13 MCP tools:
 *   current_scope → compress_context → retrieve_original → delete_original →
 *   cleanup_originals → list_compressions → remember_context → recall_context →
 *   forget_context → list_context → analyze_context → list_failures → failure_stats
 *
 * Ensures every MCP tool responds with valid structured output and no
 * unhandled errors.
 *
 * PRD §34 / §9.6: MCP tools 验收。
 */

import type { HarnessContext } from "../core/types.js";
import type { McpAdapter } from "../adapters/mcpAdapter.js";

// ── Input Types ────────────────────────────────────────────────────────────────

export interface McpToolsSmokeFlowInput {
  adapter: McpAdapter;
}

// ── Output Types ───────────────────────────────────────────────────────────────

export interface ToolResult {
  toolName: string;
  checkpoint: string;
  passed: boolean;
  isError: boolean;
  hasOutput: boolean;
  error?: string;
}

export interface McpToolsSmokeFlowOutput {
  totalTools: number;
  passed: number;
  failed: number;
  errors: number;
  results: ToolResult[];
}

// ── Tool Definitions ───────────────────────────────────────────────────────────

interface ToolDef {
  toolName: string;
  checkpoint: string;
  args: Record<string, unknown>;
}

const ALL_TOOLS: ToolDef[] = [
  { toolName: "current_scope", checkpoint: "mcp:current_scope", args: {} },
  { toolName: "compress_context", checkpoint: "mcp:compress_context", args: { content: "test content for smoke test", contentType: "plain_text" } },
  { toolName: "retrieve_original", checkpoint: "mcp:retrieve_original", args: { ccrId: "ccr_smoke_test_nonexistent" } },
  { toolName: "delete_original", checkpoint: "mcp:delete_original", args: { ccrId: "ccr_smoke_test_nonexistent" } },
  { toolName: "cleanup_originals", checkpoint: "mcp:cleanup_originals", args: {} },
  { toolName: "list_compressions", checkpoint: "mcp:list_compressions", args: { limit: 5 } },
  { toolName: "remember_context", checkpoint: "mcp:remember_context", args: { content: "smoke test memory", type: "project_rule" } },
  { toolName: "recall_context", checkpoint: "mcp:recall_context", args: { query: "smoke test", limit: 5 } },
  { toolName: "forget_context", checkpoint: "mcp:forget_context", args: { id: "mem_smoke_test_nonexistent", mode: "soft_forget" } },
  { toolName: "list_context", checkpoint: "mcp:list_context", args: { limit: 5 } },
  { toolName: "analyze_context", checkpoint: "mcp:analyze_context", args: { content: "test content for analysis" } },
  { toolName: "list_failures", checkpoint: "mcp:list_failures", args: { limit: 5 } },
  { toolName: "failure_stats", checkpoint: "mcp:failure_stats", args: {} },
];

// ── Flow Implementation ────────────────────────────────────────────────────────

export async function mcpToolsSmokeFlow(
  ctx: HarnessContext<McpToolsSmokeFlowInput>,
): Promise<McpToolsSmokeFlowOutput> {
  const { adapter } = ctx.input;
  const results: ToolResult[] = [];

  // ── Phase 1: call_each_tool_with_minimal_valid_input ─────────────────────────

  ctx.phase("call_each_tool_with_minimal_valid_input");
  ctx.log(`Calling all ${ALL_TOOLS.length} MCP tools with minimal valid input...`);

  for (const tool of ALL_TOOLS) {
    ctx.log(`Calling ${tool.toolName}...`);

    try {
      const result = await adapter.callTool(tool.toolName, tool.args);

      const passed = !result.isError;
      const hasOutput = result.content != null && result.content.length > 0;

      ctx.checkpoint(
        tool.checkpoint,
        passed ? "pass" : "fail",
        `hasOutput=${hasOutput} isError=${result.isError}`,
      );

      results.push({
        toolName: tool.toolName,
        checkpoint: tool.checkpoint,
        passed,
        isError: result.isError,
        hasOutput,
        error: result.isError ? `Tool returned isError=true` : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      ctx.checkpoint(
        tool.checkpoint,
        "fail",
        `error: ${msg}`,
      );

      results.push({
        toolName: tool.toolName,
        checkpoint: tool.checkpoint,
        passed: false,
        isError: true,
        hasOutput: false,
        error: msg,
      });
    }
  }

  // ── Phase 2: verify_no_unhandled_error ──────────────────────────────────────

  ctx.phase("verify_no_unhandled_error");

  const errors = results.filter((r) => r.isError || !r.passed);
  ctx.log(`Tools with errors: ${errors.length}/${ALL_TOOLS.length}`);

  for (const err of errors) {
    ctx.log(`  [${err.toolName}] ${err.error ?? "unknown error"}`);
  }

  // ── Phase 3: verify_structured_output ───────────────────────────────────────

  ctx.phase("verify_structured_output");

  const hasOutputCount = results.filter((r) => r.hasOutput).length;
  ctx.log(`Tools with output: ${hasOutputCount}/${ALL_TOOLS.length}`);

  // ── Phase 4: write_tool_matrix ───────────────────────────────────────────────

  ctx.phase("write_tool_matrix");

  const totalTools = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const errorCount = results.filter((r) => r.isError).length;

  const output: McpToolsSmokeFlowOutput = {
    totalTools,
    passed,
    failed,
    errors: errorCount,
    results,
  };

  ctx.writeArtifact(
    "mcp-smoke-results",
    JSON.stringify(results, null, 2),
    "application/json",
  );
  ctx.writeArtifact(
    "mcp-tool-matrix",
    JSON.stringify(output, null, 2),
    "application/json",
  );

  ctx.log(`MCP tools smoke complete: ${passed}/${totalTools} passed, ${errorCount} errors`);
  return output;
}
