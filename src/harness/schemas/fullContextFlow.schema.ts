/**
 * Full Context Flow Schema
 *
 * Defines the expected shape of artifacts and checkpoint metadata
 * for the complete compression + memory acceptance flow.
 *
 * PRD §34: 完整压缩 + 记忆验收 Schema。
 */

import type { JsonSchema } from "./common.js";

// ── Stage Result ──────────────────────────────────────────────────────────────

/** Schema for each stage of the full context flow. */
export const stageResultSchema: JsonSchema = {
  type: "object",
  properties: {
    stage: { type: "string", description: "Stage name (compress, memory, profile, receipt)" },
    passed: { type: "integer" },
    failed: { type: "integer" },
    warnings: { type: "integer" },
  },
  required: ["stage", "passed", "failed"],
};

// ── Flow Artifact ─────────────────────────────────────────────────────────────

/** Schema for the full context flow's aggregate output artifact. */
export const fullContextFlowOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    overallStatus: { type: "string", enum: ["passed", "failed"] },
    totalCheckpoints: { type: "integer" },
    passedCheckpoints: { type: "integer" },
    failedCheckpoints: { type: "integer" },
    stages: { type: "array", items: stageResultSchema },
    runReceiptId: { type: "string" },
  },
  required: ["overallStatus", "totalCheckpoints", "passedCheckpoints", "failedCheckpoints"],
};
