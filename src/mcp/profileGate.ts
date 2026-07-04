/**
 * Profile Gate — CodeGraph MCP Tool Surface
 *
 * Controls which CodeGraph MCP tools are exposed per profile.
 * Four profiles enforce the Fast MCP Path / Harness Workflow Path boundary:
 *
 *   agent   — 6 fast direct MCP tools. Default for AI coding agents.
 *   full    — all non-harness tools (currently same 6 fast tools).
 *   harness — 4 harness workflow/report/audit/debug tools only.
 *   debug   — full ∪ harness (all 10 tools).
 *
 * Set via CODEGRAPH_PROFILE env var. Defaults to "agent".
 *
 * Design constraint (§02):
 *   Fast MCP tools must not route through HarnessRunner by default.
 *   Harness is for workflow/report/audit/debug, not the default
 *   execution layer for agent tools.
 */

// ---------------------------------------------------------------------------
// Tool category definitions
// ---------------------------------------------------------------------------

/**
 * Fast MCP tools — direct dispatch, no HarnessRunner.
 * These are the tools AI coding agents use at high frequency.
 * Must remain fast path (<200ms p95).
 */
const FAST_TOOLS: ReadonlySet<string> = new Set([
  "codegraph_repo_status",
  "codegraph_find",
  "codegraph_explain",
  "codegraph_pre_edit_check",
  "codegraph_coverage_gaps",
  "codegraph_build_context_pack",
]);

/**
 * Harness-only tools — workflow/report/audit/debug.
 * These tools route through the HarnessRunner pipeline.
 * NEVER exposed in agent or full profile.
 */
const HARNESS_TOOLS: ReadonlySet<string> = new Set([
  "codegraph_harness_list",
  "codegraph_harness_run",
  "codegraph_harness_status",
  "codegraph_harness_artifacts",
]);

/** All known CodeGraph MCP tools (fast + harness). */
const ALL_CODEGRAPH_TOOLS: ReadonlySet<string> = new Set([
  ...FAST_TOOLS,
  ...HARNESS_TOOLS,
]);

// ---------------------------------------------------------------------------
// Profile type
// ---------------------------------------------------------------------------

export type CodeGraphProfile = "agent" | "full" | "harness" | "debug";

const VALID_PROFILES: ReadonlySet<string> = new Set([
  "agent",
  "full",
  "harness",
  "debug",
]);

// ---------------------------------------------------------------------------
// Profile resolution
// ---------------------------------------------------------------------------

/** Resolve CodeGraph profile from env or default to agent. */
export function resolveCodeGraphProfile(): CodeGraphProfile {
  const raw = (process.env["CODEGRAPH_PROFILE"] ?? "").trim().toLowerCase();
  if (VALID_PROFILES.has(raw)) return raw as CodeGraphProfile;
  return "agent";
}

// ---------------------------------------------------------------------------
// Profile → tool set
// ---------------------------------------------------------------------------

/**
 * Return the set of tool names allowed for a given profile.
 *
 * Profile rules:
 *   agent   = fast tools only (6)
 *   full    = all non-harness tools (currently = fast tools, 6)
 *   harness = harness tools only (4)
 *   debug   = full ∪ harness (all 10)
 */
export function getAllowedCodeGraphTools(
  profile: CodeGraphProfile,
): ReadonlySet<string> {
  switch (profile) {
    case "agent":
      return new Set(FAST_TOOLS);
    case "full":
      // All non-harness tools = fast tools only
      return new Set(FAST_TOOLS);
    case "harness":
      return new Set(HARNESS_TOOLS);
    case "debug":
      return new Set(ALL_CODEGRAPH_TOOLS);
  }
}

/** Check whether a specific tool name is allowed in the given profile. */
export function isCodeGraphToolAllowed(
  toolName: string,
  profile: CodeGraphProfile,
): boolean {
  return getAllowedCodeGraphTools(profile).has(toolName);
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

/** Human-readable description for each profile. */
export function describeCodeGraphProfile(profile: CodeGraphProfile): string {
  switch (profile) {
    case "agent":
      return "Agent profile — 6 fast direct MCP tools. Default for AI coding agents. No harness tools.";
    case "full":
      return "Full profile — all non-harness tools. Harness tools remain excluded.";
    case "harness":
      return "Harness profile — 4 harness workflow/report/audit/debug tools only.";
    case "debug":
      return "Debug profile — full ∪ harness. All 10 tools. Development and CI use.";
  }
}

/** Get the list of harness tools (for boundary assertions). */
export function getHarnessTools(): readonly string[] {
  return [...HARNESS_TOOLS];
}

/** Get the list of fast tools (for boundary assertions). */
export function getFastTools(): readonly string[] {
  return [...FAST_TOOLS];
}

/** Get all known CodeGraph tools (for completeness assertions). */
export function getAllCodeGraphTools(): readonly string[] {
  return [...ALL_CODEGRAPH_TOOLS];
}

// ---------------------------------------------------------------------------
// Re-export for convenience (shared tool name constants)
// ---------------------------------------------------------------------------

export { FAST_TOOLS, HARNESS_TOOLS, ALL_CODEGRAPH_TOOLS };
