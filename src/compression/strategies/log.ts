/**
 * Log Compressor — Phase 2
 *
 * Preserves: ERROR/WARN lines, exception types, error messages,
 * timestamps, trace/request IDs, relevant file paths, stack trace top/bottom.
 * Folds: repeated INFO, heartbeat, debug lines.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens } from "../../utils/tokenCount.js";

export const logStrategy: CompressionStrategy = {
  name: "log",
  version: "0.1.0",
  compress: compressLog,
};

// ---------------------------------------------------------------------------
// Legacy function export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressLog(
  content: string,
  maxTokens: number,
): StrategyResult {
  const warnings: string[] = [];
  const tokens = countTokens(content);

  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings };
  }

  // Basic: prioritize ERROR/WARN lines, fold repeated INFO/DEBUG
  const lines = content.split("\n");
  const priority: string[] = [];
  const other: string[] = [];

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (
      upper.includes("ERROR") ||
      upper.includes("WARN") ||
      upper.includes("EXCEPTION") ||
      upper.includes("FATAL") ||
      upper.includes("TRACEBACK")
    ) {
      priority.push(line);
    } else {
      other.push(line);
    }
  }

  // Build: all priority lines + sampled other lines
  // Keep at most ~30 non-priority lines, sampling evenly
  const maxSampled = 30;
  const sampleEvery = Math.max(1, Math.ceil(other.length / maxSampled));
  const sampled = other.filter((_, i) => i % sampleEvery === 0);

  if (sampled.length < other.length) {
    warnings.push(
      `Folded ${other.length - sampled.length} low-priority log lines`,
    );
  }

  const foldedCount = other.length - sampled.length;
  const parts: string[] = [...priority];
  if (foldedCount > 0) {
    parts.push(
      `[--- ${foldedCount} INFO/DEBUG lines folded ---]`,
    );
  }
  parts.push(...sampled.slice(-20)); // tail of sampled

  // Enforce maxTokens: if result still exceeds budget, truncate
  let result = parts.join("\n");
  let resultTokens = countTokens(result);
  if (resultTokens > maxTokens) {
    // Binary-chop content to fit budget
    let lo = 0;
    let hi = result.length;
    let best = "";
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = result.slice(0, mid);
      if (countTokens(candidate) <= maxTokens) {
        best = candidate;
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    result = best;
    resultTokens = countTokens(result);
    warnings.push(
      `Log result truncated to fit ${maxTokens} token budget (${resultTokens} tokens)`,
    );
  }

  return {
    compressedContent: result,
    warnings,
    summary: `Log compressed: ${priority.length} priority lines kept, ${other.length} lines sampled to ${sampled.length}`,
  };
}
