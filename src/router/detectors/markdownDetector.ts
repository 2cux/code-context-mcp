/**
 * Markdown Detector — Phase 2
 *
 * Detects markdown documents.
 * Signals: # headings, - lists, ``` code blocks, **bold**, [links](url), | tables.
 */

import type { DetectionResult } from "../contentRouter.js";
import { computeConfidence, matchSignals } from "../contentRouter.js";

// ---------------------------------------------------------------------------
// Signal patterns
// ---------------------------------------------------------------------------

const SIGNALS: Record<string, RegExp> = {
  "heading": /^#{1,6}\s+\S/m,
  "unordered list": /^\s*[-*+]\s+\S/m,
  "ordered list": /^\s*\d+[.)]\s+\S/m,
  "code block": /```/,
  "bold": /\*\*[^*]+\*\*/,
  "italic": /(?<!\*)\*(?!\*)[^*]+\*(?!\*)/,
  "link": /\[.+?\]\(.+?\)/,
  "table": /^\|.+\|.*\n\|[-| :]+\|/m,
  "blockquote": /^>\s/m,
};

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectMarkdown(content: string): DetectionResult | null {
  const signals = matchSignals(content, SIGNALS);
  if (signals.length === 0) return null;

  const confidence = computeConfidence(signals.length, Object.keys(SIGNALS).length, {
    minMatches: 2,
  });

  if (confidence < 0.2) return null;

  return {
    contentType: "markdown",
    confidence,
    signals,
  };
}
