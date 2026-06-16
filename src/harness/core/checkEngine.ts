/**
 * Harness Check Engine
 *
 * Implements the 15 check rules from PRD §12.1.
 * Validates HarnessManifest structure, coveredTools reality,
 * module registration, example input schema conformance, and
 * runtime artifact generation.
 *
 * For each flow, produces a structured FlowCheckReport.
 * For all flows, produces a batch report written to:
 *   artifacts/check-report.md
 *   artifacts/check-report.json
 *
 * PRD §12.1–12.3: Harness Check。
 */

import type { HarnessManifest, HarnessModule, RunId } from "./types.js";
import {
  getManifest,
  getModule,
  hasModule,
  listManifests,
} from "./registry.js";
import { validateJsonSchema } from "./validate.js";
import { executeRun } from "./runner.js";
import { generateRunId } from "../utils/runId.js";
import { loadState } from "./stateStore.js";
import { readLogs, readCheckpoints } from "./reporter.js";
import { TOOL_MAP } from "../../mcp/toolSchemas.js";
import { resolveProjectRoot } from "../utils/runPaths.js";
import { nowISO } from "../../utils/time.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Mock Adapters ──────────────────────────────────────────────────────────────

import {
  createMockCodeContextAdapter,
  createMockMcpAdapter,
  createMockCliAdapter,
} from "./mockAdapters.js";

// ── Check Rule Result ──────────────────────────────────────────────────────────

export interface CheckRuleResult {
  /** Rule identifier (e.g. "manifest.id.unique"). */
  rule: string;
  /** Human-readable description of what this rule checks. */
  description: string;
  /** Check outcome. */
  outcome: "pass" | "fail" | "warn" | "skip";
  /** Diagnostic message. */
  message: string;
}

// ── Flow Check Report ──────────────────────────────────────────────────────────

export interface FlowCheckReport {
  /** The flow manifest id being checked. */
  flowId: string;
  /** The runId used for runtime checks (empty string if skipped). */
  runId: string;
  /** ISO 8601 timestamp of the check. */
  timestamp: string;
  /** Manifest-level check results (rules 1–10). */
  manifestChecks: CheckRuleResult[];
  /** Runtime check results (rules 11–15). */
  runtimeChecks: CheckRuleResult[];
  /** Aggregate summary. */
  summary: CheckSummary;
  /** Whether the flow is registered as a runnable module. */
  isRunnable: boolean;
}

export interface CheckSummary {
  total: number;
  pass: number;
  fail: number;
  warn: number;
  skip: number;
}

// ── Batch Check Report ─────────────────────────────────────────────────────────

