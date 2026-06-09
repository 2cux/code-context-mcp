/**
 * Content chunking for oversized inputs — PRD §11.3 Chunking
 *
 * Splits content into manageable chunks that can be compressed
 * independently, then recombined. Supports content-type-specific
 * splitting strategies:
 *
 *   text  — split by headings (#, ##) and paragraph boundaries
 *   log   — split by log-entry boundaries (timestamps, log levels)
 *   code  — split by function/class/interface boundaries
 *   plain — split by paragraph boundaries (double newline)
 *
 * Each chunk carries a ChunkRef that preserves traceability back
 * to the original content, enabling the merge step to reconstruct
 * chunk provenance in the final output.
 *
 * Byte sizing uses UTF-8 encoding per the token-counter estimate
 * (conservative 4 bytes/token for English-heavy text).
 */

import type { ContentType } from "../compressed/compressedStore.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options controlling chunk behaviour. */
export interface ChunkOptions {
  /** Max tokens per chunk (approximate, using ~4 bytes/token). */
  maxTokensPerChunk: number;
  /**
   * Separator priority list. The chunker tries each separator in order,
   * falling back to byte-level splitting when no separator produces
   * small-enough chunks.
   */
  separators?: string[];
}

/**
 * A single chunk with provenance metadata.
 *
 * When chunks are merged after independent compression, the ChunkRef
 * on each result allows the merge step to annotate provenance and
 * verify that all chunks were processed.
 */
export interface ChunkRef {
  /** Zero-based index of this chunk in the sequence. */
  chunkIndex: number;
  /** Total number of chunks produced. */
  totalChunks: number;
  /** Byte offset of this chunk's content in the original input. */
  byteOffset: number;
  /** Byte length of this chunk's content (before encoding). */
  byteLength: number;
}

export interface ChunkWithRef {
  content: string;
  ref: ChunkRef;
}

