/**
 * Run Reporter
 *
 * Formats and outputs RunRecord results for human and machine consumption.
 * Supports summary, detail, and JSON output modes.
 *
 * PRD §34: receipt 升级为 run receipt，覆盖整个闭环执行。
 */

import type { RunRecord } from "./types.js";

// ── Summary ───────────────────────────────────────────────────────────────────

/** Generate a one-line summary string for a run. */
export function summarizeRun(record: RunRecord): string {
  const passed = record.checkpoints.filter((c) => c.outcome === "pass").length;
  const failed = record.checkpoints.filter((c) => c.outcome === "fail").length;
  const warned = record.checkpoints.filter((c) => c.outcome === "warn").length;
  const skipped = record.checkpoints.filter((c) => c.outcome === "skip").length;

  return [
    `[${record.status.toUpperCase()}]`,
    record.manifestName,
    `cp:${record.checkpoints.length}`,
    `P:${passed} F:${failed} W:${warned} S:${skipped}`,
    record.runId,
  ].join(" ");
}

// ── Detail ────────────────────────────────────────────────────────────────────

/** Generate a multi-line detailed report for a run. */
export function detailRun(record: RunRecord): string {
  const lines: string[] = [
    `Run:       ${record.runId}`,
    `Manifest:  ${record.manifestName}`,
    `Scope:     ${record.scopeId}`,
    `Status:    ${record.status}`,
    `Created:   ${record.createdAt}`,
    `Completed: ${record.completedAt ?? "—"}`,
    `Receipt:   ${record.runReceiptId ?? "—"}`,
    `Sub-Receipts: ${record.subReceiptIds.length > 0 ? record.subReceiptIds.join(", ") : "—"}`,
    `Tags:      ${record.tags.length > 0 ? record.tags.join(", ") : "—"}`,
    "",
    "Checkpoints:",
  ];

  const ICONS: Record<string, string> = { pass: "✓", fail: "✗", warn: "⚠", skip: "○" };

  for (const cp of record.checkpoints) {
    const icon = ICONS[cp.outcome] ?? "?";
    lines.push(`  ${icon} [${cp.seq}] ${cp.label}${cp.message ? ` — ${cp.message}` : ""}`);
  }

  return lines.join("\n");
}

// ── JSON ──────────────────────────────────────────────────────────────────────

/** Serialize a run record as formatted JSON. */
export function jsonRun(record: RunRecord): string {
  return JSON.stringify(record, null, 2);
}
