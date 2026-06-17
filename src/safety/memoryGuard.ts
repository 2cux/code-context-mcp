/**
 * Memory Guard — Pre-compression memory safety checks (§21.4)
 *
 * Protects against OOM during extreme compression by:
 *   1. Detecting available system memory before large operations.
 *   2. Auto-skipping tests/operations that exceed safe memory thresholds.
 *   3. Providing a sampling mode that works with representative slices.
 *
 * Design principles:
 *   - Never hide OOM as a test pass — skipped tests are clearly marked.
 *   - Standard tests must work on 4GB machines.
 *   - Extreme full tests are opt-in and require adequate memory.
 *   - Sampling mode provides partial coverage when full isn't safe.
 */

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryThresholds {
  /** Minimum memory (MB) required for standard performance tests. */
  standardMinMemoryMb: number;
  /** Recommended memory (MB) for full extreme tests. */
  extremeRecommendedMemoryMb: number;
  /** Below this threshold (MB), extreme tests are auto-skipped. */
  skipBelowMemoryMb: number;
  /** Fraction of content to use when sampling (0.0–1.0). */
  sampleRatioWhenLowMemory: number;
}

export interface MemoryStatus {
  /** Total system memory in MB. */
  totalMemoryMb: number;
  /** Free system memory in MB. */
  freeMemoryMb: number;
  /** Estimated Node.js heap usage in MB. */
  heapUsedMb: number;
  /** Whether the system meets standard memory requirements. */
  canRunStandard: boolean;
  /** Whether the system meets extreme memory recommendations. */
  canRunExtreme: boolean;
  /** Whether extreme tests should be skipped entirely. */
  shouldSkipExtreme: boolean;
  /** Whether sampling mode should be used instead of full extreme. */
  shouldUseSampling: boolean;
}

// ---------------------------------------------------------------------------
// Default thresholds (overridable via fixtures/rc-hardening/extreme-perf/)
// ---------------------------------------------------------------------------

let _thresholds: MemoryThresholds = {
  standardMinMemoryMb: 4096,
  extremeRecommendedMemoryMb: 16384,
  skipBelowMemoryMb: 8192,
  sampleRatioWhenLowMemory: 0.2,
};

/**
 * Load custom memory thresholds from a JSON file.
 * Falls back to defaults if the file is missing or malformed.
 */
export function loadMemoryThresholds(filePath?: string): MemoryThresholds {
  const resolvedPath = filePath ?? path.resolve(
    process.cwd(),
    "fixtures/rc-hardening/extreme-perf/memory-thresholds.json",
  );

  try {
    const raw = fs.readFileSync(resolvedPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      _thresholds = {
        standardMinMemoryMb: parsed.standardMinMemoryMb ?? _thresholds.standardMinMemoryMb,
        extremeRecommendedMemoryMb: parsed.extremeRecommendedMemoryMb ?? _thresholds.extremeRecommendedMemoryMb,
        skipBelowMemoryMb: parsed.skipBelowMemoryMb ?? _thresholds.skipBelowMemoryMb,
        sampleRatioWhenLowMemory: parsed.sampleRatioWhenLowMemory ?? _thresholds.sampleRatioWhenLowMemory,
      };
    }
  } catch {
    // File missing or malformed — use defaults
  }

  return { ..._thresholds };
}

/**
 * Return the current memory thresholds (loads from fixtures if available).
 */
export function getMemoryThresholds(): MemoryThresholds {
  return { ..._thresholds };
}

// ---------------------------------------------------------------------------
// Memory detection
// ---------------------------------------------------------------------------

/**
 * Check current system memory status against the configured thresholds.
 *
 * Uses:
 *   - os.freemem() / os.totalmem() for system-level view
 *   - process.memoryUsage() for Node.js heap usage
 */
export function checkMemoryStatus(): MemoryStatus {
  const totalMemoryMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemoryMb = Math.round(os.freemem() / (1024 * 1024));
  const heapUsedMb = Math.round(process.memoryUsage().heapUsed / (1024 * 1024));

  const canRunStandard = totalMemoryMb >= _thresholds.standardMinMemoryMb;
  const canRunExtreme = totalMemoryMb >= _thresholds.extremeRecommendedMemoryMb;
  const shouldSkipExtreme = totalMemoryMb < _thresholds.skipBelowMemoryMb;
  const shouldUseSampling = !canRunExtreme && !shouldSkipExtreme;

  return {
    totalMemoryMb,
    freeMemoryMb,
    heapUsedMb,
    canRunStandard,
    canRunExtreme,
    shouldSkipExtreme,
    shouldUseSampling,
  };
}

