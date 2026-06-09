/**
 * Command Output Compressor — Phase 2
 *
 * Preserves: command, exit code, stderr, failure reason, error file/line,
 * last N lines. Folds: repeated progress bars, install logs, warnings.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens } from "../../utils/tokenCount.js";

export const commandOutputStrategy: CompressionStrategy = {
  name: "command_output",
  version: "0.1.0",
  compress: compressCommandOutput,
};

// ---------------------------------------------------------------------------
// Legacy function export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressCommandOutput(
  content: string,
  maxTokens: number,
): StrategyResult {
  const warnings: string[] = [];
  const tokens = countTokens(content);

  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings };
  }

  const lines = content.split("\n");

  // Detect stderr/error lines
  const errorLines = lines.filter(
    (l) =>
      l.toLowerCase().includes("error") ||
      l.toLowerCase().includes("fail") ||
      l.toLowerCase().includes("stderr"),
  );

  // Keep first 20% (command + early output) and last 30% (exit code + tail)
  const headCount = Math.min(Math.ceil(lines.length * 0.2), lines.length);
  const tailCount = Math.min(Math.ceil(lines.length * 0.3), lines.length - headCount);
  const head = lines.slice(0, headCount);
  const tail = lines.slice(-tailCount);

  // Guard against negative count when head+tail exceeds total (very short content)
  const middleCount = Math.max(0, lines.length - headCount - tailCount);

  const parts = [...head];
  if (middleCount > 0) {
    parts.push(`[--- ${middleCount} lines folded ---]`);
  }
  if (errorLines.length > 0) {
    parts.push(...errorLines.slice(0, 20));
    parts.push(`[--- error lines above, tail below ---]`);
  }
  parts.push(...tail);

  // Enforce maxTokens
  let result = parts.join("\n");
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
    warnings: ["Command output compression not fully implemented (Phase 2)"],
    summary: `Command output compressed: ${headCount} head + ${tailCount} tail + ${Math.min(errorLines.length, 20)} error lines`,
  };
}
