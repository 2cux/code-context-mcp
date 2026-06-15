/**
 * Memory Flow Schema
 *
 * Defines the expected shape of artifacts and checkpoint metadata
 * for the memory lifecycle closed-loop flow.
 *
 * PRD §34: 记忆闭环 Schema。
 */

import type { JsonSchema } from "./common.js";

// ── Memory Result ─────────────────────────────────────────────────────────────

/** Schema for a single memory operation result. */
export const memoryOperationResultSchema: JsonSchema = {
  type: "object",
  properties: {
    operation: { type: "string", enum: ["remember", "recall", "forget", "list"], description: "Memory operation type" },
    memoryId: { type: "string", description: "Memory record ID (for remember/forget)" },
    memoryType: { type: "string", description: "Memory type (fact, decision, reference, feedback)" },
    status: { type: "string", enum: ["active", "superseded", "forgotten", "expired", "deleted"] },
    recallCount: { type: "integer", description: "Number of results (for recall/list)" },
    error: { type: "string", description: "Error message if operation failed" },
  },
  required: ["operation"],
};

// ── Flow Artifact ─────────────────────────────────────────────────────────────

/** Schema for the memory flow's aggregate output artifact. */
export const memoryFlowOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    totalOperations: { type: "integer" },
    remembered: { type: "integer" },
    recalled: { type: "integer" },
    forgotten: { type: "integer" },
    failures: { type: "integer" },
    results: { type: "array", items: memoryOperationResultSchema },
  },
  required: ["totalOperations", "remembered", "failures"],
};
