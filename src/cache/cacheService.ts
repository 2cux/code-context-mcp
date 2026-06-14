/**
 * CacheAligner — Cache Key Computation (§31.1)
 *
 * Produces a deterministic cache key from the five cache dimensions.
 * When two compression requests produce the same cache key they are
 * semantically identical — the cached result can be returned directly
 * without re-running compression.
 *
 * Cache key formula (per PRD §31.1):
 *   cacheKey = hash(scopeId + contentHash + contentType + strategyVersion + maxTokens)
 *
 * Key design points:
 *   - Uses full SHA-256 (not truncated) for collision resistance.
 *   - Prefixes with "cache_" for readability in DB queries and logs.
 *   - Separator "::" avoids accidental concatenation collisions
 *     (e.g. scopeId "a" + contentHash "bc" vs scopeId "ab" + contentHash "c").
 */

import { fullHash } from "../utils/hash.js";

/**
 * Compute a deterministic cache key from compression parameters.
 *
 * All six dimensions must be non-empty strings (or "unknown" for contentType
 * when detection fails).  strategyVersion must be the full semver of the
 * strategy that would be used, e.g. "1.0.0".
 *
 * keepOriginal is included because it affects canRetrieveOriginal in the
 * result — two compressions of the same content differ semantically when
 * one saves the original and the other does not.
 */
export function computeCacheKey(
  scopeId: string,
  contentHash: string,
  contentType: string,
  strategyVersion: string,
  maxTokens: number,
  keepOriginal: boolean,
): string {
  const raw = [
    scopeId,
    contentHash,
    contentType,
    strategyVersion,
    String(maxTokens),
    keepOriginal ? "1" : "0",
  ].join("::");

  return `cache_${fullHash(raw)}`;
}

/**
 * Returns true when the supplied parameters would produce a valid cache key.
 *
 * A cache key is only valid when a concrete strategy is available —
 * fallback / empty strategy versions must not be cached because the
 * compression result is not reproducible (it depends on the original content
 * being returned unchanged due to a missing strategy).
 */
export function canCache(strategyVersion: string): boolean {
  return strategyVersion.length > 0;
}
