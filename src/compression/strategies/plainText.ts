/**
 * Plain Text Compressor — Phase 2
 *
 * General-purpose conservative text compression.
 *
 * Preserves:
 *   - First section (usually title / introduction)
 *   - Last section (usually conclusion / footer)
 *   - Headings (markdown-style #, ##, underline-style)
 *   - Key paragraphs containing errors, warnings, important notes
 *   - List structures, file paths, URLs
 *
 * Folds:
 *   - Consecutive repeated content
 *   - Low-relevance middle paragraphs when token budget is tight
 *
 * Strategy: score each section, always keep first+last, fill remaining
 * budget with highest-scored sections.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens } from "../../utils/tokenCount.js";

// ---------------------------------------------------------------------------
// Strategy definition
// ---------------------------------------------------------------------------

export const plainTextStrategy: CompressionStrategy = {
  name: "plain_text",
  version: "1.0.0",
  compress: compressPlainText,
};

// ---------------------------------------------------------------------------
// Legacy function export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressPlainText(
  content: string,
  maxTokens: number,
): StrategyResult {
  const warnings: string[] = [];

  // ---- empty / whitespace-only ----
  if (!content || content.trim().length === 0) {
    return {
      compressedContent: content,
      warnings,
      summary: "Empty content — nothing to compress",
    };
  }

  const totalTokens = countTokens(content);

  // ---- fits within budget ----
  if (totalTokens <= maxTokens) {
    // Still check for consecutive repeat folding (cost-free savings)
    const sections = splitSections(content);
    const { result: folded, foldedCount } = foldConsecutiveRepeats(sections);
    const foldedResult = folded.join("\n\n");
    const foldedTokens = countTokens(foldedResult);

    if (foldedTokens < totalTokens) {
      return {
        compressedContent: foldedResult,
        warnings: [`Folded ${foldedCount} consecutive repeated sections`],
        summary: `Folded consecutive repeats — ${totalTokens} → ${foldedTokens} tokens`,
      };
    }

    return {
      compressedContent: content,
      warnings,
      summary: "Content fits within token budget — no compression needed",
    };
  }

  // ---- needs compression ----
  const sections = splitSections(content);

  // For very short content (1-3 sections), truncate rather than score
  if (sections.length <= 3) {
    return truncateContent(content, maxTokens, warnings);
  }

  // Score every section
  const scored = sections.map((section, index) => ({
    section,
    index,
    score: scoreSection(section, index, sections.length),
    kept: false,
  }));

  // First and last are always kept
  const first = scored[0]!;
  const last = scored[scored.length - 1]!;
  first.kept = true;
  last.kept = true;

  // Sort middle sections by score (descending)
  const middle = scored.slice(1, -1);
  middle.sort((a, b) => b.score - a.score);

  // Build output: always include first, then fill budget with best middle, then last
  const kept: typeof scored = [first];

  // Estimate tokens for first + last + separators
  const separatorTokens = countTokens("\n\n");
  let usedTokens =
    countTokens(first.section) +
    countTokens(last.section) +
    separatorTokens * 2;

  // If even first+last exceed budget, fall back to pure truncation
  if (usedTokens > maxTokens) {
    return truncateContent(content, maxTokens, warnings);
  }

  for (const item of middle) {
    const sectTokens = countTokens(item.section) + separatorTokens;
    if (usedTokens + sectTokens <= maxTokens) {
      item.kept = true;
      kept.push(item);
      usedTokens += sectTokens;
    }
    // else: skip — doesn't fit in budget
  }

  kept.push(last);

  // Sort back to original order
  kept.sort((a, b) => a.index - b.index);

  // Fold consecutive repeats within kept sections
  const keptSections = kept.map((k) => k.section);
  const { result: folded } = foldConsecutiveRepeats(keptSections);
  const foldedResult = folded.join("\n\n");
  const foldedTokens = countTokens(foldedResult);

  // Safety: if folding added more tokens than it saved (possible with very
  // short repeated content annotations), skip the fold
  const unfilteredResult = keptSections.join("\n\n");
  const unfilteredTokens = countTokens(unfilteredResult);

  const result = foldedTokens <= unfilteredTokens ? foldedResult : unfilteredResult;

  const dropped = sections.length - kept.length;
  if (dropped > 0) {
    warnings.push(
      `Dropped ${dropped}/${sections.length} lower-relevance sections ` +
        `to fit ${maxTokens} token budget (kept ${kept.length})`,
    );
  }

  const resultTokens = countTokens(result);

  return {
    compressedContent: result,
    warnings,
    summary: `Compressed ${sections.length} sections → ${kept.length} kept, ` +
      `${totalTokens} → ${resultTokens} tokens ` +
      `(${Math.round((1 - resultTokens / totalTokens) * 100)}% reduction)`,
  };
}

// ---------------------------------------------------------------------------
// Section splitting
// ---------------------------------------------------------------------------

/**
 * Split content into logical sections.
 *
 * Uses double-newline as the primary separator (paragraph boundaries).
 * For content without double newlines, falls back to single newlines
 * (but only when the result would be a manageable number of sections).
 */
