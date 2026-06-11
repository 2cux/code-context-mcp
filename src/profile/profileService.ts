/**
 * Profile Service — Phase 6
 *
 * Manages repo profile facts split into two layers:
 *   - static:  long-term facts (project_rule, decision, dependency, api_contract)
 *   - dynamic: transient context (current_task, test_failure, bug, command)
 *
 * Every mutation creates a receipt for auditability.
 *
 * Design principles:
 *   - Scope isolation: queries always filter by scopeId.
 *   - Layer separation: static and dynamic are stored in the same table but
 *     queried and managed through distinct APIs.
 *   - Fail-open: DB errors from queries return empty/null rather than throwing.
 *   - Receipt-backed: write/update/expire/delete always produce a receipt.
 */

import { randomBytes } from "node:crypto";
import type { Database } from "sql.js";
import { queryAll, queryOne, runStmt, type SqlValue } from "../storage/db.js";
import { nowISO } from "../utils/time.js";
import { ReceiptService } from "../receipts/receiptService.js";
import type { ProfileFact, RepoProfile } from "../memory/types.js";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _pfCounter = 0;

function generateProfileFactId(): string {
  _pfCounter += 1;
  const seq = String(_pfCounter).padStart(6, "0");
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex");
  return `pf_${ts}_${rand}_${seq}`;
}

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface WriteProfileFactInput {
  scopeId: string;
  layer: "static" | "dynamic";
  content: string;
  sourceMemoryId?: string;
  sourceRef?: string;
  confidence?: number;
  expiresAt?: string;
}

export interface UpdateProfileFactInput {
  content?: string;
  sourceMemoryId?: string;
  sourceRef?: string;
  confidence?: number;
  expiresAt?: string;
}

export interface ListProfileFactsOptions {
  scopeId: string;
  layer?: "static" | "dynamic";
  sourceMemoryId?: string;
  limit?: number;
  offset?: number;
  /** Only return facts that haven't expired yet. Default: false. */
  activeOnly?: boolean;
}

