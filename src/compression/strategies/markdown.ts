/**
 * Markdown compression with priority-aware budgeting.
 *
 * The compressor treats a heading and its body as one semantic section. This
 * keeps important tail sections recoverable and prevents repeated component
 * headings (or a generated table of contents) from consuming the whole budget.
 */

import type {
  CompressionStrategy,
  StrategyContext,
  StrategyResult,
} from "../compressionEngine.js";
import { countTokens, tokenAwareTruncate } from "../../utils/tokenCount.js";

export const markdownStrategy: CompressionStrategy = {
  name: "markdown",
  version: "2.0.0",
  compress: compressMarkdown,
};

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const PRIORITY_RE = /\b(?:rollback|critical|warning|security|failure|readiness|required)\b/i;
const STRUCTURED_SIGNAL_RE = new RegExp(
  [
    "(?:^|\\s)(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\\s+\\/\\S+",
    "\\/(?:api|v\\d+)(?:\\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)+",
    "\\b\\d+(?:\\.\\d+)?\\s*(?:ms|s|sec(?:onds?)?|m|min(?:utes?)?|h|hours?|kb|mb|gb|%|retries?|requests?|tokens?|bytes?)\\b",
    "(?:<=|>=|<|>|=)\\s*\\d+(?:\\.\\d+)?",
    "(?:^|\\s)(?:npm|pnpm|yarn|npx|node|git|docker|kubectl|mvn|gradle|cargo|python|pip|go)\\s+[^\\n]+",
    "(?:^|\\s)(?:[A-Z][A-Z0-9_]{2,}|[a-z][A-Za-z0-9]*(?:\\.[A-Za-z0-9_-]+)+)\\s*[:=]",
    "`(?:[A-Z][A-Z0-9_]{2,}|[a-z][a-z0-9_]*(?:[._-][a-z0-9_]+)+)`",
  ].join("|"),
  "i",
);

interface MarkdownSection {
  heading: string;
  title: string;
  level: number;
  body: string[];
  index: number;
  endIndex: number;
  key: string;
  priority: boolean;
  structuredLines: string[];
  score: number;
}

interface RepeatedGroup {
  key: string;
  title: string;
  sections: MarkdownSection[];
  score: number;
}

export function compressMarkdown(
  content: string,
  maxTokens: number,
  context: StrategyContext = {},
): StrategyResult {
  const warnings: string[] = [];
  const tokens = countTokens(content);

  if (!content || content.trim().length === 0) {
    return { compressedContent: content, warnings, summary: "Empty markdown content" };
  }
  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings, summary: "Markdown fits within token budget" };
  }

  try {
    const sections = parseSections(content, context.goal);
    const grouped = groupSections(sections);
    const repeatedKeys = new Set(grouped.repeated.map((group) => group.key));
    const prioritySections = sections
      .filter((section) => section.priority && !repeatedKeys.has(section.key))
      .sort(compareSections);
    const uniqueSections = sections
      .filter((section) => !section.priority && !repeatedKeys.has(section.key))
      .sort(compareSections);
    const repeatedGroups = grouped.repeated.sort((a, b) => b.score - a.score);
    const priorityRepeated = repeatedGroups.filter((group) => group.score >= 1_000);
    const ordinaryRepeated = repeatedGroups.filter((group) => group.score < 1_000);

    const result = buildBudgetedOutput(
      prioritySections,
      priorityRepeated,
      uniqueSections,
      ordinaryRepeated,
      maxTokens,
    );

    if (repeatedGroups.length > 0) {
      warnings.push(
        `Merged ${repeatedGroups.reduce((sum, group) => sum + group.sections.length, 0)} repeated sections into ${repeatedGroups.length} range summaries`,
      );
    }
    if (countTokens(result) >= maxTokens) {
      warnings.push("Trimmed markdown to fit token budget");
    }

    return {
      compressedContent: result,
      warnings,
      summary:
        `Markdown compressed: ${prioritySections.length + priorityRepeated.length} priority, ` +
        `${uniqueSections.length} unique, ${repeatedGroups.length} repeated ranges`,
    };
  } catch {
    warnings.push("Markdown compression fell back to truncation");
    return {
      compressedContent: tokenAwareTruncate(content, maxTokens),
      warnings,
      summary: "Truncated markdown (fallback)",
    };
  }
}

