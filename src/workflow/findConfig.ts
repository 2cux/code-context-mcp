/**
 * workflow.find — Behavior Contract & Default Configuration
 *
 * This module defines the AUTHORITATIVE default behavior for workflow.find.
 * It serves as the specification that the CodeGraph MCP implementation
 * must satisfy.
 *
 * Core principle:
 *   workflow.find must default to compact mode (include_details=false,
 *   format=compact). Per-result get_symbol() enrichment is opt-in only.
 *   Heavy markdown report generation is opt-in only.
 *
 * Performance justification (observed baseline):
 *   Direct MCP p95                    ≈  185ms
 *   Harness MCP p95                   ≈ 5787ms
 *   workflow.find default p95         ≈ 7194ms
 *   Details enrichment (get_symbol)   ≈  77% of workflow.find total
 *   Harness persistence               < 100ms (NOT the bottleneck)
 *
 * With limit=5 + include_details=true, each get_symbol() costs ~1100ms,
 * totaling ~5500ms for enrichment alone.  This is the root cause of
 * the 7194ms p95, not HarnessRunner overhead.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowFindFormat = "compact" | "report";

export interface WorkflowFindInput {
  /** Search query string (required). */
  query: string;
  /** Maximum results to return. Default: 5. */
  limit?: number;
  /** Whether to enrich each result with get_symbol(). Default: false. */
  include_details?: boolean;
  /** Response format. Default: "compact". */
  format?: WorkflowFindFormat;
  /** Generate heavy markdown report. Default: false (only with format="report" + include_details=true). */
  generate_report?: boolean;
}

export interface WorkflowFindExpectedBehavior {
  /** Whether get_symbol() is called per result. */
  callsGetSymbol: boolean;
  /** Maximum number of get_symbol() calls (0 if callsGetSymbol=false). */
  maxGetSymbolCalls: number;
  /** Whether a heavy markdown report is generated. */
  generatesHeavyMarkdownReport: boolean;
  /** Response style classification. */
  responseStyle: "compact" | "detailed";
  /** Classification label. */
  classification: "default-fast-workflow" | "explicit-heavy-workflow";
  /** Estimated enrichment cost in ms (0 for compact). */
  estimatedEnrichmentCostMs: number;
}

// ---------------------------------------------------------------------------
// Default constants
// ---------------------------------------------------------------------------

/** Default limit when not specified. */
export const DEFAULT_LIMIT = 5;

/** Default include_details — FALSE. Details enrichment is opt-in. */
export const DEFAULT_INCLUDE_DETAILS = false;

/** Default format — "compact". No heavy markdown report. */
export const DEFAULT_FORMAT: WorkflowFindFormat = "compact";

/** Estimated cost of a single get_symbol() call in ms. */
export const ESTIMATED_GET_SYMBOL_COST_MS = 1100;

/** Estimated cost when include_details=true (5 results × 1100ms). */
export const ESTIMATED_FULL_ENRICHMENT_COST_MS = 5500;

// ---------------------------------------------------------------------------
// Baseline measurements (from performance reports)
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  directMcpP95Ms: number;
  harnessMcpP95Ms: number;
  workflowFindDefaultP95Ms: number;
  harnessPersistenceMs: number;
  detailsEnrichmentCostRatio: number;
}

export const BASELINE_COST_BREAKDOWN: CostBreakdown = {
  directMcpP95Ms: 185,
  harnessMcpP95Ms: 5787,
  workflowFindDefaultP95Ms: 7194,
  harnessPersistenceMs: 100,
  detailsEnrichmentCostRatio: 0.77,
};

// ---------------------------------------------------------------------------
// Interpretation (derived from baseline)
// ---------------------------------------------------------------------------

export interface CostInterpretation {
  harnessPersistenceIsPrimaryCause: boolean;
  detailsEnrichmentIsPrimaryCause: boolean;
  ordinaryAgentToolsShouldUseHarness: boolean;
  workflowFindShouldDefaultCompact: boolean;
}

export function interpretCostBreakdown(
  breakdown: CostBreakdown = BASELINE_COST_BREAKDOWN,
): CostInterpretation {
  const enrichmentCost =
    breakdown.workflowFindDefaultP95Ms - breakdown.directMcpP95Ms;
  const enrichmentRatio = enrichmentCost / breakdown.workflowFindDefaultP95Ms;

  return {
    harnessPersistenceIsPrimaryCause:
      breakdown.harnessPersistenceMs > enrichmentCost,
    detailsEnrichmentIsPrimaryCause:
      enrichmentRatio > 0.5,
    ordinaryAgentToolsShouldUseHarness: false,
    workflowFindShouldDefaultCompact: true,
  };
}

// ---------------------------------------------------------------------------
// Behavior resolver — given input, what behavior is expected?
// ---------------------------------------------------------------------------

/**
 * Resolve the effective input by applying defaults.
 *
 * This is the single function that enforces compact-by-default behavior.
 * All callers of workflow.find (MCP, Harness, CLI) should use this to
 * normalize their input before dispatching.
 */
export function resolveFindInput(
  raw: Partial<WorkflowFindInput>,
): Required<WorkflowFindInput> {
  return {
    query: raw.query ?? "",
    limit: raw.limit ?? DEFAULT_LIMIT,
    include_details: raw.include_details ?? DEFAULT_INCLUDE_DETAILS,
    format: raw.format ?? DEFAULT_FORMAT,
    generate_report: raw.generate_report ?? false,
  };
}

/**
 * Given a resolved input, compute the expected behavior.
 *
 * Rules:
 *   1. include_details=false → compact mode
 *      - callsGetSymbol = false
 *      - maxGetSymbolCalls = 0
 *      - generatesHeavyMarkdownReport = false
 *      - responseStyle = "compact"
 *      - estimatedEnrichmentCostMs = 0
 *
 *   2. include_details=true → details mode
 *      - callsGetSymbol = true
 *      - maxGetSymbolCalls = limit
 *      - generatesHeavyMarkdownReport = (format === "report")
 *      - responseStyle = "detailed"
 *      - estimatedEnrichmentCostMs = limit × 1100ms
 */
export function expectedBehavior(
  input: Required<WorkflowFindInput>,
): WorkflowFindExpectedBehavior {
  const enrichment =
    input.include_details && input.limit > 0;

  return {
    callsGetSymbol: enrichment,
    maxGetSymbolCalls: enrichment ? input.limit : 0,
    generatesHeavyMarkdownReport:
      enrichment && input.format === "report",
    responseStyle: enrichment ? "detailed" : "compact",
    classification: enrichment
      ? "explicit-heavy-workflow"
      : "default-fast-workflow",
    estimatedEnrichmentCostMs: enrichment
      ? input.limit * ESTIMATED_GET_SYMBOL_COST_MS
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if this input represents the DEFAULT fast path
 * (include_details=false, format=compact).
 */
export function isDefaultCompactPath(
  input: Required<WorkflowFindInput>,
): boolean {
  return !input.include_details && input.format === "compact";
}

/**
 * Returns true if this input represents the EXPLICIT details path
 * (include_details=true).
 */
export function isExplicitDetailsPath(
  input: Required<WorkflowFindInput>,
): boolean {
  return input.include_details === true;
}
