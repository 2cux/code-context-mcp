/**
 * Original Content Store — Phase 3
 *
 * Saves, retrieves, and manages original (uncompressed) content.
 * Each original is linked to a CompressedContextRecord via ccrId.
 *
 * Design principles:
 *   - Scope isolation: retrieval always validates scopeId.
 *   - Large content: supports offset/limit pagination.
 *   - Deletion: removing an original updates the associated CCR's
 *     canRetrieveOriginal flag.
 *   - Cleanup: expired originals are removed and their CCRs updated.
 */

import { randomBytes } from "node:crypto";
import type { Database, SqlValue } from "sql.js";
import { queryAll, queryOne, runStmt } from "../storage/db.js";
import { contentHash } from "../utils/hash.js";
import { nowISO } from "../utils/time.js";
import { countTokens } from "../utils/tokenCount.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OriginalContentRecord {
  id: string;
  scopeId: string;
  ccrId: string;
  contentType: string;
  content: string;
  contentHash: string;
  tokens: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
}

export interface SaveOriginalInput {
  /** Optional pre-computed id. When omitted, an id is auto-generated. */
  id?: string;
  scopeId: string;
  ccrId: string;
  contentType: string;
  content: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

export interface RetrieveOptions {
  /** Character offset for pagination (default 0) */
  offset?: number;
  /** Max characters to return (default: no limit / full content) */
  limit?: number;
}

export interface RetrieveResult {
  scopeId: string;
  originalRef: string;
  ccrId: string;
  contentType: string;
  content: string;
  tokens: number;
  totalChars: number;
  offset: number;
  returnedChars: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  hasMore: boolean;
}

export interface CleanupResult {
  deleted: number;
  affectedCcrIds: string[];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let _originalCounter = 0;

function generateOriginalId(): string {
  _originalCounter += 1;
  const seq = String(_originalCounter).padStart(6, "0");
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex"); // 6 hex chars of entropy
  return `orig_${ts}_${rand}_${seq}`;
}

export class OriginalStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // ==========================================================================
  // 9.1 Save
  // ==========================================================================

