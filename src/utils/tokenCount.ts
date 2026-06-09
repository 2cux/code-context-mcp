import { get_encoding, type TiktokenEncoding } from "tiktoken";

/**
 * Simple token counter using tiktoken with cl100k_base encoding.
 * Falls back to a character-based estimate if tiktoken fails.
 */

let encoder: ReturnType<typeof get_encoding> | null | undefined = undefined;

function getEncoder(): ReturnType<typeof get_encoding> | null {
  if (encoder === undefined) {
    try {
      encoder = get_encoding("cl100k_base" as TiktokenEncoding);
    } catch {
      encoder = null;
    }
  }
  return encoder;
}

export function countTokens(text: string): number {
  const enc = getEncoder();
  if (enc) {
    try {
      return enc.encode(text).length;
    } catch {
      // Fall through to estimate
    }
  }
  // Conservative fallback: ~4 chars per token
  return Math.ceil(text.length / 4);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function tokenDiff(before: number, after: number): {
  saved: number;
  ratio: number;
} {
  const saved = Math.max(0, before - after);
  const ratio = before > 0 ? saved / before : 0;
  return { saved, ratio };
}
