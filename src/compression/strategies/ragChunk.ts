/**
 * RAG Chunk Compressor — Phase 4 (Full Implementation)
 *
 * Preserves: source, document title, chunk ID, score, key facts,
 * short excerpt, canExpand flag.
 * Folds: duplicate chunks, low-score chunks.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens, tokenAwareTruncate } from "../../utils/tokenCount.js";

export const ragChunkStrategy: CompressionStrategy = {
  name: "rag_chunk",
  version: "1.0.0",
  compress: compressRagChunk,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RagChunk {
  source: string;
  documentTitle: string;
  chunkId: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
}

interface ExtractedRagInfo {
  chunks: RagChunk[];
  totalChunks: number;
  minScore: number;
  maxScore: number;
  avgScore: number;
  foldedDuplicates: number;
  foldedLowScore: number;
}

// ---------------------------------------------------------------------------
// Export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressRagChunk(
  content: string,
  maxTokens: number,
): StrategyResult {
  const warnings: string[] = [];
  const tokens = countTokens(content);

  if (!content || content.trim().length === 0) {
    return { compressedContent: content, warnings, summary: "Empty RAG chunk content" };
  }

  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings, summary: "RAG chunks fit within token budget" };
  }

  try {
    const chunks = parseChunks(content);
    const extracted = extractRagInfo(chunks);

    const parts = buildCompressedOutput(extracted);

    let result = parts.join("\n");
    let resultTokens = countTokens(result);

    if (resultTokens <= maxTokens) {
      if (extracted.foldedDuplicates > 0) {
        warnings.push(`Folded ${extracted.foldedDuplicates} duplicate chunks`);
      }
      if (extracted.foldedLowScore > 0) {
        warnings.push(`Folded ${extracted.foldedLowScore} low-score chunks`);
      }
      return {
        compressedContent: result,
        warnings,
        summary: `RAG compressed: ${extracted.chunks.length}/${extracted.totalChunks} chunks kept`,
      };
    }

    // Trim: keep only top-N by score
    const trimmed = trimRagOutput(extracted, maxTokens);
    warnings.push("Trimmed RAG output to fit token budget");

    return {
      compressedContent: trimmed,
      warnings,
      summary: `RAG compressed and trimmed`,
    };
  } catch {
    return truncateFallback(content, maxTokens, warnings);
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseChunks(content: string): RagChunk[] {
  // Try JSON first
  const trimmed = content.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeChunk);
      }
      // Single object
      return [normalizeChunk(parsed)];
    } catch {
      // Not valid JSON — fall through to text parsing
    }
  }

  // Text-based parsing: look for chunk delimiters
  const chunks: RagChunk[] = [];
  const sections = content.split(/\n(?=\[?(?:source|chunk|document)\b)/i);

  for (const section of sections) {
    const chunk = parseTextChunk(section);
    if (chunk) chunks.push(chunk);
  }

  return chunks.length > 0 ? chunks : [{
    source: "(unknown)",
    documentTitle: "(unknown)",
    chunkId: "chk_000",
    score: 1.0,
    content: content.slice(0, 500),
  }];
}

function normalizeChunk(raw: Record<string, unknown>): RagChunk {
  return {
    source: String(raw.source ?? raw.uri ?? raw.filePath ?? raw.path ?? "(unknown)"),
    documentTitle: String(raw.documentTitle ?? raw.title ?? raw.docTitle ?? "(unknown)"),
    chunkId: String(raw.chunkId ?? raw.id ?? raw.chunk_id ?? `chk_${Math.random().toString(36).slice(2, 8)}`),
    score: Number(raw.score ?? raw.relevance ?? raw.similarity ?? 0.5),
    content: String(raw.content ?? raw.text ?? raw.excerpt ?? ""),
    metadata: typeof raw.metadata === "object" && raw.metadata !== null
      ? (raw.metadata as Record<string, unknown>)
      : undefined,
  };
}

function parseTextChunk(text: string): RagChunk | null {
  const source = text.match(/(?:source|from)[: ]\s*(.+)/i)?.[1]?.trim() ?? "(unknown)";
  const title = text.match(/(?:title|document)[: ]\s*(.+)/i)?.[1]?.trim() ?? "(unknown)";
  const id = text.match(/(?:chunk[_-]?id|id)[: ]\s*(\S+)/i)?.[1]?.trim() ?? `chk_${Math.random().toString(36).slice(2, 8)}`;
  const score = parseFloat(text.match(/(?:score|relevance)[: ]\s*([\d.]+)/i)?.[1] ?? "0.5");

  return { source, documentTitle: title, chunkId: id, score, content: text.slice(0, 500) };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function extractRagInfo(allChunks: RagChunk[]): ExtractedRagInfo {
  const scores = allChunks.map((c) => c.score);
  const avgScore = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;

  // Deduplicate: same source + very similar content start
  const seen = new Map<string, RagChunk>();
  let foldedDuplicates = 0;
  let foldedLowScore = 0;

  for (const chunk of allChunks) {
    const dedupKey = `${chunk.source}::${chunk.content.slice(0, 100).trim()}`;
    const existing = seen.get(dedupKey);

    if (existing) {
      // Keep the one with higher score
      if (chunk.score > existing.score) {
        seen.set(dedupKey, chunk);
      }
      foldedDuplicates++;
    } else {
      seen.set(dedupKey, chunk);
    }
  }

  // Filter low-score chunks (< 0.3) if we have many chunks
  let keptChunks = Array.from(seen.values());
  if (keptChunks.length > 10) {
    const before = keptChunks.length;
    keptChunks = keptChunks.filter((c) => c.score >= 0.3);
    foldedLowScore = before - keptChunks.length;
  }

  // Sort by score descending
  keptChunks.sort((a, b) => b.score - a.score);

  return {
    chunks: keptChunks,
    totalChunks: allChunks.length,
    minScore: scores.length > 0 ? Math.min(...scores) : 0,
    maxScore: scores.length > 0 ? Math.max(...scores) : 0,
    avgScore: Math.round(avgScore * 100) / 100,
    foldedDuplicates,
    foldedLowScore,
  };
}

// ---------------------------------------------------------------------------
// Output Building
// ---------------------------------------------------------------------------

function buildCompressedOutput(extracted: ExtractedRagInfo): string[] {
  const parts: string[] = [];

  parts.push("## RAG Chunks Summary");
  parts.push("");

  // Stats header
  parts.push(`- **Total Chunks:** ${extracted.totalChunks}`);
  parts.push(`- **Kept:** ${extracted.chunks.length}`);
  parts.push(`- **Score Range:** ${extracted.minScore} – ${extracted.maxScore} (avg: ${extracted.avgScore})`);
  if (extracted.foldedDuplicates > 0) {
    parts.push(`- **Duplicates Folded:** ${extracted.foldedDuplicates}`);
  }
  if (extracted.foldedLowScore > 0) {
    parts.push(`- **Low-Score Folded:** ${extracted.foldedLowScore}`);
  }
  parts.push("");

  // Per-chunk details
  for (let i = 0; i < extracted.chunks.length; i++) {
    const chunk = extracted.chunks[i]!;
    parts.push(`### Chunk ${i + 1}: \`${chunk.chunkId}\``);
    parts.push("");
    parts.push(`- **Source:** \`${chunk.source}\``);
    parts.push(`- **Document:** ${chunk.documentTitle}`);
    parts.push(`- **Score:** ${typeof chunk.score === "number" ? chunk.score.toFixed(2) : chunk.score}`);
    parts.push(`- **canExpand:** true`);
    parts.push("");

    // Short excerpt (first 300 chars)
    const excerpt = chunk.content.length > 300
      ? chunk.content.slice(0, 300).replace(/\n/g, " ") + "..."
      : chunk.content;
    parts.push(`> ${excerpt}`);

    // Key facts extraction
    const keyFacts = extractKeyFacts(chunk.content);
    if (keyFacts.length > 0) {
      parts.push("");
      parts.push("**Key Facts:**");
      for (const fact of keyFacts) {
        parts.push(`- ${fact}`);
      }
    }

    parts.push("");
  }

  return parts;
}

function extractKeyFacts(content: string): string[] {
  const facts: string[] = [];
  const lines = content.split(/[.;]\s*/);

  for (const line of lines.slice(0, 5)) {
    const trimmed = line.trim();
    if (trimmed.length < 20 || trimmed.length > 200) continue;

    // Look for factual statements
    if (
      /\b(?:is|are|must|should|always|never|requires|supports|accepts|returns|provides|uses)\b/i.test(trimmed) ||
      /\b(?:version|endpoint|parameter|default|maximum|minimum|rate.limit)\b/i.test(trimmed)
    ) {
      facts.push(trimmed.length > 120 ? trimmed.slice(0, 117) + "..." : trimmed);
    }
  }

  return facts.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Trimming
// ---------------------------------------------------------------------------

function trimRagOutput(extracted: ExtractedRagInfo, maxTokens: number): string {
  // Try keeping fewer chunks
  for (const count of [extracted.chunks.length, Math.ceil(extracted.chunks.length / 2), 5, 3, 1]) {
    const trimmed: ExtractedRagInfo = {
      ...extracted,
      chunks: extracted.chunks.slice(0, count).map((c) => ({
        ...c,
        content: c.content.slice(0, 150), // Shorter excerpts
      })),
    };
    const md = buildCompressedOutput(trimmed).join("\n");
    if (countTokens(md) <= maxTokens) return md;
  }

  return tokenAwareTruncate(
    buildCompressedOutput({ ...extracted, chunks: extracted.chunks.slice(0, 1) }).join("\n"),
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
  warnings.push("RAG chunk compression fell back to truncation");
  return {
    compressedContent: result,
    warnings,
    summary: "Truncated RAG chunks (fallback)",
  };
}

