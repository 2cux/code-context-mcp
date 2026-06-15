/**
 * Context Decision Engine — PRD §32
 *
 * Analyses content and queries to determine whether the agent should:
 *   - Compress content (shouldCompress)
 *   - Recall project memory (shouldRecall)
 *   - Save a new memory (shouldSaveMemory)
 *   - Retrieve original (uncompressed) content (shouldRetrieveOriginal)
 *
 * This module ONLY provides suggestions — it does NOT automatically
 * invoke any tools (§32.5). The agent receives the suggestions and
 * decides which actions to take.
 *
 * Design principles:
 *   - All decisions are rule-based and deterministic (no ML).
 *   - Every decision includes human-readable reasons.
 *   - Thresholds are configurable via an optional options bag.
 *   - The module is pure (no side effects, no DB access).
 */

import { countTokens } from "../utils/tokenCount.js";
import type { ContentType } from "../router/contentRouter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextInput {
  /**
   * The raw content to analyse for compression decisions.
   * Required for shouldCompress / shouldSaveMemory / shouldRetrieveOriginal.
   */
  content?: string;

  /**
   * Known or auto-detected content type.
   * When omitted the engine runs a basic heuristic to guess it.
   */
  contentType?: ContentType | string;

  /**
   * The user's current query / request text.
   * Required for shouldRecall to produce meaningful suggestions.
   */
  query?: string;

  /**
   * Source hint — where the content came from.
   * E.g. "agent", "user", "command_output", "test_runner", "log_file".
   */
  source?: string;

  /**
   * Optional metadata (command, filePath, etc.) that may carry
   * additional signals for decision-making.
   */
  metadata?: Record<string, unknown>;

  /**
   * Pre-computed content metrics. When provided, shouldCompress and
   * analyzeContext skip the computeContentMetrics() call, avoiding
   * duplicate work.
   * @internal — set by analyzeContext, not by external callers.
   */
  _precomputedMetrics?: {
    errorDensity: number;
    repetitionRatio: number;
  };
}

/** A single decision with a boolean recommendation and reasons. */
export interface Decision {
  /** Whether the action is recommended. */
  value: boolean;
  /** Confidence in the recommendation (0-1). */
  confidence: number;
  /** Human-readable reasons for the recommendation. */
  reasons: string[];
}

/** Full analysis result returned by analyzeContext. */
export interface AnalysisResult {
  shouldCompress: Decision;
  shouldRecall: Decision;
  shouldSaveMemory: Decision;
  shouldRetrieveOriginal: Decision;
  /** Tools suggested based on the combined analysis. */
  suggestedTools: string[];
  /** Aggregate reasons across all decisions. */
  reasons: string[];
  /** Content statistics computed during analysis. */
  stats: ContentStats;
}

export interface ContentStats {
  contentLength: number;
  estimatedTokens: number;
  contentType: string;
  errorDensity: number;
  repetitionRatio: number;
  lineCount: number;
}

