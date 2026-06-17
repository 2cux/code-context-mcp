/**
 * MCP Tool Surface Mode
 *
 * Controls which tools are exposed to the MCP client.
 * Three modes defined based on usability evaluation results
 * (see reports/usability/agent-usability-report.json):
 *
 *   agent  — 7 tools. Minimal safe surface for AI coding agents.
 *   dev    — 17 tools. Full inspection + debug (no dangerous tools).
 *   test   — 18 tools. All registered tools for schema/smoke/harness tests.
 *
 * Set via MCP_TOOL_MODE env var. Defaults to "agent".
 */

export type ToolMode = "agent" | "dev" | "test";

const VALID_MODES: ReadonlySet<string> = new Set(["agent", "dev", "test"]);

/** Resolve mode from env or default to agent. */
export function resolveToolMode(): ToolMode {
  const raw = (process.env["MCP_TOOL_MODE"] ?? "").trim().toLowerCase();
  if (VALID_MODES.has(raw)) return raw as ToolMode;
  return "agent";
}

/**
 * Mode definitions.
 *
 * Agent mode (7 tools):
 *   Based on usability evaluation: 95% score, zero safety risk.
 *   Covers compression, retrieval, memory lifecycle, and unified flow.
 *   Excludes: harness, dangerous, failure-analysis, list/browse tools.
 */
const AGENT_TOOLS: ReadonlySet<string> = new Set([
  "current_scope",
  "compress_context",
  "retrieve_original",
  "remember_context",
  "recall_context",
  "forget_context",
  "run_context_flow",
]);

/**
 * Dev mode (18 tools):
 *   All registered tools. Full inspection, debug, and maintenance access.
 *   Includes dangerous tools (delete_original, cleanup_originals) for
 *   developers who need to manage originals during debugging.
 */
const DEV_TOOLS: ReadonlySet<string> = new Set([
  ...AGENT_TOOLS,
  "list_context",
  "list_compressions",
  "analyze_context",
  "list_failures",
  "failure_stats",
  "list_harness_flows",
  "run_harness_flow",
  "get_harness_run",
  "check_harness_flow",
  "delete_original",
  "cleanup_originals",
]);

/** Test mode: ALL 18 tools, no restrictions. */
function isTestModeTool(_name: string): boolean {
  return true;
}

/** Return the set of tool names allowed for a given mode. */
export function getAllowedTools(mode: ToolMode): ReadonlySet<string> {
  switch (mode) {
    case "agent": return AGENT_TOOLS;
    case "dev":   return DEV_TOOLS;
    case "test":  // fall through — all tools allowed, check dynamically
    default:      return { has: isTestModeTool } as unknown as ReadonlySet<string>;
  }
}

/** Check whether a specific tool name is allowed in the given mode. */
export function isToolAllowed(toolName: string, mode: ToolMode): boolean {
  return getAllowedTools(mode).has(toolName);
}

/** Human-readable description for each mode. */
export function describeMode(mode: ToolMode): string {
  switch (mode) {
    case "agent": return "Agent mode — 7 tools, safe defaults for AI coding agents.";
    case "dev":   return "Dev mode — 17 tools, full inspection and debug, no destructive operations.";
    case "test":  return "Test mode — 18 tools, all registered MCP tools for schema/smoke/harness testing.";
  }
}

/** Get the list of dangerous tools (never in agent or dev mode). */
export function getDangerousTools(): string[] {
  return ["delete_original", "cleanup_originals"];
}
