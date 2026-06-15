/**
 * Check Utilities
 *
 * Lightweight assertion helpers for flow checkpoints.
 * Each check returns a checkpoint outcome and message.
 * Checks never throw — they always return a result so the run continues.
 *
 * PRD §34: checkpoint 只记录，不阻塞 — 不中断执行。
 */

// ── Check Result ──────────────────────────────────────────────────────────────

export interface CheckResult {
  outcome: "pass" | "fail";
  message: string;
}

// ── Equality ───────────────────────────────────────────────────────────────────

/** Check that two values are strictly equal. */
export function checkEq<T>(actual: T, expected: T, label: string): CheckResult {
  const pass = actual === expected;
  return {
    outcome: pass ? "pass" : "fail",
    message: pass
      ? `${label}: OK`
      : `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  };
}

// ── Truthiness ────────────────────────────────────────────────────────────────

/** Check that a value is truthy. */
export function checkOk(value: unknown, label: string): CheckResult {
  const pass = Boolean(value);
  return {
    outcome: pass ? "pass" : "fail",
    message: pass ? `${label}: OK` : `${label}: expected truthy, got ${JSON.stringify(value)}`,
  };
}

// ── Type Checks ───────────────────────────────────────────────────────────────

/** Check that a value is a string. */
export function checkString(value: unknown, label: string): CheckResult {
  const pass = typeof value === "string";
  return {
    outcome: pass ? "pass" : "fail",
    message: pass
      ? `${label}: is string`
      : `${label}: expected string, got ${typeof value}`,
  };
}

/** Check that a value is a non-empty string. */
export function checkNonEmptyString(value: unknown, label: string): CheckResult {
  if (typeof value !== "string") {
    return { outcome: "fail", message: `${label}: expected string, got ${typeof value}` };
  }
  const pass = value.trim().length > 0;
  return {
    outcome: pass ? "pass" : "fail",
    message: pass ? `${label}: non-empty` : `${label}: string is empty`,
  };
}

// ── Existence ─────────────────────────────────────────────────────────────────

/** Check that a value is not null or undefined. */
export function checkExists(value: unknown, label: string): CheckResult {
  const pass = value !== null && value !== undefined;
  return {
    outcome: pass ? "pass" : "fail",
    message: pass ? `${label}: exists` : `${label}: is null or undefined`,
  };
}

// ── Numeric ───────────────────────────────────────────────────────────────────

/** Check that a number is within an inclusive range. */
export function checkRange(
  value: number,
  min: number,
  max: number,
  label: string,
): CheckResult {
  if (Number.isNaN(value)) {
    return { outcome: "fail", message: `${label}: value is NaN` };
  }
  const pass = value >= min && value <= max;
  return {
    outcome: pass ? "pass" : "fail",
    message: pass
      ? `${label}: ${value} ∈ [${min}, ${max}]`
      : `${label}: ${value} ∉ [${min}, ${max}]`,
  };
}

/** Check that a number is greater than a threshold. */
export function checkGt(value: number, threshold: number, label: string): CheckResult {
  if (Number.isNaN(value)) {
    return { outcome: "fail", message: `${label}: value is NaN` };
  }
  const pass = value > threshold;
  return {
    outcome: pass ? "pass" : "fail",
    message: pass
      ? `${label}: ${value} > ${threshold}`
      : `${label}: ${value} ≤ ${threshold}`,
  };
}
