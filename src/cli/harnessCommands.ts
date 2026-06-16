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
import { validateJsonSchema } from "../harness/core/validate.js";
import {
  listRuns,
  loadState,
  setRunsDir,
} from "../harness/core/stateStore.js";
import { readLogs, detailRun } from "../harness/core/reporter.js";
import { listArtifacts, readArtifact } from "../harness/core/artifactStore.js";
import type { HarnessManifest, RunState } from "../harness/core/types.js";

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

// ── Manifest Check ────────────────────────────────────────────────────────────

/**
 * Validate a HarnessManifest for structural correctness.
 * Returns an array of error strings (empty = valid).
 */
function checkManifest(manifest: HarnessManifest): string[] {
  const errors: string[] = [];

  // Required fields
  if (!manifest.id || typeof manifest.id !== "string") {
    errors.push("manifest.id is required and must be a string");
  }
  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push("manifest.name is required and must be a string");
  }
  if (!manifest.description || typeof manifest.description !== "string") {
    errors.push("manifest.description is required and must be a string");
  }

  // Phases
  if (!Array.isArray(manifest.phases) || manifest.phases.length === 0) {
    errors.push("manifest.phases must be a non-empty array");
  } else {
    const phaseNames = new Set<string>();
    for (const phase of manifest.phases) {
      if (!phase.name || typeof phase.name !== "string") {
        errors.push(`manifest.phases: each phase must have a string "name"`);
      } else if (phaseNames.has(phase.name)) {
        errors.push(`manifest.phases: duplicate phase name "${phase.name}"`);
      } else {
        phaseNames.add(phase.name);
      }
    }
  }

  // Checkpoints
  if (!Array.isArray(manifest.checkpoints)) {
    errors.push("manifest.checkpoints must be an array");
  } else {
    const cpNames = new Set<string>();
    for (const cp of manifest.checkpoints) {
      if (!cp.name || typeof cp.name !== "string") {
        errors.push(`manifest.checkpoints: each checkpoint must have a string "name"`);
      } else if (cpNames.has(cp.name)) {
        errors.push(`manifest.checkpoints: duplicate checkpoint name "${cp.name}"`);
      } else {
        cpNames.add(cp.name);
      }
      if (!cp.expect || !["pass", "fail", "warn", "skip"].includes(cp.expect)) {
        errors.push(
          `manifest.checkpoints: "${cp.name}" has invalid expect "${cp.expect}" (must be pass|fail|warn|skip)`,
        );
      }
    }
  }

  // Artifacts
  if (!Array.isArray(manifest.artifacts)) {
    errors.push("manifest.artifacts must be an array");
  } else {
    for (const art of manifest.artifacts) {
      if (!art.name || typeof art.name !== "string") {
        errors.push(`manifest.artifacts: each artifact must have a string "name"`);
      }
    }
  }

  // coversTools
  if (!Array.isArray(manifest.coversTools)) {
    errors.push("manifest.coversTools must be an array");
  }

  // Input schema validation (if present)
  if (manifest.inputSchema) {
    const schemaValid = validateJsonSchema(manifest.inputSchema, {}, "inputSchema");
    if (!schemaValid.valid) {
      // Schema itself is valid JSON Schema structure — just check it's an object
      if (manifest.inputSchema.type !== "object") {
        errors.push("manifest.inputSchema: root type should be 'object' for flow inputs");
      }
    }
  }

  return errors;
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

export function runHarnessCheck(flowId: string): CliResult {
  try {
    ensureRegistry();
  } catch (err) {
    return fail(`Failed to load harness registry: ${err instanceof Error ? err.message : String(err)}`);
  }

  const manifest = getManifest(flowId);
  if (!manifest) {
    const available = listManifestDetails().map((m) => m.id).join(", ");
    return fail(
      `Flow "${flowId}" not found in registry. Available flows: [${available}]`,
    );
  }

  const errors = checkManifest(manifest);
  const warnings: string[] = [];

  // Check if the flow has a registered module (runnable)
  const isRunnable = hasModule(flowId);
  if (!isRunnable) {
    warnings.push(
      `Flow "${flowId}" has a manifest but no registered module — it cannot be executed via "harness run".`,
    );
  }

  // Check for common issues
  if (manifest.coversTools.length === 0) {
    warnings.push("manifest.coversTools is empty — flow exercises no MCP tools.");
  }
  if (manifest.checkpoints.length === 0) {
    warnings.push("manifest.checkpoints is empty — flow has no checkpoints defined.");
  }

  return ok({
    flowId,
    valid: errors.length === 0,
    errors,
    warnings,
    isRunnable,
    manifest: {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      phases: manifest.phases.map((p) => p.name),
      checkpoints: manifest.checkpoints.map((c) => ({ name: c.name, expect: c.expect })),
      artifacts: manifest.artifacts.map((a) => a.name),
      coversTools: manifest.coversTools,
      tags: manifest.tags,
      capability: manifest.capability,
    },
  });
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
      const errors = data.errors as string[];
      const warnings = data.warnings as string[];
      const valid = data.valid as boolean;
      const isRunnable = data.isRunnable as boolean;

      const lines: string[] = [];
      lines.push(`Flow: ${data.flowId}`);
      lines.push(`Valid: ${valid ? "✓ YES" : "✗ NO"}`);
      lines.push(`Runnable: ${isRunnable ? "✓ YES" : "✗ NO"}`);
      lines.push("");

      if (warnings && warnings.length > 0) {
        lines.push("Warnings:");
        for (const w of warnings) {
          lines.push(`  ⚠ ${w}`);
        }
        lines.push("");
      }

      if (errors && errors.length > 0) {
        lines.push("Errors:");
        for (const e of errors) {
          lines.push(`  ✗ ${e}`);
        }
        lines.push("");
      } else {
        lines.push("No structural errors found.");
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
