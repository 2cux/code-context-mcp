/**
 * Content chunking for oversized inputs.
 *
 * Splits content into manageable chunks that can be compressed
 * independently, then recombined.
 *
 * NOTE: Chunk sizing is byte-based (UTF-8) to match the token-counter
 * estimate. The 4 bytes/token ratio is conservative for English-heavy
 * text but will overestimate for CJK. A more accurate approach in
 * Phase 3 would use tiktoken directly to measure each chunk.
 */

const encoder = new TextEncoder();

export interface ChunkOptions {
  /** Max tokens per chunk (approximate, using 4 bytes/token). */
  maxTokensPerChunk: number;
  /** Separator to split on. Default: double newline. */
  separator?: string;
}

export interface ChunkResult {
  chunks: string[];
  totalChunks: number;
}

const DEFAULT_MAX_TOKENS = 4000;
const BYTES_PER_TOKEN_ESTIMATE = 4;

export function chunkContent(
  content: string,
  opts?: Partial<ChunkOptions>,
): ChunkResult {
  const maxTokens = opts?.maxTokensPerChunk ?? DEFAULT_MAX_TOKENS;
  const maxBytes = maxTokens * BYTES_PER_TOKEN_ESTIMATE;
  const sep = opts?.separator ?? "\n\n";

  const totalBytes = encoder.encode(content).byteLength;
  if (totalBytes <= maxBytes) {
    return { chunks: [content], totalChunks: 1 };
  }

  const chunks: string[] = [];
  const sections = content.split(sep);
  let current = "";

  for (const section of sections) {
    const candidate = current ? current + sep + section : section;
    const candidateBytes = encoder.encode(candidate).byteLength;

    if (candidateBytes > maxBytes && current) {
      chunks.push(current);
      current = section;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  // If any single chunk is still too big, force-split by byte boundary.
  // Use TextEncoder/TextDecoder for UTF-8-safe slicing.
  const decoder = new TextDecoder();
  const final: string[] = [];
  for (const chunk of chunks) {
    const chunkBytes = encoder.encode(chunk);
    if (chunkBytes.byteLength <= maxBytes) {
      final.push(chunk);
    } else {
      // Byte-by-byte safe split: scan forward, decode with stream:true
      let offset = 0;
      while (offset < chunkBytes.byteLength) {
        const end = Math.min(offset + maxBytes, chunkBytes.byteLength);
        const slice = chunkBytes.subarray(offset, end);
        final.push(decoder.decode(slice, { stream: true }));
        offset = end;
      }
    }
  }

  return { chunks: final, totalChunks: final.length };
}
