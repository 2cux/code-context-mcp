/**
 * Log Compressor — Phase 4 (Full Implementation)
 *
 * Preserves: ERROR/WARN/FATAL lines, exception types, error messages,
 * timestamps, trace IDs/request IDs, relevant file paths, stack trace
 * top and bottom.
 * Folds: repeated INFO, heartbeat, debug lines.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens, tokenAwareTruncate } from "../../utils/tokenCount.js";

export const logStrategy: CompressionStrategy = {
  name: "log",
  version: "1.0.0",
  compress: compressLog,
};

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const TIMESTAMP_RE = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\b/;
const TRACE_ID_RE = /\b(?:trace[_-]?id|request[_-]?id|correlation[_-]?id)[=:]\s*(\S+)/i;
const EXCEPTION_RE = /\b([A-Z][a-zA-Z]*(?:Error|Exception|Fault|Failure))\b/;
const STACK_FRAME_RE = /^\s+at\s+.+?:\d+:\d+/;
const CAUSED_BY_RE = /^\s*(?:Caused by|Triggered by):\s*/i;
const HEARTBEAT_RE = /\b(?:heartbeat|ping|keep-?alive|healthcheck)\b/i;
const PRIORITY_LEVELS = ["FATAL", "ERROR", "WARN", "EXCEPTION", "TRACEBACK"];

// ---------------------------------------------------------------------------
// Export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressLog(
  content: string,
  maxTokens: number,
): StrategyResult {
  const warnings: string[] = [];
  const tokens = countTokens(content);

  if (!content || content.trim().length === 0) {
    return { compressedContent: content, warnings, summary: "Empty log content" };
  }

  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings, summary: "Log fits within token budget" };
  }

  try {
    const lines = content.split("\n");
    const extracted = extractLogInfo(lines);

    // Build compressed output
    const parts = buildCompressedOutput(extracted, lines);

    let result = parts.join("\n");
    let resultTokens = countTokens(result);

    // Always add fold statistics to warnings
    if (extracted.foldedInfoDebug > 0) {
      warnings.push(`Folded ${extracted.foldedInfoDebug} INFO/DEBUG lines`);
    }
    if (extracted.foldedHeartbeats > 0) {
      warnings.push(`Folded ${extracted.foldedHeartbeats} heartbeat lines`);
    }

    if (resultTokens <= maxTokens) {
      return {
        compressedContent: result,
        warnings,
        summary: `Log compressed: ${extracted.priorityLines.length} priority lines kept, ${extracted.foldedInfoDebug} INFO/DEBUG folded`,
      };
    }

    // Still over budget — binary trim
    result = tokenAwareTruncate(result, maxTokens);
    resultTokens = countTokens(result);
    warnings.push(`Trimmed to fit ${maxTokens} token budget`);

    return {
      compressedContent: result,
      warnings,
      summary: `Log compressed and truncated to ${maxTokens} tokens`,
    };
  } catch {
    return truncateFallback(content, maxTokens, warnings);
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface ExtractedLogInfo {
  priorityLines: string[];
  exceptionTypes: string[];
  traceIds: string[];
  timestamps: { first: string; last: string };
  stackTraceTop: string[];
  stackTraceBottom: string[];
  filePaths: string[];
  foldedInfoDebug: number;
  foldedHeartbeats: number;
}

function extractLogInfo(lines: string[]): ExtractedLogInfo {
  const info: ExtractedLogInfo = {
    priorityLines: [],
    exceptionTypes: [],
    traceIds: [],
    timestamps: { first: "", last: "" },
    stackTraceTop: [],
    stackTraceBottom: [],
    filePaths: [],
    foldedInfoDebug: 0,
    foldedHeartbeats: 0,
  };

  const seenExceptionTypes = new Set<string>();
  const seenTraceIds = new Set<string>();
  let consecutiveInfoCount = 0;
  let consecutiveHeartbeatCount = 0;
  let inStackTrace = false;
  let stackTraceLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const upper = line.toUpperCase();

    // ---- Priority check ----
    const isPriority = PRIORITY_LEVELS.some((lvl) => upper.includes(lvl));

    if (isPriority) {
      info.priorityLines.push(line);
      consecutiveInfoCount = 0;
      consecutiveHeartbeatCount = 0;
    }

    // ---- Timestamp extraction ----
    if (!info.timestamps.first) {
      const tm = TIMESTAMP_RE.exec(line);
      if (tm) info.timestamps.first = tm[1]!;
    }
    const tm2 = TIMESTAMP_RE.exec(line);
    if (tm2) info.timestamps.last = tm2[1]!;

    // ---- Trace ID extraction ----
    const tid = TRACE_ID_RE.exec(line);
    if (tid && !seenTraceIds.has(tid[1]!)) {
      seenTraceIds.add(tid[1]!);
      info.traceIds.push(tid[1]!);
    }

    // ---- Exception type extraction ----
    const exc = EXCEPTION_RE.exec(line);
    if (exc && !seenExceptionTypes.has(exc[1]!) && isPriority) {
      seenExceptionTypes.add(exc[1]!);
      info.exceptionTypes.push(exc[1]!);
    }

    // ---- File path extraction from error lines ----
    const fileMatch = line.match(/(?:at |in |from )([/\w.-]+\.[a-z]{2,6}):(\d+)/i);
    if (fileMatch && !info.filePaths.includes(fileMatch[1]!)) {
      info.filePaths.push(fileMatch[1]!);
    }

    // ---- Stack trace detection ----
    if (STACK_FRAME_RE.test(line) || CAUSED_BY_RE.test(line)) {
      if (!inStackTrace) {
        inStackTrace = true;
        stackTraceLines = [];
      }
      stackTraceLines.push(line);
    } else if (inStackTrace && /^\s*$/.test(line)) {
      // End of stack trace block
      inStackTrace = false;
      extractStackTopBottom(stackTraceLines, info);
      stackTraceLines = [];
    }

    // ---- INFO/DEBUG folding ----
    if (!isPriority && (upper.includes("INFO") || upper.includes("DEBUG"))) {
      consecutiveInfoCount++;
      if (consecutiveInfoCount > 3) {
        info.foldedInfoDebug++;
      }
    } else if (!isPriority) {
      consecutiveInfoCount = 0;
    }

    // ---- Heartbeat detection ----
    if (!isPriority && HEARTBEAT_RE.test(line)) {
      consecutiveHeartbeatCount++;
      if (consecutiveHeartbeatCount > 2) {
        info.foldedHeartbeats++;
      }
    } else {
      consecutiveHeartbeatCount = 0;
    }

    // Track last priority line end for stack trace
    if (isPriority) {
      // Reset stack tracking on priority lines
      if (inStackTrace) {
        extractStackTopBottom(stackTraceLines, info);
        stackTraceLines = [];
        inStackTrace = false;
      }
    }
  }

  // Handle trailing stack trace
  if (inStackTrace && stackTraceLines.length > 0) {
    extractStackTopBottom(stackTraceLines, info);
  }

  return info;
}

