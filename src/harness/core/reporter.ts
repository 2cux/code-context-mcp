/**
 * File Reporter
 *
 * Writes structured run events to logs.jsonl and checkpoints.jsonl under
 * the run directory. Also provides formatting functions for human and
 * machine consumption (summary, detail, JSON).
 *
 * Event types written to logs.jsonl:
 *   - phase     — phase transitions
 *   - log       — free-form informational messages
 *   - artifact  — artifact creation records
 *   - error     — error records
 *   - completed — run completion record
 *
 * Checkpoints are written to checkpoints.jsonl as a separate append-only log.
 *
 * PRD §34: receipt 升级为 run receipt，覆盖整个闭环执行。
 */

import * as fs from "node:fs";
import type { ArtifactEntry, Checkpoint, RunId, RunState, SerializedError } from "./types.js";
import { getRunsDir } from "./stateStore.js";
import { logsJsonlPath, checkpointsJsonlPath, runDirPath } from "../utils/runPaths.js";

// ── JSONL Helpers ─────────────────────────────────────────────────────────────

/** Append a JSON line to a file. Creates the file if it doesn't exist. */
function appendJsonl(filePath: string, entry: Record<string, unknown>): void {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(filePath, line, "utf-8");
}

/** ISO timestamp string for now. */
function now(): string {
  return new Date().toISOString();
}