export interface ChunkResult {
  /** All chunks with their provenance refs. */
  chunks: ChunkWithRef[];
  /** Total number of chunks. */
  totalChunks: number;
  /** Total original bytes of the input. */
  totalOriginalBytes: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 4000;
const BYTES_PER_TOKEN_ESTIMATE = 4;

// Separators used by different strategies
const TEXT_SEPARATORS = ["\n## ", "\n# ", "\n### ", "\n\n", "\n"];
const LOG_SEPARATORS = [
  // Timestamp-led entries (common log formats)
  /(?=\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})/,
  // Log-level-led entries
  /(?=\[(?:ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\])/,
  // Date-less log level
  /(?=(?:ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\s)/,
];
const CODE_SEPARATORS = [
  // Top-level declarations
  "\nexport ",
  "\nexport default ",
  "\nexport const ",
  "\nexport function ",
  "\nexport class ",
  "\nexport interface ",
  "\nexport type ",
  "\npublic ",
  "\nprivate ",
  "\nprotected ",
  "\nclass ",
  "\nfunction ",
  "\ninterface ",
  "\ntype ",
  "\nconst ",
  // Module system
  "\nimport ",
  // Double newline as last resort
  "\n\n",
  "\n",
];
const PLAIN_SEPARATORS = ["\n\n", "\n"];

// ---------------------------------------------------------------------------
// Chunk by content type
// ---------------------------------------------------------------------------

/**
 * Dispatch to the appropriate chunking strategy based on content type.
 *
 * Content type mapping:
 *   test_output      → log strategy (split by timestamp / log level)
 *   log              → log strategy
 *   command_output   → log strategy (similar structure)
 *   code             → code strategy (split by declarations)
 *   json             → plain strategy (JSON is sensitive to splitting)
 *   markdown         → text strategy (split by headings)
 *   plain_text       → text strategy (split by paragraphs)
 *   rag_chunk        → plain strategy
 *   conversation_history → plain strategy
 *   unknown          → plain strategy
 */
export function chunkByType(
  content: string,
  contentType: ContentType,
  opts?: Partial<ChunkOptions>,
): ChunkResult {
  switch (contentType) {
    case "code":
      return chunkCode(content, opts);
    case "log":
    case "test_output":
    case "command_output":
      return chunkLog(content, opts);
    case "markdown":
    case "plain_text":
      return chunkText(content, opts);
    default:
      return chunkPlain(content, opts);
  }
}

// ---------------------------------------------------------------------------
// Text chunking — split by headings and paragraphs
// ---------------------------------------------------------------------------

/**
 * Split text/markdown content by heading boundaries first, then by
 * paragraph (double-newline) boundaries, falling back to line-by-line
 * and finally byte-level splitting.
 */
export function chunkText(
  content: string,
  opts?: Partial<ChunkOptions>,
): ChunkResult {
  return chunkWithSeparators(content, TEXT_SEPARATORS, opts);
}

// ---------------------------------------------------------------------------
// Log chunking — split by log-entry boundaries
// ---------------------------------------------------------------------------

/**
 * Split log / test_output / command_output content by log-entry boundaries.
 *
 * Uses regex patterns to detect the start of a new log entry:
 *   - ISO 8601 timestamps
 *   - [LEVEL] bracketed log levels
 *   - Plain ERROR/WARN/INFO/DEBUG/TRACE prefixes
 *
 * Falls back to paragraph and then byte-level splitting.
 */
export function chunkLog(
  content: string,
  opts?: Partial<ChunkOptions>,
): ChunkResult {
  const maxTokens = opts?.maxTokensPerChunk ?? DEFAULT_MAX_TOKENS;
  const maxBytes = maxTokens * BYTES_PER_TOKEN_ESTIMATE;

  const totalBytes = encoder.encode(content).byteLength;
  if (totalBytes <= maxBytes) {
    const chunk: ChunkWithRef = {
      content,
      ref: { chunkIndex: 0, totalChunks: 1, byteOffset: 0, byteLength: totalBytes },
    };
    return { chunks: [chunk], totalChunks: 1, totalOriginalBytes: totalBytes };
  }

  // Try regex-based splitting first
  let bestChunks: string[] = [];
  for (const pattern of LOG_SEPARATORS) {
    const parts = content.split(pattern);
    // Re-join split parts with their delimiter (except first)
    const joined: string[] = [];
    let current = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      // Check if we need to start a new chunk (part begins a new log entry)
      const candidate = current + (i > 0 && joined.length > 0 ? "" : "") + part;
      // Simple approach: use the matched parts directly as log entries
      // then group them to fit within maxBytes
      joined.push(part);
    }

    // Now pack `joined` entries into byte-budgeted chunks
    const packed = packIntoChunks(joined, "\n", maxBytes);
    if (packed.every((chunk) => encoder.encode(chunk).byteLength <= maxBytes)) {
      bestChunks = packed;
      break;
    }
    // otherwise try next pattern
  }

  // Fallback: plain paragraph splitting
  if (bestChunks.length === 0) {
    return chunkPlain(content, opts);
  }

  return buildChunkResult(bestChunks, totalBytes);
}

// ---------------------------------------------------------------------------
// Code chunking — split by function/class/interface boundaries
// ---------------------------------------------------------------------------

/**
 * Split code content by declaration boundaries while preserving import
 * context at the top of each chunk.
 *
 * Strategy:
 *   1. Extract imports / top-level directives as a header.
 *   2. Split remaining code by declaration boundaries.
 *   3. Prepend header to each chunk (mirrors real code structure).
 *   4. Fall back to plain splitting if declaration boundaries don't fit.
 */
export function chunkCode(
  content: string,
  opts?: Partial<ChunkOptions>,
): ChunkResult {
  const maxTokens = opts?.maxTokensPerChunk ?? DEFAULT_MAX_TOKENS;
  const maxBytes = maxTokens * BYTES_PER_TOKEN_ESTIMATE;

  const totalBytes = encoder.encode(content).byteLength;
  if (totalBytes <= maxBytes) {
    const chunk: ChunkWithRef = {
      content,
      ref: { chunkIndex: 0, totalChunks: 1, byteOffset: 0, byteLength: totalBytes },
    };
    return { chunks: [chunk], totalChunks: 1, totalOriginalBytes: totalBytes };
  }

  // Extract header lines (imports, "use strict", shebang, etc.)
  const lines = content.split("\n");
  const headerLines: string[] = [];
  const bodyLines: string[] = [];
  let inBody = false;

  for (const line of lines) {
    if (
      !inBody &&
      (line.startsWith("import ") ||
        line.startsWith("// @") ||
        line.startsWith("#!") ||
        line === '"use strict";' ||
        line === "'use strict';" ||
        line.trim() === "")
    ) {
      headerLines.push(line);
    } else {
      inBody = true;
      bodyLines.push(line);
    }
  }

  const header = headerLines.join("\n");
  const body = bodyLines.join("\n");
  const headerBytes = encoder.encode(header).byteLength;

  // Split body by declaration boundaries
  const bodySections = splitWithSeparator(body, CODE_SEPARATORS[0]!);
  const bodyChunks = packIntoChunks(bodySections, "", maxBytes - headerBytes);

  // Prepend header to each body chunk
  const resultChunks: string[] = [];
  for (const bc of bodyChunks) {
    const chunk = header ? header + "\n" + bc : bc;
    // If this chunk plus header is too big, split further (plain strategy)
    if (encoder.encode(chunk).byteLength > maxBytes) {
      const subResult = chunkPlain(chunk, {
        maxTokensPerChunk: maxTokens,
        separators: ["\n\n", "\n"],
      });
      for (const sub of subResult.chunks) {
        resultChunks.push(sub.content);
      }
    } else {
      resultChunks.push(chunk);
    }
  }

  return buildChunkResult(resultChunks, totalBytes);
}

// ---------------------------------------------------------------------------
// Plain chunking — split by paragraph and line boundaries
// ---------------------------------------------------------------------------

/**
 * Split content by paragraph boundaries (double newline), falling back
 * to line-by-line and finally byte-level splitting.
 */
export function chunkPlain(
  content: string,
  opts?: Partial<ChunkOptions>,
): ChunkResult {
  const separators = opts?.separators ?? PLAIN_SEPARATORS;
  return chunkWithSeparators(content, separators, opts);
}

// ---------------------------------------------------------------------------
// Generic chunking (original API — kept for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Legacy generic chunking function. Splits by double-newline first,
 * then force-splits oversized sections at byte boundaries.
 *
 * Prefer `chunkByType()` for new code — it uses the content type to
 * choose a smarter splitting strategy.
 */
export function chunkContent(
  content: string,
  opts?: Partial<ChunkOptions>,
): { chunks: string[]; totalChunks: number } {
  const result = chunkPlain(content, opts);
  return {
    chunks: result.chunks.map((c) => c.content),
    totalChunks: result.totalChunks,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Generic split-and-pack: try each separator in order, pack sections
 * into byte-budgeted chunks. Falls back to byte-level splitting for
 * sections that are individually too large.
 */
function chunkWithSeparators(
  content: string,
  separators: (string | RegExp)[],
  opts?: Partial<ChunkOptions>,
): ChunkResult {
  const maxTokens = opts?.maxTokensPerChunk ?? DEFAULT_MAX_TOKENS;
  const maxBytes = maxTokens * BYTES_PER_TOKEN_ESTIMATE;

  const totalBytes = encoder.encode(content).byteLength;
  if (totalBytes <= maxBytes) {
    const chunk: ChunkWithRef = {
      content,
      ref: { chunkIndex: 0, totalChunks: 1, byteOffset: 0, byteLength: totalBytes },
    };
    return { chunks: [chunk], totalChunks: 1, totalOriginalBytes: totalBytes };
  }

  // Try each separator
  for (const sep of separators) {
    const sections = splitWithSeparator(content, sep);
    const packed = packIntoChunks(sections, typeof sep === "string" ? sep : "\n", maxBytes);

    // Check if all chunks fit (none exceeds maxBytes by itself after packing)
    if (
      packed.every((chunk) => encoder.encode(chunk).byteLength <= maxBytes)
    ) {
      return buildChunkResult(packed, totalBytes);
    }
  }

  // Last resort: byte-level force splitting
  const forceChunks: string[] = [];
  const raw = encoder.encode(content);
  let offset = 0;
  while (offset < raw.byteLength) {
    const end = Math.min(offset + maxBytes, raw.byteLength);
    const slice = raw.subarray(offset, end);
    forceChunks.push(decoder.decode(slice, { stream: true }));
    offset = end;
  }

  return buildChunkResult(forceChunks, totalBytes);
}

/**
 * Split a string by a separator (string or RegExp), preserving empty sections.
 */
function splitWithSeparator(content: string, sep: string | RegExp): string[] {
  if (typeof sep === "string") {
    return content.split(sep);
  }
  return content.split(sep);
}

/**
 * Pack an array of sections into chunks that each fit within maxBytes.
 * Uses a greedy bin-packing approach: adds sections to the current chunk
 * until adding the next would overflow; then starts a new chunk.
 */
function packIntoChunks(
  sections: string[],
  joiner: string,
  maxBytes: number,
): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const section of sections) {
    const candidate = current ? current + joiner + section : section;
    const candidateBytes = encoder.encode(candidate).byteLength;

    if (candidateBytes > maxBytes && current) {
      // Current chunk is full — save it and start a new one
      chunks.push(current);
      current = section;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Build a ChunkResult from an array of content strings, computing
 * byte offsets for each chunk's provenance metadata.
 */
function buildChunkResult(
  contents: string[],
  totalOriginalBytes: number,
): ChunkResult {
  let byteOffset = 0;
  const chunks: ChunkWithRef[] = [];

  for (let i = 0; i < contents.length; i++) {
    const content = contents[i];
    if (!content) continue;
    const byteLength = encoder.encode(content).byteLength;

    chunks.push({
      content,
      ref: {
        chunkIndex: i,
        totalChunks: contents.length,
        byteOffset,
        byteLength,
      },
    });

    byteOffset += byteLength;
  }

  return {
    chunks,
    totalChunks: chunks.length,
    totalOriginalBytes: totalOriginalBytes,
  };
}