function extractStackTopBottom(stackLines: string[], info: ExtractedLogInfo): void {
  if (stackLines.length === 0) return;
  // Top 5 frames
  for (const frame of stackLines.slice(0, 5)) {
    info.stackTraceTop.push(frame);
  }
  // Bottom 3 frames (if different from top)
  if (stackLines.length > 8) {
    for (const frame of stackLines.slice(-3)) {
      info.stackTraceBottom.push(frame);
    }
  }
}

// ---------------------------------------------------------------------------
// Output Building
// ---------------------------------------------------------------------------

function buildCompressedOutput(extracted: ExtractedLogInfo, allLines: string[]): string[] {
  const parts: string[] = [];

  // Header
  parts.push("## Log Summary");
  parts.push("");

  // Time range
  if (extracted.timestamps.first) {
    parts.push(`- **Time Range:** \`${extracted.timestamps.first}\` → \`${extracted.timestamps.last}\``);
  }

  // Trace IDs
  if (extracted.traceIds.length > 0) {
    parts.push(`- **Trace/Request IDs:** ${extracted.traceIds.map((t) => `\`${t}\``).join(", ")}`);
  }

  // Exception types
  if (extracted.exceptionTypes.length > 0) {
    parts.push(`- **Exception Types:** ${extracted.exceptionTypes.join(", ")}`);
  }

  // File paths
  if (extracted.filePaths.length > 0) {
    parts.push(`- **Relevant Files:** ${extracted.filePaths.slice(0, 5).map((f) => `\`${f}\``).join(", ")}`);
  }

  parts.push("");

  // Priority lines (ERROR/WARN/FATAL)
  if (extracted.priorityLines.length > 0) {
    parts.push("### Priority Lines (ERROR / WARN / FATAL)");
    parts.push("```");
    for (const line of extracted.priorityLines.slice(0, 100)) {
      parts.push(line);
    }
    if (extracted.priorityLines.length > 100) {
      parts.push(`... (${extracted.priorityLines.length - 100} more priority lines)`);
    }
    parts.push("```");
    parts.push("");
  }

  // Stack trace (combined top + bottom)
  const allStackFrames = [...extracted.stackTraceTop];
  if (extracted.stackTraceBottom.length > 0) {
    allStackFrames.push("  ... (middle frames folded) ...");
    allStackFrames.push(...extracted.stackTraceBottom);
  }
  if (allStackFrames.length > 0) {
    parts.push("### Stack Trace");
    parts.push("```");
    for (const frame of allStackFrames.slice(0, 30)) {
      parts.push(frame);
    }
    parts.push("```");
    parts.push("");
  }

  // Folded counts
  if (extracted.foldedInfoDebug > 0) {
    parts.push(`- **INFO/DEBUG Lines Folded:** ${extracted.foldedInfoDebug}`);
  }
  if (extracted.foldedHeartbeats > 0) {
    parts.push(`- **Heartbeat Lines Folded:** ${extracted.foldedHeartbeats}`);
  }

  // Sampled context (last 10 non-priority non-empty lines)
  parts.push("");
  parts.push("### Tail Context");
  parts.push("```");
  const contextLines = allLines
    .filter((l) => {
      const upper = l.toUpperCase();
      return !PRIORITY_LEVELS.some((lvl) => upper.includes(lvl));
    })
    .filter((l) => l.trim())
    .slice(-10);
  for (const line of contextLines) {
    parts.push(line);
  }
  parts.push("```");

  return parts;
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

function truncateFallback(
  content: string,
  maxTokens: number,
  warnings: string[],
): StrategyResult {
  const lines = content.split("\n");
  const priority = lines.filter((l) => {
    const u = l.toUpperCase();
    return PRIORITY_LEVELS.some((lvl) => u.includes(lvl));
  });
  const other = lines.filter((l) => {
    const u = l.toUpperCase();
    return !PRIORITY_LEVELS.some((lvl) => u.includes(lvl));
  });
  const sampleEvery = Math.max(1, Math.ceil(other.length / 20));
  const sampled = other.filter((_, i) => i % sampleEvery === 0);
  let result = [...priority, `[... ${other.length - sampled.length} lines folded ...]`, ...sampled].join("\n");
  result = tokenAwareTruncate(result, maxTokens);
  warnings.push("Log compression fell back to truncation");
  return {
    compressedContent: result,
    warnings,
    summary: "Truncated log (fallback)",
  };
}

