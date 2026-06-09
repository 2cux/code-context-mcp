/**
 * Test Output Detector — Phase 2
 *
 * Detects test runner output (jest, vitest, pytest, mocha, etc.)
 * Signals: FAIL, AssertionError, Expected, Received, test framework names.
 */

import type { DetectionResult } from "../contentRouter.js";
import { computeConfidence, matchSignals } from "../contentRouter.js";

// ---------------------------------------------------------------------------
// Signal patterns — ordered roughly by specificity
// ---------------------------------------------------------------------------

const SIGNALS: Record<string, RegExp> = {
  AssertionError: /assertionerror|assertion error/i,
  Expected: /\bexpected\b[:\s]/i,
  Received: /\breceived\b[:\s]/i,
  FAIL: /\bFAIL(?:ED)?\b/,
  "test failed": /tests?.*(?:failed|FAILED)|(?:failed|FAILED).*tests?|^\d+\s+failed/im,
  "Test Suites": /test\s*suites?:/i,
  jest: /\bjest\b/i,
  vitest: /\bvitest\b/i,
  pytest: /\bpytest\b/i,
  mocha: /\bmocha\b/i,
  unittest: /\bunittest\b/i,
};

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectTestOutput(content: string): DetectionResult | null {
  const signals = matchSignals(content, SIGNALS);
  if (signals.length === 0) return null;

  const confidence = computeConfidence(signals.length, Object.keys(SIGNALS).length, {
    minMatches: 2,
  });

  if (confidence < 0.2) return null;

  return {
    contentType: "test_output",
    confidence,
    signals,
  };
}
