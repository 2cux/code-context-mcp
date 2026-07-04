/**
 * workflow.find Compact Default — Behavior Contract Tests — Phase 04
 *
 * Validates that workflow.find defaults to compact mode:
 *   - include_details=false by default
 *   - format=compact by default
 *   - No per-result get_symbol() enrichment by default
 *   - Only include_details=true triggers enrichment
 *   - limit=5 + include_details=false → 0 enrichment calls
 *   - limit=5 + include_details=true → ≤5 enrichment calls
 *   - Compact mode → no heavy markdown report
 *   - Details/report mode → markdown report allowed
 *
 * The test validates the behavior CONTRACT defined in src/workflow/findConfig.ts.
 * Actual CodeGraph MCP implementation is in a separate repository; this module
 * serves as the authoritative specification.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

import {
  resolveFindInput,
  expectedBehavior,
  interpretCostBreakdown,
  isDefaultCompactPath,
  isExplicitDetailsPath,
  BASELINE_COST_BREAKDOWN,
  DEFAULT_INCLUDE_DETAILS,
  DEFAULT_FORMAT,
  DEFAULT_LIMIT,
  ESTIMATED_GET_SYMBOL_COST_MS,
  ESTIMATED_FULL_ENRICHMENT_COST_MS,
} from "../src/workflow/findConfig.js";
import type {
  WorkflowFindInput,
  WorkflowFindExpectedBehavior,
} from "../src/workflow/findConfig.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "fast-path-harness-boundary",
);

function readJsonFixture(relativePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.join(FIXTURES_DIR, relativePath),
    "utf-8",
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

// ============================================================================
// 1. Default parameter behavior
// ============================================================================

describe("workflow.find — default parameters", () => {
  it("include_details defaults to false", () => {
    expect(DEFAULT_INCLUDE_DETAILS).toBe(false);
  });

  it("format defaults to 'compact'", () => {
    expect(DEFAULT_FORMAT).toBe("compact");
  });

  it("limit defaults to 5", () => {
    expect(DEFAULT_LIMIT).toBe(5);
  });

  it("resolveFindInput with empty input uses all defaults", () => {
    const resolved = resolveFindInput({ query: "test" });
    expect(resolved.include_details).toBe(false);
    expect(resolved.format).toBe("compact");
    expect(resolved.limit).toBe(5);
    expect(resolved.generate_report).toBe(false);
  });

  it("resolveFindInput preserves explicit values", () => {
    const resolved = resolveFindInput({
      query: "handler",
      limit: 10,
      include_details: true,
      format: "report",
      generate_report: true,
    });
    expect(resolved.query).toBe("handler");
    expect(resolved.limit).toBe(10);
    expect(resolved.include_details).toBe(true);
    expect(resolved.format).toBe("report");
    expect(resolved.generate_report).toBe(true);
  });

  it("resolveFindInput only overrides undefined fields", () => {
    const resolved = resolveFindInput({
      query: "test",
      limit: 3,
      // include_details not set → should default to false
      // format not set → should default to "compact"
    });
    expect(resolved.limit).toBe(3);
    expect(resolved.include_details).toBe(false);
    expect(resolved.format).toBe("compact");
  });
});

// ============================================================================
// 2. Compact mode behavior (default)
// ============================================================================

describe("workflow.find — compact mode (default)", () => {
  const compactInput = resolveFindInput({
    query: "handler",
    limit: 5,
  });
  // verify defaults applied
  expect(compactInput.include_details).toBe(false);
  expect(compactInput.format).toBe("compact");

  const behavior = expectedBehavior(compactInput);

  it("does NOT call get_symbol", () => {
    expect(behavior.callsGetSymbol).toBe(false);
  });

  it("maxGetSymbolCalls = 0", () => {
    expect(behavior.maxGetSymbolCalls).toBe(0);
  });

  it("does NOT generate heavy markdown report", () => {
    expect(behavior.generatesHeavyMarkdownReport).toBe(false);
  });

  it("responseStyle = 'compact'", () => {
    expect(behavior.responseStyle).toBe("compact");
  });

  it("classification = 'default-fast-workflow'", () => {
    expect(behavior.classification).toBe("default-fast-workflow");
  });

  it("estimated enrichment cost = 0ms", () => {
    expect(behavior.estimatedEnrichmentCostMs).toBe(0);
  });

  it("isDefaultCompactPath returns true", () => {
    expect(isDefaultCompactPath(compactInput)).toBe(true);
  });

  it("isExplicitDetailsPath returns false", () => {
    expect(isExplicitDetailsPath(compactInput)).toBe(false);
  });

  it("matches fixture: workflow-find-compact.json", () => {
    const fixture = readJsonFixture("workflow-find/workflow-find-compact.json");
    const input = fixture.input as Record<string, unknown>;
    const expected = fixture.expected as Record<string, unknown>;

    const resolved = resolveFindInput({
      query: input.query as string,
      limit: input.limit as number,
      include_details: input.include_details as boolean,
      format: input.format as WorkflowFindInput["format"],
    });
    const actual = expectedBehavior(resolved);

    expect(actual.callsGetSymbol).toBe(expected.callsGetSymbol);
    expect(actual.generatesHeavyMarkdownReport).toBe(
      expected.generatesHeavyMarkdownReport,
    );
    expect(actual.responseStyle).toBe(expected.responseStyle);
    expect(actual.classification).toBe(expected.classification);
  });
});

// ============================================================================
// 3. Details mode behavior (explicit opt-in)
// ============================================================================

describe("workflow.find — details mode (explicit include_details=true)", () => {
  const detailsInput = resolveFindInput({
    query: "handler",
    limit: 5,
    include_details: true,
    format: "report",
  });

  const behavior = expectedBehavior(detailsInput);

  it("DOES call get_symbol", () => {
    expect(behavior.callsGetSymbol).toBe(true);
  });

  it("maxGetSymbolCalls = limit (5)", () => {
    expect(behavior.maxGetSymbolCalls).toBe(5);
  });

  it("DOES generate heavy markdown report when format='report'", () => {
    expect(behavior.generatesHeavyMarkdownReport).toBe(true);
  });

  it("responseStyle = 'detailed'", () => {
    expect(behavior.responseStyle).toBe("detailed");
  });

  it("classification = 'explicit-heavy-workflow'", () => {
    expect(behavior.classification).toBe("explicit-heavy-workflow");
  });

  it("estimated enrichment cost = 5 × 1100ms = 5500ms", () => {
    expect(behavior.estimatedEnrichmentCostMs).toBe(
      ESTIMATED_FULL_ENRICHMENT_COST_MS,
    );
  });

  it("isDefaultCompactPath returns false", () => {
    expect(isDefaultCompactPath(detailsInput)).toBe(false);
  });

  it("isExplicitDetailsPath returns true", () => {
    expect(isExplicitDetailsPath(detailsInput)).toBe(true);
  });

  it("matches fixture: workflow-find-details.json", () => {
    const fixture = readJsonFixture("workflow-find/workflow-find-details.json");
    const input = fixture.input as Record<string, unknown>;
    const expected = fixture.expected as Record<string, unknown>;

    const resolved = resolveFindInput({
      query: input.query as string,
      limit: input.limit as number,
      include_details: input.include_details as boolean,
      format: input.format as WorkflowFindInput["format"],
    });
    const actual = expectedBehavior(resolved);

    expect(actual.callsGetSymbol).toBe(expected.callsGetSymbol);
    expect(actual.maxGetSymbolCalls).toBe(expected.maxGetSymbolCalls);
    expect(actual.generatesHeavyMarkdownReport).toBe(
      expected.generatesHeavyMarkdownReport,
    );
    expect(actual.responseStyle).toBe(expected.responseStyle);
    expect(actual.classification).toBe(expected.classification);
  });
});

// ============================================================================
// 4. Details mode with compact format (no markdown report)
// ============================================================================

describe("workflow.find — details mode with compact format", () => {
  it("include_details=true + format=compact → enrichment but no markdown report", () => {
    const input = resolveFindInput({
      query: "handler",
      limit: 5,
      include_details: true,
      format: "compact",
    });
    const behavior = expectedBehavior(input);

    expect(behavior.callsGetSymbol).toBe(true);
    expect(behavior.maxGetSymbolCalls).toBe(5);
    // Markdown report only generated when format="report"
    expect(behavior.generatesHeavyMarkdownReport).toBe(false);
    expect(behavior.responseStyle).toBe("detailed");
    expect(behavior.classification).toBe("explicit-heavy-workflow");
    expect(behavior.estimatedEnrichmentCostMs).toBe(5500);
  });
});

// ============================================================================
// 5. Limit variations
// ============================================================================

describe("workflow.find — limit variations", () => {
  it("limit=0 with include_details=false → 0 enrichment calls", () => {
    const input = resolveFindInput({ query: "test", limit: 0 });
    const behavior = expectedBehavior(input);
    expect(behavior.callsGetSymbol).toBe(false);
    expect(behavior.maxGetSymbolCalls).toBe(0);
    expect(behavior.estimatedEnrichmentCostMs).toBe(0);
  });

  it("limit=0 with include_details=true → 0 enrichment calls (nothing to enrich)", () => {
    const input = resolveFindInput({
      query: "test",
      limit: 0,
      include_details: true,
    });
    const behavior = expectedBehavior(input);
    expect(behavior.maxGetSymbolCalls).toBe(0);
    expect(behavior.estimatedEnrichmentCostMs).toBe(0);
  });

  it("limit=1 → enrichment cost = 1100ms", () => {
    const input = resolveFindInput({
      query: "test",
      limit: 1,
      include_details: true,
    });
    const behavior = expectedBehavior(input);
    expect(behavior.maxGetSymbolCalls).toBe(1);
    expect(behavior.estimatedEnrichmentCostMs).toBe(1100);
  });

  it("limit=10 → enrichment cost = 11000ms", () => {
    const input = resolveFindInput({
      query: "test",
      limit: 10,
      include_details: true,
    });
    const behavior = expectedBehavior(input);
    expect(behavior.maxGetSymbolCalls).toBe(10);
    expect(behavior.estimatedEnrichmentCostMs).toBe(11000);
  });
});

// ============================================================================
// 6. Cost breakdown interpretation
// ============================================================================

describe("workflow.find — cost breakdown interpretation", () => {
  it("details enrichment IS the primary cause (not harness persistence)", () => {
    const interpretation = interpretCostBreakdown(BASELINE_COST_BREAKDOWN);
    expect(interpretation.detailsEnrichmentIsPrimaryCause).toBe(true);
    expect(interpretation.harnessPersistenceIsPrimaryCause).toBe(false);
  });

  it("ordinary agent tools should NOT use HarnessRunner", () => {
    const interpretation = interpretCostBreakdown(BASELINE_COST_BREAKDOWN);
    expect(interpretation.ordinaryAgentToolsShouldUseHarness).toBe(false);
  });

  it("workflow.find should default to compact", () => {
    const interpretation = interpretCostBreakdown(BASELINE_COST_BREAKDOWN);
    expect(interpretation.workflowFindShouldDefaultCompact).toBe(true);
  });

  it("harness persistence < 100ms is NOT the bottleneck", () => {
    expect(BASELINE_COST_BREAKDOWN.harnessPersistenceMs).toBeLessThanOrEqual(100);
    // Harness persistence is < 2% of workflow.find total
    const ratio =
      BASELINE_COST_BREAKDOWN.harnessPersistenceMs /
      BASELINE_COST_BREAKDOWN.workflowFindDefaultP95Ms;
    expect(ratio).toBeLessThan(0.02);
  });

  it("details enrichment is ~77% of workflow.find total", () => {
    expect(BASELINE_COST_BREAKDOWN.detailsEnrichmentCostRatio).toBeCloseTo(
      0.77,
      1,
    );
  });

  it("matches fixture: workflow-find-expected-cost-breakdown.json", () => {
    const fixture = readJsonFixture(
      "workflow-find/workflow-find-expected-cost-breakdown.json",
    );
    const baseline = fixture.baselineObservation as Record<string, unknown>;
    const expected = fixture.expectedInterpretation as Record<string, unknown>;

    // Baseline values match
    expect(BASELINE_COST_BREAKDOWN.directMcpP95Ms).toBe(
      baseline.directMcpP95Ms,
    );
    expect(BASELINE_COST_BREAKDOWN.harnessMcpP95Ms).toBe(
      baseline.harnessMcpP95Ms,
    );
    expect(BASELINE_COST_BREAKDOWN.workflowFindDefaultP95Ms).toBe(
      baseline.workflowFindDefaultP95Ms,
    );
    expect(BASELINE_COST_BREAKDOWN.harnessPersistenceMs).toBe(
      baseline.harnessPersistenceMs,
    );
    expect(BASELINE_COST_BREAKDOWN.detailsEnrichmentCostRatio).toBeCloseTo(
      baseline.detailsEnrichmentCostRatio as number,
      2,
    );

    // Interpretation matches
    const interpretation = interpretCostBreakdown(BASELINE_COST_BREAKDOWN);
    expect(interpretation.harnessPersistenceIsPrimaryCause).toBe(
      expected.harnessPersistenceIsPrimaryCause,
    );
    expect(interpretation.detailsEnrichmentIsPrimaryCause).toBe(
      expected.detailsEnrichmentIsPrimaryCause,
    );
    expect(interpretation.ordinaryAgentToolsShouldUseHarness).toBe(
      expected.ordinaryAgentToolsShouldUseHarness,
    );
    expect(interpretation.workflowFindShouldDefaultCompact).toBe(
      expected.workflowFindShouldDefaultCompact,
    );
  });
});

// ============================================================================
// 7. Simulated enrichment cost model
// ============================================================================

describe("workflow.find — enrichment cost simulation", () => {
  it("5 results × compact = 0ms enrichment", () => {
    const input = resolveFindInput({ query: "test", limit: 5 });
    expect(input.include_details).toBe(false);
    expect(expectedBehavior(input).estimatedEnrichmentCostMs).toBe(0);
  });

  it("5 results × details = 5500ms enrichment", () => {
    const input = resolveFindInput({
      query: "test",
      limit: 5,
      include_details: true,
    });
    expect(expectedBehavior(input).estimatedEnrichmentCostMs).toBe(5500);
  });

  it("matches fixture: symbol-details-sample.json — 5 symbols, 5500ms total", () => {
    const fixture = readJsonFixture("fixtures/symbol-details-sample.json");
    const details = fixture.details as Array<{
      symbol: string;
      file: string;
      simulatedLatencyMs: number;
    }>;

    expect(details.length).toBe(5);

    // Each symbol has ~1100ms simulated latency
    for (const d of details) {
      expect(d.simulatedLatencyMs).toBe(ESTIMATED_GET_SYMBOL_COST_MS);
    }

    // Total enrichment cost
    const totalMs = details.reduce(
      (sum, d) => sum + d.simulatedLatencyMs,
      0,
    );
    expect(totalMs).toBe(fixture.expectedTotalEnrichmentMs);
    expect(totalMs).toBe(ESTIMATED_FULL_ENRICHMENT_COST_MS);
  });
});

// ============================================================================
// 8. Fixture: find-results-5.json
// ============================================================================

describe("workflow.find — fixture data: 5 search results", () => {
  const fixture = readJsonFixture("fixtures/find-results-5.json");

  it("has exactly 5 results", () => {
    const results = fixture.results as Array<unknown>;
    expect(results.length).toBe(5);
  });

  it("query = 'handler'", () => {
    expect(fixture.query).toBe("handler");
  });

  it("limit = 5", () => {
    expect(fixture.limit).toBe(5);
  });

  it("results are sorted by score descending", () => {
    const results = fixture.results as Array<{ score: number }>;
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(
        results[i]!.score,
      );
    }
  });

  it("each result has symbol, file, score fields", () => {
    const results = fixture.results as Array<Record<string, unknown>>;
    for (const r of results) {
      expect(typeof r.symbol).toBe("string");
      expect(typeof r.file).toBe("string");
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================================
// 9. Compact vs details — explicit boundary assertions
// ============================================================================

describe("workflow.find — compact vs details boundary", () => {
  it("compact = default = fast (<200ms target equivalent)", () => {
    const c = expectedBehavior(
      resolveFindInput({ query: "x", limit: 5 }),
    );
    expect(c.callsGetSymbol).toBe(false);
    expect(c.estimatedEnrichmentCostMs).toBe(0);
    expect(c.classification).toBe("default-fast-workflow");
  });

  it("details = explicit = heavy (up to 5500ms enrichment)", () => {
    const d = expectedBehavior(
      resolveFindInput({
        query: "x",
        limit: 5,
        include_details: true,
        format: "report",
      }),
    );
    expect(d.callsGetSymbol).toBe(true);
    expect(d.estimatedEnrichmentCostMs).toBe(5500);
    expect(d.classification).toBe("explicit-heavy-workflow");
  });

  it("include_details=true without report format → still detailed", () => {
    const input = resolveFindInput({
      query: "x",
      limit: 5,
      include_details: true,
      format: "compact",
    });
    const behavior = expectedBehavior(input);
    expect(behavior.callsGetSymbol).toBe(true);
    expect(behavior.generatesHeavyMarkdownReport).toBe(false);
    expect(behavior.classification).toBe("explicit-heavy-workflow");
  });

  it("format=report without include_details=true → no report generation", () => {
    const input = resolveFindInput({
      query: "x",
      limit: 5,
      format: "report",
      // include_details defaults to false
    });
    const behavior = expectedBehavior(input);
    expect(behavior.callsGetSymbol).toBe(false);
    expect(behavior.generatesHeavyMarkdownReport).toBe(false);
    // classification stays compact because include_details=false
    expect(behavior.classification).toBe("default-fast-workflow");
  });

  it("CLI workflow find CAN use details/report (explicit path preserved)", () => {
    // CLI calls with explicit include_details=true → details path works
    const cliInput = resolveFindInput({
      query: "handler",
      limit: 10,
      include_details: true,
      format: "report",
      generate_report: true,
    });
    const behavior = expectedBehavior(cliInput);

    expect(behavior.callsGetSymbol).toBe(true);
    expect(behavior.maxGetSymbolCalls).toBe(10);
    expect(behavior.generatesHeavyMarkdownReport).toBe(true);
    expect(behavior.responseStyle).toBe("detailed");
    expect(isExplicitDetailsPath(cliInput)).toBe(true);
  });
});

// ============================================================================
// 10. Constants sanity checks
// ============================================================================

describe("workflow.find — constants", () => {
  it("ESTIMATED_GET_SYMBOL_COST_MS = 1100", () => {
    expect(ESTIMATED_GET_SYMBOL_COST_MS).toBe(1100);
  });

  it("ESTIMATED_FULL_ENRICHMENT_COST_MS = 5500", () => {
    expect(ESTIMATED_FULL_ENRICHMENT_COST_MS).toBe(5500);
    expect(ESTIMATED_FULL_ENRICHMENT_COST_MS).toBe(
      DEFAULT_LIMIT * ESTIMATED_GET_SYMBOL_COST_MS,
    );
  });

  it("baseline direct MCP p95 < harness MCP p95", () => {
    expect(BASELINE_COST_BREAKDOWN.directMcpP95Ms).toBeLessThan(
      BASELINE_COST_BREAKDOWN.harnessMcpP95Ms,
    );
  });

  it("baseline harness MCP p95 < workflow.find p95", () => {
    expect(BASELINE_COST_BREAKDOWN.harnessMcpP95Ms).toBeLessThan(
      BASELINE_COST_BREAKDOWN.workflowFindDefaultP95Ms,
    );
  });

  it("defaults are stable (regression guard)", () => {
    // If these assertions fail, someone changed the defaults.
    // The defaults are SPECIFIED here and must not be changed
    // without explicit approval.
    expect(DEFAULT_INCLUDE_DETAILS).toBe(false);
    expect(DEFAULT_FORMAT).toBe("compact");
    expect(DEFAULT_LIMIT).toBe(5);
  });
});

// ============================================================================
// 11. Fixture integrity
// ============================================================================

describe("workflow.find — fixture integrity", () => {
  it("all 5 fixture files exist and are valid JSON", () => {
    const files = [
      "workflow-find/workflow-find-compact.json",
      "workflow-find/workflow-find-details.json",
      "workflow-find/workflow-find-expected-cost-breakdown.json",
      "fixtures/find-results-5.json",
      "fixtures/symbol-details-sample.json",
    ];
    for (const f of files) {
      const fixture = readJsonFixture(f);
      expect(fixture).toBeDefined();
      expect(typeof fixture).toBe("object");
    }
  });
});
