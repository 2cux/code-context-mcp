/**
 * Compression Flow Schema
 *
 * Defines the expected shape of artifacts and checkpoint metadata
 * for the compression closed-loop flow.
 *
 * PRD §34: 压缩闭环 Schema。
 */

import type { JsonSchema } from "./common.js";

// ── Compression Result ────────────────────────────────────────────────────────

/** Schema for a single compression result artifact. */
export const compressionResultSchema: JsonSchema = {
  type: "object",
  properties: {
    ccrId: { type: "string", description: "Compressed context record ID" },
    contentType: { type: "string", description: "Detected content type" },
    originalTokens: { type: "integer", description: "Token count before compression" },
    compressedTokens: { type: "integer", description: "Token count after compression" },
    savingsPercent: { type: "number", description: "Token savings percentage" },
    strategy: { type: "string", description: "Compression strategy used" },
    truncated: { type: "boolean", description: "Whether content was truncated" },
  },
  required: ["ccrId", "contentType", "originalTokens", "compressedTokens", "strategy"],
};

// ── Flow Artifact ─────────────────────────────────────────────────────────────

/** Schema for the compression flow's aggregate output artifact. */
export const compressionFlowOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    totalInputs: { type: "integer" },
    totalCompressed: { type: "integer" },
    totalFailures: { type: "integer" },
    totalOriginalTokens: { type: "integer" },
    totalCompressedTokens: { type: "integer" },
    aggregateSavingsPercent: { type: "number" },
    results: { type: "array", items: compressionResultSchema },
  },
  required: ["totalInputs", "totalCompressed", "totalFailures"],
};
