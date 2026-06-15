/**
 * MCP Adapter
 *
 * Provides a programmatic interface for calling MCP tools directly
 * (bypassing the stdio transport). Used by the MCP tools smoke flow
 * to invoke each tool handler and capture results.
 *
 * PRD §34: MCP tools 验收适配器。
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface McpCallResult {
  toolName: string;
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
}

export interface McpAdapter {
  /** Call a named MCP tool with the given arguments. */
  callTool(toolName: string, args: Record<string, unknown>): Promise<McpCallResult>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an MCP adapter backed by the real tool handlers.
 * Stub: returns a placeholder that throws on every call.
 * Real implementation will import handlers from src/mcp/tools/.
 */
export function createMcpAdapter(): McpAdapter {
  return {
    async callTool(toolName: string, _args: Record<string, unknown>): Promise<McpCallResult> {
      throw new Error(`McpAdapter.callTool("${toolName}") is not yet implemented.`);
    },
  };
}
