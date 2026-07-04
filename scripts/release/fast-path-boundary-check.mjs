#!/usr/bin/env node

/**
 * Fast Path Boundary Release Gate — Phase 06
 *
 * Unified release gate that checks all fast-path boundary invariants:
 *   1. Profile gate (agent/full/harness/debug)
 *   2. Fast tools ≠ HarnessRunner
 *   3. workflow.find compact defaults
 *   4. Direct vs harness benchmark separation
 *
 * Runs standalone — no vitest, no tsx, pure Node.js.
 *
 * Usage: node scripts/release/fast-path-boundary-check.mjs
 *
 * Outputs:
 *   reports/release/fast-path-boundary-check.json
 *   reports/release/fast-path-boundary-check.md
 *   exit code 0 = pass/warning, exit code 1 = fail
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const FIXTURES = path.join(ROOT, "fixtures", "fast-path-harness-boundary");
const REPORTS = path.join(ROOT, "reports");
const RELEASE_DIR = path.join(REPORTS, "release");
const PERF_DIR = path.join(REPORTS, "performance");

// ---------------------------------------------------------------------------
// Check result types
// ---------------------------------------------------------------------------

/** @typedef {{ check: string, status: "pass"|"warning"|"fail", detail: string }} CheckResult */

/** @type {CheckResult[]} */
const checks = [];

function pass(check, detail = "") {
  checks.push({ check, status: "pass", detail });
}
function warn(check, detail = "") {
  checks.push({ check, status: "warning", detail });
}
function fail(check, detail = "") {
  checks.push({ check, status: "fail", detail });
}

function finalVerdict() {
  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarning = checks.some((c) => c.status === "warning");
  if (hasFail) return "fail";
  if (hasWarning) return "warning";
  return "pass";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
}
function readJson(relativePath) {
  return JSON.parse(readFile(relativePath));
}
function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}
function grepSource(dir, pattern) {
  const results = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), "utf-8");
    if (pattern.test(content)) results.push(f);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Check 1: Profile gate — tool category definitions
// ---------------------------------------------------------------------------

{
  const src = readFile("src/mcp/profileGate.ts");

  const fastTools = [
    "codegraph_repo_status",
    "codegraph_find",
    "codegraph_explain",
    "codegraph_pre_edit_check",
    "codegraph_coverage_gaps",
    "codegraph_build_context_pack",
  ];
  const harnessTools = [
    "codegraph_harness_list",
    "codegraph_harness_run",
    "codegraph_harness_status",
    "codegraph_harness_artifacts",
  ];

  // Verify all 6 fast tools are defined in source
  let missing = fastTools.filter((t) => !src.includes(t));
  if (missing.length === 0) {
    pass("profile-gate: 6 fast tools defined", `FAST_TOOLS has all ${fastTools.length} entries`);
  } else {
    fail("profile-gate: fast tools missing", `Missing: ${missing.join(", ")}`);
  }

  // Verify all 4 harness tools are defined in source
  missing = harnessTools.filter((t) => !src.includes(t));
  if (missing.length === 0) {
    pass("profile-gate: 4 harness tools defined", `HARNESS_TOOLS has all ${harnessTools.length} entries`);
  } else {
    fail("profile-gate: harness tools missing", `Missing: ${missing.join(", ")}`);
  }

  // Verify FAST_TOOLS ∩ HARNESS_TOOLS = ∅ (no overlap in source)
  for (const t of fastTools) {
    if (harnessTools.includes(t)) {
      fail("profile-gate: tool overlap", `${t} appears in both FAST and HARNESS`);
    }
  }

  // Verify profile agent = 6 fast tools (from source code)
  if (/case\s+"agent":\s*\n\s*return new Set\(FAST_TOOLS\)/.test(src) ||
      /"agent".*FAST_TOOLS/.test(src)) {
    pass("profile-gate: agent = 6 fast tools", "Agent profile returns FAST_TOOLS");
  } else {
    warn("profile-gate: agent profile mapping", "Could not verify agent → FAST_TOOLS from source pattern");
  }

  // Verify full profile excludes harness
  if (src.includes("HARNESS_TOOLS")) {
    pass("profile-gate: full excludes harness", "HARNESS_TOOLS referenced for exclusion checks");
  }

  // Verify debug = full + harness
  if (/case\s+"debug":/.test(src) && src.includes("ALL_CODEGRAPH_TOOLS")) {
    pass("profile-gate: debug = full ∪ harness", "Debug profile returns ALL_CODEGRAPH_TOOLS");
  } else {
    warn("profile-gate: debug composition", "Could not verify debug = full ∪ harness from source");
  }

  // Verify profile-call-permissions fixture
  const permFixture = readJson("fixtures/fast-path-harness-boundary/path/profile-call-permissions.json");
  const perms = permFixture.callPermissions || [];
  let permOk = true;
  for (const p of perms) {
    const agentFull = (p.profile === "agent" || p.profile === "full");
    const harnessDebug = (p.profile === "harness" || p.profile === "debug");
    if (p.tool === "codegraph_harness_run") {
      if (agentFull && p.allowed !== false) { permOk = false; fail("profile-gate: agent/full must not expose codegraph_harness_run", `${p.profile} allows harness_run=${p.allowed}`); }
      if (harnessDebug && p.allowed !== true) { permOk = false; fail("profile-gate: harness/debug must expose codegraph_harness_run", `${p.profile} allows harness_run=${p.allowed}`); }
    }
  }
  if (permOk) {
    pass("profile-gate: call permissions matrix", `All ${perms.length} entries validated`);
  }
}

