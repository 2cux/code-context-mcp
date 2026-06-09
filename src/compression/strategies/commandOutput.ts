/**
 * Command Output Compressor — Phase 4 (Full Implementation)
 *
 * Preserves: command, exit code, stderr, failure reason, error file/line,
 * last N lines.
 * Folds: repeated progress bars, install logs, warnings, successful output.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens, tokenAwareTruncate } from "../../utils/tokenCount.js";

export const commandOutputStrategy: CompressionStrategy = {
  name: "command_output",
  version: "1.0.0",
  compress: compressCommandOutput,
};

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const COMMAND_RE = /^\s*[>$]\s+(.+)/;
const EXIT_CODE_RE = /exit\s*code[: ]?\s*(\d+)/i;
const FAILED_EXIT_RE = /(?:failed|exited)\s+with\s+(?:exit\s+)?code\s+(\d+)/i;
const ERROR_FILE_RE = /([/\w.-]+\.[a-z]{2,6})\s*[\(\[](?:(\d+)[,:]?(?:(\d+))?)?[\)\]]?\s*:\s*(?:error|Error|ERROR)\s+(\w+)[: ]?\s*(.*)/i;
const TS_ERROR_RE = /^(.+?)\((\d+),(\d+)\):\s*error\s+(\w+)[: ]?\s*(.*)/i;
const PROGRESS_BAR_RE = /(?:[\[=]+\s*[>]*\s*[=\]]+|[\|\\/\-\|])/;
const PERCENT_RE = /\b\d{1,3}%\b/;
const SPINNER_CHARS = /[\|\\/\-⠀-⣿◐-◿]/;
const INSTALL_LOG_RE = /(?:npm|pnpm|yarn|pip|cargo|go)\s+(?:install|add|get|download)/i;
const STDER_PREFIX = /^(?:STDERR|stderr)[: ]/i;

// ---------------------------------------------------------------------------
// Export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressCommandOutput(
  content: string,
  maxTokens: number,
): StrategyResult {
  const warnings: string[] = [];
  const tokens = countTokens(content);

  if (!content || content.trim().length === 0) {
    return { compressedContent: content, warnings, summary: "Empty command output" };
  }

  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings, summary: "Command output fits within token budget" };
  }

  try {
    const lines = content.split("\n");
    const extracted = extractCommandInfo(lines);

    const parts = buildCompressedOutput(extracted, lines);

    let result = parts.join("\n");
    let resultTokens = countTokens(result);

    if (resultTokens <= maxTokens) {
      if (extracted.foldedProgress > 0) {
        warnings.push(`Folded ${extracted.foldedProgress} progress/install lines`);
      }
      return {
        compressedContent: result,
        warnings,
        summary: `Command output compressed: command="${extracted.command}", exit=${extracted.exitCode}`,
      };
    }

    result = tokenAwareTruncate(result, maxTokens);
    warnings.push(`Trimmed to fit ${maxTokens} token budget`);

    return {
      compressedContent: result,
      warnings,
      summary: `Command output compressed and truncated`,
    };
  } catch {
    return truncateFallback(content, maxTokens, warnings);
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface ExtractedCommandInfo {
  command: string;
  exitCode: string;
  stderrLines: string[];
  failureReason: string;
  errorFiles: Array<{ file: string; line: string; col: string; code: string; message: string }>;
  lastLines: string[];
  foldedProgress: number;
}

function extractCommandInfo(lines: string[]): ExtractedCommandInfo {
  const info: ExtractedCommandInfo = {
    command: "",
    exitCode: "",
    stderrLines: [],
    failureReason: "",
    errorFiles: [],
    lastLines: [],
    foldedProgress: 0,
  };

  const seenErrors = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lower = line.toLowerCase();

    // ---- Command extraction ----
    if (!info.command) {
      const cmdMatch = COMMAND_RE.exec(line);
      if (cmdMatch) {
        info.command = cmdMatch[1]!.trim();
      }
    }

    // ---- Exit code ----
    if (!info.exitCode) {
      const ecMatch = EXIT_CODE_RE.exec(line);
      if (ecMatch) {
        info.exitCode = ecMatch[1]!;
      }
      const fecMatch = FAILED_EXIT_RE.exec(line);
      if (fecMatch && !info.exitCode) {
        info.exitCode = fecMatch[1]!;
      }
    }

    // ---- Stderr lines ----
    if (STDER_PREFIX.test(line) || lower.includes("stderr")) {
      info.stderrLines.push(line);
    }

    // ---- TypeScript-style error lines ----
    const tsMatch = TS_ERROR_RE.exec(line);
    if (tsMatch) {
      const file = tsMatch[1]!;
      const lineNum = tsMatch[2]!;
      const col = tsMatch[3]!;
      const code = tsMatch[4]!;
      const message = tsMatch[5] ?? "";
      const key = `${file}:${lineNum}:${code}`;
      if (!seenErrors.has(key)) {
        seenErrors.add(key);
        info.errorFiles.push({ file, line: lineNum, col, code, message });
      }
    }

    // ---- Generic error file extraction ----
    const efMatch = ERROR_FILE_RE.exec(line);
    if (efMatch) {
      const file = efMatch[1]!;
      const lineNum = efMatch[2] ?? "";
      const code = efMatch[4]!;
      const message = efMatch[5] ?? "";
      const key = `${file}:${lineNum}:${code}`;
      if (!seenErrors.has(key) && !tsMatch) {
        seenErrors.add(key);
        info.errorFiles.push({ file, line: lineNum, col: efMatch[3] ?? "", code, message });
      }
    }

    // ---- Failure reason ----
    if (!info.failureReason && (lower.includes("build failed") || lower.includes("command failed"))) {
      info.failureReason = line.trim();
    }

    // ---- Progress bar / install log folding ----
    const isProgress = PROGRESS_BAR_RE.test(line) && PERCENT_RE.test(line);
    const isInstall = INSTALL_LOG_RE.test(line);
    const isSpinner = line.trim().length <= 3 && SPINNER_CHARS.test(line.trim());
    if ((isProgress || isInstall || isSpinner) && !lower.includes("error")) {
      info.foldedProgress++;
    }
  }

  // Last 20 non-empty lines
  info.lastLines = lines.filter((l) => l.trim()).slice(-20);

  // Try to extract command from content if not found with $/> prefix
  if (!info.command) {
    for (const line of lines.slice(0, 5)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith(">") && trimmed.length > 3 && trimmed.length < 200) {
        info.command = trimmed;
        break;
      }
    }
  }

  return info;
}

// ---------------------------------------------------------------------------
// Output Building
// ---------------------------------------------------------------------------

function buildCompressedOutput(extracted: ExtractedCommandInfo, allLines: string[]): string[] {
  const parts: string[] = [];

  parts.push("## Command Output Summary");
  parts.push("");

  // Command
  parts.push(`- **Command:** \`${extracted.command || "(not detected)"}\``);

  // Exit code
  parts.push(`- **Exit Code:** ${extracted.exitCode || "(not detected)"}`);

  // Failure reason
  if (extracted.failureReason) {
    parts.push(`- **Failure:** ${extracted.failureReason}`);
  }

  parts.push("");

  // Error files
  if (extracted.errorFiles.length > 0) {
    parts.push(`### Errors (${extracted.errorFiles.length})`);
    parts.push("");
    parts.push("| File | Line | Code | Message |");
    parts.push("|------|------|------|---------|");
    for (const err of extracted.errorFiles.slice(0, 30)) {
      const fileShort = err.file.split(/[/\\]/).slice(-2).join("/");
      parts.push(`| \`${fileShort}\` | ${err.line}:${err.col} | \`${err.code}\` | ${escapeMarkdown(err.message.slice(0, 80))} |`);
    }
    if (extracted.errorFiles.length > 30) {
      parts.push(`| ... | ... | ... | *(${extracted.errorFiles.length - 30} more errors)* |`);
    }
    parts.push("");
  }

  // Stderr
  if (extracted.stderrLines.length > 0) {
    parts.push("### Stderr");
    parts.push("```");
    for (const line of extracted.stderrLines.slice(0, 30)) {
      parts.push(line);
    }
    if (extracted.stderrLines.length > 30) {
      parts.push(`... (${extracted.stderrLines.length - 30} more stderr lines)`);
    }
    parts.push("```");
    parts.push("");
  }

  // Folded count
  if (extracted.foldedProgress > 0) {
    parts.push(`- **Progress/Install Lines Folded:** ${extracted.foldedProgress}`);
    parts.push("");
  }

  // Last lines
  if (extracted.lastLines.length > 0) {
    parts.push("### Last Output");
    parts.push("```");
    for (const line of extracted.lastLines.slice(-15)) {
      parts.push(line);
    }
    parts.push("```");
  }

  return parts;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[|\\]/g, "\\$&").replace(/\n/g, " ");
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
  const headCount = Math.ceil(lines.length * 0.2);
  const tailCount = Math.ceil(lines.length * 0.3);
  const kept = [
    ...lines.slice(0, headCount),
    `[... ${Math.max(0, lines.length - headCount - tailCount)} lines folded ...]`,
    ...lines.slice(-tailCount),
  ];
  let result = kept.join("\n");
  result = tokenAwareTruncate(result, maxTokens);
  warnings.push("Command output compression fell back to truncation");
  return {
    compressedContent: result,
    warnings,
    summary: "Truncated command output (fallback)",
  };
}

