/**
 * analyze_context MCP tool handler — PRD §32.4
 *
 * Analyses provided content and/or query to recommend context management
 * actions. Returns structured decisions (shouldCompress, shouldRecall,
 * shouldSaveMemory, shouldRetrieveOriginal) with confidence scores,
 * human-readable reasons, and suggested next tools.
 *
 * This tool is READ-ONLY: it does not modify any state, does not
 * auto-invoke any other tool, and does not require a scopeId.
 *
 * Pipeline:
 *   1. Validate inputs (at least one of content or query required).
 *   2. Run analyzeContext() from the intelligence module.
 *   3. Return the AnalysisResult as JSON.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { analyzeContext, type ContextInput } from "../../intelligence/contextDecision.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CONTENT_TYPES = new Set<string>([
  "test_output",
  "log",
  "command_output",
  "code",
  "json",
  "markdown",
  "plain_text",
  "rag_chunk",
  "file_summary",
  "conversation_history",
  "unknown",
]);

const MAX_CONTENT_LENGTH = 1_000_000; // 1MB — practical limit for analysis
const MAX_QUERY_LENGTH = 5000;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleAnalyzeContext(
  _ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const warnings: string[] = [];

  // ---- Validate inputs ----

  const contentRaw = typeof args.content === "string" ? args.content : "";
  const queryRaw = typeof args.query === "string" ? args.query.trim() : "";

  if (!contentRaw && !queryRaw) {
    return {
      content: [
        {
          type: "text",
          text: "Error: At least one of 'content' or 'query' is required.",
        },
      ],
      isError: true,
    };
  }

  // Truncate oversized content for analysis (analysis is cheap; no need to
  // analyze every byte to get a good recommendation)
  let content = contentRaw;
  if (contentRaw.length > MAX_CONTENT_LENGTH) {
    content = contentRaw.slice(0, MAX_CONTENT_LENGTH);
    warnings.push(
      `Content truncated from ${contentRaw.length} to ${MAX_CONTENT_LENGTH} chars for analysis.`,
    );
  }

  if (queryRaw.length > MAX_QUERY_LENGTH) {
    return {
      content: [
        {
          type: "text",
          text: `Error: query exceeds maximum length of ${MAX_QUERY_LENGTH} characters (got ${queryRaw.length}).`,
        },
      ],
      isError: true,
    };
  }

  // ---- Validate contentType ----

  const contentTypeRaw = typeof args.contentType === "string"
    ? args.contentType
    : undefined;

  if (contentTypeRaw !== undefined && !VALID_CONTENT_TYPES.has(contentTypeRaw)) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Invalid contentType "${contentTypeRaw}". Valid values: ${Array.from(VALID_CONTENT_TYPES).join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  // ---- Validate source ----

  const source = typeof args.source === "string" ? args.source : undefined;

  if (source !== undefined && source.length > 200) {
    return {
      content: [
        {
          type: "text",
          text: "Error: 'source' must be at most 200 characters.",
        },
      ],
      isError: true,
    };
  }

  // ---- Validate metadata ----

  const metadata: Record<string, unknown> | undefined =
    typeof args.metadata === "object" && args.metadata !== null
      ? (args.metadata as Record<string, unknown>)
      : undefined;

  // ---- Build input and run analysis ----

  const input: ContextInput = {
    content,
    query: queryRaw,
    contentType: contentTypeRaw,
    source,
    metadata,
  };

  const result = analyzeContext(input);

  // ---- Build response ----

  const response: Record<string, unknown> = {
    shouldCompress: result.shouldCompress,
    shouldRecall: result.shouldRecall,
    shouldSaveMemory: result.shouldSaveMemory,
    shouldRetrieveOriginal: result.shouldRetrieveOriginal,
    suggestedTools: result.suggestedTools,
    reasons: result.reasons,
    stats: result.stats,
  };

  if (warnings.length > 0) {
    response.warnings = warnings;
  }

  // Add a clear disclaimer per §32.5
  response._note =
    "These are suggestions only. The agent decides which tools to invoke. No actions were performed automatically.";

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