/**
 * Format a memory status for human-readable output.
 */
export function formatMemoryStatus(status: MemoryStatus): string {
  const lines: string[] = [];
  lines.push(`Total: ${status.totalMemoryMb}MB | Free: ${status.freeMemoryMb}MB | Heap: ${status.heapUsedMb}MB`);
  lines.push(`Standard: ${status.canRunStandard ? "✅" : "❌"} | Extreme: ${status.canRunExtreme ? "✅ full" : status.shouldSkipExtreme ? "⏭️ skip" : "🔬 sampled"}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Extract a representative sample from large content.
 *
 * Strategy:
 *   - Takes `ratio` fraction from the beginning (header/context preservation)
 *   - Takes `ratio` fraction from the middle (body representation)
 *   - Takes `ratio` fraction from the end (tail/errors preservation)
 *   - The total sample is roughly `ratio * 3` of the original, but never
 *     exceeds the original content length.
 *
 * This preserves the structural characteristics that compression strategies
 * depend on (timestamps at start, errors at end, patterns throughout).
 */
export function sampleContent(content: string, ratio: number = 0.2): string {
  if (ratio >= 1.0) return content;
  if (ratio <= 0) return "";

  const lines = content.split("\n");
  const totalLines = lines.length;

  // Each section gets ratio * totalLines lines
  const sectionLines = Math.max(1, Math.floor(totalLines * ratio));

  const head = lines.slice(0, sectionLines);
  const midStart = Math.floor(totalLines / 2) - Math.floor(sectionLines / 2);
  const mid = lines.slice(Math.max(0, midStart), Math.min(totalLines, midStart + sectionLines));
  const tail = lines.slice(Math.max(0, totalLines - sectionLines));

  // Deduplicate overlapping sections (when content is small)
  const seen = new Set<number>();
  const resultLines: string[] = [];

  // Head: lines 0..sectionLines
  for (let i = 0; i < head.length; i++) {
    const line = head[i];
    if (line === undefined) continue;
    seen.add(i);
    resultLines.push(line);
  }

  // Separator marker
  const midStartIdx = Math.max(0, midStart);
  resultLines.push(`\n// ... [sampled: middle section, lines ${midStartIdx}-${midStartIdx + mid.length}] ...\n`);

  // Middle
  for (let i = 0; i < mid.length; i++) {
    const line = mid[i];
    if (line === undefined) continue;
    const globalIdx = midStartIdx + i;
    if (!seen.has(globalIdx)) {
      seen.add(globalIdx);
      resultLines.push(line);
    }
  }

  // Separator
  const tailStartIdx = Math.max(0, totalLines - sectionLines);
  resultLines.push(`\n// ... [sampled: tail section, lines ${tailStartIdx}-${totalLines}] ...\n`);

  // Tail
  for (let i = 0; i < tail.length; i++) {
    const line = tail[i];
    if (line === undefined) continue;
    const globalIdx = tailStartIdx + i;
    if (!seen.has(globalIdx)) {
      seen.add(globalIdx);
      resultLines.push(line);
    }
  }

  return resultLines.join("\n");
}

/**
 * Return the recommended sample ratio for the current memory status.
 */
export function getSampleRatio(): number {
  return _thresholds.sampleRatioWhenLowMemory;
}

// ---------------------------------------------------------------------------
// Content size estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the memory overhead of processing content of a given byte size.
 *
 * Conservative estimates (actual overhead varies by content type and strategy):
 *   - Raw content in memory: 2x (JS string is UTF-16 internally)
 *   - TextEncoder buffer: 1x (Uint8Array)
 *   - Compression working set: 1-2x
 *   - DB storage (in-memory SQLite): 1x
 *   - Total: ~5x the raw UTF-8 byte count
 */
export function estimateMemoryOverhead(inputBytes: number): number {
  return inputBytes * 5;
}

/**
 * Check if processing content of the given size is likely safe.
 * Returns true if estimated memory usage is below available free memory
 * with a 20% safety margin.
 */
export function isSizeSafe(inputBytes: number, safetyMargin = 0.2): boolean {
  const status = checkMemoryStatus();
  const estimated = estimateMemoryOverhead(inputBytes);
  const available = status.freeMemoryMb * 1024 * 1024;
  return estimated < available * (1 - safetyMargin);
}
