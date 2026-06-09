/**
 * Command Output Detector — Phase 2
 *
 * Detects shell / terminal command output.
 * Signals: stdout, stderr, exit code, shell prompt, build output.
 */

import type { DetectionResult } from "../contentRouter.js";
import { computeConfidence, matchSignals } from "../contentRouter.js";

// ---------------------------------------------------------------------------
// Signal patterns
// ---------------------------------------------------------------------------

const SIGNALS: Record<string, RegExp> = {
  stdout: /\bstdout\b/i,
  stderr: /\bstderr\b/i,
  "exit code": /exit\s*(?:code|status)[:\s]*\d+/i,
  command: /\bcommand\b/i,
  "command prompt": /^[$#>]\s/m,
  "build failed": /build\s*(?:failed|failure)/i,
  "shell output": /shell\s*output/i,
  "path prompt": /^[A-Z]:[\\\/].*?>/m,
  "error level": /error\s*level/i,
};

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectCommandOutput(content: string): DetectionResult | null {
  const signals = matchSignals(content, SIGNALS);
  if (signals.length === 0) return null;

  const confidence = computeConfidence(signals.length, Object.keys(SIGNALS).length, {
    minMatches: 2,
  });

  if (confidence < 0.2) return null;

  return {
    contentType: "command_output",
    confidence,
    signals,
  };
}