/** Tunable thresholds — all have sensible defaults. */
export interface DecisionOptions {
  /** Minimum character length to recommend compression (default 2000). */
  compressMinLength?: number;
  /** Minimum token count to recommend compression (default 500). */
  compressMinTokens?: number;
  /** Above this error density compression is flagged as risky (default 0.3). */
  errorDensityWarnThreshold?: number;
  /** Above this repetition ratio compression becomes more attractive (default 0.3). */
  repetitionHighThreshold?: number;
  /** Minimum confidence for a positive recall suggestion (default 0.3). */
  recallMinConfidence?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULTS: Required<DecisionOptions> = {
  compressMinLength: 2000,
  compressMinTokens: 500,
  errorDensityWarnThreshold: 0.3,
  repetitionHighThreshold: 0.3,
  recallMinConfidence: 0.3,
};

/** Content types that typically benefit most from compression. */
const HIGH_VALUE_COMPRESSION_TYPES = new Set<string>([
  "test_output",
  "log",
  "command_output",
  "conversation_history",
  "rag_chunk",
]);

/** Content types where compression should be conservative. */
const CONSERVATIVE_COMPRESSION_TYPES = new Set<string>([
  "code",
  "json",
  "markdown",
]);

/** Error-indicator patterns used for error density calculation. */
const ERROR_PATTERNS = [
  /\b(error|exception|fail|crash|panic|fatal|abort|timeout)\b/i,
  /\b(syntax\s*error|type\s*error|reference\s*error|range\s*error)\b/i,
  /\b(E\d{4,}|0x[0-9A-Fa-f]{8})\b/, // error codes like EACCES, 0x80004005
  /\bassert(ion)?\s*(failed|error)\b/i,
  /\[ERROR\]|\[FATAL\]|\[CRITICAL\]|\[WARN\]/,
  /Traceback\s*\(most\s+recent\s+call\s+last\)/i,
  /^\s*at\s+\S+\s+\(.*:\d+:\d+\)/m, // stack trace lines
  /Caused by:/i,
  /Exit\s*code:\s*[1-9]/i,
];

// ---------------------------------------------------------------------------
// Recall keyword patterns (§32.3)
// ---------------------------------------------------------------------------

/** Patterns that suggest the query involves project rules. */
const PROJECT_RULE_PATTERNS = [
  /\b(rule|guideline|convention|standard|policy|protocol|pattern|best\s*practice)\b/i,
  /\b(code\s*style|lint|format|naming)\b/i,
  /\b(CLAUDE\.md|AGENTS\.md|CONTRIBUTING|README)\b/,
  /\b(should|must|always|never)\s+\w+\s+(be|use|follow|do)\b/i,
  /\b(project\s*(rule|convention|standard|guideline))\b/i,
];

/** Patterns that suggest the query involves historical bugs. */
const HISTORICAL_BUG_PATTERNS = [
  /\b(bug|issue|defect|regression|broken|fix|patch|workaround)\b/i,
  /\b(previously|before|earlier|last\s*time|used\s*to)\b.+\b(bug|error|fail|break)\b/i,
  /\b(recur|reappear|again|still)\b.+\b(error|fail|bug|issue)\b/i,
  /\b(known\s*(issue|bug|problem|limitation))\b/i,
  /\b(ticket|JIRA|github\s*issue|#\d{2,})\b/i,
];

/** Patterns that suggest the query involves current task. */
const CURRENT_TASK_PATTERNS = [
  /\b(current|ongoing|active|now|today|this\s*session)\s+(task|work|goal|focus|doing)\b/i,
  /\b(what\s*(are|is|were)\s*(we|you|I)\s*(doing|working|building|implementing))\b/i,
  /\b(continue|resume|pick\s*up|carry\s*on)\b/i,
  /\b(task|todo|plan|milestone|sprint|iteration)\b/i,
  /\b(where\s*(did|were)\s*(we|you|I)\s*(leave|stop|pause))\b/i,
];

/** Patterns that suggest the query involves dependencies / architecture / API contracts. */
const ARCHITECTURE_PATTERNS = [
  /\b(dependenc|package|library|module|import|require)\b/i,
  /\b(architect|design|structure|layer|component|service|boundary)\b/i,
  /\b(API|endpoint|route|contract|interface|schema|protocol)\b/,
  /\b(breaking\s*change|backward|compat|migration|upgrade|version)\b/i,
  /\b(database|schema|migration|table|column|index|query)\b/i,
  /\b(how\s*(does|is|do|are).*\b(connect|integrate|communicate|call|invoke|depend))\b/i,
];

// ---------------------------------------------------------------------------
// Core decision functions
// ---------------------------------------------------------------------------

/**
 * Decide whether content should be compressed.
 *
 * Rules (§32.2):
 *   1. Content length > threshold (default 2000 chars) → strong signal.
 *   2. Estimated tokens > threshold (default 500) → strong signal.
 *   3. Content type is a high-value compression target → boost.
 *   4. Error density is high → caution (compression could lose detail).
 *   5. Repetition ratio is high → good compression candidate.
 *   6. Source type provides additional context.
 */
export function shouldCompress(
  input: ContextInput,
  options?: DecisionOptions,
): Decision {
  const opts = { ...DEFAULTS, ...options };
  const reasons: string[] = [];
  let score = 0;
  let maxScore = 0;

  const content = input.content ?? "";
  const contentLen = content.length;
  const tokens = countTokens(content);
  const ct = input.contentType ?? "unknown";

  // Rule 1: Content length
  maxScore += 3;
  if (contentLen === 0) {
    reasons.push("Content is empty — nothing to compress.");
  } else if (contentLen >= opts.compressMinLength * 4) {
    score += 3;
    reasons.push(
      `Content length (${contentLen} chars) is well above the ${opts.compressMinLength}-char threshold — strong compression candidate.`,
    );
  } else if (contentLen >= opts.compressMinLength * 2) {
    score += 2;
    reasons.push(
      `Content length (${contentLen} chars) is above the compression threshold — good candidate.`,
    );
  } else if (contentLen >= opts.compressMinLength) {
    score += 1;
    reasons.push(
      `Content length (${contentLen} chars) meets the minimum compression threshold.`,
    );
  } else {
    reasons.push(
      `Content length (${contentLen} chars) is below the ${opts.compressMinLength}-char threshold — compression likely unnecessary.`,
    );
  }

  // Rule 2: Estimated tokens
  maxScore += 3;
  if (tokens >= opts.compressMinTokens * 4) {
    score += 3;
    reasons.push(
      `Estimated tokens (${tokens}) are very high — compression recommended to reduce context cost.`,
    );
  } else if (tokens >= opts.compressMinTokens * 2) {
    score += 2;
    reasons.push(
      `Estimated tokens (${tokens}) are above the ${opts.compressMinTokens}-token threshold — compression would save meaningful context.`,
    );
  } else if (tokens >= opts.compressMinTokens) {
    score += 1;
    reasons.push(
      `Estimated tokens (${tokens}) meet the minimum token threshold.`,
    );
  } else {
    reasons.push(
      `Estimated tokens (${tokens}) are below the ${opts.compressMinTokens}-token threshold — compression may not be worth the overhead.`,
    );
  }

  // Rule 3: Content type signal
  maxScore += 2;
  if (HIGH_VALUE_COMPRESSION_TYPES.has(ct)) {
    score += 2;
    reasons.push(
      `Content type "${ct}" is a high-value compression target — typically compresses well.`,
    );
  } else if (CONSERVATIVE_COMPRESSION_TYPES.has(ct)) {
    score += 1;
    reasons.push(
      `Content type "${ct}" — moderate compression candidate (conservative strategy recommended).`,
    );
  } else if (ct === "unknown") {
    reasons.push(
      `Content type is unknown — compression may still help but results are less predictable.`,
    );
  } else {
    score += 1;
    reasons.push(`Content type "${ct}" — standard compression applies.`);
  }

  // Rule 4: Error density
  maxScore += 2;
  const metrics = input._precomputedMetrics ?? computeContentMetrics(content);
  const { errorDensity, repetitionRatio } = metrics;
  if (errorDensity >= opts.errorDensityWarnThreshold) {
    score -= 2;
    reasons.push(
      `High error density (${(errorDensity * 100).toFixed(0)}%) — compression may lose important error details. Consider compressing conservatively.`,
    );
  } else if (errorDensity > 0) {
    reasons.push(
      `Error density is low (${(errorDensity * 100).toFixed(0)}%) — safe to compress.`,
    );
  }

  // Rule 5: Repetition ratio
  maxScore += 2;
  if (repetitionRatio >= opts.repetitionHighThreshold) {
    score += 2;
    reasons.push(
      `High repetition ratio (${(repetitionRatio * 100).toFixed(0)}%) — content is highly compressible.`,
    );
  } else if (repetitionRatio > 0.1) {
    score += 1;
    reasons.push(
      `Moderate repetition detected (${(repetitionRatio * 100).toFixed(0)}%) — some compression benefit expected.`,
    );
  }

  // Rule 6: Source type
  maxScore += 1;
  if (input.source) {
    const src = input.source.toLowerCase();
    if (
      src.includes("log") ||
      src.includes("test") ||
      src.includes("output") ||
      src.includes("trace")
    ) {
      score += 1;
      reasons.push(`Source "${input.source}" suggests content benefits from compression.`);
    } else if (src.includes("agent") || src.includes("user")) {
      reasons.push(`Source "${input.source}" — evaluate compression based on content traits.`);
    }
  }

  // Normalize score to [0, 1]
  const confidence = maxScore > 0 ? Math.max(0, Math.min(1, score / maxScore)) : 0;
  const value = confidence >= 0.4;

  if (value && reasons.length === 0) {
    reasons.push("Content meets compression thresholds.");
  }
  if (!value && reasons.length === 0) {
    reasons.push("Content does not meet compression thresholds — keeping original is fine.");
  }

  return { value, confidence: Math.round(confidence * 100) / 100, reasons };
}

/**
 * Decide whether project memory should be recalled.
 *
 * Rules (§32.3):
 *   1. Query involves project rules / conventions.
 *   2. Query involves historical bugs / known issues.
 *   3. Query involves the current task / what we were doing.
 *   4. Query involves dependencies / architecture / API contracts.
 *   5. Query is a follow-up to a prior context operation.
 */
export function shouldRecall(
  input: ContextInput,
  options?: DecisionOptions,
): Decision {
  const opts = { ...DEFAULTS, ...options };
  const reasons: string[] = [];
  let score = 0;
  // 4 core rules + 1 content-type rule = 5 total
  let maxScore = 5;

  const query = input.query ?? "";
  if (!query.trim()) {
    return {
      value: false,
      confidence: 0,
      reasons: ["No query provided — cannot determine recall need."],
    };
  }

  // Rule 1: Project rules
  const ruleMatches = countPatternMatches(query, PROJECT_RULE_PATTERNS);
  if (ruleMatches > 0) {
    score += 1;
    reasons.push(
      `Query matches project-rule patterns (${ruleMatches} signal(s)) — recalling project rules/conventions may help.`,
    );
  }

  // Rule 2: Historical bugs
  const bugMatches = countPatternMatches(query, HISTORICAL_BUG_PATTERNS);
  if (bugMatches > 0) {
    score += 1;
    reasons.push(
      `Query matches historical-bug patterns (${bugMatches} signal(s)) — recalling prior bugs/fixes may prevent regressions.`,
    );
  }

  // Rule 3: Current task
  const taskMatches = countPatternMatches(query, CURRENT_TASK_PATTERNS);
  if (taskMatches > 0) {
    score += 1;
    reasons.push(
      `Query matches current-task patterns (${taskMatches} signal(s)) — recalling task context may restore session state.`,
    );
  }

  // Rule 4: Architecture / dependencies / API
  const archMatches = countPatternMatches(query, ARCHITECTURE_PATTERNS);
  if (archMatches > 0) {
    score += 1;
    reasons.push(
      `Query matches architecture/dependency/API patterns (${archMatches} signal(s)) — recalling related context may prevent breaking changes.`,
    );
  }

  // Rule 5: Content type hints at prior work
  if (input.contentType && input.content) {
    if (
      input.contentType === "conversation_history" ||
      input.contentType === "file_summary"
    ) {
      score += 1;
      reasons.push(
        `Content type "${input.contentType}" suggests prior context — recall may surface related memories.`,
      );
    } else {
      // Rule 5 didn't fire — remove it from the denominator
      maxScore = 4;
    }
  } else {
    // Rule 5 not applicable (no content type info) — remove from denominator
    maxScore = 4;
  }

  const confidence = Math.max(0, Math.min(1, score / maxScore));
  const value = confidence >= opts.recallMinConfidence;

  if (!value && reasons.length === 0) {
    reasons.push(
      "Query does not strongly match recall trigger patterns — direct recall may not be needed.",
    );
  }

  return { value, confidence: Math.round(confidence * 100) / 100, reasons };
}

/**
 * Decide whether content should be saved as project memory.
 *
 * Heuristics:
 *   - Content looks like a decision / rule → save.
 *   - Content contains a bug description → save.
 *   - Content resembles a task definition → save.
 *   - Content is a user preference → save.
 *   - High-confidence, non-ephemeral content → save.
 */
export function shouldSaveMemory(
  input: ContextInput,
  _options?: DecisionOptions,
): Decision {
  const reasons: string[] = [];
  let score = 0;
  const maxScore = 5;

  const content = input.content ?? "";
  const query = input.query ?? "";
  const combined = `${query}\n${content}`.toLowerCase();

  if (!combined.trim()) {
    return {
      value: false,
      confidence: 0,
      reasons: ["No content or query provided — nothing to evaluate for memory saving."],
    };
  }

  // Decision / rule detection
  if (
    /\b(decide|decision|agreed|concluded|resolved|chosen|opted)\b/i.test(combined) ||
    /\b(from now on|going forward|henceforth|hereafter)\b/i.test(combined) ||
    /\b(rule|policy|standard|guideline|convention)\b.+\b(set|establish|define|create|add)\b/i.test(
      combined,
    )
  ) {
    score += 1;
    reasons.push("Content appears to contain a decision or rule — worth remembering.");
  }

  // Bug detection
  if (
    /\b(bug|defect|regression|broken)\b.*\b(found|discovered|identified|reported|exists)\b/i.test(
      combined,
    ) ||
    /\b(root\s*cause|fix|workaround|patch)\b/i.test(combined) ||
    /\b(repro|reproduce|reproduction)\s*(steps|case|scenario)\b/i.test(combined)
  ) {
    score += 1;
    reasons.push("Content describes a bug or fix — saving as memory prevents re-occurrence.");
  }

  // Task / context detection
  if (
    /\b(currently|now|today)\s+(working|building|implementing|fixing|debugging|adding)\b/i.test(
      combined,
    ) ||
    /\b(task|todo|goal|objective|milestone)\b.+\b(is|are|:)\b/i.test(combined)
  ) {
    score += 1;
    reasons.push("Content describes current task state — saving helps restore context later.");
  }

  // User preference detection
  if (
    /\b(prefer|preference|like|dislike|want|don't\s*want|always|never)\b/i.test(
      combined,
    ) &&
    combined.length > 100
  ) {
    score += 1;
    reasons.push("Content may contain user preferences — saving improves personalization.");
  }

  // Dependency / api contract
  if (
    /\b(API|endpoint|route|contract|schema|interface|dependency)\b.+\b(change|update|add|remove|deprecate|break)\b/i.test(
      combined,
    ) ||
    /\b(version|upgrade|migrate)\b.+\b(from|to)\b/i.test(combined)
  ) {
    score += 1;
    reasons.push("Content describes API/dependency changes — recording prevents future breakage.");
  }

  const confidence = Math.max(0, Math.min(1, score / maxScore));
  const value = confidence >= 0.2; // Lower bar — better to suggest than miss

  if (!value && reasons.length === 0) {
    reasons.push(
      "Content does not strongly match memory-worthy patterns — but review is recommended if it seems important.",
    );
  }

  return { value, confidence: Math.round(confidence * 100) / 100, reasons };
}

/**
 * Decide whether original (uncompressed) content should be retrieved.
 *
 * Heuristics:
 *   - Content/query references a prior compression (originalRef pattern).
 *   - User is reviewing something that was compressed.
 *   - Content type suggests expandability is needed.
 */
export function shouldRetrieveOriginal(
  input: ContextInput,
  _options?: DecisionOptions,
): Decision {
  const reasons: string[] = [];
  let score = 0;
  const maxScore = 3;

  const content = input.content ?? "";
  const query = input.query ?? "";
  const combined = `${query}\n${content}`;

  if (!combined.trim()) {
    return {
      value: false,
      confidence: 0,
      reasons: ["No content or query provided — nothing to evaluate for retrieval."],
    };
  }

  // Reference to compressed content
  if (
    /\b(originalRef|original_ref|original-ref)\b/i.test(combined) ||
    /\b(ccr[-_]?\w+|compressed[-_]context)\b/i.test(combined)
  ) {
    score += 1;
    reasons.push("Content references a compressed context record — retrieval may be needed.");
  }

  // User wants to see the original / expand
  if (
    /\b(expand|retrieve|restore|recover|original|uncompressed|full)\b/i.test(
      combined,
    ) &&
    /\b(content|text|output|log|result)\b/i.test(combined)
  ) {
    score += 1;
    reasons.push("Query suggests the user wants to see original (uncompressed) content.");
  }

  // Compressed summary is insufficient
  if (
    input.contentType &&
    ["test_output", "log", "command_output"].includes(input.contentType) &&
    input.content &&
    input.content.length < 500
  ) {
    score += 1;
    reasons.push(
      `Short "${input.contentType}" content (${input.content.length} chars) — may be a compressed summary; user might want the original.`,
    );
  }

  const confidence = Math.max(0, Math.min(1, score / maxScore));
  const value = confidence >= 0.3;

  if (!value && reasons.length === 0) {
    reasons.push(
      "No signals detected that suggest original content retrieval is needed.",
    );
  }

  return { value, confidence: Math.round(confidence * 100) / 100, reasons };
}

// ---------------------------------------------------------------------------
// Main analysis entry point (§32.4)
// ---------------------------------------------------------------------------

/**
 * Run full context analysis and return structured recommendations.
 *
 * This is the primary entry point called by the `analyze_context` MCP tool.
 * It runs all four decision functions, gathers suggested tools, and
 * returns the combined analysis.
 */
export function analyzeContext(
  input: ContextInput,
  options?: DecisionOptions,
): AnalysisResult {
  const opts = { ...DEFAULTS, ...options };

  // Compute content metrics once and share via _precomputedMetrics so
  // shouldCompress doesn't recompute them.
  const content = input.content ?? "";
  const metrics = computeContentMetrics(content);
  const inputWithMetrics: ContextInput = {
    ...input,
    _precomputedMetrics: metrics,
  };

  const compress = shouldCompress(inputWithMetrics, opts);
  const recall = shouldRecall(inputWithMetrics, opts);
  const saveMemory = shouldSaveMemory(inputWithMetrics, opts);
  const retrieveOriginal = shouldRetrieveOriginal(inputWithMetrics, opts);

  const stats: ContentStats = {
    contentLength: content.length,
    estimatedTokens: countTokens(content),
    contentType: input.contentType ?? detectSimpleContentType(content),
    errorDensity: Math.round(metrics.errorDensity * 1000) / 1000,
    repetitionRatio: Math.round(metrics.repetitionRatio * 1000) / 1000,
    lineCount: content ? content.split("\n").length : 0,
  };

  // Build suggested tools
  const suggestedTools: string[] = [];
  if (compress.value) {
    suggestedTools.push("compress_context");
  }
  if (recall.value) {
    suggestedTools.push("recall_context");
  }
  if (saveMemory.value) {
    suggestedTools.push("remember_context");
  }
  if (retrieveOriginal.value) {
    suggestedTools.push("retrieve_original");
  }

  // Aggregate all reasons
  const reasons: string[] = [
    ...compress.reasons.map((r) => `[compress] ${r}`),
    ...recall.reasons.map((r) => `[recall] ${r}`),
    ...saveMemory.reasons.map((r) => `[memory] ${r}`),
    ...retrieveOriginal.reasons.map((r) => `[retrieve] ${r}`),
  ];

  return {
    shouldCompress: compress,
    shouldRecall: recall,
    shouldSaveMemory: saveMemory,
    shouldRetrieveOriginal: retrieveOriginal,
    suggestedTools,
    reasons,
    stats,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute basic content metrics: error density and repetition ratio.
 *
 * These are cheap to compute and provide useful signals for all
 * decision functions.
 */
function computeContentMetrics(content: string): {
  errorDensity: number;
  repetitionRatio: number;
} {
  if (!content || content.length === 0) {
    return { errorDensity: 0, repetitionRatio: 0 };
  }

  // Error density: proportion of lines containing error-like patterns
  const lines = content.split("\n");
  if (lines.length === 0) {
    return { errorDensity: 0, repetitionRatio: 0 };
  }

  let errorLines = 0;
  for (const line of lines) {
    for (const pattern of ERROR_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        errorLines++;
        break;
      }
    }
  }
  const errorDensity = errorLines / lines.length;

  // Repetition ratio: 1 - (unique non-empty lines / total non-empty lines)
  const nonEmptyLines = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (nonEmptyLines.length === 0) {
    return { errorDensity, repetitionRatio: 0 };
  }

  const uniqueLines = new Set(nonEmptyLines);
  const repetitionRatio =
    1 - uniqueLines.size / nonEmptyLines.length;

  return { errorDensity, repetitionRatio };
}

/**
 * Count how many patterns in a list match the given text.
 */
function countPatternMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      count++;
    }
  }
  return count;
}

