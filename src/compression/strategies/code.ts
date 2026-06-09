/**
 * Code Compressor — Phase 4
 *
 * Conservative code compression. MUST preserve:
 *   file path, imports, exports, type/interface, function signatures,
 *   class signatures, public methods, TODO/FIXME, error-related blocks,
 *   query-related blocks, line numbers.
 * MUST NOT: rewrite code semantics, delete public API, delete type defs,
 *   delete error-related lines.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens } from "../../utils/tokenCount.js";

export const codeStrategy: CompressionStrategy = {
  name: "code",
  version: "0.1.0",
  compress: compressCode,
};

// ---------------------------------------------------------------------------
// Legacy function export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressCode(
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
    warnings: ["Code compression not yet implemented (Phase 4) — returned original"],
    summary: "Code compression stub — returning original",
  };
}
