/**
 * Common Schema Utilities
 *
 * Shared JSON Schema fragments and helpers used across flow schemas.
 * Each flow schema defines the expected shape of run artifacts and
 * checkpoint metadata for that flow.
 *
 * PRD §34: Schema 定义 Run 产物的预期结构。
 */

// ── JSON Schema Type (lightweight, no dependency) ─────────────────────────────

export type JsonSchemaType =
  | "object"
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "array"
  | "null";

export interface JsonSchema {
  type?: JsonSchemaType;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  description?: string;
  additionalProperties?: boolean;
}

// ── Common Fragments ──────────────────────────────────────────────────────────

/** Standard checkpoint entry schema. */
export const checkpointSchema: JsonSchema = {
  type: "object",
  properties: {
    seq: { type: "integer", description: "Monotonic sequence number" },
    timestamp: { type: "string", description: "ISO 8601 timestamp" },
    phase: { type: "string", description: "Phase active when checkpoint was logged" },
    label: { type: "string", description: "Human-readable label" },
    outcome: {
      type: "string",
      enum: ["pass", "fail", "warn", "skip"],
    },
    message: { type: "string", description: "Optional diagnostic message" },
  },
  required: ["seq", "timestamp", "phase", "label", "outcome"],
};

/** Standard run state schema. */
export const runStateSchema: JsonSchema = {
  type: "object",
  properties: {
    runId: { type: "string", description: "Unique run identifier" },
    moduleId: { type: "string", description: "Manifest id that defined this run" },
    status: {
      type: "string",
      enum: ["created", "running", "failed", "completed"],
    },
    currentPhase: { type: "string", description: "Currently executing phase" },
    input: { description: "Input data supplied to the run" },
    output: { description: "Output data produced by the run" },
    artifacts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          path: { type: "string" },
          contentType: { type: "string" },
          size: { type: "integer" },
        },
        required: ["name", "path", "size"],
      },
    },
    checkpoints: { type: "array", items: checkpointSchema },
    error: {
      type: "object",
      properties: {
        name: { type: "string" },
        message: { type: "string" },
        stack: { type: "string" },
      },
      required: ["name", "message"],
    },
    createdAt: { type: "string", description: "ISO 8601 creation timestamp" },
    updatedAt: { type: "string", description: "ISO 8601 last-updated timestamp" },
    completedAt: { type: "string", description: "ISO 8601 completion timestamp" },
  },
  required: ["runId", "moduleId", "status", "input", "createdAt", "updatedAt", "checkpoints", "artifacts"],
};

/**
 * @deprecated Use `runStateSchema` instead.
 */
export const runRecordSchema = runStateSchema;