/** Ensure the run directory exists. */
function ensureRunDir(runId: RunId): void {
  const dir = runDirPath(getRunsDir(), runId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Log Event Types ───────────────────────────────────────────────────────────

interface LogEntry {
  ts: string;
  type: "phase" | "log" | "artifact" | "error" | "completed";
  [key: string]: unknown;
}

// ── Record: Phase ─────────────────────────────────────────────────────────────

/** Record a phase change in logs.jsonl. */
export function recordPhase(runId: RunId, phase: string): void {
  ensureRunDir(runId);
  appendJsonl(logsJsonlPath(getRunsDir(), runId), {
    ts: now(),
    type: "phase",
    phase,
  });
}

// ── Record: Log ───────────────────────────────────────────────────────────────

/** Record a free-form log message in logs.jsonl. */
export function recordLog(runId: RunId, message: string): void {
  ensureRunDir(runId);
  appendJsonl(logsJsonlPath(getRunsDir(), runId), {
    ts: now(),
    type: "log",
    message,
  });
}

// ── Record: Checkpoint ────────────────────────────────────────────────────────

/** Record a checkpoint entry in checkpoints.jsonl. */
export function recordCheckpoint(runId: RunId, checkpoint: Checkpoint): void {
  ensureRunDir(runId);
  appendJsonl(checkpointsJsonlPath(getRunsDir(), runId), {
    ts: checkpoint.timestamp,
    seq: checkpoint.seq,
    phase: checkpoint.phase,
    label: checkpoint.label,
    outcome: checkpoint.outcome,
    ...(checkpoint.message !== undefined ? { message: checkpoint.message } : {}),
    ...(checkpoint.metadata !== undefined ? { metadata: checkpoint.metadata } : {}),
  });
}

// ── Record: Artifact ──────────────────────────────────────────────────────────

/** Record an artifact creation event in logs.jsonl. */
export function recordArtifact(runId: RunId, artifact: ArtifactEntry): void {
  ensureRunDir(runId);
  appendJsonl(logsJsonlPath(getRunsDir(), runId), {
    ts: now(),
    type: "artifact",
    name: artifact.name,
    path: artifact.path,
    ...(artifact.contentType !== undefined ? { contentType: artifact.contentType } : {}),
    size: artifact.size,
  });
}

// ── Record: Error ─────────────────────────────────────────────────────────────

/** Record an error event in logs.jsonl. */
export function recordError(runId: RunId, error: SerializedError): void {
  ensureRunDir(runId);
  appendJsonl(logsJsonlPath(getRunsDir(), runId), {
    ts: now(),
    type: "error",
    name: error.name,
    message: error.message,
    ...(error.stack !== undefined ? { stack: error.stack } : {}),
    ...(error.cause !== null && error.cause !== undefined ? { cause: error.cause } : {}),
  });
}

// ── Record: Completed ─────────────────────────────────────────────────────────

/** Record a run completion event in logs.jsonl. */
export function recordCompleted(runId: RunId): void {
  ensureRunDir(runId);
  appendJsonl(logsJsonlPath(getRunsDir(), runId), {
    ts: now(),
    type: "completed",
    runId,
  });
}

// ── Read Logs ─────────────────────────────────────────────────────────────────

/** Read all log entries from logs.jsonl. Skips malformed lines. Returns empty array if not found. */
export function readLogs(runId: RunId): LogEntry[] {
  const filePath = logsJsonlPath(getRunsDir(), runId);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (raw.length === 0) return [];
  const entries: LogEntry[] = [];
  for (const line of raw.split("\n")) {
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch {
      // Skip malformed lines (e.g. from a crash during write)
    }
  }
  return entries;
}

/** Read all checkpoint entries from checkpoints.jsonl. Skips malformed lines. Returns empty array if not found. */
export function readCheckpoints(runId: RunId): Checkpoint[] {
  const filePath = checkpointsJsonlPath(getRunsDir(), runId);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (raw.length === 0) return [];
  const entries: Checkpoint[] = [];
  for (const line of raw.split("\n")) {
    try {
      entries.push(JSON.parse(line) as Checkpoint);
    } catch {
      // Skip malformed lines (e.g. from a crash during write)
    }
  }
  return entries;
}

// ── Formatting: Summary ───────────────────────────────────────────────────────

/** Generate a one-line summary string for a run. */
export function summarizeRun(state: RunState): string {
  const passed = state.checkpoints.filter((c) => c.outcome === "pass").length;
  const failed = state.checkpoints.filter((c) => c.outcome === "fail").length;
  const warned = state.checkpoints.filter((c) => c.outcome === "warn").length;
  const skipped = state.checkpoints.filter((c) => c.outcome === "skip").length;

  return [
    `[${state.status.toUpperCase()}]`,
    state.moduleId,
    `cp:${state.checkpoints.length}`,
    `P:${passed} F:${failed} W:${warned} S:${skipped}`,
    `artifacts:${state.artifacts.length}`,
    state.runId,
  ].join(" ");
}

// ── Formatting: Detail ────────────────────────────────────────────────────────

/** Generate a multi-line detailed report for a run. */
export function detailRun(state: RunState): string {
  const lines: string[] = [
    `Run:        ${state.runId}`,
    `Module:     ${state.moduleId}`,
    `Status:     ${state.status}`,
    `Phase:      ${state.currentPhase ?? "—"}`,
    `Created:    ${state.createdAt}`,
    `Updated:    ${state.updatedAt}`,
    `Completed:  ${state.completedAt ?? "—"}`,
    `Error:      ${state.error ? `${state.error.name}: ${state.error.message}` : "—"}`,
    `Artifacts:  ${state.artifacts.length > 0 ? state.artifacts.map((a) => a.name).join(", ") : "—"}`,
    "",
    "Checkpoints:",
  ];

  const ICONS: Record<string, string> = { pass: "✓", fail: "✗", warn: "⚠", skip: "○" };

  for (const cp of state.checkpoints) {
    const icon = ICONS[cp.outcome] ?? "?";
    lines.push(
      `  ${icon} [${cp.seq}] ${cp.phase}/${cp.label}${cp.message ? ` — ${cp.message}` : ""}`,
    );
  }

  return lines.join("\n");
}

// ── Formatting: JSON ──────────────────────────────────────────────────────────

/** Serialize a run state as formatted JSON. */
export function jsonRun(state: RunState): string {
  return JSON.stringify(state, null, 2);
}
