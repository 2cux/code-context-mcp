/**
 * JSON Schema Validation
 *
 * Lightweight JSON Schema validator for harness input/output validation.
 * Reuses the project's existing JsonSchema type from schemas/common.ts.
 *
 * Covers: object (with properties, required), array (with items),
 * string, integer, number, boolean, null.
 *
 * Not a full JSON Schema implementation — intentionally limited to the
 * shapes used by HarnessManifest.inputSchema / .outputSchema.
 *
 * PRD §34: 第一版可以复用项目现有 schema 工具。
 */

import type { JsonSchema } from "../schemas/common.js";

// ── Result ──────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  /** Whether the value passes validation. */
  valid: boolean;
  /** Human-readable error messages (empty if valid). */
  errors: string[];
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Validate a value against a JsonSchema.
 *
 * If schema is undefined or null, validation passes (no schema = no constraint).
 * Returns a structured result — never throws.
 */
export function validateJsonSchema(
  schema: JsonSchema | undefined,
  value: unknown,
  label = "value",
): ValidationResult {
  const errors: string[] = [];

  if (!schema) {
    return { valid: true, errors: [] };
  }

  _validate(schema, value, label, errors);
  return { valid: errors.length === 0, errors };
}

// ── Internal Recursive Validator ────────────────────────────────────────────────

function _validate(
  schema: JsonSchema,
  value: unknown,
  path: string,
  errors: string[],
): void {
  // ── Enum check (before type check — constrains allowed values) ──────────

  if (schema.enum && schema.enum.length > 0) {
    if (typeof value !== "string" || !schema.enum.includes(value)) {
      errors.push(
        `${path}: expected one of [${schema.enum.join(", ")}], got ${_typeName(value)}${typeof value === "string" ? ` "${value}"` : ""}`,
      );
      return; // Stop further validation — enum fully constrains the value
    }
    // Value is a valid enum member — continue with type checks below
  }

  // ── Type check ──────────────────────────────────────────────────────────────

  if (schema.type === "object") {
    _validateObject(schema, value, path, errors);
  } else if (schema.type === "array") {
    _validateArray(schema, value, path, errors);
  } else if (schema.type === "string") {
    if (typeof value !== "string") {
      errors.push(`${path}: expected string, got ${_typeName(value)}`);
    }
  } else if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      errors.push(`${path}: expected integer, got ${_typeName(value)}`);
    }
  } else if (schema.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push(`${path}: expected number, got ${_typeName(value)}`);
    }
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      errors.push(`${path}: expected boolean, got ${_typeName(value)}`);
    }
  } else if (schema.type === "null") {
    if (value !== null) {
      errors.push(`${path}: expected null, got ${_typeName(value)}`);
    }
  }
  // Unknown type is silently ignored (lenient parsing)
}

// ── Object Validation ───────────────────────────────────────────────────────────

function _validateObject(
  schema: JsonSchema,
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path}: expected object, got ${_typeName(value)}`);
    return;
  }

  const obj = value as Record<string, unknown>;

  // Required properties
  if (schema.required) {
    for (const key of schema.required) {
      if (!(key in obj) || obj[key] === undefined) {
        errors.push(`${path}.${key}: required property missing`);
      }
    }
  }

  // Property validation
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj && obj[key] !== undefined) {
        _validate(propSchema, obj[key], `${path}.${key}`, errors);
      }
    }
  }

  // Disallow additional properties
  if (schema.additionalProperties === false && schema.properties) {
    const known = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(obj)) {
      if (!known.has(key)) {
        errors.push(`${path}.${key}: unexpected property`);
      }
    }
  }
}

// ── Array Validation ────────────────────────────────────────────────────────────

function _validateArray(
  schema: JsonSchema,
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array, got ${_typeName(value)}`);
    return;
  }

  if (schema.items) {
    for (let i = 0; i < value.length; i++) {
      _validate(schema.items, value[i], `${path}[${i}]`, errors);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function _typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