export interface ListProfileFactsResult {
  scopeId: string;
  items: ProfileFact[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// ProfileService
// ============================================================================

export class ProfileService {
  private db: Database;
  private receipts: ReceiptService;

  constructor(db: Database, opts?: { receipts?: ReceiptService }) {
    this.db = db;
    this.receipts = opts?.receipts ?? new ReceiptService(db);
  }

  // ========================================================================
  // 19.2 — Static Profile
  // ========================================================================

  /**
   * Write a long-term static fact to the profile.
   *
   * Static facts should be associated with memory types:
   * project_rule, decision, dependency, api_contract.
   *
   * Returns the created fact and a receipt.
   */
  writeStaticFact(input: Omit<WriteProfileFactInput, "layer">): {
    fact: ProfileFact;
    receiptId: string;
  } {
    return this.writeFact({ ...input, layer: "static" });
  }

  /**
   * Query static facts for a scope.
   *
   * By default returns only active (non-expired) facts, newest first.
   */
  getStaticFacts(
    scopeId: string,
    opts?: {
      limit?: number;
      offset?: number;
      activeOnly?: boolean;
      sourceMemoryId?: string;
    },
  ): ListProfileFactsResult {
    return this.listFacts({
      scopeId,
      layer: "static",
      activeOnly: opts?.activeOnly ?? true,
      limit: opts?.limit,
      offset: opts?.offset,
      sourceMemoryId: opts?.sourceMemoryId,
    });
  }

  /**
   * Update a static fact's content, confidence, sourceRef, or expiresAt.
   *
   * Only updates fields that are provided. Returns the updated fact.
   */
  updateStaticFact(
    id: string,
    scopeId: string,
    updates: UpdateProfileFactInput,
  ): { fact: ProfileFact; receiptId: string } | null {
    return this.updateFact(id, scopeId, "static", updates);
  }

  /**
   * Expire a static fact by setting its expiresAt to now.
   *
   * The fact remains in the database but will no longer appear in
   * activeOnly queries.
   */
  expireStaticFact(
    id: string,
    scopeId: string,
  ): { fact: ProfileFact; receiptId: string } | null {
    return this.expireFact(id, scopeId, "static");
  }

  // ========================================================================
  // 19.3 — Dynamic Profile
  // ========================================================================

  /**
   * Write a transient dynamic context fact to the profile.
   *
   * Dynamic facts should be associated with memory types:
   * current_task, test_failure, bug, command.
   *
   * Returns the created fact and a receipt.
   */
  writeDynamicContext(input: Omit<WriteProfileFactInput, "layer">): {
    fact: ProfileFact;
    receiptId: string;
  } {
    return this.writeFact({ ...input, layer: "dynamic" });
  }

  /**
   * Query dynamic context for a scope.
   *
   * By default returns only active (non-expired) facts, newest first.
   */
  getDynamicContext(
    scopeId: string,
    opts?: {
      limit?: number;
      offset?: number;
      activeOnly?: boolean;
      sourceMemoryId?: string;
    },
  ): ListProfileFactsResult {
    return this.listFacts({
      scopeId,
      layer: "dynamic",
      activeOnly: opts?.activeOnly ?? true,
      limit: opts?.limit,
      offset: opts?.offset,
      sourceMemoryId: opts?.sourceMemoryId,
    });
  }

  /**
   * Update a dynamic context fact.
   */
  updateDynamicContext(
    id: string,
    scopeId: string,
    updates: UpdateProfileFactInput,
  ): { fact: ProfileFact; receiptId: string } | null {
    return this.updateFact(id, scopeId, "dynamic", updates);
  }

  /**
   * Expire a dynamic context fact.
   *
   * Dynamic context is inherently transient — expiring old context prevents
   * stale information from polluting future recall.
   */
  expireDynamicContext(
    id: string,
    scopeId: string,
  ): { fact: ProfileFact; receiptId: string } | null {
    return this.expireFact(id, scopeId, "dynamic");
  }

  // ========================================================================
  // Shared profile operations
  // ========================================================================

  /**
   * Get the full repo profile for a scope — both static and dynamic layers.
   *
   * Per PRD §15.5, returns RepoProfile with scopeId, staticFacts,
   * dynamicContext, and updatedAt (most recent update across all facts).
   *
   * Used by recall_context to merge profile facts into the recall result.
   * Only returns active (non-expired) facts by default.
   */
  getProfile(
    scopeId: string,
    opts?: { activeOnly?: boolean },
  ): RepoProfile {
    const activeOnly = opts?.activeOnly ?? true;

    try {
      const staticFacts = this.listFactsRaw({
        scopeId,
        layer: "static",
        activeOnly,
      });
      const dynamicFacts = this.listFactsRaw({
        scopeId,
        layer: "dynamic",
        activeOnly,
      });

      // Compute updatedAt as the most recent update across all facts
      const allFacts = [...staticFacts, ...dynamicFacts];
      const updatedAt = allFacts.length > 0
        ? allFacts.reduce((max, f) => f.updatedAt > max ? f.updatedAt : max, allFacts[0]!.updatedAt)
        : new Date().toISOString();

      return {
        scopeId,
        staticFacts,
        dynamicContext: dynamicFacts,
        updatedAt,
      };
    } catch {
      // Fail-open: return empty profile on error
      return {
        scopeId,
        staticFacts: [],
        dynamicContext: [],
        updatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Get a single profile fact by id, validated against scopeId.
   *
   * Returns null when:
   *   - No record exists with that id
   *   - The record exists but belongs to a different scope
   */
  getFact(id: string, scopeId: string): ProfileFact | null {
    return this.rowToFact(
      queryOne(
        this.db,
        `SELECT * FROM profile_facts WHERE id = ? AND scope_id = ?`,
        [id, scopeId],
      ),
    );
  }

  /**
   * Delete a profile fact (hard delete).
   *
   * Always creates a receipt. Returns null if the fact doesn't exist
   * or belongs to a different scope.
   */
  deleteFact(
    id: string,
    scopeId: string,
  ): { fact: ProfileFact; receiptId: string } | null {
    const existing = this.getFact(id, scopeId);
    if (!existing) return null;

    runStmt(
      this.db,
      `DELETE FROM profile_facts WHERE id = ? AND scope_id = ?`,
      [id, scopeId],
    );

    const receipt = this.receipts.create({
      operation: "forget",
      scopeId,
      memoryIds: [id], // Use memoryIds for the receipt — the schema stores IDs generically
      compressed: true,
    });

    return { fact: existing, receiptId: receipt.id };
  }

  /**
   * List profile facts with filtering and pagination.
   */
  listFacts(opts: ListProfileFactsOptions): ListProfileFactsResult {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;

    const conditions: string[] = ["scope_id = ?"];
    const params: SqlValue[] = [opts.scopeId];

    if (opts.layer) {
      conditions.push("layer = ?");
      params.push(opts.layer);
    }

    if (opts.sourceMemoryId) {
      conditions.push("source_memory_id = ?");
      params.push(opts.sourceMemoryId);
    }

    if (opts.activeOnly) {
      conditions.push(
        "(expires_at IS NULL OR expires_at > ?)",
      );
      params.push(nowISO());
    }

    const whereClause = conditions.join(" AND ");

    // Count total
    const countRow = queryOne(
      this.db,
      `SELECT COUNT(*) as cnt FROM profile_facts WHERE ${whereClause}`,
      params,
    );
    const total = Number(countRow?.["cnt"] ?? 0);

    // Fetch page — sorted by created_at DESC
    const rows = queryAll(
      this.db,
      `SELECT * FROM profile_facts WHERE ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit as SqlValue, offset as SqlValue],
    );

    return {
      scopeId: opts.scopeId,
      items: rows.map((r) => this.rowToFact(r)!),
      total,
      limit,
      offset,
    };
  }

  /**
   * Count profile facts for a scope, optionally filtered by layer.
   */
  countFacts(
    scopeId: string,
    opts?: { layer?: "static" | "dynamic"; activeOnly?: boolean },
  ): number {
    let sql = "SELECT COUNT(*) as cnt FROM profile_facts WHERE scope_id = ?";
    const params: SqlValue[] = [scopeId];

    if (opts?.layer) {
      sql += " AND layer = ?";
      params.push(opts.layer);
    }

    if (opts?.activeOnly) {
      sql += " AND (expires_at IS NULL OR expires_at > ?)";
      params.push(nowISO());
    }

    const row = queryOne(this.db, sql, params);
    return Number(row?.["cnt"] ?? 0);
  }

  // ========================================================================
  // Private helpers
  // ========================================================================

  /**
   * Internal: write a fact to the profile_facts table.
   */
  private writeFact(input: WriteProfileFactInput): {
    fact: ProfileFact;
    receiptId: string;
  } {
    const id = generateProfileFactId();
    const now = nowISO();
    const confidence = input.confidence ?? 0.8;

    runStmt(
      this.db,
      `INSERT INTO profile_facts (
         id, scope_id, layer, content, source_memory_id, source_ref,
         confidence, created_at, updated_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.scopeId,
        input.layer,
        input.content,
        input.sourceMemoryId ?? null,
        input.sourceRef ?? null,
        confidence,
        now,
        now,
        input.expiresAt ?? null,
      ],
    );

    const fact = this.getFact(id, input.scopeId)!;

    const receipt = this.receipts.create({
      operation: "remember",
      scopeId: input.scopeId,
      memoryIds: [id],
      compressed: true,
    });

    return { fact, receiptId: receipt.id };
  }

  /**
   * Internal: update a fact, validated by layer.
   */
  private updateFact(
    id: string,
    scopeId: string,
    expectedLayer: "static" | "dynamic",
    updates: UpdateProfileFactInput,
  ): { fact: ProfileFact; receiptId: string } | null {
    const existing = this.getFact(id, scopeId);
    if (!existing) return null;

    // Layer guard — prevent cross-layer updates
    if (existing.layer !== expectedLayer) {
      throw new Error(
        `Cannot update ${expectedLayer} fact: fact ${id} is in layer "${existing.layer}"`,
      );
    }

    const now = nowISO();
    const fields: string[] = ["updated_at = ?"];
    const values: SqlValue[] = [now];

    if (updates.content !== undefined) {
      fields.push("content = ?");
      values.push(updates.content);
    }
    if (updates.sourceMemoryId !== undefined) {
      fields.push("source_memory_id = ?");
      values.push(updates.sourceMemoryId);
    }
    if (updates.sourceRef !== undefined) {
      fields.push("source_ref = ?");
      values.push(updates.sourceRef);
    }
    if (updates.confidence !== undefined) {
      fields.push("confidence = ?");
      values.push(updates.confidence);
    }
    if (updates.expiresAt !== undefined) {
      fields.push("expires_at = ?");
      values.push(updates.expiresAt);
    }

    values.push(id, scopeId);
    runStmt(
      this.db,
      `UPDATE profile_facts SET ${fields.join(", ")} WHERE id = ? AND scope_id = ?`,
      values,
    );

    const updated = this.getFact(id, scopeId)!;

    const receipt = this.receipts.create({
      operation: "remember",
      scopeId,
      memoryIds: [id],
      compressed: true,
    });

    return { fact: updated, receiptId: receipt.id };
  }

  /**
   * Internal: expire a fact by setting expiresAt to now.
   */
  private expireFact(
    id: string,
    scopeId: string,
    expectedLayer: "static" | "dynamic",
  ): { fact: ProfileFact; receiptId: string } | null {
    const existing = this.getFact(id, scopeId);
    if (!existing) return null;

    // Layer guard
    if (existing.layer !== expectedLayer) {
      throw new Error(
        `Cannot expire ${expectedLayer} fact: fact ${id} is in layer "${existing.layer}"`,
      );
    }

    const now = nowISO();
    runStmt(
      this.db,
      `UPDATE profile_facts SET expires_at = ?, updated_at = ? WHERE id = ? AND scope_id = ?`,
      [now, now, id, scopeId],
    );

    const updated = this.getFact(id, scopeId)!;

    const receipt = this.receipts.create({
      operation: "forget",
      scopeId,
      memoryIds: [id],
      compressed: true,
    });

    return { fact: updated, receiptId: receipt.id };
  }

  /**
   * Internal: list facts without pagination (used by getProfile).
   */
  private listFactsRaw(opts: {
    scopeId: string;
    layer: "static" | "dynamic";
    activeOnly?: boolean;
  }): ProfileFact[] {
    const conditions: string[] = [
      "scope_id = ?",
      "layer = ?",
    ];
    const params: SqlValue[] = [opts.scopeId, opts.layer];

    if (opts.activeOnly) {
      conditions.push(
        "(expires_at IS NULL OR expires_at > ?)",
      );
      params.push(nowISO());
    }

    const whereClause = conditions.join(" AND ");
    const rows = queryAll(
      this.db,
      `SELECT * FROM profile_facts WHERE ${whereClause}
       ORDER BY created_at DESC`,
      params,
    );

    return rows.map((r) => this.rowToFact(r)!).filter(Boolean);
  }

  /**
   * Convert a raw DB row to a ProfileFact, or null if the row is null.
   */
  private rowToFact(
    row: Record<string, unknown> | null,
  ): ProfileFact | null {
    if (!row) return null;
    return {
      id: row["id"] as string,
      scopeId: row["scope_id"] as string,
      layer: row["layer"] as "static" | "dynamic",
      content: row["content"] as string,
      sourceMemoryId: (row["source_memory_id"] as string) ?? undefined,
      sourceRef: (row["source_ref"] as string) ?? undefined,
      confidence: row["confidence"] as number,
      createdAt: row["created_at"] as string,
      updatedAt: row["updated_at"] as string,
      expiresAt: (row["expires_at"] as string) ?? undefined,
    };
  }
}
