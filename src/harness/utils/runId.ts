/**
 * Run ID Generation
 *
 * Produces unique, sortable, human-readable Run identifiers.
 * Format: run_{YYYYMMDD}_{base36Timestamp}_{randomHex}_{counter}
 *
 * PRD §34: Run ID 生成工具。
 */

import { randomBytes } from "node:crypto";

// ── Counter ───────────────────────────────────────────────────────────────────

let counter = 0;

/** Reset the internal counter (test helper). */
export function resetRunCounter(value = 0): void {
  counter = value;
}

// ── Generation ────────────────────────────────────────────────────────────────

/** Generate a unique RunId. */
export function generateRunId(): string {
  const now = new Date();
  const date = [
    now.getFullYear().toString(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");

  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex");
  const seq = String(counter++).padStart(3, "0");

  return `run_${date}_${ts}_${rand}_${seq}`;
}

// ── Validation ────────────────────────────────────────────────────────────────

const RUN_ID_RE = /^run_\d{8}_[a-z0-9]+_[a-f0-9]+_\d{3,}$/;

/** Check whether a string is a valid RunId. */
export function isValidRunId(id: string): boolean {
  return RUN_ID_RE.test(id);
}
