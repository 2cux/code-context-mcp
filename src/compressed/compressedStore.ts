/**
 * Compressed Context Store — Phase 4
 *
 * Persists and queries CompressedContextRecords (CCR).
 * Each record represents one compression operation and is
 * scoped to a repository via scopeId.
 *
 * Design principles:
 *   - Scope isolation: queries always filter by scopeId.
 *   - Fail-open: save failures throw (they are programming errors,
 *     not runtime conditions), but queries return empty results
 *     rather than throwing.
 *   - Pagination: list() always returns a total count for
 *     offset-based pagination.
 */

import { randomBytes } from "node:crypto";
import type { Database } from "sql.js";
import { queryAll, queryOne, runStmt, type SqlValue } from "../storage/db.js";
import { nowISO } from "../utils/time.js";

// ---------------------------------------------------------------------------
// Types — matching PRD §15.2 CompressedContextRecord
// ---------------------------------------------------------------------------

export type ContentType =
  | "test_output"
  | "log"
  | "command_output"
  | "code"
  | "json"
  | "markdown"
  | "plain_text"
  | "rag_chunk"
  | "file_summary"
  | "conversation_history"
  | "unknown";

export interface CompressedContextRecord {
  id: string;
  scopeId: string;
  contentType: ContentType;
  strategy: string;
  compressedContent: string;
  summary?: string;
  originalRef?: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  compressionRatio: number;
  canRetrieveOriginal: boolean;
  retrieveCount: number;
  failed: boolean;
  errorReason?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  // CacheAligner fields (§31.2)
  contentHash?: string;
  cacheKey?: string;
  strategyVersion?: string;
  cacheHitCount: number;
  lastAccessedAt?: string;
}

/** Input type for save() — mirrors the DB columns without auto-generated fields. */
export interface SaveCCRInput {
  scopeId: string;
  contentType: ContentType;
  strategy: string;
  compressedContent: string;
  summary?: string;
  originalRef?: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  compressionRatio: number;
  canRetrieveOriginal?: boolean;
  failed?: boolean;
  errorReason?: string;
  expiresAt?: string;
  // CacheAligner fields (§31.2)
  contentHash?: string;
  cacheKey?: string;
  strategyVersion?: string;
}

/** Options for list(). */
export interface ListCCROptions {
  scopeId: string;
  contentType?: ContentType;
  limit?: number;
  offset?: number;
}

/** A lightweight summary returned by list(), matching PRD §11.5. */
export interface CCRSummary {
  ccrId: string;
  contentType: ContentType;
  summary?: string;
  originalRef?: string;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  retrieveCount: number;
  cacheHitCount: number;
  failed: boolean;
  createdAt: string;
}

