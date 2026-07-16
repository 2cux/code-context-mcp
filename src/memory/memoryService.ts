/**
 * Memory Repository — Phase 5
 *
 * Full CRUD for MemoryRecord in the `memories` table.
 * Every mutation creates a receipt for auditability.
 *
 * Design principles:
 *   - Scope isolation: queries always filter by scopeId.
 *   - Lifecycle validation: status transitions checked via isValidTransition().
 *   - Fail-open: DB errors from queries return empty/null rather than throwing.
 *   - Receipt-backed: remember/forget always produce a receipt.
 */

import { randomBytes } from "node:crypto";
import type { Database } from "sql.js";
import { queryAll, queryOne, runStmt, type SqlValue } from "../storage/db.js";
import { nowISO } from "../utils/time.js";
import { ReceiptService } from "../receipts/receiptService.js";
import { isValidTransition } from "./lifecycle.js";
import { MemoryFtsIndex } from "./memoryFts.js";
import { computeMemoryFingerprint } from "./fingerprint.js";
import type {
  MemoryType,
  MemoryStatus,
  ForgetMode,
  MemoryRecord,
  SaveMemoryInput,
  ListMemoryOptions,
  ListMemoryResult,
  ListMemorySortField,
  SortOrder,
  RememberResult,
  ForgetResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _memCounter = 0;

function generateMemoryId(): string {
  _memCounter += 1;
  const seq = String(_memCounter).padStart(6, "0");
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex");
  return `mem_${ts}_${rand}_${seq}`;
}

// ---------------------------------------------------------------------------
// MemoryRepository
// ---------------------------------------------------------------------------

export class MemoryService {
  private db: Database;
  private receipts: ReceiptService;
  private ftsIndex: MemoryFtsIndex | null;

  constructor(
    db: Database,
    opts?: { receipts?: ReceiptService; ftsIndex?: MemoryFtsIndex },
  ) {
    this.db = db;
    this.receipts = opts?.receipts ?? new ReceiptService(db);
    this.ftsIndex = opts?.ftsIndex ?? null;
  }

  // ==========================================================================
  // 17.2.1 — Create memory
  // ==========================================================================

  /**
   * Persist a new memory record with dedup and optional atomic supersede.
   *
   * Dedup: computes a fingerprint from scopeId + type + normalizedContent.
   * If an active memory with the same fingerprint already exists, returns
   * action=deduplicated with the existing memory's info (no new record created).
   *
   * Atomic supersede: when supersedesMemoryId is provided and valid, wraps
   * create + supersede + link + receipt in a single transaction. On any
   * failure the transaction is rolled back.
   *
   * Generates a unique id, sets createdAt/updatedAt, defaults confidence to
   * 0.8 and status to "active". Optionally writes a profile_fact row when
   * profileTarget is specified.
   *
   * Always creates a receipt.
   */
  remember(params: SaveMemoryInput): RememberResult {
    const fingerprint = computeMemoryFingerprint(
      params.scopeId,
      params.type,
      params.content,
    );

    // ── Dedup check: only active memories with same fingerprint ──────────
    const existing = this.findActiveByFingerprint(params.scopeId, fingerprint);
    if (existing) {
      // Create a receipt even for dedup so the operation is auditable
      const receipt = this.receipts.create({
        operation: "remember",
        scopeId: params.scopeId,
        memoryIds: [existing.id],
        compressed: true,
      });

      return {
        action: "deduplicated",
        memoryId: existing.id,
        scopeId: params.scopeId,
        type: params.type,
        status: existing.status,
        receiptId: receipt.id,
      };
    }

    // ── Atomic supersede: if supersedesMemoryId provided, wrap in tx ────
    const supersedes = params.supersedesMemoryId;
    if (supersedes) {
      return this.rememberWithSupersede(params, fingerprint);
    }

    // ── Standard create ──────────────────────────────────────────────────
    return this.createMemory(params, fingerprint);
  }

  /**
   * Find an active memory by scopeId + fingerprint.
   * Returns null if no match found or match is not active.
   */
  private findActiveByFingerprint(
    scopeId: string,
    fingerprint: string,
  ): MemoryRecord | null {
    const row = queryOne(
      this.db,
      `SELECT * FROM memories
       WHERE scope_id = ? AND fingerprint = ? AND status = 'active'
       LIMIT 1`,
      [scopeId, fingerprint],
    );
    if (!row) return null;
    return this.rowToRecord(row);
  }

  /**
   * Standard memory creation (no dedup, no supersede).
   */
  private createMemory(
    params: SaveMemoryInput,
    fingerprint: string,
  ): RememberResult {
    const id = generateMemoryId();
    const now = nowISO();
    const confidence = params.confidence ?? 0.8;
    const status: MemoryStatus = "active";

    runStmt(
      this.db,
      `INSERT INTO memories (
         id, scope_id, type, content, summary, source_ref,
         confidence, status, created_at, updated_at,
         expires_at, superseded_by, tags, fingerprint
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.scopeId,
        params.type,
        params.content,
        params.summary ?? null,
        params.sourceRef ?? null,
        confidence,
        status,
        now,
        now,
        params.expiresAt ?? null,
        null,
        params.tags ? JSON.stringify(params.tags) : null,
        fingerprint,
      ],
    );

    // Sync to FTS index
    if (this.ftsIndex) {
      this.ftsIndex.insert({
        id,
        scopeId: params.scopeId,
        type: params.type,
        content: params.content,
        summary: params.summary,
        sourceRef: params.sourceRef,
        confidence,
        status,
        createdAt: now,
        updatedAt: now,
        expiresAt: params.expiresAt,
        supersededBy: undefined,
        tags: params.tags,
        fingerprint,
      });
    }

    // Optionally write to profile_facts
    if (params.profileTarget) {
      this.writeProfileFact(id, params, now);
    }

    // Create receipt
    const receipt = this.receipts.create({
      operation: "remember",
      scopeId: params.scopeId,
      memoryIds: [id],
      compressed: true,
    });

    return {
      action: "created",
      memoryId: id,
      scopeId: params.scopeId,
      type: params.type,
      status,
      receiptId: receipt.id,
    };
  }

  /**
   * Atomic supersede: create new memory + mark old as superseded + receipt.
   *
   * Wrapped in a transaction — any failure triggers a rollback.
   */
  private rememberWithSupersede(
    params: SaveMemoryInput,
    fingerprint: string,
  ): RememberResult {
    const supersededId = params.supersedesMemoryId!;

    // Validate the target exists and is active
    const target = this._getRaw(supersededId, params.scopeId);
    if (!target) {
      throw new Error(
        `supersedesMemoryId "${supersededId}" not found in scope "${params.scopeId}".`,
      );
    }
    if (target.status !== "active") {
      throw new Error(
        `Cannot supersede memory "${supersededId}" — status is "${target.status}", must be "active".`,
      );
    }

    const newId = generateMemoryId();
    const now = nowISO();
    const confidence = params.confidence ?? 0.8;
    const status: MemoryStatus = "active";
    const memoryIds = [newId, supersededId];

    // ── Transaction wrap ──────────────────────────────────────────────────
    try {
      runStmt(this.db, "BEGIN TRANSACTION");

      // 1. Insert new memory
      runStmt(
        this.db,
        `INSERT INTO memories (
           id, scope_id, type, content, summary, source_ref,
           confidence, status, created_at, updated_at,
           expires_at, superseded_by, tags, fingerprint
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          params.scopeId,
          params.type,
          params.content,
          params.summary ?? null,
          params.sourceRef ?? null,
          confidence,
          status,
          now,
          now,
          params.expiresAt ?? null,
          null,
          params.tags ? JSON.stringify(params.tags) : null,
          fingerprint,
        ],
      );

      // 2. Supersede the old memory (update status + superseded_by)
      runStmt(
        this.db,
        `UPDATE memories SET status = ?, superseded_by = ?, updated_at = ?
         WHERE id = ? AND scope_id = ?`,
        ["superseded", newId, now, supersededId, params.scopeId],
      );

      // 3. Sync to FTS index
      if (this.ftsIndex) {
        this.ftsIndex.insert({
          id: newId,
          scopeId: params.scopeId,
          type: params.type,
          content: params.content,
          summary: params.summary,
          sourceRef: params.sourceRef,
          confidence,
          status,
          createdAt: now,
          updatedAt: now,
          expiresAt: params.expiresAt,
          supersededBy: undefined,
          tags: params.tags,
          fingerprint,
        });
        // Update the old memory's FTS entry
        const oldRecord = this.get(supersededId, params.scopeId);
        if (oldRecord) {
          this.ftsIndex.update(oldRecord);
        }
      }

      // 4. Optionally write to profile_facts
      if (params.profileTarget) {
        this.writeProfileFact(newId, params, now);
      }

      // 5. Receipt with both memory IDs
      const receipt = this.receipts.create({
        operation: "remember",
        scopeId: params.scopeId,
        memoryIds,
        compressed: true,
      });

      runStmt(this.db, "COMMIT");

      return {
        action: "replaced",
        memoryId: newId,
        scopeId: params.scopeId,
        type: params.type,
        status,
        receiptId: receipt.id,
        supersededMemoryId: supersededId,
      };
    } catch (err) {
      // Rollback on any failure
      try { runStmt(this.db, "ROLLBACK"); } catch { /* best effort */ }
      throw err;
    }
  }

  // ==========================================================================
  // 17.2.2 — Query single memory
  // ==========================================================================

  /**
   * Get a single memory by id, validated against scopeId.
   *
   * Returns null when:
   *   - No record exists with that id
   *   - The record exists but belongs to a different scope (scope isolation)
   */
  /**
   * Get a single memory by id, validated against scopeId.
   *
   * Populates the computed `supersedes` field (reverse of supersededBy).
   * For internal callers that don't need supersedes, use _getRaw() instead.
   *
   * Returns null when:
   *   - No record exists with that id
   *   - The record exists but belongs to a different scope (scope isolation)
   */
  get(id: string, scopeId: string): MemoryRecord | null {
    const record = this._getRaw(id, scopeId);
    if (!record) return null;
    // Populate computed supersedes (reverse of supersededBy)
    record.supersedes = this.getSupersedes(id, scopeId);
    return record;
  }

  /**
   * Internal: get a memory without computing supersedes.
   * Used by updateStatus / forget to avoid a wasted query.
   */
  private _getRaw(id: string, scopeId: string): MemoryRecord | null {
    const row = queryOne(
      this.db,
      `SELECT * FROM memories WHERE id = ? AND scope_id = ?`,
      [id, scopeId],
    );
    if (!row) return null;
    return this.rowToRecord(row);
  }

  // ==========================================================================
  // 17.2.3 — Update memory status (lifecycle transition)
  // ==========================================================================

  /**
   * Update a memory's status.
   *
   * Validates the lifecycle transition via isValidTransition().
   * Also supports updating summary, content, confidence, tags, expiresAt.
   *
   * Returns the updated record or null if not found (wrong scope).
   */
  updateStatus(
    id: string,
    scopeId: string,
    newStatus: MemoryStatus,
    opts?: {
      summary?: string;
      content?: string;
      confidence?: number;
      tags?: string[];
      expiresAt?: string;
      supersededBy?: string;
    },
  ): MemoryRecord | null {
    const existing = this._getRaw(id, scopeId);
    if (!existing) return null;

    // Validate lifecycle transition
    if (!isValidTransition(existing.status, newStatus)) {
      throw new Error(
        `Invalid memory lifecycle transition: ${existing.status} -> ${newStatus}`,
      );
    }

    const now = nowISO();
    const fields: string[] = ["status = ?", "updated_at = ?"];
    const values: SqlValue[] = [newStatus, now];

    if (opts?.summary !== undefined) {
      fields.push("summary = ?");
      values.push(opts.summary);
    }
    if (opts?.content !== undefined) {
      fields.push("content = ?");
      values.push(opts.content);
    }
    if (opts?.confidence !== undefined) {
      fields.push("confidence = ?");
      values.push(opts.confidence);
    }
    if (opts?.tags !== undefined) {
      fields.push("tags = ?");
      values.push(JSON.stringify(opts.tags));
    }
    if (opts?.expiresAt !== undefined) {
      fields.push("expires_at = ?");
      values.push(opts.expiresAt);
    }
    if (opts?.supersededBy !== undefined) {
      fields.push("superseded_by = ?");
      values.push(opts.supersededBy);
    }

    values.push(id, scopeId);
    runStmt(
      this.db,
      `UPDATE memories SET ${fields.join(", ")} WHERE id = ? AND scope_id = ?`,
      values,
    );

    // Sync updated record to FTS — use get() to get supersedes too
    const updated = this.get(id, scopeId);
    if (updated && this.ftsIndex) {
      this.ftsIndex.update(updated);
    }

    return updated;
  }

  // ==========================================================================
  // 17.2.4 — Forget (soft / supersede / expire / hard delete)
  // ==========================================================================

  /**
   * Forget a memory.
   *
   * Modes:
   *   - "soft_forget": status → "forgotten"
   *   - "supersede":   status → "superseded", sets supersededBy
   *   - "expire":      status → "expired"
   *   - "hard_delete": actually deletes the row
   *
   * Always creates a receipt.
   */
  forget(params: {
    id: string;
    scopeId: string;
    mode: ForgetMode;
    reason?: string;
    supersededBy?: string;
  }): ForgetResult | null {
    const existing = this._getRaw(params.id, params.scopeId);
    if (!existing) return null;

    const previousStatus = existing.status;

    if (params.mode === "hard_delete") {
      const profileFactCount = queryOne(
        this.db,
        `SELECT COUNT(*) AS count FROM profile_facts
         WHERE source_memory_id = ? AND scope_id = ?`,
        [params.id, params.scopeId],
      );
      const profileFactsDeleted = Number(profileFactCount?.["count"] ?? 0);

      let transactionStarted = false;
      try {
        runStmt(this.db, "BEGIN TRANSACTION");
        transactionStarted = true;

        // All destructive writes share this transaction. Strict FTS deletion
        // propagates failures so a later rollback restores every deleted row.
        this.ftsIndex?.deleteStrict(params.id);
        runStmt(
          this.db,
          `DELETE FROM profile_facts WHERE source_memory_id = ? AND scope_id = ?`,
          [params.id, params.scopeId],
        );
        runStmt(
          this.db,
          `DELETE FROM memories WHERE id = ? AND scope_id = ?`,
          [params.id, params.scopeId],
        );

        const receipt = this.receipts.create({
          operation: "forget",
          scopeId: params.scopeId,
          memoryIds: [params.id],
          errorReason: params.reason ?? undefined,
        });

        runStmt(this.db, "COMMIT");
        return {
          action: "hard_deleted",
          memoryId: params.id,
          previousStatus,
          deleted: true,
          profileFactsDeleted,
          receiptId: receipt.id,
        };
      } catch (err) {
        if (transactionStarted) {
          try { runStmt(this.db, "ROLLBACK"); } catch { /* best effort */ }
        }
        throw err;
      }
    }

    // Soft modes — map mode to target status
    const statusMap: Record<string, MemoryStatus> = {
      soft_forget: "forgotten",
      supersede: "superseded",
      expire: "expired",
    };

    const newStatus = statusMap[params.mode];
    if (!newStatus) {
      throw new Error(`Unknown forget mode: ${params.mode}`);
    }

    const updated = this.updateStatus(params.id, params.scopeId, newStatus, {
      supersededBy: params.supersededBy,
    });

    if (!updated) return null; // shouldn't happen since we just read it

    const receipt = this.receipts.create({
      operation: "forget",
      scopeId: params.scopeId,
      memoryIds: [params.id],
      errorReason: params.reason ?? undefined,
    });

    return {
      memoryId: params.id,
      previousStatus,
      newStatus,
      supersededBy: params.supersededBy,
      receiptId: receipt.id,
    };
  }

  // ==========================================================================
  // 17.2.5 — List with filters and pagination
  // ==========================================================================

  /**
   * List memories for a scope.
   *
   * Supports:
   *   - Filtering by multiple types
   *   - Filtering by multiple statuses
   *   - Pagination via limit/offset
   *   - Sorting by createdAt, updatedAt, type, status, or confidence
   *   - Configurable sort order (asc / desc)
   *
   * Default sort: created_at DESC (most recent first).
   * Always returns a total count so callers can compute page counts.
   */
  list(opts: ListMemoryOptions): ListMemoryResult {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const sortBy = this.resolveSortColumn(opts.sortBy ?? "createdAt");
    const sortOrder = this.resolveSortOrder(opts.sortOrder ?? "desc");

    // Build WHERE clause
    const conditions: string[] = ["scope_id = ?"];
    const params: SqlValue[] = [opts.scopeId];

    if (opts.types && opts.types.length > 0) {
      const placeholders = opts.types.map(() => "?").join(", ");
      conditions.push(`type IN (${placeholders})`);
      params.push(...opts.types);
    }

    if (opts.status && opts.status.length > 0) {
      const placeholders = opts.status.map(() => "?").join(", ");
      conditions.push(`status IN (${placeholders})`);
      params.push(...opts.status);
    }

    const whereClause = conditions.join(" AND ");

    // Count total
    const countRow = queryOne(
      this.db,
      `SELECT COUNT(*) as cnt FROM memories WHERE ${whereClause}`,
      params,
    );
    const total = Number(countRow?.["cnt"] ?? 0);

    // Fetch page — sorted by the requested column + order
    const rows = queryAll(
      this.db,
      `SELECT * FROM memories WHERE ${whereClause}
       ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`,
      [...params, limit as SqlValue, offset as SqlValue],
    );

    return {
      scopeId: opts.scopeId,
      items: rows.map((r) => this.rowToRecord(r)),
      total,
      limit,
      offset,
    };
  }

  // ==========================================================================
  // 17.2.6 — Count
  // ==========================================================================

  /**
   * Count memories for a scope, optionally filtered by type or status.
   */
  count(
    scopeId: string,
    opts?: { type?: MemoryType; status?: MemoryStatus },
  ): number {
    let sql = "SELECT COUNT(*) as cnt FROM memories WHERE scope_id = ?";
    const params: SqlValue[] = [scopeId];

    if (opts?.type) {
      sql += " AND type = ?";
      params.push(opts.type);
    }
    if (opts?.status) {
      sql += " AND status = ?";
      params.push(opts.status);
    }

    const row = queryOne(this.db, sql, params);
    return Number(row?.["cnt"] ?? 0);
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Convert a raw DB row to a MemoryRecord.
   */
  private rowToRecord(row: Record<string, unknown>): MemoryRecord {
    return {
      id: row["id"] as string,
      scopeId: row["scope_id"] as string,
      type: row["type"] as MemoryType,
      content: row["content"] as string,
      summary: (row["summary"] as string) ?? undefined,
      sourceRef: (row["source_ref"] as string) ?? undefined,
      confidence: row["confidence"] as number,
      status: row["status"] as MemoryStatus,
      createdAt: row["created_at"] as string,
      updatedAt: row["updated_at"] as string,
      expiresAt: (row["expires_at"] as string) ?? undefined,
      supersededBy: (row["superseded_by"] as string) ?? undefined,
      tags: safeParseJSONArray(row["tags"] as string | null),
      fingerprint: (row["fingerprint"] as string) ?? undefined,
    };
  }

  /**
   * Compute the supersedes list — all memory IDs that have
   * superseded_by pointing to this memory.
   *
   * This is the reverse of supersededBy and is NOT stored directly
   * in the row (it's computed on read).
   */
  private getSupersedes(memoryId: string, scopeId: string): string[] {
    const rows = queryAll(
      this.db,
      `SELECT id FROM memories WHERE superseded_by = ? AND scope_id = ?`,
      [memoryId, scopeId],
    );
    return rows.map((r) => r["id"] as string);
  }

  /**
   * Map a ListMemorySortField to the corresponding SQL column name.
   *
   * Allowed values are whitelisted to prevent SQL injection from
   * dynamic ORDER BY.
   */
  private resolveSortColumn(field: ListMemorySortField): string {
    const COLUMN_MAP: Record<ListMemorySortField, string> = {
      createdAt: "created_at",
      updatedAt: "updated_at",
      type: "type",
      status: "status",
      confidence: "confidence",
    };
    return COLUMN_MAP[field];
  }

  /**
   * Validate sort order — only "asc" or "desc" are allowed.
   * Defaults to "desc" for unrecognized values.
   */
  private resolveSortOrder(order: SortOrder): "ASC" | "DESC" {
    return order === "asc" ? "ASC" : "DESC";
  }

  /**
   * Write a profile_fact row when profileTarget is specified.
   */
  private writeProfileFact(
    memoryId: string,
    params: SaveMemoryInput,
    now: string,
  ): void {
    const pfId = `pf_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}_${String(_memCounter).padStart(6, "0")}`;

    const content = params.summary ?? params.content;

    runStmt(
      this.db,
      `INSERT INTO profile_facts (
         id, scope_id, layer, content, source_memory_id, source_ref,
         confidence, created_at, updated_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pfId,
        params.scopeId,
        params.profileTarget!,
        content,
        memoryId,
        params.sourceRef ?? null,
        params.confidence ?? 0.8,
        now,
        now,
        params.expiresAt ?? null,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely parse a JSON array string (tags).
 * Returns undefined on any parse failure.
 */
function safeParseJSONArray(
  raw: string | null | undefined,
): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return undefined;
  } catch {
    return undefined;
  }
}
