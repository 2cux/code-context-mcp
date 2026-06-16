/**
 * MCP Tool Handler Registry
 *
 * Shared registry of all registered MCP tool handlers.
 * Both the MCP server (server.ts) and the real MCP adapter (mcpAdapter.ts)
 * use this to create a tool-name → handler map without duplicating
 * handler imports or relying on dynamic imports.
 *
 * Two handler signatures:
 *   - ctx-bound  (16 tools): (args) => handler(ctx, args)
 *   - ctx-less   (2 tools):  (args) => handler(args)
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "./server.js";

// ── 18 handler imports ─────────────────────────────────────────────────────────
import { handleCurrentScope } from "./tools/currentScope.js";
import { handleCompressContext } from "./tools/compressContext.js";
import { handleListCompressions } from "./tools/listCompressions.js";
import { handleRetrieveOriginal } from "./tools/retrieveOriginal.js";
import { handleDeleteOriginal } from "./tools/deleteOriginal.js";
import { handleCleanupOriginals } from "./tools/cleanupOriginals.js";
import { handleRememberContext } from "./tools/rememberContext.js";
import { handleRecallContext } from "./tools/recallContext.js";
import { handleForgetContext } from "./tools/forgetContext.js";
import { handleListContext } from "./tools/listContext.js";
import { handleAnalyzeContext } from "./tools/analyzeContext.js";
import { handleListFailures } from "./tools/listFailures.js";
import { handleFailureStats } from "./tools/failureStats.js";
import { handleListHarnessFlows } from "./tools/listHarnessFlows.js";
import { handleRunHarnessFlow } from "./tools/runHarnessFlow.js";
import { handleGetHarnessRun } from "./tools/getHarnessRun.js";
import { handleCheckHarnessFlow } from "./tools/checkHarnessFlow.js";
import { handleRunContextFlow } from "./tools/runContextFlow.js";

// ── Type ───────────────────────────────────────────────────────────────────────

export type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

// ── Factory ─────────────────────────────────────────────────────────────────────

/**
 * Create a map of all 18 registered MCP tool handlers.
 *
 * @param ctx - ServerContext with db and receipts.
 *              For ctx-less tools (list_harness_flows, check_harness_flow),
 *              ctx is unused but passed for API uniformity.
 */
export function createToolHandlers(ctx: ServerContext): Record<string, ToolHandler> {
  return {
    // Agent-facing
    run_context_flow: (args) => handleRunContextFlow(ctx, args),
    current_scope: (args) => handleCurrentScope(ctx, args),

    // Compression
    compress_context: (args) => handleCompressContext(ctx, args),
    retrieve_original: (args) => handleRetrieveOriginal(ctx, args),
    delete_original: (args) => handleDeleteOriginal(ctx, args),
    cleanup_originals: (args) => handleCleanupOriginals(ctx, args),
    list_compressions: (args) => handleListCompressions(ctx, args),

    // Memory
    remember_context: (args) => handleRememberContext(ctx, args),
    recall_context: (args) => handleRecallContext(ctx, args),
    forget_context: (args) => handleForgetContext(ctx, args),
    list_context: (args) => handleListContext(ctx, args),

    // Analysis & Failure
    analyze_context: (args) => handleAnalyzeContext(ctx, args),
    list_failures: (args) => handleListFailures(ctx, args),
    failure_stats: (args) => handleFailureStats(ctx, args),

    // Harness (ctx-less: only need HarnessRegistry, not DB)
    list_harness_flows: (args) => handleListHarnessFlows(args),
    check_harness_flow: (args) => handleCheckHarnessFlow(args),

    // Harness (ctx-bound: need DB + receipts for run state)
    run_harness_flow: (args) => handleRunHarnessFlow(ctx, args),
    get_harness_run: (args) => handleGetHarnessRun(ctx, args),
  };
}

/** Set of tool names for convenience (e.g., adapter dispatch). */
export const ALL_TOOL_NAMES: ReadonlyArray<string> = [
  "run_context_flow",
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
  "list_harness_flows",
  "check_harness_flow",
  "run_harness_flow",
  "get_harness_run",
];
