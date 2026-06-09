/**
 * ContentRouter — Phase 2
 *
 * Detects content type and selects the appropriate compression strategy.
 * Supported types: test_output, log, command_output, code, json,
 * markdown, plain_text, rag_chunk, file_summary, conversation_history, unknown.
 */

import { detectTestOutput } from "./detectors/testOutputDetector.js";
import { detectLog } from "./detectors/logDetector.js";
import { detectCommandOutput } from "./detectors/commandOutputDetector.js";
import { detectCode } from "./detectors/codeDetector.js";
import { detectJson } from "./detectors/jsonDetector.js";
import { detectMarkdown } from "./detectors/markdownDetector.js";
import { detectRagChunk } from "./detectors/ragChunkDetector.js";
import { detectConversationHistory } from "./detectors/conversationHistoryDetector.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentType =
  | "test_output"
  | "log"
  | "command_output"
  | "code"
  | "json"
  | "markdown"
  | "plain_text"
  | "rag_chunk"
  | "file_summary"
  | "conversation_history"
  | "unknown";

export interface DetectionResult {
  contentType: ContentType;
  confidence: number;
  signals: string[];
}

/**
 * A detector is a function that analyses content and either returns
 * a DetectionResult (with a confidence score and matched signals) or
 * null when it cannot detect its target type.
 */
export interface Detector {
  (content: string): DetectionResult | null;
}

export interface RouterOutput {
  contentType: ContentType;
  confidence: number;
  signals: string[];
  /** Every detector result that returned non-null, sorted by confidence desc. */
  allResults: DetectionResult[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum confidence required to accept a detector match. */
const MIN_CONFIDENCE = 0.2;

/**
 * Priority tie-breaker when two detectors report the same confidence.
 * Lower index = higher priority.  Content types NOT in this list are
 * sorted after the listed ones by their natural order.
 */
const TYPE_PRIORITY: Record<ContentType, number> = {
  test_output: 0,
  log: 1,
  command_output: 2,
  code: 3,
  json: 4,
  markdown: 5,
  rag_chunk: 6,
  conversation_history: 7,
  file_summary: 8,
  plain_text: 9,
  unknown: 10,
};

// ---------------------------------------------------------------------------
// Detector registry
// ---------------------------------------------------------------------------

const DETECTORS: Detector[] = [
  detectTestOutput,
  detectLog,
  detectCommandOutput,
  detectCode,
  detectJson,
  detectMarkdown,
  detectRagChunk,
  detectConversationHistory,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyse `content` and return the best-matching content type together
 * with confidence, matched signals, and every non-null detector result.
 *
 * When no detector reaches the minimum confidence threshold the router
 * returns `unknown` — the caller should fall back to a plain-text strategy.
 */
export function detectContentType(content: string): RouterOutput {
  if (!content || content.trim().length === 0) {
    return {
      contentType: "unknown",
      confidence: 1.0,
      signals: [],
      allResults: [],
    };
  }

  // Run every detector
  const allResults: DetectionResult[] = [];
  for (const detector of DETECTORS) {
    const result = detector(content);
    if (result && result.confidence >= MIN_CONFIDENCE) {
      allResults.push(result);
    }
  }

  // Sort: higher confidence first, then type priority as tie-breaker
  allResults.sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    const pa = TYPE_PRIORITY[a.contentType] ?? 99;
    const pb = TYPE_PRIORITY[b.contentType] ?? 99;
    return pa - pb;
  });

  // Pick best
  const best = allResults[0];
  if (best) {
    return {
      contentType: best.contentType,
      confidence: best.confidence,
      signals: best.signals,
      allResults,
    };
  }

  // Nothing matched — return unknown
  return {
    contentType: "unknown",
    confidence: 0,
    signals: [],
    allResults,
  };
}

// ---------------------------------------------------------------------------
// Helpers (exported for use by detectors)
// ---------------------------------------------------------------------------

/**
 * Shared confidence helper used by individual detectors.
 *
 * `matched`  – number of signals that were found in the content.
 * `total`    – total number of signal patterns the detector defines.
 * `options`:
 *   - `boost`       – additional confidence to add (e.g. 0.3 for a JSON.parse success).
 *   - `minMatches`  – minimum matched signals before returning > 0 confidence.
 *                     Defaults to 2.
 *
 * Returns a confidence value in [0, 0.95].
 */
export function computeConfidence(
  matched: number,
  total: number,
  options?: { boost?: number; minMatches?: number },
): number {
  const minMatches = options?.minMatches ?? 2;
  const boost = options?.boost ?? 0;

  if (matched < minMatches) {
    // With too few signals we still return something low so the
    // caller can decide whether to report it.
    return Math.min(0.15, boost);
  }

  // Linear scaling: 2 matches → 0.25, all matches → 0.95
  const base = matched >= total
    ? 0.95
    : 0.25 + 0.7 * ((matched - minMatches) / (total - minMatches));

  return Math.min(0.95, Math.round((base + boost) * 100) / 100);
}

/**
 * Scan `content` against a map of signal-name → RegExp and return the
 * names of every signal whose pattern matches at least once.
 */
export function matchSignals(
  content: string,
  patterns: Record<string, RegExp>,
): string[] {
  const hits: string[] = [];
  for (const [name, re] of Object.entries(patterns)) {
    // Reset lastIndex in case the regex has the global flag
    re.lastIndex = 0;
    if (re.test(content)) {
      hits.push(name);
    }
  }
  return hits;
}
