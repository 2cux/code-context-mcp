/**
 * RAG Chunk Detector — Phase 2
 *
 * Detects RAG (Retrieval-Augmented Generation) chunk result data.
 * Signals: source, chunk, document, metadata, score fields.
 */

import type { DetectionResult } from "../contentRouter.js";
import { computeConfidence, matchSignals } from "../contentRouter.js";

// ---------------------------------------------------------------------------
// Signal patterns
// ---------------------------------------------------------------------------

const SIGNALS: Record<string, RegExp> = {
  // Use (?:_|\b) suffix so "chunk" matches "chunk_id" but NOT "chunky"
  source: /\bsource(?:_|\b)/i,
  chunk: /\bchunk(?:_|\b)/i,
  document: /\bdocument(?:_|\b)/i,
  metadata: /\bmetadata(?:_|\b)/i,
  score: /\bscore(?:_|\b)/i,
  chunk_id: /\bchunk[_\s]?id\b/i,
  document_id: /\bdocument[_\s]?id\b/i,
  excerpt: /\bexcerpt\b/i,
  relevance: /\brelevance\b/i,
};

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectRagChunk(content: string): DetectionResult | null {
  const signals = matchSignals(content, SIGNALS);
  if (signals.length === 0) return null;

  const confidence = computeConfidence(signals.length, Object.keys(SIGNALS).length, {
    minMatches: 2,
  });

  if (confidence < 0.2) return null;

  return {
    contentType: "rag_chunk",
    confidence,
    signals,
  };
}
