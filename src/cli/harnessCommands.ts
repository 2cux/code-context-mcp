/**
 * CodeContext CLI — Harness Command Handlers
 *
 * Each function returns a CliResult and NEVER throws, prints to console,
 * or calls process.exit. This makes them directly testable.
 *
 * CLI 只做三件事：
 *   1. 解析参数（由 CLI dispatcher 完成）
 *   2. 加载 registry + 调用 runner
 *   3. 打印结果
 *
 * 业务逻辑全部留在 harness/ 目录，CLI 不写业务逻辑。
 *
 * PRD §34 / §10: CLI 接入 Harness。
 */

import { readFileSync } from "node:fs";
import { registerAllFlows } from "../harness/register.js";
import {
  listManifestDetails,
  getManifest,
  hasModule,
} from "../harness/core/registry.js";
import { runModule } from "../harness/core/runner.js";
import {
  listRuns,
  loadState,
  setRunsDir,
} from "../harness/core/stateStore.js";
import { readLogs, detailRun } from "../harness/core/reporter.js";
import { listArtifacts, readArtifact } from "../harness/core/artifactStore.js";
import type { RunState } from "../harness/core/types.js";
import {
  checkFlow,
  checkAllFlows,
  writeCheckReports,
} from "../harness/core/checkEngine.js";
import type { FlowCheckReport, BatchCheckReport } from "../harness/core/checkEngine.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CliResult {
  status: "ok" | "error";
  data: unknown;
  error?: string;
}

function ok(data: unknown): CliResult {
  return { status: "ok", data };
}

function fail(message: string): CliResult {
  return { status: "error", data: null, error: message };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ensure the harness registry is populated. Safe to call multiple times. */
function ensureRegistry(): void {
  try {
    registerAllFlows();
  } catch (err) {
    // Only suppress "already registered" errors — re-throw everything else
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already registered")) {
      throw err;
    }
  }
}

/** Discriminated result for readInputFile — avoids ambiguity with JSON shapes. */
interface InputFileResult {
  ok: true;
  data: unknown;
}

interface InputFileError {
  ok: false;
  error: string;
}

type InputFileOutcome = InputFileResult | InputFileError;