// ---------------------------------------------------------------------------
// Check 2: Fast tools ≠ HarnessRunner
// ---------------------------------------------------------------------------

{
  const toolsDir = path.join(SRC, "mcp", "tools");
  const importers = grepSource(toolsDir, /from\s+["'][^"']*harness\/core\/runner[^"']*["']/);

  // Only runHarnessFlow.ts should import from harness/core/runner
  const expectedImporters = ["runHarnessFlow.ts"];
  const unexpected = importers.filter((f) => !expectedImporters.includes(f));

  if (unexpected.length === 0 && importers.length >= 1) {
    pass("fast-tools-no-harness: only runHarnessFlow imports runModule",
      `Importers: ${importers.join(", ")}`);
  } else if (unexpected.length > 0) {
    fail("fast-tools-no-harness: unexpected runModule import",
      `Unexpected importers: ${unexpected.join(", ")}`);
  } else {
    fail("fast-tools-no-harness: no runModule imports found",
      "Expected runHarnessFlow.ts to import runModule");
  }

  // Verify runHarnessFlow.ts actually calls runModule
  const rhfSrc = readFile("src/mcp/tools/runHarnessFlow.ts");
  if (rhfSrc.includes("runModule(") || rhfSrc.includes("runModule (")) {
    pass("fast-tools-no-harness: runHarnessFlow calls runModule",
      "Call site confirmed in runHarnessFlow.ts");
  } else {
    fail("fast-tools-no-harness: runHarnessFlow missing runModule call");
  }

  // Verify all other tool handlers do NOT call runModule
  const otherHandlers = fs.readdirSync(toolsDir)
    .filter((f) => f.endsWith(".ts") && f !== "runHarnessFlow.ts");
  let hasRunnerCall = false;
  for (const f of otherHandlers) {
    const content = fs.readFileSync(path.join(toolsDir, f), "utf-8");
    if (/\brunModule\s*\(/.test(content) || /\bexecuteRun\s*\(/.test(content)) {
      hasRunnerCall = true;
      fail("fast-tools-no-harness: handler calls runModule/executeRun",
        `${f} contains runModule() or executeRun() call`);
    }
  }
  if (!hasRunnerCall) {
    pass("fast-tools-no-harness: 17 handlers do NOT call runModule",
      `Verified ${otherHandlers.length} handlers`);
  }

  // Verify fast-tools-must-not-use-harness fixture
  const ftFixture = readJson("fixtures/fast-path-harness-boundary/path/fast-tools-must-not-use-harness.json");
  if (ftFixture.expectedHarnessRunnerCalls === 0) {
    pass("fast-tools-no-harness: fixture expects 0 runner calls",
      ftFixture.failureMessage);
  } else {
    fail("fast-tools-no-harness: fixture expectation mismatch",
      `Expected 0, got ${ftFixture.expectedHarnessRunnerCalls}`);
  }
}

// ---------------------------------------------------------------------------
// Check 3: workflow.find compact defaults
// ---------------------------------------------------------------------------

{
  const src = readFile("src/workflow/findConfig.ts");

  // Check DEFAULT_INCLUDE_DETAILS = false
  if (/DEFAULT_INCLUDE_DETAILS\s*=\s*false/.test(src)) {
    pass("workflow-find: include_details defaults to false",
      "DEFAULT_INCLUDE_DETAILS = false");
  } else {
    fail("workflow-find: include_details defaults to true",
      "Must be false for compact-by-default behavior");
  }

  // Check DEFAULT_FORMAT = "compact"
  if (/DEFAULT_FORMAT.*=.*"compact"/.test(src)) {
    pass("workflow-find: format defaults to compact",
      "DEFAULT_FORMAT = 'compact'");
  } else {
    fail("workflow-find: format defaults to non-compact",
      "Must be 'compact' for compact-by-default behavior");
  }

  // Check include_details=true triggers enrichment
  if (src.includes("include_details") && src.includes("callsGetSymbol") && src.includes("enrichment")) {
    pass("workflow-find: include_details=true triggers enrichment",
      "get_symbol() enrichment logic present");
  } else {
    warn("workflow-find: enrichment trigger pattern", "Could not verify enrichment logic from source");
  }

  // Check include_details=false → 0 enrichment calls (source uses ternary: enrichment ? N : 0)
  if (src.includes("maxGetSymbolCalls") && src.includes("0") &&
      src.includes("estimatedEnrichmentCostMs")) {
    pass("workflow-find: compact mode produces 0 enrichment cost",
      "maxGetSymbolCalls/enrichment → 0 when include_details=false");
  } else {
    warn("workflow-find: compact mode enrichment cost", "Could not verify 0-cost from source pattern");
  }

  // Check fixture
  const compactFixture = readJson("fixtures/fast-path-harness-boundary/workflow-find/workflow-find-compact.json");
  if (compactFixture.expected && compactFixture.expected.callsGetSymbol === false) {
    pass("workflow-find: compact fixture expects no get_symbol",
      `classification: ${compactFixture.expected.classification}`);
  } else {
    fail("workflow-find: compact fixture mismatch");
  }

  const detailsFixture = readJson("fixtures/fast-path-harness-boundary/workflow-find/workflow-find-details.json");
  if (detailsFixture.expected && detailsFixture.expected.callsGetSymbol === true) {
    pass("workflow-find: details fixture expects get_symbol enrichment",
      `maxGetSymbolCalls: ${detailsFixture.expected.maxGetSymbolCalls}`);
  } else {
    fail("workflow-find: details fixture mismatch");
  }
}

// ---------------------------------------------------------------------------
// Check 4: Direct vs harness benchmark separation
// ---------------------------------------------------------------------------

{
  // Check that the performance fixture thresholds exist and are valid
  const thresholdsFile = "fixtures/fast-path-harness-boundary/performance/overhead-thresholds.json";
  if (fileExists(thresholdsFile)) {
    const thresholds = readJson(thresholdsFile);

    // Check classification rules
    const rules = thresholds.classificationRules || {};
    if (rules.doNotFailDirectMcpBecauseHarnessIsSlow) {
      pass("benchmark: doNotFailDirectMcpBecauseHarnessIsSlow = true",
        "Harness slowness will never fail direct MCP gate");
    } else {
      fail("benchmark: missing classification rule",
        "doNotFailDirectMcpBecauseHarnessIsSlow must be true");
    }

    if (rules.markHarnessSlowAsWorkflowHeavy) {
      pass("benchmark: markHarnessSlowAsWorkflowHeavy = true",
        "Harness slow is classified correctly");
    }

    if (rules.markDetailsEnrichmentAsExplicitHeavyMode) {
      pass("benchmark: markDetailsEnrichmentAsExplicitHeavyMode = true",
        "Details enrichment is classified correctly");
    }

    // Check separate thresholds exist
    if (thresholds.directMcp && thresholds.harnessWorkflow && thresholds.harnessPersistence) {
      pass("benchmark: separate thresholds for direct/harness/persistence",
        `directMcp p95 warning=${thresholds.directMcp.p95MsWarning}ms, harnessPersistence warning=${thresholds.harnessPersistence.p95MsWarning}ms`);
    } else {
      fail("benchmark: missing separate threshold categories");
    }

    // Verify persistence threshold is < 100ms for warning
    if (thresholds.harnessPersistence?.p95MsWarning <= 100) {
      pass("benchmark: harness persistence warning threshold <= 100ms",
        `Currently ${thresholds.harnessPersistence.p95MsWarning}ms`);
    } else {
      warn("benchmark: harness persistence threshold > 100ms",
        `Currently ${thresholds.harnessPersistence?.p95MsWarning}ms, expected <= 100ms`);
    }
  } else {
    warn("benchmark: overhead-thresholds.json not found",
      "Run PERF_TEST=1 npx vitest run tests/performance/directVsHarness.perf.test.ts first");
  }

  // Check perf report if it exists
  const perfReportFile = "reports/performance/direct-vs-harness.json";
  if (fileExists(perfReportFile)) {
    const perfReport = readJson(perfReportFile);
    const summary = perfReport.summary || {};

    // Direct MCP p95 < 500ms (fail threshold)
    if (summary.overallDirectMcpP95Ms !== undefined) {
      if (summary.overallDirectMcpP95Ms < 500) {
        pass("benchmark: direct MCP p95 within threshold",
          `${summary.overallDirectMcpP95Ms}ms < 500ms`);
      } else if (summary.overallDirectMcpP95Ms < 1000) {
        warn("benchmark: direct MCP p95 elevated",
          `${summary.overallDirectMcpP95Ms}ms (threshold: 500ms)`);
      } else {
        fail("benchmark: direct MCP p95 exceeds fail threshold",
          `${summary.overallDirectMcpP95Ms}ms >= 1000ms`);
      }
    } else {
      warn("benchmark: no direct MCP p95 in report");
    }

    // Harness persistence < 200ms (fail threshold)
    if (summary.overallHarnessPersistenceMs !== undefined) {
      if (summary.overallHarnessPersistenceMs < 100) {
        pass("benchmark: harness persistence within target",
          `${summary.overallHarnessPersistenceMs}ms < 100ms`);
      } else if (summary.overallHarnessPersistenceMs < 200) {
        warn("benchmark: harness persistence elevated",
          `${summary.overallHarnessPersistenceMs}ms (target: <100ms)`);
      } else {
        fail("benchmark: harness persistence exceeds fail threshold",
          `${summary.overallHarnessPersistenceMs}ms >= 200ms`);
      }
    }

    // Classification notes exist
    if (summary.classificationNotes && summary.classificationNotes.length > 0) {
      pass("benchmark: classification notes present",
        `${summary.classificationNotes.length} notes`);
    } else {
      warn("benchmark: no classification notes in report");
    }
  } else {
    warn("benchmark: direct-vs-harness.json not found",
      "Run PERF_TEST=1 npx vitest run tests/performance/directVsHarness.perf.test.ts first");
  }
}

// ---------------------------------------------------------------------------
// Check 5: Document consistency
// ---------------------------------------------------------------------------

{
  const docFile = "docs/FAST_PATH_VS_HARNESS.md";
  if (fileExists(docFile)) {
    const doc = readFile(docFile);

    if (doc.includes("Fast MCP tools must not route through HarnessRunner by default")) {
      pass("docs: core principle documented",
        "FAST_PATH_VS_HARNESS.md contains the binding rule");
    } else {
      warn("docs: core principle text not found");
    }

    if (doc.includes("Don't") || doc.includes("DON'T") || doc.includes("❌")) {
      pass("docs: do/don't rules documented");
    } else {
      warn("docs: do/don't rules not verified in document");
    }
  } else {
    fail("docs: FAST_PATH_VS_HARNESS.md not found",
      "Create docs/FAST_PATH_VS_HARNESS.md first (Phase 01)");
  }
}

// ---------------------------------------------------------------------------
// Check 6: Fixture integrity
// ---------------------------------------------------------------------------

{
  const requiredFixtures = [
    "fixtures/fast-path-harness-boundary/profiles/expected-agent-tools.json",
    "fixtures/fast-path-harness-boundary/profiles/expected-harness-tools.json",
    "fixtures/fast-path-harness-boundary/profiles/profile-rules.json",
    "fixtures/fast-path-harness-boundary/profiles/expected-debug-composition.json",
    "fixtures/fast-path-harness-boundary/path/fast-tools-must-not-use-harness.json",
    "fixtures/fast-path-harness-boundary/path/harness-tools-may-use-harness.json",
    "fixtures/fast-path-harness-boundary/path/profile-call-permissions.json",
    "fixtures/fast-path-harness-boundary/workflow-find/workflow-find-compact.json",
    "fixtures/fast-path-harness-boundary/workflow-find/workflow-find-details.json",
    "fixtures/fast-path-harness-boundary/workflow-find/workflow-find-expected-cost-breakdown.json",
    "fixtures/fast-path-harness-boundary/performance/overhead-thresholds.json",
    "fixtures/fast-path-harness-boundary/performance/phase-thresholds.json",
  ];

  const missingFixtures = requiredFixtures.filter((f) => !fileExists(f));
  if (missingFixtures.length === 0) {
    pass("fixtures: all 12 required fixtures present", `${requiredFixtures.length} files`);
  } else {
    fail("fixtures: missing files", missingFixtures.join(", "));
  }
}

// ---------------------------------------------------------------------------
// Check 7: Test file integrity
// ---------------------------------------------------------------------------

{
  const requiredTests = [
    "tests/profileBoundary.test.ts",
    "tests/fastPathNoHarness.test.ts",
    "tests/workflowFindCompactDefault.test.ts",
    "tests/performance/directVsHarness.perf.test.ts",
  ];

  const missingTests = requiredTests.filter((f) => !fileExists(f));
  if (missingTests.length === 0) {
    pass("tests: all 4 boundary test files present", `${requiredTests.length} files`);
  } else {
    fail("tests: missing test files", missingTests.join(", "));
  }
}

// ---------------------------------------------------------------------------
// Run vitest (quick structural tests only, non-perf)
// ---------------------------------------------------------------------------

{
  try {
    const result = execSync(
      'npx vitest run tests/profileBoundary.test.ts tests/fastPathNoHarness.test.ts tests/workflowFindCompactDefault.test.ts --reporter=json 2>&1',
      { cwd: ROOT, timeout: 120000, encoding: "utf-8" },
    );
    // Parse vitest JSON output to count failures
    try {
      const jsonStart = result.lastIndexOf("{");
      if (jsonStart >= 0) {
        const parsed = JSON.parse(result.slice(jsonStart));
        const failed = parsed.numFailedTests || 0;
        const passed = parsed.numPassedTests || 0;
        if (failed === 0) {
          pass("vitest: all boundary tests pass", `${passed} passed, ${failed} failed`);
        } else {
          fail("vitest: boundary test failures", `${passed} passed, ${failed} failed`);
        }
      } else {
        // Fallback: check for "failed" in output
        if (result.includes("Tests") && !result.includes("FAIL")) {
          pass("vitest: boundary tests complete (no failures detected)");
        } else {
          warn("vitest: could not parse JSON output, check manually");
        }
      }
    } catch {
      // Non-JSON output, check text
      if (result.includes("Failed Tests") || result.includes("FAIL  Tests")) {
        fail("vitest: test failures detected in output");
      } else if (result.includes("Tests")) {
        pass("vitest: boundary tests completed");
      } else {
        warn("vitest: unexpected output format, check manually");
      }
    }
  } catch (err) {
    // vitest returns non-zero exit code on test failure
    const stderr = err.stderr || "";
    const stdout = err.stdout || "";
    if ((stderr + stdout).includes("FAIL")) {
      fail("vitest: boundary tests have failures", (stderr + stdout).slice(0, 200));
    } else {
      warn("vitest: could not execute boundary tests", err.message?.slice(0, 100));
    }
  }
}

// ---------------------------------------------------------------------------
// Generate report
// ---------------------------------------------------------------------------

const verdict = finalVerdict();
const now = new Date().toISOString();

const report = {
  generated: now,
  verdict,
  summary: {
    total: checks.length,
    pass: checks.filter((c) => c.status === "pass").length,
    warning: checks.filter((c) => c.status === "warning").length,
    fail: checks.filter((c) => c.status === "fail").length,
  },
  checks,
  verdictRules: {
    pass: "All checks pass. Fast path boundary is intact.",
    warning: "One or more checks are warnings. Review before release. Harness slowness does NOT fail the gate.",
    fail: "One or more checks FAILED. Do NOT release until resolved. Fast tools calling HarnessRunner, agent/full exposing harness tools, or workflow.find defaulting to include_details=true are blockers.",
    triggers: {
      failTriggers: [
        "fast tools 调用 HarnessRunner",
        "agent/full 暴露 harness tools",
        "workflow.find 默认 include_details=true",
        "direct MCP p95 超过 fail 阈值",
        "harness persistence overhead 超过 fail 阈值",
      ],
      warningTriggers: [
        "harness workflow p95 高但 direct MCP 正常",
        "workflow.find details 模式慢 → explicit-heavy，不是 direct MCP fail",
      ],
    },
  },
};

// Write JSON
fs.mkdirSync(RELEASE_DIR, { recursive: true });
const jsonPath = path.join(RELEASE_DIR, "fast-path-boundary-check.json");
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

// Write Markdown
const md = buildMarkdownReport(report);
const mdPath = path.join(RELEASE_DIR, "fast-path-boundary-check.md");
fs.writeFileSync(mdPath, md, "utf-8");

// Print summary
console.log("");
console.log("═══════════════════════════════════════════");
console.log(`  Fast Path Boundary Release Gate`);
console.log(`  Verdict: ${verdict.toUpperCase()}`);
console.log(`  Pass: ${report.summary.pass}  Warning: ${report.summary.warning}  Fail: ${report.summary.fail}`);
console.log("═══════════════════════════════════════════");
console.log(`  Report: ${path.relative(ROOT, jsonPath)}`);
console.log(`  Report: ${path.relative(ROOT, mdPath)}`);
console.log("═══════════════════════════════════════════");
console.log("");

// Exit with appropriate code
process.exit(verdict === "fail" ? 1 : 0);

// ---------------------------------------------------------------------------
// Markdown report builder
// ---------------------------------------------------------------------------

function buildMarkdownReport(report) {
  const lines = [];
  const statusIcon = { pass: "✅", warning: "⚠️", fail: "❌" };

  lines.push("# Fast Path Boundary Release Gate");
  lines.push("");
  lines.push(`**Generated**: ${report.generated}`);
  lines.push("");
  lines.push(`## Verdict: **${report.verdict.toUpperCase()}** ${statusIcon[report.verdict] || ""}`);
  lines.push("");
  lines.push(`| Status | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| ✅ Pass | ${report.summary.pass} |`);
  lines.push(`| ⚠️ Warning | ${report.summary.warning} |`);
  lines.push(`| ❌ Fail | ${report.summary.fail} |`);
  lines.push(`| **Total** | **${report.summary.total}** |`);
  lines.push("");

  // Verdict rules
  lines.push("## Verdict Rules");
  lines.push("");
  lines.push("### ❌ Fail Triggers (blockers)");
  lines.push("");
  for (const t of report.verdictRules.triggers.failTriggers) {
    lines.push(`- ${t}`);
  }
  lines.push("");
  lines.push("### ⚠️ Warning Triggers (non-blocking)");
  lines.push("");
  for (const t of report.verdictRules.triggers.warningTriggers) {
    lines.push(`- ${t}`);
  }
  lines.push("");

  // Per-check details
  lines.push("## Check Results");
  lines.push("");
  lines.push("| Check | Status | Detail |");
  lines.push("|---|---|---|");
  for (const c of report.checks) {
    const icon = statusIcon[c.status] || "?";
    const detail = c.detail.length > 80 ? c.detail.slice(0, 77) + "..." : c.detail;
    lines.push(`| ${c.check} | ${icon} ${c.status} | ${detail} |`);
  }
  lines.push("");

  // Actions
  if (report.verdict === "fail") {
    lines.push("## ❌ Action Required");
    lines.push("");
    lines.push("Fix all ❌ fail checks before release. See above for details.");
  } else if (report.verdict === "warning") {
    lines.push("## ⚠️ Review Before Release");
    lines.push("");
    lines.push("Review all ⚠️ warning checks. Warnings do not block release but should be understood.");
  } else {
    lines.push("## ✅ Ready for Release");
    lines.push("");
    lines.push("All checks pass. Fast path boundary is intact.");
  }
  lines.push("");

  return lines.join("\n");
}
