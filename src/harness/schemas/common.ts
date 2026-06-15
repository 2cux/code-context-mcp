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

export type JsonSchemaType = "object" | "string" | "integer" | "number" | "boolean" | "array" | "null";

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
    label: { type: "string", description: "Human-readable label" },
    outcome: { type: "string", enum: ["pass", "fail", "warn", "skip"] },
    message: { type: "string", description: "Optional diagnostic message" },
  },
  required: ["seq", "timestamp", "label", "outcome"],
};

/** Standard run record schema. */
export const runRecordSchema: JsonSchema = {
  type: "object",
  properties: {
    runId: { type: "string", description: "Unique run identifier" },
    manifestName: { type: "string" },
    scopeId: { type: "string" },
    status: { type: "string", enum: ["created", "running", "passed", "failed", "aborted"] },
    createdAt: { type: "string", description: "ISO 8601 creation timestamp" },
    completedAt: { type: "string", description: "ISO 8601 completion timestamp" },
    checkpoints: { type: "array", items: checkpointSchema },
    runReceiptId: { type: "string" },
    subReceiptIds: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["runId", "manifestName", "scopeId", "status", "createdAt", "checkpoints"],
};
