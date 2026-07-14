import { fullHash } from "../utils/hash.js";

/**
 * Normalize content for fingerprinting: conservative, no semantic analysis.
 *
 * Operations:
 *   1. Trim leading/trailing whitespace.
 *   2. Normalize line endings: CRLF -> LF, standalone CR -> LF.
 *   3. Collapse multiple consecutive blank lines into one.
 */
export function normalizeMemoryContent(raw: string): string {
  return raw
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Compute a content fingerprint for exact dedup.
 *
 * Fingerprint = SHA-256(scopeId + "|" + type + "|" + normalizedContent)
 */
export function computeMemoryFingerprint(
  scopeId: string,
  type: string,
  content: string,
): string {
  const normalized = normalizeMemoryContent(content);
  const payload = `${scopeId}|${type}|${normalized}`;
  return fullHash(payload);
}