/** Read and parse a JSON input file. Returns a discriminated result. */
function readInputFile(filePath: string): InputFileOutcome {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    return { ok: false, error: `Cannot read input file: ${filePath} — ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!raw.trim()) {
    return { ok: false, error: `Input file is empty: ${filePath}` };
  }

  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: `Invalid JSON in input file: ${filePath} — ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── CLI Data Shapes (pre-mapped by runHarnessXxx handlers) ─────────────────────

interface CliFlowSummary {
  id: string;
  name: string;
  description: string;
  capability?: string;
  phases: string[];
  checkpoints: number;
  artifacts: number;
  coversTools: string[];
  tags?: string[];
}

interface CliRunSummary {
  runId: string;
  moduleId: string;
  status: string;
  currentPhase?: string;
  checkpoints: { total: number; pass: number; fail: number; warn: number; skip: number };
  artifacts: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// ── Formatting Helpers ────────────────────────────────────────────────────────

/** Format a flow summary as a human-readable block. */
function formatFlowSummary(f: CliFlowSummary): string {
  const phases = f.phases.join(" → ");
  const tools = f.coversTools.join(", ");
  const tags = f.tags?.join(", ") ?? "—";
  return [
    `  ${f.id}`,
    `    Name:        ${f.name}`,
    `    Description: ${f.description}`,
    `    Capability:  ${f.capability ?? "—"}`,
    `    Phases:      ${phases}`,
    `    Checkpoints: ${f.checkpoints}`,
    `    Artifacts:   ${f.artifacts}`,
    `    Tools:       ${tools}`,
    `    Tags:        ${tags}`,
    ``,
  ].join("\n");
}

/** Format a runs list entry as a human-readable summary line. */
function formatRunSummaryLine(r: CliRunSummary): string {
  const cp = r.checkpoints;
  return [
    `  [${r.status.toUpperCase()}]`,
    r.moduleId,
    `cp:${cp.total}`,
    `P:${cp.pass} F:${cp.fail} W:${cp.warn} S:${cp.skip}`,
    `artifacts:${r.artifacts}`,
    r.runId,
  ].join(" ");
}

/** Format artifact list for human-readable output. */
function formatArtifactList(runId: string, names: string[]): string {
  if (names.length === 0) {
    return `  Run ${runId} has no artifacts.`;
  }
  const lines = names.map((n) => `    ${n}`);
  return [`  Artifacts for run ${runId}:`, ...lines].join("\n");
}

/** Format log entries for human-readable output. */
function formatLogs(logs: Array<Record<string, unknown>>): string {
  if (logs.length === 0) {
    return "  No log entries.";
  }
  return logs
    .map((entry) => {
      const ts = (entry.ts as string)?.slice(0, 19) ?? "?";
      const type = entry.type ?? "?";
      const rest = { ...entry };
      delete rest.ts;
      delete rest.type;
      const detail =
        Object.keys(rest).length > 0
          ? " " + JSON.stringify(rest)
          : "";
      return `  [${ts}] ${type}${detail}`;
    })
    .join("\n");
}

// ── 1. harness list ───────────────────────────────────────────────────────────

export function runHarnessList(): CliResult {
  try {
    ensureRegistry();
    const manifests = listManifestDetails();
    return ok({
      count: manifests.length,
      flows: manifests.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        capability: m.capability,
        phases: m.phases.map((p) => p.name),
        checkpoints: m.checkpoints.length,
        artifacts: m.artifacts.length,
        coversTools: m.coversTools,
        tags: m.tags,
      })),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ── 2. harness run ────────────────────────────────────────────────────────────

export interface HarnessRunOpts {
  flowId: string;
  inputFile?: string;
  /** Optional override for runs directory. */
  runsDir?: string;
}

export async function runHarnessRun(opts: HarnessRunOpts): Promise<CliResult> {
  // Parse --input file
  let input: unknown = {};
  if (opts.inputFile) {
    const parsed = readInputFile(opts.inputFile);
    if (!parsed.ok) {
      return fail(parsed.error);
    }
    input = parsed.data;
  }

  // Override runs dir if specified
  if (opts.runsDir) {
    setRunsDir(opts.runsDir);
  }

  // Load registry
  try {
    ensureRegistry();
  } catch (err) {
    return fail(`Failed to load harness registry: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Check flow exists
  if (!hasModule(opts.flowId)) {
    const available = listManifestDetails().map((m) => m.id).join(", ");
    return fail(
      `Flow "${opts.flowId}" not found in registry. Available flows: [${available}]`,
    );
  }

  // Run the flow
  try {
    const state = await runModule(opts.flowId, { input });
    return ok(state);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ── 3. harness check ──────────────────────────────────────────────────────────

export interface HarnessCheckOpts {
  flowId: string;
  /** If true, skip runtime checks (rules 11–15). */
  manifestOnly?: boolean;
}

/**
 * Check a single harness flow using the 15-rule check engine.
 *
 * Runs manifest checks (rules 1–10) and optionally runtime checks
 * (rules 11–15). Runtime checks execute the flow with mock adapters.
 */
export async function runHarnessCheck(opts: HarnessCheckOpts): Promise<CliResult> {
  try {
    ensureRegistry();
  } catch (err) {
    return fail(`Failed to load harness registry: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!getManifest(opts.flowId)) {
    const available = listManifestDetails().map((m) => m.id).join(", ");
    return fail(
      `Flow "${opts.flowId}" not found in registry. Available flows: [${available}]`,
    );
  }

  try {
    const report = await checkFlow(opts.flowId, {
      manifestOnly: opts.manifestOnly,
    });
    return ok(report);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ── 3b. harness check-all ─────────────────────────────────────────────────────

export interface HarnessCheckAllOpts {
  /** If true, skip runtime checks for all flows. */
  manifestOnly?: boolean;
  /** If true, write artifacts/check-report.md and .json. */
  writeReport?: boolean;
}

/**
 * Check all registered harness flows and produce a batch report.
 *
 * Optionally writes reports to disk (artifacts/check-report.md and
 * artifacts/check-report.json).
 */
export async function runHarnessCheckAll(
  opts: HarnessCheckAllOpts = {},
): Promise<CliResult> {
  try {
    ensureRegistry();
  } catch (err) {
    return fail(`Failed to load harness registry: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const batchReport = await checkAllFlows({
      manifestOnly: opts.manifestOnly,
    });

    // Optionally write reports to disk
    let reportPaths: { jsonPath: string; mdPath: string } | undefined;
    if (opts.writeReport) {
      reportPaths = writeCheckReports(batchReport);
    }

    return ok({
      batchReport,
      ...(reportPaths ? { reportPaths } : {}),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ── 4. harness runs ───────────────────────────────────────────────────────────

export interface HarnessRunsOpts {
  /** Optional override for runs directory. */
  runsDir?: string;
}

export function runHarnessRuns(opts: HarnessRunsOpts = {}): CliResult {
  try {
    if (opts.runsDir) {
      setRunsDir(opts.runsDir);
    }

    const runIds = listRuns();
    const states: RunState[] = [];

    for (const runId of runIds) {
      const state = loadState(runId);
      if (state) {
        states.push(state);
      }
    }

    return ok({
      count: states.length,
      runs: states.map((s) => ({
        runId: s.runId,
        moduleId: s.moduleId,
        status: s.status,
        currentPhase: s.currentPhase,
        checkpoints: {
          total: s.checkpoints.length,
          pass: s.checkpoints.filter((c) => c.outcome === "pass").length,
          fail: s.checkpoints.filter((c) => c.outcome === "fail").length,
          warn: s.checkpoints.filter((c) => c.outcome === "warn").length,
          skip: s.checkpoints.filter((c) => c.outcome === "skip").length,
        },
        artifacts: s.artifacts.length,
        error: s.error ? `${s.error.name}: ${s.error.message}` : undefined,
        createdAt: s.createdAt,
        completedAt: s.completedAt,
      })),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ── 5. harness show ───────────────────────────────────────────────────────────

export interface HarnessShowOpts {
  runId: string;
  /** Optional override for runs directory. */
  runsDir?: string;
}

export function runHarnessShow(opts: HarnessShowOpts): CliResult {
  try {
    if (opts.runsDir) {
      setRunsDir(opts.runsDir);
    }

    const state = loadState(opts.runId as import("../harness/core/types.js").RunId);
    if (!state) {
      const runIds = listRuns();
      const hint =
        runIds.length > 0
          ? ` Available runs: [${runIds.join(", ")}]`
          : " No runs found.";
      return fail(`Run "${opts.runId}" not found.${hint}`);
    }

    return ok(state);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ── 6. harness logs ───────────────────────────────────────────────────────────

export interface HarnessLogsOpts {
  runId: string;
  /** Optional override for runs directory. */
  runsDir?: string;
}

export function runHarnessLogs(opts: HarnessLogsOpts): CliResult {
  try {
    if (opts.runsDir) {
      setRunsDir(opts.runsDir);
    }

    const runId = opts.runId as import("../harness/core/types.js").RunId;

    // Verify the run exists
    const state = loadState(runId);
    if (!state) {
      const runIds = listRuns();
      const hint =
        runIds.length > 0
          ? ` Available runs: [${runIds.join(", ")}]`
          : " No runs found.";
      return fail(`Run "${opts.runId}" not found.${hint}`);
    }

    const logs = readLogs(runId);

    return ok({
      runId: opts.runId,
      status: state.status,
      count: logs.length,
      entries: logs,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ── 7. harness artifacts ──────────────────────────────────────────────────────

export interface HarnessArtifactsOpts {
  runId: string;
  /** Optional artifact name to read a specific artifact. */
  name?: string;
  /** Optional override for runs directory. */
  runsDir?: string;
}

export function runHarnessArtifacts(opts: HarnessArtifactsOpts): CliResult {
  try {
    if (opts.runsDir) {
      setRunsDir(opts.runsDir);
    }

    const runId = opts.runId as import("../harness/core/types.js").RunId;

    // Verify the run exists
    const state = loadState(runId);
    if (!state) {
      const runIds = listRuns();
      const hint =
        runIds.length > 0
          ? ` Available runs: [${runIds.join(", ")}]`
          : " No runs found.";
      return fail(`Run "${opts.runId}" not found.${hint}`);
    }

    // If a specific artifact name is requested, read it
    if (opts.name) {
      const content = readArtifact(runId, opts.name);
      if (content === undefined) {
        const available = listArtifacts(runId);
        const hint =
          available.length > 0
            ? ` Available artifacts: [${available.join(", ")}]`
            : " Run has no artifacts.";
        return fail(`Artifact "${opts.name}" not found in run "${opts.runId}".${hint}`);
      }

      // Try to parse as JSON for structured output
      let parsed: unknown = content;
      try {
        parsed = JSON.parse(content);
      } catch {
        // Keep as raw string
      }

      return ok({
        runId: opts.runId,
        artifact: opts.name,
        content: parsed,
      });
    }

    // List all artifacts
    const names = listArtifacts(runId);
    const artifacts = names.map((name) => {
      const content = readArtifact(runId, name);
      return {
        name,
        size: content ? Buffer.byteLength(content, "utf-8") : 0,
      };
    });

    return ok({
      runId: opts.runId,
      count: artifacts.length,
      artifacts,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ── Human-Readable Formatters (used by CLI dispatcher) ────────────────────────

/**
 * Format a CliResult as a human-readable string.
 * Used when --json flag is NOT set.
 */
export function formatHumanReadable(command: string, result: CliResult): string {
  if (result.status === "error") {
    return `Error: ${result.error}`;
  }

  const data = result.data as Record<string, unknown>;

  switch (command) {
    case "list": {
      const flows = data.flows as CliFlowSummary[];
      if (!flows || flows.length === 0) {
        return "No flows registered.";
      }
      const header = `Registered harness flows (${data.count}):\n`;
      return header + flows.map((f) => formatFlowSummary(f)).join("");
    }

    case "run": {
      const state = data as unknown as RunState;
      if (!state) return "No run data.";
      return detailRun(state);
    }

    case "check": {
      const report = data as unknown as FlowCheckReport;
      if (!report) return "No check data.";

      const lines: string[] = [];
      const s = report.summary;
      lines.push(`Flow: ${report.flowId}`);
      lines.push(`Runnable: ${report.isRunnable ? "✓ YES" : "✗ NO"}`);
      lines.push(`Run ID: ${report.runId || "—"}`);
      lines.push(`Timestamp: ${report.timestamp}`);
      lines.push(`Summary: ${s.pass}P / ${s.fail}F / ${s.warn}W / ${s.skip}S (${s.total} checks)`);
      lines.push("");

      const ICONS: Record<string, string> = { pass: "✓", fail: "✗", warn: "⚠", skip: "○" };

      lines.push("── Manifest Checks ──");
      for (const c of report.manifestChecks) {
        const icon = ICONS[c.outcome] ?? "?";
        lines.push(`  ${icon} ${c.rule}: ${c.message}`);
      }
      lines.push("");

      lines.push("── Runtime Checks ──");
      for (const c of report.runtimeChecks) {
        const icon = ICONS[c.outcome] ?? "?";
        lines.push(`  ${icon} ${c.rule}: ${c.message}`);
      }

      return lines.join("\n");
    }

    case "check-all": {
      const batchReport = (data as { batchReport: BatchCheckReport }).batchReport;
      if (!batchReport) return "No check data.";

      const lines: string[] = [];
      const s = batchReport.summary;
      lines.push(`Batch Check Report — ${batchReport.timestamp}`);
      lines.push(`Flows checked: ${batchReport.totalFlows}`);
      lines.push(`Total checks: ${s.total} | ✓ ${s.pass} | ✗ ${s.fail} | ⚠ ${s.warn} | ○ ${s.skip}`);
      lines.push("");

      for (const flow of batchReport.flows) {
        const fs = flow.summary;
        const statusIcon = fs.fail === 0 ? "✓" : "✗";
        lines.push(
          `  ${statusIcon} ${flow.flowId}: ${fs.pass}P/${fs.fail}F/${fs.warn}W/${fs.skip}S | Runnable: ${flow.isRunnable ? "YES" : "NO"}`,
        );
      }

      const reportPaths = (data as { reportPaths?: { jsonPath: string; mdPath: string } }).reportPaths;
      if (reportPaths) {
        lines.push("");
        lines.push(`Reports written:`);
        lines.push(`  JSON: ${reportPaths.jsonPath}`);
        lines.push(`  MD:   ${reportPaths.mdPath}`);
      }

      return lines.join("\n");
    }

    case "runs": {
      const runs = data.runs as CliRunSummary[];
      if (!runs || runs.length === 0) {
        return "No runs found.";
      }
      const header = `Harness runs (${data.count}):\n`;
      return header + runs.map((r) => formatRunSummaryLine(r)).join("\n");
    }

    case "show": {
      const state = data as unknown as RunState;
      if (!state) return "No run data.";
      return detailRun(state);
    }

    case "logs": {
      const entries = data.entries as Array<Record<string, unknown>>;
      const header = `Logs for run ${data.runId} (${data.count} entries, status: ${data.status}):\n`;
      return header + formatLogs(entries ?? []);
    }

    case "artifacts": {
      // If reading a specific artifact
      if (data.artifact) {
        const content = data.content;
        if (typeof content === "string") {
          return `Artifact: ${data.artifact} (run ${data.runId})\n\n${content}`;
        }
        return `Artifact: ${data.artifact} (run ${data.runId})\n\n${JSON.stringify(content, null, 2)}`;
      }

      // Listing artifacts
      const artifacts = data.artifacts as Array<{ name: string; size: number }>;
      if (!artifacts || artifacts.length === 0) {
        return `Run ${data.runId} has no artifacts.`;
      }
      const lines = [`Artifacts for run ${data.runId} (${data.count}):`];
      for (const art of artifacts) {
        lines.push(`  ${art.name}  (${art.size} bytes)`);
      }
      return lines.join("\n");
    }

    default:
      return JSON.stringify(data, null, 2);
  }
}
