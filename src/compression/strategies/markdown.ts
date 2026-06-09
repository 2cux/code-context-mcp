/**
 * Markdown Compressor — Phase 4 (Full Implementation)
 *
 * Preserves: headings, key paragraphs, list structure, code block summaries,
 * source refs.
 * Folds: repeated descriptions, low-relevance paragraphs, long examples.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens, tokenAwareTruncate } from "../../utils/tokenCount.js";

export const markdownStrategy: CompressionStrategy = {
  name: "markdown",
  version: "1.0.0",
  compress: compressMarkdown,
};

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const CODE_FENCE_RE = /^```(\w*)/;
const LIST_ITEM_RE = /^\s*[-*+]\s+|^\s*\d+[.)]\s+/;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const KEY_SIGNALS = /\b(?:error|fail|warn|critical|important|note|caution|warning|deprecated|breaking change|security)\b/i;

// ---------------------------------------------------------------------------
// Export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressMarkdown(
  content: string,
  maxTokens: number,
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
    const sections = splitIntoSections(content);
    const extracted = extractMarkdownInfo(sections);

    const parts = buildCompressedOutput(extracted, sections);

    let result = parts.join("\n");
    let resultTokens = countTokens(result);

    if (resultTokens <= maxTokens) {
      return {
        compressedContent: result,
        warnings,
        summary: `Markdown compressed: ${extracted.headings.length} headings, ${extracted.foldedSections} sections folded`,
      };
    }

    // Trim code blocks and low-priority paragraphs
    result = trimMarkdownOutput(extracted, sections, maxTokens);
    warnings.push("Trimmed markdown to fit token budget");

    return {
      compressedContent: result,
      warnings,
      summary: "Markdown compressed and trimmed",
    };
  } catch {
    return truncateFallback(content, maxTokens, warnings);
  }
}

// ---------------------------------------------------------------------------
// Section splitting
// ---------------------------------------------------------------------------

interface Section {
  type: "heading" | "paragraph" | "code" | "list" | "blank";
  content: string;
  headingLevel?: number;
  headingText?: string;
  codeLang?: string;
  lineCount?: number;
  score: number;
  index: number;
}

function splitIntoSections(content: string): Section[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const sections: Section[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Blank line
    if (line.trim() === "") {
      sections.push({ type: "blank", content: "", score: 0, index: i });
      i++;
      continue;
    }

    // Heading
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      sections.push({
        type: "heading",
        content: line,
        headingLevel: headingMatch[1]!.length,
        headingText: headingMatch[2]!.trim(),
        score: 50 - headingMatch[1]!.length * 5, // Higher level = higher score
        index: i,
      });
      i++;
      continue;
    }

    // Code fence
    const fenceMatch = CODE_FENCE_RE.exec(line);
    if (fenceMatch) {
      const codeLang = fenceMatch[1] || "";
      const codeLines: string[] = [line];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) {
        codeLines.push(lines[i]!); // closing fence
        i++;
      }
      const codeContent = codeLines.join("\n");
      sections.push({
        type: "code",
        content: codeContent,
        codeLang,
        lineCount: codeLines.length - 2, // exclude fences
        score: codeLines.length > 30 ? 5 : 20, // Long code blocks lower priority
        index: sections.length,
      });
      continue;
    }

    // List item or paragraph — consume until blank line or next heading/fence
    const blockLines: string[] = [line];
    const isList = LIST_ITEM_RE.test(line);
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !HEADING_RE.test(lines[i]!) &&
      !/^```/.test(lines[i]!)
    ) {
      blockLines.push(lines[i]!);
      i++;
    }

    const blockContent = blockLines.join("\n");
    sections.push({
      type: isList ? "list" : "paragraph",
      content: blockContent,
      score: scoreParagraph(blockContent, sections.length),
      index: sections.length,
    });
  }

  return sections;
}

function scoreParagraph(content: string, _position: number): number {
  let score = 10;

  // Key signals boost
  if (KEY_SIGNALS.test(content)) score += 20;

  // Links boost (reference value)
  const linkCount = (content.match(LINK_RE) ?? []).length;
  score += Math.min(linkCount * 5, 15);

  // Length: medium paragraphs preferred
  const len = content.length;
  if (len >= 40 && len <= 500) score += 10;
  if (len > 2000) score -= 10;
  if (len < 30) score -= 5;

  // Lists get a small boost
  if (LIST_ITEM_RE.test(content)) score += 5;

  return score;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface ExtractedMarkdownInfo {
  headings: Section[];
  keyParagraphs: Section[];
  codeBlocks: Section[];
  listSections: Section[];
  foldedSections: number;
}

function extractMarkdownInfo(sections: Section[]): ExtractedMarkdownInfo {
  const info: ExtractedMarkdownInfo = {
    headings: [],
    keyParagraphs: [],
    codeBlocks: [],
    listSections: [],
    foldedSections: 0,
  };

  // Headings: keep all
  info.headings = sections.filter((s) => s.type === "heading");

  // Code blocks
  info.codeBlocks = sections.filter((s) => s.type === "code");

  // Score all non-heading, non-code sections
  const contentSections = sections.filter(
    (s) => s.type === "paragraph" || s.type === "list",
  );

  // Sort by score descending
  const sorted = [...contentSections].sort((a, b) => b.score - a.score);

  // Keep top-scored paragraphs up to a reasonable count
  const maxKeep = Math.max(10, Math.floor(contentSections.length * 0.6));
  const keepSet = new Set(sorted.slice(0, maxKeep).map((s) => s.index));

  for (const section of contentSections) {
    if (keepSet.has(section.index)) {
      if (section.type === "list") {
        info.listSections.push(section);
      } else {
        info.keyParagraphs.push(section);
      }
    } else {
      info.foldedSections++;
    }
  }

  return info;
}

// ---------------------------------------------------------------------------
// Output Building
// ---------------------------------------------------------------------------

function buildCompressedOutput(
  extracted: ExtractedMarkdownInfo,
  allSections: Section[],
): string[] {
  const parts: string[] = [];

  parts.push("## Markdown Summary");
  parts.push("");

  // Table of contents (heading tree)
  if (extracted.headings.length > 0) {
    parts.push("### Table of Contents");
    parts.push("");
    for (const h of extracted.headings.slice(0, 30)) {
      const indent = "  ".repeat(Math.max(0, (h.headingLevel ?? 2) - 1));
      parts.push(`${indent}- ${h.headingText ?? h.content}`);
    }
    parts.push("");
  }

  // Key paragraphs
  const keyParagraphs = allSections
    .filter((s) => extracted.keyParagraphs.some((kp) => kp.index === s.index))
    .sort((a, b) => a.index - b.index);

  if (keyParagraphs.length > 0) {
    parts.push("### Key Content");
    parts.push("");
    for (const para of keyParagraphs.slice(0, 20)) {
      if (para.content.length <= 500) {
        parts.push(para.content);
      } else {
        parts.push(para.content.slice(0, 400) + `\n\n*... (${para.content.length - 400} more chars)*`);
      }
      parts.push("");
    }
  }

  // Lists
  const listSections = allSections
    .filter((s) => extracted.listSections.some((ls) => ls.index === s.index))
    .sort((a, b) => a.index - b.index);

  if (listSections.length > 0) {
    parts.push("### Lists");
    parts.push("");
    for (const list of listSections.slice(0, 10)) {
      parts.push(list.content);
      parts.push("");
    }
  }

  // Code block summaries
  if (extracted.codeBlocks.length > 0) {
    parts.push("### Code Blocks");
    parts.push("");
    for (const cb of extracted.codeBlocks.slice(0, 10)) {
      const lang = cb.codeLang || "text";
      const lines = cb.content.split("\n");
      const codeLines = lines.slice(1, -1); // Exclude fences
      const preview = codeLines.slice(0, 3).join("\n");
      parts.push(`- **\`${lang}\`** (${cb.lineCount ?? codeLines.length} lines)`);
      if (preview.trim()) {
        parts.push("  ```" + lang);
        for (const l of codeLines.slice(0, 3)) {
          parts.push(`  ${l}`);
        }
        if (codeLines.length > 3) {
          parts.push(`  ... (${codeLines.length - 3} more lines)`);
        }
        parts.push("  ```");
      }
      parts.push("");
    }
  }

  // Folded count
  if (extracted.foldedSections > 0) {
    parts.push(`- **Sections Folded:** ${extracted.foldedSections}`);
  }

  return parts;
}

// ---------------------------------------------------------------------------
// Trimming
// ---------------------------------------------------------------------------

function trimMarkdownOutput(
  extracted: ExtractedMarkdownInfo,
  _allSections: Section[],
  maxTokens: number,
): string {
  // Try progressively shorter outputs
  const variants: ExtractedMarkdownInfo[] = [
    extracted,
    { ...extracted, keyParagraphs: extracted.keyParagraphs.slice(0, 10), codeBlocks: extracted.codeBlocks.slice(0, 5) },
    { ...extracted, keyParagraphs: extracted.keyParagraphs.slice(0, 5), codeBlocks: [], listSections: [] },
    { ...extracted, keyParagraphs: [], codeBlocks: [], listSections: [], headings: extracted.headings.slice(0, 10) },
  ];

  for (const variant of variants) {
    const md = buildCompressedOutput(variant, []).join("\n");
    if (countTokens(md) <= maxTokens) return md;
  }

  return tokenAwareTruncate(
    buildCompressedOutput(variants[variants.length - 1]!, []).join("\n"),
    maxTokens,
  );
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

function truncateFallback(
  content: string,
  maxTokens: number,
  warnings: string[],
): StrategyResult {
  let result = tokenAwareTruncate(content, maxTokens);
  warnings.push("Markdown compression fell back to truncation");
  return {
    compressedContent: result,
    warnings,
    summary: "Truncated markdown (fallback)",
  };
}

