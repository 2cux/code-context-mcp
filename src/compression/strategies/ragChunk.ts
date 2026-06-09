/**
 * RAG Chunk Compressor — Phase 4
 *
 * Preserves: source, document title, chunkId, score, key facts,
 * short excerpt, canExpand flag.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens } from "../../utils/tokenCount.js";

export const ragChunkStrategy: CompressionStrategy = {
  name: "rag_chunk",
  version: "0.1.0",
  compress: compressRagChunk,
};

// ---------------------------------------------------------------------------
// Legacy function export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressRagChunk(
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
    warnings: ["RAG chunk compression not yet implemented (Phase 4) — returned original"],
    summary: "RAG chunk compression stub — returning original",
  };
}
