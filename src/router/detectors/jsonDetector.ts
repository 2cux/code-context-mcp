/**
 * JSON Detector — Phase 2
 *
 * Detects JSON content.
 * Signals: starts with { or [, can be parsed as JSON.
 */

import type { DetectionResult } from "../contentRouter.js";

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectJson(content: string): DetectionResult | null {
  const trimmed = content.trim();

  // Quick structural check
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  const signals: string[] = [];

  if (trimmed.startsWith("{")) signals.push("starts with {");
  if (trimmed.startsWith("[")) signals.push("starts with [");

  // Try to parse — this is the strongest signal
  let parseSuccess = false;
  try {
    JSON.parse(trimmed);
    parseSuccess = true;
    signals.push("JSON.parse success");
  } catch {
    // Still might be JSON-like (e.g. truncated or with comments)
    // Check for JSON structural patterns
    if (/"\w+":/u.test(trimmed)) {
      signals.push("key-value pairs");
    }
  }

  // Confidence calculation
  let confidence: number;

  if (parseSuccess) {
    // Successful parse → very high confidence
    // Slightly lower for very small objects that might be coincidental
    const isSubstantial = trimmed.length > 20;
    confidence = isSubstantial ? 0.95 : 0.85;
  } else if (signals.length >= 2) {
    // Key-value patterns but unparseable → moderate confidence
    confidence = 0.4;
  } else {
    // Starts with { or [ but nothing else → low confidence
    confidence = 0.15;
  }

  if (confidence < 0.2) return null;

  return {
    contentType: "json",
    confidence,
    signals,
  };
}