function splitSections(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // Normalize Windows-style line endings before splitting
  const normalized = trimmed.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Try paragraph splitting first
  const paragraphs = normalized.split(/\n\n+/);
  if (paragraphs.length > 1) {
    return paragraphs.filter((p) => p.length > 0);
  }

  // Single block — try line splitting if there are many lines
  const lines = trimmed.split("\n");
  if (lines.length >= 5) {
    return lines.filter((l) => l.length > 0);
  }

  return [trimmed];
}

// ---------------------------------------------------------------------------
// Section scoring
// ---------------------------------------------------------------------------

/**
 * Score a section by importance.
 *
 * Higher score = more likely to be preserved when budget is tight.
 *
 * Scoring dimensions:
 *   - Position (first/last bonus)
 *   - Structural markers (headings, lists)
 *   - Semantic signals (errors, warnings, important notes)
 *   - Content quality (medium-length sections preferred)
 */
function scoreSection(
  section: string,
  index: number,
  total: number,
): number {
  let score = 0;
  const trimmed = section.trim();
  const firstLine = trimmed.split("\n")[0] ?? "";

  // ---- Position ----
  if (index === 0) {
    score += 50; // Always keep intro
  } else if (index === total - 1) {
    score += 30; // Always keep conclusion
  } else if (index <= Math.ceil(total * 0.15)) {
    score += 10; // Near start — likely early context
  } else if (index >= Math.floor(total * 0.85)) {
    score += 5; // Near end — likely summary
  }

  // ---- Headings ----
  if (/^#{1,6}\s/.test(firstLine)) {
    score += 40; // Markdown heading
  }
  if (isUnderlineHeading(section)) {
    score += 25; // Setext-style heading (=== or --- underline)
  }

  // ---- Short ALL-CAPS line (likely a title/section header) ----
  if (
    firstLine.length >= 3 &&
    firstLine.length <= 80 &&
    /^[A-Z0-9\s_\-/:]+$/.test(firstLine) &&
    firstLine.replace(/\s/g, "").length >= 3
  ) {
    score += 15;
  }

  // ---- Key semantic signals ----
  if (hasKeySignal(trimmed, "critical")) {
    score += 12;
  } else if (hasKeySignal(trimmed, "warning")) {
    score += 8;
  } else if (hasKeySignal(trimmed, "info")) {
    score += 4;
  }

  // ---- Structural richness ----
  // Lists (unordered or ordered)
  if (/^[\s]*[-*+]\s/m.test(trimmed) || /^[\s]*\d+[.)]\s/m.test(trimmed)) {
    score += 8;
  }

  // Code indicators (inline code or fenced blocks)
  if (/`{1,3}[^`]+`{1,3}/.test(trimmed)) {
    score += 5;
  }

  // File paths
  if (/[\/\\][\w.-]+\.[a-z]{2,6}\b/i.test(trimmed)) {
    score += 5;
  }

  // URLs
  if (/\bhttps?:\/\/\S+/.test(trimmed)) {
    score += 5;
  }

  // ---- Content quality ----
  const len = trimmed.length;
  if (len >= 40 && len <= 800) {
    score += 5; // Goldilocks length
  }
  if (len > 2000) {
    score -= 10; // Very long sections penalized (likely low signal)
  }

  // ---- Penalize very short / noisy sections ----
  if (len < 20 && !/^#{1,6}\s/.test(firstLine)) {
    score -= 5; // Too short to be meaningful (unless heading)
  }

  return score;
}

/**
 * Check whether a section's first two lines form a Setext heading.
 * Pattern:
 *   Heading Text
 *   ===========   or   -----------
 */
function isUnderlineHeading(section: string): boolean {
  const lines = section.split("\n");
  if (lines.length < 2) return false;
  const secondLine = lines[1]?.trim() ?? "";
  const firstLine = lines[0]?.trim() ?? "";
  return (
    firstLine.length > 0 &&
    secondLine.length >= 3 &&
    (/^={3,}$/.test(secondLine) || /^-{3,}$/.test(secondLine))
  );
}

type SignalLevel = "critical" | "warning" | "info";

function hasKeySignal(text: string, level: SignalLevel): boolean {
  const lower = text.toLowerCase();

  const patterns: Record<SignalLevel, RegExp[]> = {
    critical: [
      /\b(error|fail|fatal|exception|panic|crash|critical)\b/i,
      /\b(cannot|unable|refused|timeout|rejected|denied|invalid)\b/i,
      /\b(stack trace|traceback|backtrace)\b/i,
    ],
    warning: [
      /\b(warn(ing)?|alert|caution|attention|notice)\b/i,
      /\b(deprecated|obsolete|outdated|unstable)\b/i,
    ],
    info: [
      /\b(important|note|key|crucial|essential|significant)\b/i,
      /\b(todo|fixme|hack|xxx|review)\b/i,
      /\b(summary|overview|conclusion|result)\b/i,
    ],
  };

  const levelPatterns = patterns[level];
  for (const re of levelPatterns) {
    if (re.test(lower)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Consecutive repeat folding
// ---------------------------------------------------------------------------

/**
 * Collapse consecutive identical sections.
 *
 * When N > 2 consecutive sections have the same normalized text,
 * keep the first occurrence and add a fold annotation.
 *
 * For N = 2, both are kept (not enough repetition to fold).
 */
interface FoldResult {
  result: string[];
  /** Number of original sections collapsed/folded */
  foldedCount: number;
}

/**
 * Collapse consecutive identical sections.
 *
 * When N > 2 consecutive sections have the same normalized text,
 * keep the first occurrence and add a fold annotation.
 * The remaining N-1 sections are counted as folded.
 *
 * For N = 2, both are kept (not enough repetition to fold).
 */
function foldConsecutiveRepeats(sections: string[]): FoldResult {
  if (sections.length <= 1) {
    return { result: sections, foldedCount: 0 };
  }

  const result: string[] = [];
  let foldedCount = 0;
  let i = 0;

  while (i < sections.length) {
    const current = sections[i]!;
    const key = normalizeForDedup(current);

    let repeatCount = 1;
    while (
      i + repeatCount < sections.length &&
      normalizeForDedup(sections[i + repeatCount]!) === key
    ) {
      repeatCount++;
    }

    if (repeatCount > 2) {
      result.push(current);
      result.push(`[↑ Repeated ${repeatCount} times — folded to save tokens]`);
      foldedCount += repeatCount - 1;
    } else if (repeatCount === 2) {
      result.push(current);
      result.push(sections[i + 1]!);
    } else {
      result.push(current);
    }

    i += repeatCount;
  }

  return { result, foldedCount };
}

/**
 * Normalize text for dedup comparison.
 * Trims whitespace, lowercases, collapses whitespace.
 */
function normalizeForDedup(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Token-aware truncation
// ---------------------------------------------------------------------------

/**
 * Truncate content to fit within maxTokens.
 *
 * Uses a binary-search approach on the character level, verifying
 * with tiktoken at each step to avoid over-shooting the budget.
 * This is UTF-8 safe because we split on character (not byte) boundaries.
 */
function truncateContent(
  content: string,
  maxTokens: number,
  warnings: string[],
): StrategyResult {
  const totalTokens = countTokens(content);

  // Try character-estimate truncation point
  const charsPerTokenEstimate = content.length / Math.max(totalTokens, 1);
  let estimateChars = Math.floor(maxTokens * charsPerTokenEstimate * 0.9); // 10% safety margin

  // Binary search for the actual truncation point
  let lo = Math.min(estimateChars, content.length);
  let hi = content.length;
  let best = "";

  // Coarse: character estimate as starting point
  let trunc = content.slice(0, lo);
  let truncTokens = countTokens(trunc);

  if (truncTokens <= maxTokens) {
    // We're under budget — extend forward
    best = trunc;
    let step = Math.ceil((hi - lo) / 2);
    while (step > 0) {
      const next = lo + step;
      if (next >= hi) {
        step = Math.floor(step / 2);
        continue;
      }
      trunc = content.slice(0, next);
      truncTokens = countTokens(trunc);
      if (truncTokens <= maxTokens) {
        best = trunc;
        lo = next;
      } else {
        hi = next;
      }
      step = Math.floor(step / 2);
    }
  } else {
    // Over budget — shrink back
    hi = lo;
    lo = 0;
    best = content.slice(0, 0);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      trunc = content.slice(0, mid);
      truncTokens = countTokens(trunc);
      if (truncTokens <= maxTokens) {
        best = trunc;
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
  }

  const bestTokens = countTokens(best);
  if (best.length < content.length) {
    warnings.push(
      `Content truncated: ${totalTokens} → ${bestTokens} tokens to fit budget of ${maxTokens}`,
    );
  }

  return {
    compressedContent: best,
    warnings,
    summary: `Truncated to fit ${maxTokens} token budget (${totalTokens} → ${bestTokens} tokens)`,
  };
}
