/**
 * Validate (JSON Schema) Tests
 *
 * Covers: validateJsonSchema for all supported types (object, array,
 * string, integer, number, boolean, null), required properties,
 * additionalProperties: false, enum, nested schemas, edge cases.
 *
 * PRD §34: Harness input/output validation.
 */

import { describe, it, expect } from "vitest";
import { validateJsonSchema } from "../../src/harness/core/validate.js";
import type { JsonSchema } from "../../src/harness/schemas/common.js";

// ── Undefined / Null Schema ──────────────────────────────────────────────────

describe("validateJsonSchema: no-schema passthrough", () => {
  it("passes when schema is undefined", () => {
    const result = validateJsonSchema(undefined, { anything: true });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("passes any value when schema is undefined (null, number, etc.)", () => {
    expect(validateJsonSchema(undefined, null).valid).toBe(true);
    expect(validateJsonSchema(undefined, 42).valid).toBe(true);
    expect(validateJsonSchema(undefined, "hello").valid).toBe(true);
  });
});

// ── String ───────────────────────────────────────────────────────────────────

describe("validateJsonSchema: string", () => {
  const schema: JsonSchema = { type: "string" };

  it("passes for string values", () => {
    expect(validateJsonSchema(schema, "hello").valid).toBe(true);
    expect(validateJsonSchema(schema, "").valid).toBe(true);
  });

  it("fails for non-string values", () => {
    expect(validateJsonSchema(schema, 42).valid).toBe(false);
    expect(validateJsonSchema(schema, true).valid).toBe(false);
    expect(validateJsonSchema(schema, null).valid).toBe(false);
    expect(validateJsonSchema(schema, {}).valid).toBe(false);
    expect(validateJsonSchema(schema, []).valid).toBe(false);
  });

  it("includes descriptive error message", () => {
    const result = validateJsonSchema(schema, 42, "myField");
    expect(result.errors[0]).toContain("myField");
    expect(result.errors[0]).toContain("expected string");
    expect(result.errors[0]).toContain("number");
  });
});

// ── Integer ──────────────────────────────────────────────────────────────────

describe("validateJsonSchema: integer", () => {
  const schema: JsonSchema = { type: "integer" };

  it("passes for integer values", () => {
    expect(validateJsonSchema(schema, 0).valid).toBe(true);
    expect(validateJsonSchema(schema, 42).valid).toBe(true);
    expect(validateJsonSchema(schema, -1).valid).toBe(true);
  });

  it("fails for floats", () => {
    expect(validateJsonSchema(schema, 3.14).valid).toBe(false);
  });

  it("fails for non-number values", () => {
    expect(validateJsonSchema(schema, "42").valid).toBe(false);
    expect(validateJsonSchema(schema, null).valid).toBe(false);
  });
});

// ── Number ───────────────────────────────────────────────────────────────────

describe("validateJsonSchema: number", () => {
  const schema: JsonSchema = { type: "number" };

  it("passes for integer and float values", () => {
    expect(validateJsonSchema(schema, 42).valid).toBe(true);
    expect(validateJsonSchema(schema, 3.14).valid).toBe(true);
    expect(validateJsonSchema(schema, -0.5).valid).toBe(true);
  });

  it("fails for NaN", () => {
    expect(validateJsonSchema(schema, NaN).valid).toBe(false);
  });

  it("fails for non-number values", () => {
    expect(validateJsonSchema(schema, "42").valid).toBe(false);
    expect(validateJsonSchema(schema, true).valid).toBe(false);
  });
});

// ── Boolean ──────────────────────────────────────────────────────────────────

describe("validateJsonSchema: boolean", () => {
  const schema: JsonSchema = { type: "boolean" };

  it("passes for boolean values", () => {
    expect(validateJsonSchema(schema, true).valid).toBe(true);
    expect(validateJsonSchema(schema, false).valid).toBe(true);
  });

  it("fails for non-boolean values", () => {
    expect(validateJsonSchema(schema, 1).valid).toBe(false);
    expect(validateJsonSchema(schema, "true").valid).toBe(false);
    expect(validateJsonSchema(schema, null).valid).toBe(false);
  });
});

// ── Null ─────────────────────────────────────────────────────────────────────

describe("validateJsonSchema: null", () => {
  const schema: JsonSchema = { type: "null" };

  it("passes for null", () => {
    expect(validateJsonSchema(schema, null).valid).toBe(true);
  });

  it("fails for non-null values", () => {
    expect(validateJsonSchema(schema, undefined).valid).toBe(false);
    expect(validateJsonSchema(schema, 0).valid).toBe(false);
    expect(validateJsonSchema(schema, "").valid).toBe(false);
  });
});

// ── Object ───────────────────────────────────────────────────────────────────

describe("validateJsonSchema: object", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "integer" },
    },
    required: ["name"],
  };

  it("passes for a valid object", () => {
    expect(validateJsonSchema(schema, { name: "Alice", age: 30 }).valid).toBe(true);
  });

  it("passes when optional properties are missing", () => {
    expect(validateJsonSchema(schema, { name: "Bob" }).valid).toBe(true);
  });

  it("fails when required property is missing", () => {
    const result = validateJsonSchema(schema, { age: 30 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name") && e.includes("required"))).toBe(true);
  });

  it("fails when a property has wrong type", () => {
    const result = validateJsonSchema(schema, { name: 42 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name") && e.includes("string"))).toBe(true);
  });

  it("fails for arrays (not objects)", () => {
    expect(validateJsonSchema(schema, []).valid).toBe(false);
  });

  it("fails for null", () => {
    expect(validateJsonSchema(schema, null).valid).toBe(false);
  });

  it("fails for primitive values", () => {
    expect(validateJsonSchema(schema, "hello").valid).toBe(false);
    expect(validateJsonSchema(schema, 42).valid).toBe(false);
  });
});

// ── additionalProperties: false ──────────────────────────────────────────────

describe("validateJsonSchema: additionalProperties", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
    },
    additionalProperties: false,
  };

  it("passes when only known properties are present", () => {
    expect(validateJsonSchema(schema, { id: "abc" }).valid).toBe(true);
  });

  it("fails when unknown properties are present", () => {
    const result = validateJsonSchema(schema, { id: "abc", extra: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("extra") && e.includes("unexpected"))).toBe(true);
  });

  it("passes when no properties are present (empty object)", () => {
    // No required fields, so empty object is valid
    expect(validateJsonSchema(schema, {}).valid).toBe(true);
  });
});

