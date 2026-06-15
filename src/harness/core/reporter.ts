/**
 * Run Reporter
 *
 * Formats and outputs RunState results for human and machine consumption.
 * Supports summary, detail, and JSON output modes.
 *
 * PRD §34: receipt 升级为 run receipt，覆盖整个闭环执行。
 */

import type { RunState } from "./types.js";

// ── Summary ───────────────────────────────────────────────────────────────────

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

// ── Detail ────────────────────────────────────────────────────────────────────

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

// ── JSON ──────────────────────────────────────────────────────────────────────

/** Serialize a run state as formatted JSON. */
export function jsonRun(state: RunState): string {
  return JSON.stringify(state, null, 2);
}
