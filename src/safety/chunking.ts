/**
 * Content chunking for oversized inputs.
 *
 * Splits content into manageable chunks that can be compressed
 * independently, then recombined.
 */

export interface ChunkOptions {
  /** Max tokens per chunk (approximate, using char/4 estimate). */
  maxTokensPerChunk: number;
  /** Separator to split on. Default: double newline. */
  separator?: string;
}

export interface ChunkResult {
  chunks: string[];
  totalChunks: number;
}

const DEFAULT_MAX_TOKENS = 4000;
const CHARS_PER_TOKEN_ESTIMATE = 4;

export function chunkContent(
  content: string,
  opts?: Partial<ChunkOptions>,
): ChunkResult {
  const maxTokens = opts?.maxTokensPerChunk ?? DEFAULT_MAX_TOKENS;
  const maxChars = maxTokens * CHARS_PER_TOKEN_ESTIMATE;
  const sep = opts?.separator ?? "\n\n";

  if (content.length <= maxChars) {
    return { chunks: [content], totalChunks: 1 };
  }

  const chunks: string[] = [];
  const sections = content.split(sep);
  let current = "";

  for (const section of sections) {
    if (current.length + section.length + sep.length > maxChars && current) {
      chunks.push(current);
      current = section;
    } else {
      current = current ? current + sep + section : section;
    }
  }

  if (current) {
    chunks.push(current);
  }

  // If any single chunk is still too big, force-split by character count
  const final: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      final.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += maxChars) {
        final.push(chunk.slice(i, i + maxChars));
      }
    }
  }

  return { chunks: final, totalChunks: final.length };
}