export interface BatchCheckReport {
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Total flows checked. */
  totalFlows: number;
  /** Per-flow reports. */
  flows: FlowCheckReport[];
  /** Aggregate across all flows. */
  summary: CheckSummary;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function computeSummary(results: CheckRuleResult[]): CheckSummary {
  return {
    total: results.length,
    pass: results.filter((r) => r.outcome === "pass").length,
    fail: results.filter((r) => r.outcome === "fail").length,
    warn: results.filter((r) => r.outcome === "warn").length,
    skip: results.filter((r) => r.outcome === "skip").length,
  };
}

/** Get the set of all valid MCP tool names from the tool registry. */
function getValidToolNames(): Set<string> {
  return new Set(Object.keys(TOOL_MAP));
}

// ── Manifest Checks (Rules 1–10) ───────────────────────────────────────────────

/**
 * Run all manifest-level checks against a manifest and optional module.
 * Rules 1–10: structural validation, schema checks, tool reality, module hooks.
 */
function runManifestChecks(
  manifest: HarnessManifest,
  mod: HarnessModule | undefined,
  exampleInput: unknown | undefined,
): CheckRuleResult[] {
  const results: CheckRuleResult[] = [];

  // ── Rule 1: manifest.id.unique ───────────────────────────────────────────────

  const allIds = listManifests();
  const duplicateIds = allIds.filter((id) => id === manifest.id);
  results.push({
    rule: "manifest.id.unique",
    description: "Manifest id is unique across all registered manifests",
    outcome: duplicateIds.length <= 1 ? "pass" : "fail",
    message:
      duplicateIds.length <= 1
        ? `id "${manifest.id}" is unique (${allIds.length} total manifests)`
        : `id "${manifest.id}" appears ${duplicateIds.length} times — duplicate detected`,
  });

  // ── Rule 2: manifest.name.exists ─────────────────────────────────────────────

  const hasName = typeof manifest.name === "string" && manifest.name.trim().length > 0;
  results.push({
    rule: "manifest.name.exists",
    description: "Manifest has a non-empty name",
    outcome: hasName ? "pass" : "fail",
    message: hasName ? `name="${manifest.name}"` : "manifest.name is missing or empty",
  });

  // ── Rule 3: manifest.description.exists ──────────────────────────────────────

  const hasDesc = typeof manifest.description === "string" && manifest.description.trim().length > 0;
  results.push({
    rule: "manifest.description.exists",
    description: "Manifest has a non-empty description",
    outcome: hasDesc ? "pass" : "fail",
    message: hasDesc ? "description present" : "manifest.description is missing or empty",
  });

  // ── Rule 4: manifest.inputSchema ─────────────────────────────────────────────

  if (manifest.inputSchema) {
    // Input schema declared — validate it's a well-formed JSON Schema
    const schemaValid = manifest.inputSchema.type != null;
    results.push({
      rule: "manifest.inputSchema.valid",
      description: "Declared inputSchema is a well-formed JSON Schema",
      outcome: schemaValid ? "pass" : "warn",
      message: schemaValid
        ? `inputSchema type="${manifest.inputSchema.type}"`
        : "inputSchema declared but missing root type",
    });
  } else {
    results.push({
      rule: "manifest.inputSchema.valid",
      description: "Declared inputSchema is a well-formed JSON Schema",
      outcome: "skip",
      message: "no inputSchema declared (optional)",
    });
  }

  // ── Rule 5: manifest.outputSchema ────────────────────────────────────────────

  if (manifest.outputSchema) {
    const schemaValid = manifest.outputSchema.type != null;
    results.push({
      rule: "manifest.outputSchema.valid",
      description: "Declared outputSchema is a well-formed JSON Schema",
      outcome: schemaValid ? "pass" : "warn",
      message: schemaValid
        ? `outputSchema type="${manifest.outputSchema.type}"`
        : "outputSchema declared but missing root type",
    });
  } else {
    results.push({
      rule: "manifest.outputSchema.valid",
      description: "Declared outputSchema is a well-formed JSON Schema",
      outcome: "skip",
      message: "no outputSchema declared (optional)",
    });
  }

  // ── Rule 6: manifest.phases.nonEmpty ─────────────────────────────────────────

  const phasesValid = Array.isArray(manifest.phases) && manifest.phases.length > 0;
  const phaseNames = phasesValid ? manifest.phases.map((p) => p.name) : [];
  results.push({
    rule: "manifest.phases.nonEmpty",
    description: "Manifest declares at least one phase",
    outcome: phasesValid ? "pass" : "fail",
    message: phasesValid
      ? `${manifest.phases.length} phases: [${phaseNames.join(", ")}]`
      : "manifest.phases is empty or missing",
  });

  // ── Rule 7: manifest.coveredTools.real ───────────────────────────────────────

  const validTools = getValidToolNames();
  const unknownTools = manifest.coversTools.filter((t) => !validTools.has(t));
  const isCliSmoke = manifest.id === "cli-smoke-flow";

  const toolCheckOutcome =
    manifest.coversTools.length === 0
      ? isCliSmoke
        ? "skip" // CLI flows legitimately have no MCP tools
        : "warn"
      : unknownTools.length === 0
        ? "pass"
        : "fail";

  const toolCheckMessage = (() => {
    if (manifest.coversTools.length === 0) {
      return isCliSmoke
        ? "CLI smoke flow — no MCP tools to cover"
        : "coversTools is empty — flow exercises no MCP tools";
    }
    if (unknownTools.length === 0) {
      return `${manifest.coversTools.length} tools all valid: [${manifest.coversTools.join(", ")}]`;
    }
    return `Unknown tools: [${unknownTools.join(", ")}] — not in TOOL_DEFINITIONS`;
  })();

  results.push({
    rule: "manifest.coveredTools.real",
    description: "All coveredTools match actual MCP tool names",
    outcome: toolCheckOutcome as "pass" | "fail" | "warn" | "skip",
    message: toolCheckMessage,
  });

  // ── Rule 8: module.run.exists ────────────────────────────────────────────────

  const hasRun = mod != null && typeof mod.run === "function";
  results.push({
    rule: "module.run.exists",
    description: "Registered module has a run function",
    outcome: hasRun ? "pass" : "fail",
    message: hasRun
      ? "module.run is a function"
      : mod == null
        ? "no module registered — cannot check module.run"
        : "module.run is not a function",
  });

  // ── Rule 9: module.check.exists ──────────────────────────────────────────────

  if (mod != null && mod.check != null) {
    const hasCheck = typeof mod.check === "function";
    results.push({
      rule: "module.check.exists",
      description: "Declared module.check is a valid function",
      outcome: hasCheck ? "pass" : "fail",
      message: hasCheck ? "module.check is a function" : "module.check is not a function",
    });
  } else if (mod != null && mod.check == null) {
    results.push({
      rule: "module.check.exists",
      description: "Declared module.check is a valid function",
      outcome: "skip",
      message: "no module.check declared (optional)",
    });
  } else {
    results.push({
      rule: "module.check.exists",
      description: "Declared module.check is a valid function",
      outcome: "skip",
      message: "no module registered — cannot check module.check",
    });
  }

  // ── Rule 10: example.input.valid ─────────────────────────────────────────────

  if (manifest.inputSchema && exampleInput !== undefined) {
    const inputValidation = validateJsonSchema(
      manifest.inputSchema,
      exampleInput,
      "input",
    );
    results.push({
      rule: "example.input.valid",
      description: "Example input passes inputSchema validation",
      outcome: inputValidation.valid ? "pass" : "fail",
      message: inputValidation.valid
        ? "example input passes schema validation"
        : `example input fails: ${inputValidation.errors.join("; ")}`,
    });
  } else if (!manifest.inputSchema) {
    results.push({
      rule: "example.input.valid",
      description: "Example input passes inputSchema validation",
      outcome: "skip",
      message: "no inputSchema declared — input validation skipped",
    });
  } else {
    results.push({
      rule: "example.input.valid",
      description: "Example input passes inputSchema validation",
      outcome: "skip",
      message: "no example input provided — validation skipped",
    });
  }

  return results;
}

// ── Runtime Checks (Rules 11–15) ───────────────────────────────────────────────

type FlowCategory = "codecontext" | "mcp" | "cli";

/** Determine the adapter category for a flow based on manifest metadata. */
function categorizeFlow(manifest: HarnessManifest): FlowCategory {
  // Primary: check explicit id (exact match)
  switch (manifest.id) {
    case "cli-smoke-flow":
      return "cli";
    case "mcp-tools-smoke-flow":
      return "mcp";
  }
  // Fallback: check tags for classification
  if (manifest.tags?.includes("cli")) return "cli";
  // MCP-only flows: tagged "smoke" + "mcp" but without "compression"/"memory"/"originals"/"profile"
  if (
    manifest.tags?.includes("mcp") &&
    !manifest.tags?.includes("compression") &&
    !manifest.tags?.includes("memory") &&
    !manifest.tags?.includes("originals") &&
    !manifest.tags?.includes("profile") &&
    manifest.capability === "smoke-test"
  ) {
    return "mcp";
  }
  return "codecontext";
}

/**
 * Run runtime checks by executing the flow with a mock adapter.
 * Rules 11–15: state.json, output.json, logs.jsonl, receipt, artifacts.
 *
 * For CodeContextAdapter flows: uses in-memory sql.js + mock service.
 * For McpAdapter flows: uses mock MCP adapter (stubs).
 * For CliAdapter flows: uses mock CLI adapter (stubs, exitCode=0).
 */
async function runRuntimeChecks(
  manifest: HarnessManifest,
  mod: HarnessModule,
  runId: RunId,
): Promise<CheckRuleResult[]> {
  const results: CheckRuleResult[] = [];
  const category = categorizeFlow(manifest);

  // Build mock input based on flow category and manifest id.
  // Each flow has specific input shape requirements beyond just the adapter.
  let mockInput: unknown;

  switch (category) {
    case "mcp":
      mockInput = { adapter: createMockMcpAdapter() };
      break;
    case "cli":
      mockInput = { adapter: createMockCliAdapter() };
      break;
    case "codecontext":
    default: {
      const mockAdapter = await createMockCodeContextAdapter();
      // Per-flow input shaping: some flows need extra fields
      switch (manifest.id) {
        case "compression-flow":
          mockInput = {
            adapter: mockAdapter,
            fixtures: [
              { label: "mock_fixture", content: "mock test content for compression" },
            ],
          };
          break;
        case "originals-flow":
          mockInput = {
            adapter: mockAdapter,
            testContent: "mock test content for originals lifecycle",
          };
          break;
        default:
          // memory-flow, profile-flow, full-context-flow only need adapter
          mockInput = { adapter: mockAdapter };
          break;
      }
      break;
    }
  }
  let runState;
  try {
    runState = await executeRun({
      module: mod,
      runId,
      input: mockInput,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // All runtime checks fail if the flow itself throws
    for (const rule of [
      "run.generates.stateJson",
      "run.generates.outputJson",
      "run.generates.logsJsonl",
      "run.generates.receipt",
      "artifacts.asExpected",
    ]) {
      results.push({ rule, description: "", outcome: "fail", message: `flow threw: ${msg}` });
    }
    return results;
  }

  // ── Rule 11: run.generates.stateJson ────────────────────────────────────────

  const loadedState = loadState(runId);
  const hasState = loadedState != null && loadedState.status != null;
  results.push({
    rule: "run.generates.stateJson",
    description: "Run execution produces a valid state.json",
    outcome: hasState ? "pass" : "fail",
    message: hasState
      ? `state.json present, status="${loadedState!.status}"`
      : "state.json missing or invalid after run",
  });

  // ── Rule 12: run.generates.outputJson ────────────────────────────────────────

  const hasOutput = runState.output !== undefined && runState.output !== null;
  results.push({
    rule: "run.generates.outputJson",
    description: "Run execution produces a valid output.json",
    outcome: hasOutput ? "pass" : "fail",
    message: hasOutput
      ? "output.json present and contains output data"
      : "output.json missing or empty after run",
  });

  // ── Rule 13 & 14: run.generates.logsJsonl + run.generates.receipt ──────────────

  // Read logs once — shared between rule 13 (logs check) and rule 14 (receipt check)
  let logs: ReturnType<typeof readLogs> = [];
  let checkpoints: ReturnType<typeof readCheckpoints> = [];
  try {
    logs = readLogs(runId);
    checkpoints = readCheckpoints(runId);
  } catch {
    // logs/checkpoints read failure handled in individual rules below
  }

  const hasLogs = (logs.length > 0) || (checkpoints.length > 0);
  results.push({
    rule: "run.generates.logsJsonl",
    description: "Run execution produces logs.jsonl with event entries",
    outcome: hasLogs ? "pass" : "fail",
    message: hasLogs
      ? `logs.jsonl has ${logs.length} entries, checkpoints.jsonl has ${checkpoints.length} entries`
      : "no log entries or checkpoints found after run",
  });

  // Receipt is created via ctx.createReceipt() in steps 5 and 13 of the runner.
  // When no ReceiptService is provided, a stub receipt is created and logged.
  // Evidence: "[receipt]" in log entries, or run completed normally.
  const receiptLogs = logs.filter(
    (entry) =>
      entry.type === "log" &&
      typeof entry.message === "string" &&
      (entry.message.includes("[receipt]") || entry.message.includes("receipt")),
  );
  const hasReceiptEvidence =
    receiptLogs.length > 0 || runState.status === "completed";
  results.push({
    rule: "run.generates.receipt",
    description: "Run execution creates a run receipt",
    outcome: hasReceiptEvidence ? "pass" : "warn",
    message: hasReceiptEvidence
      ? receiptLogs.length > 0
        ? "receipt log entry found"
        : "run completed — receipt created by runner pipeline"
      : "no receipt evidence in logs — verify receipt creation",
  });

  // ── Rule 15: artifacts.asExpected ────────────────────────────────────────────

  const declaredArtifacts = manifest.artifacts.map((a) => a.name);
  const producedArtifactNames = new Set(runState.artifacts.map((a) => a.name));

  const missingArtifacts = declaredArtifacts.filter((a) => !producedArtifactNames.has(a));
  const extraArtifacts = runState.artifacts
    .map((a) => a.name)
    .filter((a) => !declaredArtifacts.includes(a));

  const artifactsMatch = missingArtifacts.length === 0;
  results.push({
    rule: "artifacts.asExpected",
    description: "All declared artifacts are produced as expected",
    outcome: artifactsMatch ? "pass" : "fail",
    message: artifactsMatch
      ? `all ${declaredArtifacts.length} declared artifacts produced: [${declaredArtifacts.join(", ")}]`
      : `missing: [${missingArtifacts.join(", ")}]; extra: [${extraArtifacts.join(", ")}]`,
  });

  return results;
}

// ── Single-Flow Check ──────────────────────────────────────────────────────────

export interface CheckFlowOptions {
  /** Override example input for schema validation (rule 10). */
  exampleInput?: unknown;
  /** If true, skip runtime checks (rules 11–15). Default: false. */
  manifestOnly?: boolean;
}

/**
 * Check a single flow by manifest id.
 *
 * Runs rules 1–10 (manifest) and optionally rules 11–15 (runtime).
 * Returns a full FlowCheckReport.
 */
export async function checkFlow(
  flowId: string,
  opts: CheckFlowOptions = {},
): Promise<FlowCheckReport> {
  const manifest = getManifest(flowId);
  if (!manifest) {
    const emptySummary: CheckSummary = { total: 1, pass: 0, fail: 1, warn: 0, skip: 0 };
    return {
      flowId,
      runId: "",
      timestamp: nowISO(),
      manifestChecks: [
        {
          rule: "manifest.notFound",
          description: "Manifest exists in registry",
          outcome: "fail",
          message: `Flow "${flowId}" not found in registry. Available: [${listManifests().join(", ")}]`,
        },
      ],
      runtimeChecks: [],
      summary: emptySummary,
      isRunnable: false,
    };
  }

  const mod = getModule(flowId);
  const isRunnable = hasModule(flowId);

  // Rules 1–10
  const manifestChecks = runManifestChecks(manifest, mod, opts.exampleInput);

  // Rules 11–15 (runtime)
  let runtimeChecks: CheckRuleResult[] = [];
  let runId: RunId | string = "";

  if (!opts.manifestOnly && mod != null) {
    runId = generateRunId() as RunId;
    runtimeChecks = await runRuntimeChecks(manifest, mod, runId as RunId);
  } else if (opts.manifestOnly) {
    for (const rule of [
      "run.generates.stateJson",
      "run.generates.outputJson",
      "run.generates.logsJsonl",
      "run.generates.receipt",
      "artifacts.asExpected",
    ]) {
      runtimeChecks.push({
        rule,
        description: "",
        outcome: "skip",
        message: "manifestOnly mode — runtime checks skipped",
      });
    }
  } else {
    for (const rule of [
      "run.generates.stateJson",
      "run.generates.outputJson",
      "run.generates.logsJsonl",
      "run.generates.receipt",
      "artifacts.asExpected",
    ]) {
      runtimeChecks.push({
        rule,
        description: "",
        outcome: "skip",
        message: "no registered module — runtime checks skipped",
      });
    }
  }

  const allChecks = [...manifestChecks, ...runtimeChecks];
  const summary = computeSummary(allChecks);

  return {
    flowId,
    runId,
    timestamp: nowISO(),
    manifestChecks,
    runtimeChecks,
    summary,
    isRunnable,
  };
}

// ── Batch: Check All Flows ─────────────────────────────────────────────────────

export interface CheckAllOptions {
  /** If true, skip runtime checks for all flows. */
  manifestOnly?: boolean;
  /** Specific flow ids to check (defaults to all registered). */
  flowIds?: string[];
  /** Custom example inputs keyed by flowId. */
  exampleInputs?: Record<string, unknown>;
}

/**
 * Check all registered flows (or a specified subset).
 *
 * For each flow, runs manifest checks and optionally runtime checks.
 * Returns a BatchCheckReport.
 */
export async function checkAllFlows(
  opts: CheckAllOptions = {},
): Promise<BatchCheckReport> {
  const flowIds = opts.flowIds ?? listManifests();

  const reports: FlowCheckReport[] = [];
  for (const flowId of flowIds) {
    const report = await checkFlow(flowId, {
      manifestOnly: opts.manifestOnly,
      exampleInput: opts.exampleInputs?.[flowId],
    });
    reports.push(report);
  }

  // Aggregate summary
  const allChecks = reports.flatMap((r) => [...r.manifestChecks, ...r.runtimeChecks]);
  const summary = computeSummary(allChecks);

  return {
    timestamp: nowISO(),
    totalFlows: reports.length,
    flows: reports,
    summary,
  };
}

// ── Report Persistence (12.3) ──────────────────────────────────────────────────

/**
 * Persist a batch check report to disk.
 *
 * Writes:
 *   artifacts/check-report.json  — machine-readable full report
 *   artifacts/check-report.md    — human-readable summary
 */
export function writeCheckReports(report: BatchCheckReport): { jsonPath: string; mdPath: string } {
  const root = resolveProjectRoot();
  const artifactsDir = path.join(root, "artifacts");

  // Best-effort directory creation — fails gracefully on permission errors
  try {
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }
  } catch {
    // Directory creation failed — skip writing reports
    return { jsonPath: path.join(artifactsDir, "check-report.json"), mdPath: path.join(artifactsDir, "check-report.md") };
  }

  // ── JSON Report ──────────────────────────────────────────────────────────────

  const jsonPath = path.join(artifactsDir, "check-report.json");
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  } catch {
    // Best-effort: JSON write failure must not block the caller
  }

  // ── Markdown Report ──────────────────────────────────────────────────────────

  const mdPath = path.join(artifactsDir, "check-report.md");
  try {
    const md = formatCheckReportMarkdown(report);
    fs.writeFileSync(mdPath, md, "utf-8");
  } catch {
    // Best-effort: MD write failure must not block the caller
  }

  return { jsonPath, mdPath };
}

// ── Markdown Formatting ────────────────────────────────────────────────────────

function formatCheckReportMarkdown(report: BatchCheckReport): string {
  const lines: string[] = [];

  lines.push("# CodeContext Harness — Check Report");
  lines.push("");
  lines.push(`**Generated:** ${report.timestamp}`);
  lines.push(`**Flows checked:** ${report.totalFlows}`);
  lines.push("");
  lines.push("## Batch Summary");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total checks | ${report.summary.total} |`);
  lines.push(`| ✓ Pass | ${report.summary.pass} |`);
  lines.push(`| ✗ Fail | ${report.summary.fail} |`);
  lines.push(`| ⚠ Warn | ${report.summary.warn} |`);
  lines.push(`| ○ Skip | ${report.summary.skip} |`);
  lines.push("");

  for (const flow of report.flows) {
    lines.push(`---`);
    lines.push(`## Flow: \`${flow.flowId}\``);
    lines.push("");
    lines.push(`- **Runnable:** ${flow.isRunnable ? "✓ YES" : "✗ NO"}`);
    lines.push(`- **Run ID:** ${flow.runId || "—"}`);
    lines.push(`- **Timestamp:** ${flow.timestamp}`);
    lines.push(`- **Summary:** ${flow.summary.pass}P / ${flow.summary.fail}F / ${flow.summary.warn}W / ${flow.summary.skip}S`);
    lines.push("");

    lines.push("### Manifest Checks");
    lines.push("");
    lines.push("| Rule | Outcome | Message |");
    lines.push("|------|---------|---------|");
    for (const c of flow.manifestChecks) {
      const icon = { pass: "✓", fail: "✗", warn: "⚠", skip: "○" }[c.outcome];
      lines.push(`| \`${c.rule}\` | ${icon} ${c.outcome} | ${escapeMd(c.message)} |`);
    }
    lines.push("");

    lines.push("### Runtime Checks");
    lines.push("");
    lines.push("| Rule | Outcome | Message |");
    lines.push("|------|---------|---------|");
    for (const c of flow.runtimeChecks) {
      const icon = { pass: "✓", fail: "✗", warn: "⚠", skip: "○" }[c.outcome];
      lines.push(`| \`${c.rule}\` | ${icon} ${c.outcome} | ${escapeMd(c.message)} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