// ── Array ────────────────────────────────────────────────────────────────────

describe("validateJsonSchema: array", () => {
  const schema: JsonSchema = {
    type: "array",
    items: { type: "string" },
  };

  it("passes for arrays of correct item type", () => {
    expect(validateJsonSchema(schema, ["a", "b", "c"]).valid).toBe(true);
    expect(validateJsonSchema(schema, []).valid).toBe(true);
  });

  it("fails for non-array values", () => {
    expect(validateJsonSchema(schema, "not-an-array").valid).toBe(false);
    expect(validateJsonSchema(schema, { 0: "a" }).valid).toBe(false);
    expect(validateJsonSchema(schema, null).valid).toBe(false);
  });

  it("fails when array item has wrong type", () => {
    const result = validateJsonSchema(schema, ["a", 42, "c"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("[1]") && e.includes("string"))).toBe(true);
  });
});

// ── Array of Objects ─────────────────────────────────────────────────────────

describe("validateJsonSchema: array of objects", () => {
  const schema: JsonSchema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "integer" },
        label: { type: "string" },
      },
      required: ["id"],
    },
  };

  it("passes for valid array of objects", () => {
    expect(
      validateJsonSchema(schema, [
        { id: 1, label: "first" },
        { id: 2 },
      ]).valid,
    ).toBe(true);
  });

  it("fails when a required property is missing in an item", () => {
    const result = validateJsonSchema(schema, [{ label: "no-id" }]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("[0].id") && e.includes("required"))).toBe(true);
  });

  it("fails when an item has wrong type", () => {
    const result = validateJsonSchema(schema, [{ id: 1 }, { id: "not-int" }]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("integer"))).toBe(true);
  });
});

// ── Enum ─────────────────────────────────────────────────────────────────────

describe("validateJsonSchema: enum", () => {
  const schema: JsonSchema = {
    type: "string",
    enum: ["pass", "fail", "warn", "skip"],
  };

  it("passes for valid enum values", () => {
    expect(validateJsonSchema(schema, "pass").valid).toBe(true);
    expect(validateJsonSchema(schema, "fail").valid).toBe(true);
    expect(validateJsonSchema(schema, "skip").valid).toBe(true);
  });

  it("fails for values not in enum", () => {
    const result = validateJsonSchema(schema, "blocked");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("expected one of");
  });

  it("fails for non-string values when enum is on a string schema", () => {
    expect(validateJsonSchema(schema, 42).valid).toBe(false);
  });
});

// ── Nested Objects ───────────────────────────────────────────────────────────

describe("validateJsonSchema: nested objects", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      config: {
        type: "object",
        properties: {
          debug: { type: "boolean" },
          port: { type: "integer" },
        },
        required: ["port"],
        additionalProperties: false,
      },
    },
    required: ["config"],
  };

  it("passes for deeply valid nested object", () => {
    expect(
      validateJsonSchema(schema, {
        config: { debug: true, port: 3000 },
      }).valid,
    ).toBe(true);
  });

  it("fails when nested required property is missing", () => {
    const result = validateJsonSchema(schema, { config: { debug: false } });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("config.port") && e.includes("required"))).toBe(true);
  });

  it("fails when nested property has wrong type", () => {
    const result = validateJsonSchema(schema, { config: { port: "3000" } });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("config.port") && e.includes("integer"))).toBe(true);
  });

  it("fails when nested object has extra properties", () => {
    const result = validateJsonSchema(schema, {
      config: { port: 3000, unknown: true },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown") && e.includes("unexpected"))).toBe(true);
  });
});

// ── Edge Cases ───────────────────────────────────────────────────────────────

describe("validateJsonSchema: edge cases", () => {
  it("passes when no required fields and empty object", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { optional: { type: "string" } },
    };
    expect(validateJsonSchema(schema, {}).valid).toBe(true);
  });

  it("handles undefined property values (treated as missing)", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { name: { type: "string" } },
    };
    // Property exists but is undefined — treated as missing, not type-checked
    expect(validateJsonSchema(schema, { name: undefined }).valid).toBe(true);
  });

  it("handles unknown schema type gracefully (lenient)", () => {
    const schema = { type: "unknown_type" } as unknown as JsonSchema;
    // Unknown types are silently ignored
    expect(validateJsonSchema(schema, "anything").valid).toBe(true);
  });

  it("returns multiple errors for multiple violations", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer" },
      },
      required: ["name", "count"],
    };
    const result = validateJsonSchema(schema, {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
