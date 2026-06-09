/**
 * JSON Compressor — Phase 4
 *
 * Preserves: top-level keys, schema shape, error fields, status fields,
 * ID fields, important nested paths, array samples.
 * Folds: long arrays, repeated objects, very long text fields.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens } from "../../utils/tokenCount.js";

export const jsonStrategy: CompressionStrategy = {
  name: "json",
  version: "0.1.0",
  compress: compressJson,
};

// ---------------------------------------------------------------------------
// Legacy function export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressJson(
  content: string,
  maxTokens: number,
): StrategyResult {
  // TODO: Phase 4
  const tokens = countTokens(content);
  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings: [] };
  }
  return {
    compressedContent: content,
    warnings: ["JSON compression not yet implemented (Phase 4) — returned original"],
    summary: "JSON compression stub — returning original",
  };
}