  /**
   * Save original content.
   *
   * Generates an originalRef, computes contentHash, records token count,
   * and associates the row with the given scopeId and ccrId.
   *
   * Also updates the related CCR to set canRetrieveOriginal = 1.
   */
  save(input: SaveOriginalInput): OriginalContentRecord {
    const id = input.id ?? generateOriginalId();
    const hash = contentHash(input.content);
    const tokens = countTokens(input.content);
    const now = nowISO();

    const record: OriginalContentRecord = {
      id,
      scopeId: input.scopeId,
      ccrId: input.ccrId,
      contentType: input.contentType,
      content: input.content,
      contentHash: hash,
      tokens,
      metadata: input.metadata,
      createdAt: now,
      expiresAt: input.expiresAt,
    };

    // Use INSERT OR IGNORE so that a duplicate id (e.g. when the caller
    // passes a content-hash-based id that collides) does not throw.
    // In that case the existing row is preserved and we still update
    // the CCR flag so the original remains reachable.
    runStmt(
      this.db,
      `INSERT OR IGNORE INTO original_contents (
         id, scope_id, ccr_id, content_type,
         content, content_hash, tokens, metadata,
         created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.scopeId,
        record.ccrId,
        record.contentType,
        record.content,
        record.contentHash,
        record.tokens,
        record.metadata ? JSON.stringify(record.metadata) : null,
        record.createdAt,
        record.expiresAt ?? null,
      ],
    );

    // Ensure the linked CCR reflects that an original is available.
    // Do this even when the INSERT was a no-op (id collision) — the
    // pre-existing row already holds the content, so the CCR should
    // still point to it.
    this.flagCcrOriginalAvailable(record.ccrId, true);

    return record;
  }

  /**
   * Convenience: save and return only the originalRef string.
   */
  saveRef(input: SaveOriginalInput): string {
    return this.save(input).id;
  }

  /**
   * Link a CCR to the persisted originalRef and mark it retrievable.
   * Used when the original id is generated at save time rather than
   * precomputed by the caller.
   */
  linkOriginalToCcr(ccrId: string, originalRef: string): void {
    runStmt(
      this.db,
      `UPDATE compressed_contexts
         SET original_ref = ?, can_retrieve_original = 1, updated_at = ?
       WHERE id = ?`,
      [originalRef, nowISO(), ccrId],
    );
  }

  // ==========================================================================
  // 9.2 Retrieve
  // ==========================================================================

  /**
   * Retrieve original content by originalRef.
   *
   * Always validates scopeId — returns null when the scope does not match
   * (scope isolation). Supports offset/limit for paginating large content.
   *
   * Returns null for "original_not_found".
   */
  retrieve(
    originalRef: string,
    scopeId: string,
    opts?: RetrieveOptions,
  ): RetrieveResult | null {
    const row = queryOne(
      this.db,
      `SELECT * FROM original_contents WHERE id = ?`,
      [originalRef],
    );

    if (!row) return null; // original_not_found

    // Scope isolation: must match
    if ((row["scope_id"] as string) !== scopeId) return null;

    const fullContent = row["content"] as string;
    const totalChars = fullContent.length;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit;

    // Clamp offset
    const safeOffset = Math.max(0, Math.min(offset, totalChars));

    let sliced: string;
    let returnedChars: number;

    if (limit !== undefined && limit >= 0) {
      sliced = fullContent.substring(safeOffset, safeOffset + limit);
      returnedChars = sliced.length;
    } else {
      sliced = fullContent.substring(safeOffset);
      returnedChars = sliced.length;
    }

    const hasMore = safeOffset + returnedChars < totalChars;

    // Increment retrieveCount on the associated CCR
    const ccrId = row["ccr_id"] as string;
    this.incrementRetrieveCount(ccrId);

    return {
      scopeId: row["scope_id"] as string,
      originalRef: row["id"] as string,
      ccrId: row["ccr_id"] as string,
      contentType: row["content_type"] as string,
      content: sliced,
      tokens: row["tokens"] as number,
      totalChars,
      offset: safeOffset,
      returnedChars,
      metadata: this.safeParseMetadata(row["metadata"] as string | null),
      createdAt: row["created_at"] as string,
      hasMore,
    };
  }

  /**
   * Return the full record (including complete content) without pagination.
   * For internal use or when offset/limit is not needed.
   */
  getRecord(originalRef: string, scopeId: string): OriginalContentRecord | null {
    const row = queryOne(
      this.db,
      `SELECT * FROM original_contents WHERE id = ?`,
      [originalRef],
    );

    if (!row) return null;
    if ((row["scope_id"] as string) !== scopeId) return null;

    return this.rowToRecord(row);
  }

  // ==========================================================================
  // 9.3 Delete & Cleanup
  // ==========================================================================

  /**
   * Delete a single original by its ref.
   *
   * Updates the associated CCR to set canRetrieveOriginal = 0.
   * Returns true if a row was actually deleted, false otherwise.
   */
  delete(originalRef: string, scopeId: string): boolean {
    // Look up the CCR before deleting so we can update it
    const row = queryOne(
      this.db,
      `SELECT ccr_id, scope_id FROM original_contents WHERE id = ?`,
      [originalRef],
    );

    if (!row) return false;

    // Scope isolation for deletion
    if ((row["scope_id"] as string) !== scopeId) return false;

    const ccrId = row["ccr_id"] as string;

    runStmt(
      this.db,
      `DELETE FROM original_contents WHERE id = ?`,
      [originalRef],
    );

    // If this was the last original for this CCR, mark it
    const remaining = queryOne(
      this.db,
      `SELECT COUNT(*) as cnt FROM original_contents WHERE ccr_id = ?`,
      [ccrId],
    );

    const count = Number(remaining?.["cnt"] ?? 0);
    if (count === 0) {
      this.flagCcrOriginalAvailable(ccrId, false);
    }

    return true;
  }

  /**
   * Clean up expired original content.
   *
   * When scopeId is provided, only removes expired originals for that scope.
   * When omitted (backward-compatible), cleans up all scopes.
   *
   * For each affected CCR, if it no longer has any originals, sets
   * canRetrieveOriginal = 0.
   *
   * Returns a summary of how many rows were deleted and which CCRs were affected.
   */
  cleanup(scopeId?: string): CleanupResult {
    const now = nowISO();

    // Find all expired originals (including those expiring right now),
    // optionally scoped to a single project.
    const sql = scopeId
      ? `SELECT id, ccr_id, scope_id FROM original_contents
         WHERE expires_at IS NOT NULL AND expires_at <= ? AND scope_id = ?`
      : `SELECT id, ccr_id, scope_id FROM original_contents
         WHERE expires_at IS NOT NULL AND expires_at <= ?`;
    const params: SqlValue[] = scopeId ? [now, scopeId] : [now];

    const expired = queryAll(this.db, sql, params);

    if (expired.length === 0) {
      return { deleted: 0, affectedCcrIds: [] };
    }

    // Collect unique CCR ids before deleting
    const ccrSet = new Set<string>();
    for (const row of expired) {
      ccrSet.add(row["ccr_id"] as string);
    }

    // Delete all matched expired rows
    const deleteSql = scopeId
      ? `DELETE FROM original_contents
         WHERE expires_at IS NOT NULL AND expires_at <= ? AND scope_id = ?`
      : `DELETE FROM original_contents
         WHERE expires_at IS NOT NULL AND expires_at <= ?`;
    runStmt(this.db, deleteSql, params);

    // For each affected CCR, check if it still has originals
    const affectedCcrIds: string[] = [];
    for (const ccrId of ccrSet) {
      const remaining = queryOne(
        this.db,
        `SELECT COUNT(*) as cnt FROM original_contents WHERE ccr_id = ?`,
        [ccrId],
      );

      if (Number(remaining?.["cnt"] ?? 0) === 0) {
        this.flagCcrOriginalAvailable(ccrId, false);
        affectedCcrIds.push(ccrId);
      }
    }

    return {
      deleted: expired.length,
      affectedCcrIds,
    };
  }

  /**
   * Delete all originals for a given scope.
   * Useful for scope-level teardown. Updates all affected CCRs.
   */
  deleteByScope(scopeId: string): number {
    const rows = queryAll(
      this.db,
      `SELECT id, ccr_id FROM original_contents WHERE scope_id = ?`,
      [scopeId],
    );

    if (rows.length === 0) return 0;

    const ccrSet = new Set<string>();
    for (const row of rows) {
      ccrSet.add(row["ccr_id"] as string);
    }

    runStmt(
      this.db,
      `DELETE FROM original_contents WHERE scope_id = ?`,
      [scopeId],
    );

    for (const ccrId of ccrSet) {
      // Check remaining originals for this CCR (mirrors delete() behavior)
      const remaining = queryOne(
        this.db,
        `SELECT COUNT(*) as cnt FROM original_contents WHERE ccr_id = ?`,
        [ccrId],
      );

      if (Number(remaining?.["cnt"] ?? 0) === 0) {
        this.flagCcrOriginalAvailable(ccrId, false);
      }
    }

    return rows.length;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Set canRetrieveOriginal on a compressed_contexts row.
   */
  private flagCcrOriginalAvailable(ccrId: string, available: boolean): void {
    runStmt(
      this.db,
      `UPDATE compressed_contexts
         SET can_retrieve_original = ?, updated_at = ?
       WHERE id = ?`,
      [available ? 1 : 0, nowISO(), ccrId],
    );
  }

  /**
   * Increment the retrieveCount on a compressed_contexts row.
   */
  private incrementRetrieveCount(ccrId: string): void {
    runStmt(
      this.db,
      `UPDATE compressed_contexts
         SET retrieve_count = retrieve_count + 1, updated_at = ?
       WHERE id = ?`,
      [nowISO(), ccrId],
    );
  }

  /**
   * Check whether an original with the given ref exists and belongs to scopeId.
   */
  exists(originalRef: string, scopeId: string): boolean {
    const row = queryOne(
      this.db,
      `SELECT 1 FROM original_contents WHERE id = ? AND scope_id = ?`,
      [originalRef, scopeId],
    );
    return row !== null;
  }

  /**
   * Look up which scope an originalRef belongs to, without validating
   * that the caller has access. Returns the scope_id if the original
   * exists, or null if no row with that id exists at all.
   *
   * This lets the tool handler differentiate between:
   *   - original_not_found  (no row at all)
   *   - scope_mismatch      (row exists but in a different scope)
   */
  lookupScope(originalRef: string): string | null {
    const row = queryOne(
      this.db,
      `SELECT scope_id FROM original_contents WHERE id = ?`,
      [originalRef],
    );
    if (!row) return null;
    return (row["scope_id"] as string) ?? null;
  }

  /**
   * Check whether a CCR with the given original_ref exists and whether
   * its can_retrieve_original flag is still 1. Returns:
   *   - { found: true, deleted: false } — original is retrievable
   *   - { found: true, deleted: true }  — CCR exists but original was deleted
   *   - { found: false }                — no CCR references this originalRef
   */
  checkDeleted(originalRef: string): { found: boolean; deleted?: boolean } {
    const row = queryOne(
      this.db,
      `SELECT can_retrieve_original FROM compressed_contexts WHERE original_ref = ?`,
      [originalRef],
    );
    if (!row) return { found: false };
    return {
      found: true,
      deleted: !Boolean(row["can_retrieve_original"]),
    };
  }

  // ------------------------------------------------------------------
  // Row mapping
  // ------------------------------------------------------------------

  /**
   * Safely parse a metadata JSON string.
   * Returns undefined on any parse failure (fail-open: don't let corrupt
   * metadata block the caller from retrieving the original content).
   */
  private safeParseMetadata(raw: string | null | undefined): Record<string, unknown> | undefined {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private rowToRecord(row: Record<string, unknown>): OriginalContentRecord {
    return {
      id: row["id"] as string,
      scopeId: row["scope_id"] as string,
      ccrId: row["ccr_id"] as string,
      contentType: row["content_type"] as string,
      content: row["content"] as string,
      contentHash: row["content_hash"] as string,
      tokens: row["tokens"] as number,
      metadata: this.safeParseMetadata(row["metadata"] as string | null),
      createdAt: row["created_at"] as string,
      expiresAt: (row["expires_at"] as string) ?? undefined,
    };
  }
}
