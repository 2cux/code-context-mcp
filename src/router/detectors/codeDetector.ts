/**
 * Code Detector — Phase 2
 *
 * Detects source code (TypeScript, JavaScript, Python, etc.)
 * Signals: import, export, function, class, interface, type, const, def, etc.
 */

import type { DetectionResult } from "../contentRouter.js";
import { computeConfidence, matchSignals } from "../contentRouter.js";

// ---------------------------------------------------------------------------
// Signal patterns
// ---------------------------------------------------------------------------

const SIGNALS: Record<string, RegExp> = {
  import: /\bimport\b/,
  export: /\bexport\b/,
  function: /\bfunction\b/,
  class: /\bclass\s+\w+/,
  interface: /\binterface\s+\w+/,
  type: /\b(?:import\s+)?type\b/,
  const: /\bconst\s+\w+/,
  let: /\blet\s+\w+/,
  def: /\bdef\s+\w+/,
  public: /\bpublic\b/,
  private: /\bprivate\b/,
  return: /\breturn\b/,
  async: /\basync\b/,
  "arrow function": /=>\s*[{(\[]/,
  enum: /\benum\s+\w+/,
  extends: /\bextends\b/,
  implements: /\bimplements\b/,
};

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectCode(content: string): DetectionResult | null {
  const signals = matchSignals(content, SIGNALS);
  if (signals.length === 0) return null;

  // Code detection requires at least 3 signals to reduce false positives
  // (prose can contain isolated keywords like "return" or "import")
  if (signals.length < 3) return null;

  const confidence = computeConfidence(signals.length, Object.keys(SIGNALS).length, {
    minMatches: 3,
  });

  if (confidence < 0.25) return null;

  return {
    contentType: "code",
    confidence,
    signals,
  };
}
