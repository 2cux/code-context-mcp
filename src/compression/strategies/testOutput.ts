/**
 * Test Output Compressor — Phase 4 (Full Implementation)
 *
 * Extracts and preserves: test command, framework, failed test names,
 * file paths, assertion info, Expected/Received, key stack trace, exit code.
 * Folds: passing tests, repeated logs, large snapshots, debug output.
 *
 * Output format: fixed Markdown per PRD §13.2.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens, tokenAwareTruncate } from "../../utils/tokenCount.js";

export const testOutputStrategy: CompressionStrategy = {
  name: "test_output",
  version: "1.0.0",
  compress: compressTestOutput,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FailedTest {
  file: string;
  testName: string;
  errorType: string;
  errorMessage: string;
  expected?: string;
  received?: string;
  stackTrace: string[];
  location?: string;
}

interface TestOutputSummary {
  command: string;
  framework: string;
  status: string;
  failedTests: FailedTest[];
  keyError: string;
  expected: string;
  received: string;
  stackTrace: string[];
  exitCode: string;
  lastLines: string[];
}

type TestStatus = "FAILED" | "PASSED" | "UNKNOWN";

interface SurefireSummary {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const FRAMEWORK_PATTERNS: Record<string, RegExp> = {
  vitest: /vitest\s+v?[\d.]+/i,
  jest: /\bjest\b/i,
  pytest: /\bpytest\b/i,
  mocha: /\bmocha\b/i,
};

const FAIL_BLOCK_START = /^\s*(?:FAIL|×|✗|✘)\s+/;
const TEST_NAME_LINE = /^\s*(?:×|✗|✘|✓)\s+(.+)$/;
const ASSERTION_ERROR = /AssertionError[: ]\s*(.+)/i;
const EXPECTED_LINE = /Expected[: ]\s*(.+)/i;
const RECEIVED_LINE = /Received[: ]\s*(.+)/i;
const STACK_FILE_LINE = /^\s*(?:at |❯ |→ )?(.+?):(\d+)(?::(\d+))?/;
const COMMAND_LINE = /^\s*[>$]\s+(.+)/;
const INTERNAL_FRAMES = /node_modules|node:internal|\(internal\)/;
const ANSI_ESCAPE = /[\u001B\u009B](?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const SUREFIRE_SUMMARY = /Tests run:\s*(\d+)\s*,\s*Failures:\s*(\d+)\s*,\s*Errors:\s*(\d+)\s*,\s*Skipped:\s*(\d+)/gi;
const MAVEN_FAILURE = /(?:BUILD FAILURE|<<<\s+(?:FAILURE|ERROR)!)/i;
const EXPLICIT_SUCCESS = /(?:BUILD SUCCESS|Tests? (?:all )?passed|All tests passed|\bSUCCESSFUL\b)/i;

// ---------------------------------------------------------------------------
// Export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressTestOutput(
  content: string,
  maxTokens: number,
): StrategyResult {
  const warnings: string[] = [];
  const tokens = countTokens(content);

  if (!content || content.trim().length === 0) {
    return { compressedContent: content, warnings, summary: "Empty test output" };
  }

  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings, summary: "Content fits within token budget" };
  }

  try {
    const summary = extractSummary(content);
    const markdown = formatMarkdown(summary);
    const markdownTokens = countTokens(markdown);

    if (markdownTokens <= maxTokens) {
      return { compressedContent: markdown, warnings, summary: buildSummaryText(summary) };
    }

    // Still over budget — trim stack traces and fold some details
    const trimmed = trimToBudget(summary, maxTokens);
    const trimmedTokens = countTokens(trimmed);
    if (trimmedTokens < tokens) {
      warnings.push(`Trimmed to fit ${maxTokens} token budget (${tokens} → ${trimmedTokens} tokens)`);
    }
    return {
      compressedContent: trimmed,
      warnings,
      summary: buildSummaryText(summary),
    };
  } catch {
    // Fallback: truncation
    return truncateFallback(content, maxTokens, warnings);
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function extractSummary(content: string): TestOutputSummary {
  const normalizedContent = normalizeTestOutput(content);
  const lines = normalizedContent.split("\n");

  // Detect framework
  let framework = "unknown";
  for (const [name, pattern] of Object.entries(FRAMEWORK_PATTERNS)) {
    if (pattern.test(normalizedContent)) {
      framework = name;
      break;
    }
  }

  // Detect command
  let command = "";
  for (const line of lines.slice(0, 20)) {
    const m = COMMAND_LINE.exec(line);
    if (m) {
      command = m[1]!.trim();
      break;
    }
  }
  // Also try finding a command after framework name
  if (!command) {
    const runMatch = normalizedContent.match(/(?:RUN|run|Running)\s+(.+)/);
    if (runMatch) command = runMatch[1]!.trim();
  }

  // Extract failed tests
  const failedTests = extractFailedTests(lines, normalizedContent);

  // Detect exit code
  const exitCode = extractLastExitCode(normalizedContent);

  // Overall status
  const status = determineTestStatus(normalizedContent, exitCode, failedTests.length);

  // Key error from first failure
  const firstFailure = failedTests[0];
  const keyError = firstFailure
    ? `${firstFailure.errorType}: ${firstFailure.errorMessage}`
    : "";

  // Expected/Received from first failure
  const expected = firstFailure?.expected ?? "";
  const received = firstFailure?.received ?? "";

  // Stack trace — first failure's trace, filtered
  const stackTrace = firstFailure?.stackTrace ?? [];

  // Last 10 non-empty lines
  const lastLines = lines
    .filter((l) => l.trim())
    .slice(-10);

  return {
    command,
    framework,
    status,
    failedTests,
    keyError,
    expected,
    received,
    stackTrace,
    exitCode,
    lastLines,
  };
}

function normalizeTestOutput(content: string): string {
  return content
    .replace(ANSI_ESCAPE, "")
    .replace(/\r\n?/g, "\n");
}

function extractLastExitCode(content: string): string {
  const patterns = [
    /\bexit\s*code\s*[:=]?\s*(-?\d+)/gi,
    /\bexitCode\s*[:=]\s*(-?\d+)/gi,
  ];
  let lastMatch: { index: number; value: string } | undefined;

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (!lastMatch || match.index > lastMatch.index) {
        lastMatch = { index: match.index, value: match[1]! };
      }
    }
  }

  return lastMatch?.value ?? "";
}

function extractLastSurefireSummary(content: string): SurefireSummary | undefined {
  let last: SurefireSummary | undefined;
  for (const match of content.matchAll(SUREFIRE_SUMMARY)) {
    last = {
      tests: Number(match[1]),
      failures: Number(match[2]),
      errors: Number(match[3]),
      skipped: Number(match[4]),
    };
  }
  return last;
}

function determineTestStatus(
  content: string,
  exitCode: string,
  extractedFailureCount: number,
): TestStatus {
  // Failure evidence is deliberately evaluated before every success signal.
  if (exitCode !== "" && Number(exitCode) !== 0) return "FAILED";
  if (MAVEN_FAILURE.test(content)) return "FAILED";

  const lastSummary = extractLastSurefireSummary(content);
  if (lastSummary?.errors && lastSummary.errors > 0) return "FAILED";
  if (lastSummary?.failures && lastSummary.failures > 0) return "FAILED";

  // Preserve failure detection for non-Maven runners handled by this strategy.
  if (extractedFailureCount > 0) return "FAILED";

  if (EXPLICIT_SUCCESS.test(content)) return "PASSED";
  if (lastSummary && lastSummary.failures === 0 && lastSummary.errors === 0) {
    return "PASSED";
  }

  return "UNKNOWN";
}

function extractFailedTests(lines: string[], fullContent: string): FailedTest[] {
  const tests: FailedTest[] = [];

  // Strategy: find FAIL blocks (vitest/jest format) or Python-style failures
  // Approach: iterate through lines looking for fail markers

  // First, try vitest/jest style — look for FAIL lines
  const failBlockPattern = /^\s*(?:FAIL|×)\s+(.+)$/;
  let currentFile = "";
  let currentFailures: FailedTest[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Detect test file header: "FAIL  path/to/file.test.ts" or "❯ path/to/file.test.ts"
    const fileMatch = line.match(/^\s*(?:FAIL|❯)\s+(.+\.(?:test|spec)\.\w+)/);
    if (fileMatch) {
      // Finalize previous file's failures
      tests.push(...currentFailures);
      currentFailures = [];
      currentFile = fileMatch[1]!.trim();
      continue;
    }

    // Detect failing test: "   × test name" or "   ✗ test name"
    if (currentFile) {
      const testMatch = line.match(/^\s*(?:×|✗|✘)\s+(.+)$/);
      if (testMatch) {
        const testName = testMatch[1]!.trim();
        const failure = extractFailureDetail(lines, i, currentFile, testName);
        currentFailures.push(failure);
        continue;
      }
    }

    // Detect individual FAIL line (standalone)
    const singleFail = line.match(failBlockPattern);
    if (singleFail && !currentFile) {
      currentFile = singleFail[1]!.trim();
      continue;
    }

    // Detect error message after a fail line
    if (currentFile && currentFailures.length > 0) {
      const lastFailure = currentFailures[currentFailures.length - 1]!;
      if (!lastFailure.errorMessage) {
        const errMatch = line.match(/^\s*(?:Error|TypeError|AssertionError|ReferenceError)[: ]\s*(.+)/i);
        if (errMatch) {
          lastFailure.errorType = errMatch[0]!.split(/[: ]/, 1)[0] ?? "Error";
          lastFailure.errorMessage = errMatch[1] ?? errMatch[0]!;
        }
      }
    }
  }

  // Don't forget last batch
  tests.push(...currentFailures);

  // If no tests found with the structured approach, try regex-based extraction
  if (tests.length === 0) {
    // Find all FAIL blocks
    const failSections = fullContent.split(/\n(?=\s*(?:FAIL|❯)\s+\S)/);
    for (const section of failSections) {
      const fileMatch = section.match(/^\s*(?:FAIL|❯)\s+(.+\.(?:test|spec)\.\w+)/m);
      if (!fileMatch) continue;

      const file = fileMatch[1]!.trim();
      // Find test names preceded by ×/✗
      const testMatches = section.matchAll(/^\s*(?:×|✗|✘)\s+(.+)$/gm);
      for (const tm of testMatches) {
        const testName = tm[1]!.trim();
        const failure: FailedTest = {
          file,
          testName,
          errorType: "",
          errorMessage: "",
          stackTrace: [],
        };

        // Try to find error details near this test
        const testIndex = section.indexOf(tm[0]);
        const afterTest = section.slice(testIndex);
        const errMatch = afterTest.match(/(?:Error|TypeError|AssertionError|ReferenceError)[: ]\s*(.+)/i);
        if (errMatch) {
          failure.errorType = errMatch[0]!.split(/[: ]/, 1)[0] ?? "Error";
          failure.errorMessage = errMatch[1] ?? errMatch[0]!;
        }

        // Expected / Received
        const expMatch = afterTest.match(EXPECTED_LINE);
        if (expMatch) failure.expected = expMatch[1]!.trim();
        const recMatch = afterTest.match(RECEIVED_LINE);
        if (recMatch) failure.received = recMatch[1]!.trim();

        // Stack trace from section
        failure.stackTrace = extractStackTrace(section.split("\n"));

        tests.push(failure);
      }
    }
  }

  return tests;
}

function extractFailureDetail(
  lines: string[],
  startIdx: number,
  file: string,
  testName: string,
): FailedTest {
  const failure: FailedTest = {
    file,
    testName,
    errorType: "",
    errorMessage: "",
    stackTrace: [],
  };

  // Look ahead up to 30 lines for error details, stack trace, Expected/Received
  const lookAhead = lines.slice(startIdx + 1, startIdx + 40);

  for (const line of lookAhead) {
    // Error type + message
    const errMatch = line.match(/^\s*(?:Error|TypeError|AssertionError|ReferenceError|RangeError)[: ]\s*(.+)/i);
    if (errMatch && !failure.errorMessage) {
      failure.errorType = (errMatch[0]!.match(/^[A-Za-z]+/) ?? ["Error"])[0]!;
      failure.errorMessage = errMatch[1] ?? line.trim();
    }

    // Expected
    const expMatch = line.match(EXPECTED_LINE);
    if (expMatch && !failure.expected) {
      failure.expected = expMatch[1]!.trim();
    }

    // Received
    const recMatch = line.match(RECEIVED_LINE);
    if (recMatch && !failure.received) {
      failure.received = recMatch[1]!.trim();
    }

    // Stack trace start
    if (/^\s*(?:at |❯ |→ )/.test(line)) {
      failure.stackTrace.push(line);
    }

    // Location from stack
    if (!failure.location) {
      const locMatch = line.match(/^\s*(?:❯ |at )?(.+?\.\w+):(\d+):(\d+)/);
      if (locMatch) {
        failure.location = `${locMatch[1]}:${locMatch[2]}:${locMatch[3]}`;
      }
    }
  }

  return failure;
}

function extractStackTrace(lines: string[]): string[] {
  const trace: string[] = [];
  let inTrace = false;

  for (const line of lines) {
    if (/^\s*(?:at |❯ |→ |Error:|Traceback|Stack trace)/i.test(line)) {
      inTrace = true;
    }
    if (inTrace && /^\s*(?:at |❯ |→ )/.test(line)) {
      // Filter out internal frames
      if (!INTERNAL_FRAMES.test(line)) {
        trace.push(line);
      }
    }
    if (inTrace && trace.length >= 20) break;
    if (inTrace && /^\s*$/.test(line) && trace.length > 0) {
      // Empty line after trace — end
      break;
    }
  }

  return trace;
}

// ---------------------------------------------------------------------------
// Markdown Formatting
// ---------------------------------------------------------------------------

function formatMarkdown(s: TestOutputSummary): string {
  const parts: string[] = [];

  parts.push("## Test Output Summary");
  parts.push("");
  parts.push(`- **Command:** ${s.command || "(not detected)"}`);
  parts.push(`- **Framework:** ${s.framework}`);
  parts.push(`- **Status:** ${s.status}`);

  if (s.failedTests.length > 0) {
    parts.push(`- **Failed Tests:** ${s.failedTests.length}`);
    for (let i = 0; i < s.failedTests.length; i++) {
      const ft = s.failedTests[i]!;
      parts.push(`  ${i + 1}. **${ft.file}** > \`${ft.testName}\``);
      if (ft.errorType) {
        parts.push(`     - Error: \`${ft.errorType}\`: ${ft.errorMessage}`);
      }
      if (ft.expected) {
        parts.push(`     - Expected: \`${ft.expected}\``);
      }
      if (ft.received) {
        parts.push(`     - Received: \`${ft.received}\``);
      }
      if (ft.location) {
        parts.push(`     - Location: \`${ft.location}\``);
      }
    }
  } else {
    parts.push("- **Failed Tests:** None detected");
  }

  if (s.keyError) {
    parts.push(`- **Key Error:** ${s.keyError}`);
  }
  if (s.expected) {
    parts.push(`- **Expected:** \`${s.expected}\``);
  }
  if (s.received) {
    parts.push(`- **Received:** \`${s.received}\``);
  }

  if (s.stackTrace.length > 0) {
    parts.push("- **Stack Trace:**");
    parts.push("  ```");
    for (const frame of s.stackTrace.slice(0, 20)) {
      parts.push(`  ${frame.trim()}`);
    }
    if (s.stackTrace.length > 20) {
      parts.push(`  ... (${s.stackTrace.length - 20} more frames)`);
    }
    parts.push("  ```");
  }

  parts.push(`- **Exit Code:** ${s.exitCode || "(not detected)"}`);

  if (s.lastLines.length > 0) {
    parts.push("- **Last Lines:**");
    parts.push("  ```");
    for (const line of s.lastLines) {
      parts.push(`  ${line}`);
    }
    parts.push("  ```");
  }

  return parts.join("\n");
}

function buildSummaryText(s: TestOutputSummary): string {
  if (s.failedTests.length === 0) {
    return `Test output compressed — status: ${s.status}, framework: ${s.framework}`;
  }
  const first = s.failedTests[0]!;
  return `${first.file} > ${first.testName} failed — ${first.errorType}: ${first.errorMessage}`;
}

// ---------------------------------------------------------------------------
// Budget trimming
// ---------------------------------------------------------------------------

function trimToBudget(s: TestOutputSummary, maxTokens: number): string {
  // Try progressively trimming: shorter stack traces, fewer last lines
  const strategies: TestOutputSummary[] = [
    // Strategy 1: limit stack to 10 frames
    { ...s, stackTrace: s.stackTrace.slice(0, 10) },
    // Strategy 2: limit stack to 5 frames, last lines to 5
    { ...s, stackTrace: s.stackTrace.slice(0, 5), lastLines: s.lastLines.slice(-5) },
    // Strategy 3: minimal — 3 frames, 3 last lines
    { ...s, stackTrace: s.stackTrace.slice(0, 3), lastLines: s.lastLines.slice(-3) },
    // Strategy 4: bare minimum
    { ...s, stackTrace: [], lastLines: [], failedTests: s.failedTests.slice(0, 1) },
  ];

  for (const strategy of strategies) {
    const md = formatMarkdown(strategy);
    if (countTokens(md) <= maxTokens) {
      return md;
    }
  }

  // Last resort: truncate the minimal markdown
  const minimal = formatMarkdown(strategies[strategies.length - 1]!);
  return tokenAwareTruncate(minimal, maxTokens);
}

function truncateFallback(
  content: string,
  maxTokens: number,
  warnings: string[],
): StrategyResult {
  const lines = content.split("\n");
  const head = Math.ceil(lines.length * 0.5);
  const tail = Math.ceil(lines.length * 0.3);
  const kept = [
    ...lines.slice(0, head),
    `[... ${lines.length - head - tail} lines folded ...]`,
    ...lines.slice(-tail),
  ];
  let result = kept.join("\n");
  result = tokenAwareTruncate(result, maxTokens);
  warnings.push("Test output compression fell back to truncation");
  return {
    compressedContent: result,
    warnings,
    summary: "Truncated test output (fallback)",
  };
}