/** Paginated list result. */
export interface ListCCRResult {
  scopeId: string;
  items: CCRSummary[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// CacheAligner types (§31)
// ---------------------------------------------------------------------------

/** Aggregate cache statistics for a scope. */
export interface CacheStats {
  scopeId: string;
  totalEntries: number;
  totalHits: number;
  uniqueContentTypes: number;
  avgCompressionRatio: number;
}

/** A single entry in the cache listing. */
export interface CacheEntrySummary {
  ccrId: string;
  cacheKey: string;
  contentType: string;
  strategyVersion: string;
  cacheHitCount: number;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  compressionRatio: number;
  createdAt: string;
  lastAccessedAt?: string;
}

/** Paginated cache list result. */
export interface CacheListResult {
  scopeId: string;
  items: CacheEntrySummary[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let _ccrStoreCounter = 0;

function generateCCRId(): string {
  _ccrStoreCounter += 1;
  const seq = String(_ccrStoreCounter).padStart(6, "0");
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex"); // 6 hex chars of entropy
  return `ccr_${ts}_${rand}_${seq}`;
}

export class CompressedStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // ==========================================================================
  // 10.1 Save — create a CompressedContextRecord
  // ==========================================================================

  /**
   * Persist a compressed context record.
   *
   * Generates a unique ccrId and sets createdAt/updatedAt.
   * All required fields are validated by TypeScript — runtime
   * errors from SQLite constraint violations are intentionally
   * not caught (they indicate a programming error).
   */
  save(input: SaveCCRInput): CompressedContextRecord {
    const id = generateCCRId();
    const now = nowISO();

    const record: CompressedContextRecord = {
      id,
      scopeId: input.scopeId,
      contentType: input.contentType,
      strategy: input.strategy,
      compressedContent: input.compressedContent,
      summary: input.summary,
      originalRef: input.originalRef,
      sourceRef: input.sourceRef,
      metadata: input.metadata,
      tokensBefore: input.tokensBefore,
      tokensAfter: input.tokensAfter,
      tokensSaved: input.tokensSaved,
      compressionRatio: input.compressionRatio,
      canRetrieveOriginal: input.canRetrieveOriginal ?? true,
      retrieveCount: 0,
      failed: input.failed ?? false,
      errorReason: input.errorReason,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
      contentHash: input.contentHash,
      cacheKey: input.cacheKey,
      strategyVersion: input.strategyVersion,
      cacheHitCount: 0,
    };

    runStmt(
      this.db,
      `INSERT INTO compressed_contexts (
         id, scope_id, content_type, strategy,
         compressed_content, summary, original_ref, source_ref,
         metadata, tokens_before, tokens_after, tokens_saved,
         compression_ratio, can_retrieve_original, retrieve_count,
         failed, error_reason, created_at, updated_at, expires_at,
         content_hash, cache_key, strategy_version, cache_hit_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.scopeId,
        record.contentType,
        record.strategy,
        record.compressedContent,
        record.summary ?? null,
        record.originalRef ?? null,
        record.sourceRef ?? null,
        record.metadata ? JSON.stringify(record.metadata) : null,
        record.tokensBefore,
        record.tokensAfter,
        record.tokensSaved,
        record.compressionRatio,
        record.canRetrieveOriginal ? 1 : 0,
        record.retrieveCount,
        record.failed ? 1 : 0,
        record.errorReason ?? null,
        record.createdAt,
        record.updatedAt,
        record.expiresAt ?? null,
        record.contentHash ?? null,
        record.cacheKey ?? null,
        record.strategyVersion ?? null,
        record.cacheHitCount,
      ],
    );

    return record;
  }

  // ==========================================================================
  // 10.2 Query — get by ccrId, list by scope/contentType, paginated
  // ==========================================================================

  /**
   * Get a single CCR by its id, validated against scopeId.
   *
   * Returns null when:
   *   - No record exists with that id
   *   - The record exists but belongs to a different scope (scope isolation)
   */
  get(ccrId: string, scopeId: string): CompressedContextRecord | null {
    const row = queryOne(
      this.db,
      `SELECT * FROM compressed_contexts WHERE id = ? AND scope_id = ?`,
      [ccrId, scopeId],
    );
    if (!row) return null;
    return this.rowToRecord(row);
  }

  /**
   * List compressed context records for a scope.
   *
   * Supports:
   *   - Filtering by contentType
   *   - Pagination via limit/offset
   *   - Sorting by created_at DESC (most recent first)
   *
   * Always returns a total count so callers can compute page counts.
   */
  list(opts: ListCCROptions): ListCCRResult {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;

    // Build WHERE clause and params
    let whereClause = "WHERE scope_id = ?";
    const params: SqlValue[] = [opts.scopeId];

    if (opts.contentType) {
      whereClause += " AND content_type = ?";
      params.push(opts.contentType);
    }

    // Count total matching rows
    const countRow = queryOne(
      this.db,
      `SELECT COUNT(*) as cnt FROM compressed_contexts ${whereClause}`,
      params,
    );
    const total = Number(countRow?.["cnt"] ?? 0);

    // Fetch page — sorted by created_at DESC
    const rows = queryAll(
      this.db,
      `SELECT * FROM compressed_contexts ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit as SqlValue, offset as SqlValue],
    );

    return {
      scopeId: opts.scopeId,
      items: rows.map((r) => this.rowToSummary(r)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Count compressions for a scope, optionally filtered by contentType.
   */
  count(scopeId: string, contentType?: ContentType): number {
    if (contentType) {
      const row = queryOne(
        this.db,
        `SELECT COUNT(*) as cnt FROM compressed_contexts
         WHERE scope_id = ? AND content_type = ?`,
        [scopeId, contentType],
      );
      return Number(row?.["cnt"] ?? 0);
    }

    const row = queryOne(
      this.db,
      `SELECT COUNT(*) as cnt FROM compressed_contexts WHERE scope_id = ?`,
      [scopeId],
    );
    return Number(row?.["cnt"] ?? 0);
  }

  // ==========================================================================
  // CacheAligner methods (§31.3–31.4)
  // ==========================================================================

  /**
   * Find a cached CCR by its cache key, validated against scopeId.
   *
   * Returns null when:
   *   - No record exists with that cache key
   *   - The record exists but belongs to a different scope
   */
  findByCacheKey(cacheKey: string, scopeId: string): CompressedContextRecord | null {
    if (!cacheKey) return null;
    const row = queryOne(
      this.db,
      `SELECT * FROM compressed_contexts WHERE cache_key = ? AND scope_id = ?`,
      [cacheKey, scopeId],
    );
    if (!row) return null;
    return this.rowToRecord(row);
  }

  /**
   * Increment the cache hit counter for a record and update last_accessed_at.
   *
   * This is called each time a cache hit is served, so the stats reflect
   * real usage.  Failures are intentionally not caught — they indicate
   * a programming error (record was deleted between lookup and increment).
   */
  incrementCacheHit(ccrId: string): void {
    const now = nowISO();
    runStmt(
      this.db,
      `UPDATE compressed_contexts
       SET cache_hit_count = cache_hit_count + 1,
           last_accessed_at = ?
       WHERE id = ?`,
      [now, ccrId],
    );
  }

  /**
   * Return aggregate cache statistics for a scope.
   *
   * Only counts records that have a non-null cache_key (i.e. records
   * that were actually cached — fallback compressions are excluded).
   */
  getCacheStats(scopeId: string): CacheStats {
    const row = queryOne(
      this.db,
      `SELECT
         COUNT(*) as total_entries,
         COALESCE(SUM(cache_hit_count), 0) as total_hits,
         COUNT(DISTINCT content_type) as unique_types,
         COALESCE(AVG(compression_ratio), 0) as avg_ratio
       FROM compressed_contexts
       WHERE scope_id = ? AND cache_key IS NOT NULL`,
      [scopeId],
    );

    return {
      scopeId,
      totalEntries: Number(row?.["total_entries"] ?? 0),
      totalHits: Number(row?.["total_hits"] ?? 0),
      uniqueContentTypes: Number(row?.["unique_types"] ?? 0),
      avgCompressionRatio: Math.round(Number(row?.["avg_ratio"] ?? 0) * 10000) / 10000,
    };
  }

  /**
   * Clear all cached compression records for a scope.
   *
   * Deletes records that have a cache_key (i.e. were produced by the
   * CacheAligner flow).  Records without a cache_key (legacy, fallback)
   * are left untouched.
   *
   * Also deletes associated original_contents rows to prevent orphan
   * records and foreign-key violations.
   *
   * Returns the number of deleted CCR records.
   */
  clearCache(scopeId: string): { deleted: number } {
    // Delete associated original_contents first to avoid FK violations.
    // SQLite with PRAGMA foreign_keys = ON would reject the CCR DELETE
    // if originals still reference those CCRs.
    runStmt(
      this.db,
      `DELETE FROM original_contents WHERE ccr_id IN (
         SELECT id FROM compressed_contexts
         WHERE scope_id = ? AND cache_key IS NOT NULL
       )`,
      [scopeId],
    );

    const countRow = queryOne(
      this.db,
      `SELECT COUNT(*) as cnt FROM compressed_contexts
       WHERE scope_id = ? AND cache_key IS NOT NULL`,
      [scopeId],
    );
    const deleted = Number(countRow?.["cnt"] ?? 0);

    runStmt(
      this.db,
      `DELETE FROM compressed_contexts
       WHERE scope_id = ? AND cache_key IS NOT NULL`,
      [scopeId],
    );

    return { deleted };
  }

  /**
   * List cached compression entries for a scope, paginated.
   *
   * Only returns records that have a cache_key.  Sorted by last_accessed_at
   * DESC so the most recently hit entries appear first, followed by
   * newest entries (created_at DESC) as a tiebreaker.
   */
  listCacheEntries(
    scopeId: string,
    opts?: { limit?: number; offset?: number },
  ): CacheListResult {
    const limit = opts?.limit ?? 20;
    const offset = opts?.offset ?? 0;

    const countRow = queryOne(
      this.db,
      `SELECT COUNT(*) as cnt FROM compressed_contexts
       WHERE scope_id = ? AND cache_key IS NOT NULL`,
      [scopeId],
    );
    const total = Number(countRow?.["cnt"] ?? 0);

    const rows = queryAll(
      this.db,
      `SELECT * FROM compressed_contexts
       WHERE scope_id = ? AND cache_key IS NOT NULL
       ORDER BY last_accessed_at DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      [scopeId, limit as SqlValue, offset as SqlValue],
    );

    return {
      scopeId,
      items: rows.map((r) => ({
        ccrId: r["id"] as string,
        cacheKey: (r["cache_key"] as string) ?? "",
        contentType: r["content_type"] as string,
        strategyVersion: (r["strategy_version"] as string) ?? "",
        cacheHitCount: (r["cache_hit_count"] as number) ?? 0,
        tokensBefore: r["tokens_before"] as number,
        tokensAfter: r["tokens_after"] as number,
        tokensSaved: r["tokens_saved"] as number,
        compressionRatio: r["compression_ratio"] as number,
        createdAt: r["created_at"] as string,
        lastAccessedAt: (r["last_accessed_at"] as string) ?? undefined,
      })),
      total,
      limit,
      offset,
    };
  }

  // ==========================================================================
  // Row mapping helpers
  // ==========================================================================

  /**
   * Convert a raw DB row to a full CompressedContextRecord.
   */
  private rowToRecord(row: Record<string, unknown>): CompressedContextRecord {
    return {
      id: row["id"] as string,
      scopeId: row["scope_id"] as string,
      contentType: row["content_type"] as ContentType,
      strategy: row["strategy"] as string,
      compressedContent: row["compressed_content"] as string,
      summary: (row["summary"] as string) ?? undefined,
      originalRef: (row["original_ref"] as string) ?? undefined,
      sourceRef: (row["source_ref"] as string) ?? undefined,
      metadata: safeParseJSON(row["metadata"] as string | null),
      tokensBefore: row["tokens_before"] as number,
      tokensAfter: row["tokens_after"] as number,
      tokensSaved: row["tokens_saved"] as number,
      compressionRatio: row["compression_ratio"] as number,
      canRetrieveOriginal: Boolean(row["can_retrieve_original"]),
      retrieveCount: row["retrieve_count"] as number,
      failed: Boolean(row["failed"]),
      errorReason: (row["error_reason"] as string) ?? undefined,
      createdAt: row["created_at"] as string,
      updatedAt: row["updated_at"] as string,
      expiresAt: (row["expires_at"] as string) ?? undefined,
      contentHash: (row["content_hash"] as string) ?? undefined,
      cacheKey: (row["cache_key"] as string) ?? undefined,
      strategyVersion: (row["strategy_version"] as string) ?? undefined,
      cacheHitCount: (row["cache_hit_count"] as number) ?? 0,
      lastAccessedAt: (row["last_accessed_at"] as string) ?? undefined,
    };
  }

  /**
   * Convert a raw DB row to a lightweight CCRSummary for list results.
   * Matches the output format specified in PRD §11.5.
   */
  private rowToSummary(row: Record<string, unknown>): CCRSummary {
    return {
      ccrId: row["id"] as string,
      contentType: row["content_type"] as ContentType,
      summary: (row["summary"] as string) ?? undefined,
      originalRef: (row["original_ref"] as string) ?? undefined,
      tokensBefore: row["tokens_before"] as number,
      tokensAfter: row["tokens_after"] as number,
      tokensSaved: row["tokens_saved"] as number,
      retrieveCount: row["retrieve_count"] as number,
      cacheHitCount: (row["cache_hit_count"] as number) ?? 0,
      failed: Boolean(row["failed"]),
      createdAt: row["created_at"] as string,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely parse a JSON metadata string.
 * Returns undefined on any parse failure (fail-open: don't let corrupt
 * metadata block the caller from accessing the record).
 */
function safeParseJSON(
  raw: string | null | undefined,
): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
