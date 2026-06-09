/**
 * Test Output Compressor — Phase 2
 *
 * Preserves: test command, framework, failed test names, file paths,
 * assertion info, Expected/Received, key stack trace, exit code.
 * Folds: passing tests, repeated logs, large snapshots, debug output.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens } from "../../utils/tokenCount.js";

export const testOutputStrategy: CompressionStrategy = {
  name: "test_output",
  version: "0.1.0",
  compress: compressTestOutput,
};

// ---------------------------------------------------------------------------
// Legacy function export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressTestOutput(
  content: string,
  maxTokens: number,
): StrategyResult {
  const warnings: string[] = [];
  // TODO: Phase 2 — full implementation
  // For now, return as-is when within budget, otherwise fall through to
  // plain-text-style truncation.
  const tokens = countTokens(content);
  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings };
  }

  // Basic: keep first 60% + last 20% of lines
  const lines = content.split("\n");
  if (lines.length <= 10) {
    // Character-safe truncation: use Array.from to avoid splitting surrogate pairs
    const chars = Array.from(content);
    const truncLen = Math.floor(chars.length * 0.7);
    const truncated = chars.slice(0, truncLen).join("");
    // Verify token budget
    if (countTokens(truncated) > maxTokens) {
      // Further truncate if needed
      let lo = 0;
      let hi = truncated.length;
      let best = "";
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const candidate = truncated.slice(0, mid);
        if (countTokens(candidate) <= maxTokens) { best = candidate; lo = mid; }
        else { hi = mid - 1; }
      }
      return {
        compressedContent: best,
        warnings: ["Test output compression not fully implemented — truncated conservatively"],
        summary: "Truncated test output (Phase 2 stub)",
      };
    }
    return {
      compressedContent: truncated,
      warnings: ["Test output compression not fully implemented — truncated conservatively"],
      summary: "Truncated test output (Phase 2 stub)",
    };
  }

  const head = Math.ceil(lines.length * 0.6);
  const tail = Math.ceil(lines.length * 0.2);
  const kept = [
    ...lines.slice(0, head),
    `[... ${lines.length - head - tail} lines folded — test output compressor Phase 2 stub ...]`,
    ...lines.slice(-tail),
  ];

  // Enforce maxTokens
  let result = kept.join("\n");
  let resultTokens = countTokens(result);
  if (resultTokens > maxTokens) {
    let lo = 0;
    let hi = result.length;
    let best = "";
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = result.slice(0, mid);
      if (countTokens(candidate) <= maxTokens) { best = candidate; lo = mid; }
      else { hi = mid - 1; }
    }
    result = best;
  }

  return {
    compressedContent: result,
    warnings: ["Test output compression not fully implemented (Phase 2)"],
    summary: "Conservative truncation of test output",
  };
}