/**
 * Basic content type detection when none is provided.
 * Uses cheap heuristics to guess the type — this is intentionally
 * simpler than the full ContentRouter to keep the decision engine
 * fast and dependency-light.
 */
function detectSimpleContentType(content: string): string {
  if (!content || content.trim().length === 0) return "unknown";

  const head = content.slice(0, 500).trim();
  const tail = content.slice(-100).trim();

  // JSON — only attempt full parse on reasonably sized content to avoid DoS
  const JSON_MAX_PARSE_BYTES = 100_000; // 100 KiB safety limit
  if (/^\s*[\[{]/.test(head) && /[\]}]\s*$/.test(tail)) {
    if (content.length <= JSON_MAX_PARSE_BYTES) {
      try {
        JSON.parse(content);
        return "json";
      } catch {
        // Not valid JSON
      }
    }
    // For oversized content: if it looks like JSON but is too large to
    // validate, don't guess — let the full ContentRouter handle it.
  }

  // Code
  const codeSignals = [
    /\b(function|class|const|let|var|import|export|return|if|for|while)\b/,
    /[{;}]/,
    /^\s*\/\//m,
    /^\s*\/\*/m,
  ];
  let codeHits = 0;
  for (const s of codeSignals) {
    s.lastIndex = 0;
    if (s.test(head)) codeHits++;
  }
  if (codeHits >= 3) return "code";

  // Markdown
  if (/^#{1,6}\s/m.test(head) || /\*\*.*\*\*/.test(head) || /\[.*\]\(.*\)/.test(head)) {
    return "markdown";
  }

  // Log-like
  if (
    /\b(INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\b/i.test(head) ||
    /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(head)
  ) {
    return "log";
  }

  // Test output
  if (
    /\b(PASS|FAIL|SKIP|OK|passed|failed|tests?)\b/i.test(head) ||
    /\b(assert|expect)\b/i.test(head)
  ) {
    return "test_output";
  }

  return "unknown";
}
