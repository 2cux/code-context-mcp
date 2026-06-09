/**
 * Markdown Compressor — Phase 4
 *
 * Preserves: headings, key paragraphs, list structure, code block summaries,
 * source refs. Folds: repeated descriptions, low-relevance paragraphs, long examples.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens } from "../../utils/tokenCount.js";

export const markdownStrategy: CompressionStrategy = {
  name: "markdown",
  version: "0.1.0",
  compress: compressMarkdown,
};

// ---------------------------------------------------------------------------
// Legacy function export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressMarkdown(
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
    warnings: ["Markdown compression not yet implemented (Phase 4) — returned original"],
    summary: "Markdown compression stub — returning original",
  };
}