function parseSections(content: string, goal?: string): MarkdownSection[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const sections: MarkdownSection[] = [];
  let currentTitle = "Document introduction";
  let currentHeading = "# Document introduction";
  let currentLevel = 1;
  let currentStart = 0;
  let body: string[] = [];
  let inFence = false;

  const flush = (endIndex: number): void => {
    const meaningful = body.some((line) => line.trim().length > 0);
    if (!meaningful && currentTitle === "Document introduction") return;
    const bodyText = body.join("\n");
    const priority = PRIORITY_RE.test(`${currentTitle}\n${bodyText}`);
    const structuredLines = pickStructuredLines(body);
    sections.push({
      heading: currentHeading,
      title: currentTitle,
      level: currentLevel,
      body: [...body],
      index: currentStart,
      endIndex,
      key: normalizeTitle(currentTitle),
      priority,
      structuredLines,
      score: scoreSection(currentTitle, bodyText, structuredLines, priority, goal),
    });
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^```/.test(line.trim())) inFence = !inFence;
    const match = !inFence ? HEADING_RE.exec(line) : null;
    if (!match) {
      body.push(line);
      continue;
    }

    flush(index - 1);
    currentHeading = line;
    currentTitle = match[2]!.trim();
    currentLevel = match[1]!.length;
    currentStart = index;
    body = [];
  }
  flush(lines.length - 1);
  return sections;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\b(component|module|package|service)\s*[#:]?\s*\d+\b/g, "$1")
    .replace(/\d+/g, "#")
    .replace(/[^a-z0-9\u4e00-\u9fff#]+/g, " ")
    .trim();
}

function pickStructuredLines(lines: string[]): string[] {
  const picked: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const informativeListItem = /^(?:[-*+]\s+|\d+[.)]\s+)/.test(trimmed);
    if (
      !trimmed ||
      (!PRIORITY_RE.test(trimmed) && !STRUCTURED_SIGNAL_RE.test(trimmed) && !informativeListItem)
    ) continue;
    if (!picked.includes(trimmed)) picked.push(trimmed);
    if (picked.length >= 8) break;
  }
  return picked;
}

function goalTerms(goal?: string): string[] {
  if (!goal) return [];
  return Array.from(
    new Set(goal.toLowerCase().match(/[a-z0-9_./-]{3,}|[\u4e00-\u9fff]{2,}/g) ?? []),
  );
}

function scoreSection(
  title: string,
  body: string,
  structuredLines: string[],
  priority: boolean,
  goal?: string,
): number {
  let score = priority ? 1_000 : 20;
  if (/\brollback\b/i.test(title)) score += 250;
  score += Math.min(
    structuredLines.reduce(
      (sum, line) => sum + (STRUCTURED_SIGNAL_RE.test(line) ? 50 : 15),
      0,
    ),
    240,
  );
  if (/\b(?:required|security|critical|failure|readiness|warning)\b/i.test(title)) score += 100;
  const haystack = `${title}\n${body}`.toLowerCase();
  score += goalTerms(goal).filter((term) => haystack.includes(term)).length * 120;
  return score;
}

function groupSections(sections: MarkdownSection[]): { repeated: RepeatedGroup[] } {
  const byKey = new Map<string, MarkdownSection[]>();
  for (const section of sections) {
    const group = byKey.get(section.key) ?? [];
    group.push(section);
    byKey.set(section.key, group);
  }
  return {
    repeated: Array.from(byKey.entries())
      .filter(([, matches]) => matches.length > 1)
      .map(([key, matches]) => {
        const representative = [...matches].sort(compareSections)[0]!;
        return {
          key,
          title: representative.title,
          sections: matches,
          score: representative.score,
        };
      }),
  };
}

function compareSections(a: MarkdownSection, b: MarkdownSection): number {
  return b.score - a.score || a.index - b.index;
}

function buildBudgetedOutput(
  priority: MarkdownSection[],
  priorityRepeated: RepeatedGroup[],
  unique: MarkdownSection[],
  repeated: RepeatedGroup[],
  maxTokens: number,
): string {
  const header = "## Markdown Summary\n";
  if (maxTokens <= countTokens(header) + 8) return tokenAwareTruncate(header, maxTokens);

  const parts: string[] = [header];
  // This pool is intentionally filled before any unique or repeated-directory
  // content. It guarantees that a tail rollback/readiness section has budget.
  const priorityLimit = Math.max(24, Math.floor(maxTokens * 0.48));
  if (priority.length > 0 || priorityRepeated.length > 0) {
    appendLine(parts, "### Priority Sections", maxTokens);
    const priorityCount = priority.length + priorityRepeated.length;
    const perSection = Math.max(18, Math.floor(priorityLimit / priorityCount));
    for (const section of priority) {
      appendCard(parts, renderSection(section, perSection), maxTokens);
    }
    for (const group of priorityRepeated) {
      appendCard(parts, renderRepeatedGroup(group), maxTokens);
    }
  }

  if (unique.length > 0) {
    appendLine(parts, "### Unique Sections", maxTokens);
    for (const section of unique) {
      const remaining = maxTokens - countTokens(parts.join("\n"));
      if (remaining < 18) break;
      appendCard(parts, renderSection(section, Math.min(90, remaining)), maxTokens);
    }
  }

  if (repeated.length > 0) {
    appendLine(parts, "### Repeated Section Ranges", maxTokens);
    for (const group of repeated) {
      if (!appendCard(parts, renderRepeatedGroup(group), maxTokens)) break;
    }
  }

  return parts.join("\n").trimEnd();
}

function renderRepeatedGroup(group: RepeatedGroup): string {
  const first = group.sections[0]!;
  const last = group.sections[group.sections.length - 1]!;
  const signals = Array.from(
    new Set(group.sections.flatMap((section) => section.structuredLines)),
  ).slice(0, 3);
  return [
    `- **${group.title}** ×${group.sections.length} (source lines ${first.index + 1}–${last.endIndex + 1})`,
    ...signals.map((line) => `  - ${line}`),
  ].join("\n");
}

function renderSection(section: MarkdownSection, budget: number): string {
  const heading = `${"#".repeat(Math.min(section.level + 1, 6))} ${section.title}`;
  const bodyLines = section.body.filter((line) => line.trim().length > 0);
  const selected = Array.from(new Set([
    ...section.structuredLines,
    ...bodyLines.slice(0, section.priority ? 4 : 2),
  ])).slice(0, section.priority ? 8 : 4);
  const card = [heading, ...selected].join("\n");
  return countTokens(card) <= budget ? card : tokenAwareTruncate(card, budget);
}

function appendLine(parts: string[], line: string, maxTokens: number): boolean {
  return appendCard(parts, line, maxTokens);
}

function appendCard(parts: string[], card: string, maxTokens: number): boolean {
  if (!card.trim()) return false;
  const candidate = [...parts, card, ""].join("\n");
  if (countTokens(candidate) > maxTokens) return false;
  parts.push(card, "");
  return true;
}
