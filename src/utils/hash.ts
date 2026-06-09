import { createHash } from "node:crypto";

/**
 * Stable hash for scope derivation and content dedup.
 * Uses SHA-256 truncated to 8 hex chars for readability.
 */
export function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

export function fullHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function contentHash(content: string): string {
  return fullHash(content);
}
