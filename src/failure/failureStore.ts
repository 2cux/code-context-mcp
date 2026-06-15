/**
 * Failure Store — Failure Learning (§33)
 *
 * Records failure events for compression, recall, and retrieve operations.
 * These events drive strategy optimization over time.
 *
 * Event types:
 *   Compression failures: compression_timeout, compression_error,
 *     oversized_input, poor_compression_ratio
 *   Recall failures:      recall_no_hit, recall_low_confidence,
 *     recall_wrong_memory
 *   Retrieve signal:       high_retrieve_count
 *
 * Design principles:
 *   - Non-blocking: record() failures are silent — never throw to the caller.
 *   - Scope-isolated: queries always filter by scopeId.
 *   - Paginated: list() supports offset/limit.
 */

import { randomBytes } from "node:crypto";
import type { Database, SqlValue } from "../storage/db.js";
import { queryAll, queryOne, runStmt } from "../storage/db.js";
import { nowISO } from "../utils/time.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FailureOperation = "compress" | "recall" | "retrieve_original";

export type FailureEventType =
  | "compression_timeout"
  | "compression_error"
  | "oversized_input"
  | "poor_compression_ratio"
  | "recall_no_hit"
  | "recall_low_confidence"
  | "recall_wrong_memory"
  | "high_retrieve_count";

export interface FailureEvent {
  id: string;
  scopeId: string;
  operation: FailureOperation;
  contentType?: string;
  strategy?: string;
  ccrId?: string;
  memoryId?: string;
  errorReason?: string;
  eventType: FailureEventType;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface RecordFailureInput {
  scopeId: string;
  operation: FailureOperation;
  eventType: FailureEventType;
  contentType?: string;
  strategy?: string;
  ccrId?: string;
  memoryId?: string;
  errorReason?: string;
  metadata?: Record<string, unknown>;
}

export interface ListFailuresOptions {
  scopeId: string;
  eventType?: FailureEventType;
  operation?: FailureOperation;
  limit?: number;
  offset?: number;
}

export interface ListFailuresResult {
  scopeId: string;
  items: FailureEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface FailureStats {
  scopeId: string;
  totalEvents: number;
  byEventType: Record<string, number>;
  byOperation: Record<string, number>;
  recentEvents: number; // last 24 hours
  topCcrIds: { ccrId: string; count: number }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Threshold for high_retrieve_count — fire when a CCR is retrieved >= this many times. */
export const HIGH_RETRIEVE_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let _failureCounter = 0;

function generateFailureId(): string {
  _failureCounter += 1;
  const seq = String(_failureCounter).padStart(6, "0");
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex");
  return `fev_${ts}_${rand}_${seq}`;
}

export class FailureStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // ==========================================================================
  // Record
  // ==========================================================================

  /**
   * Record a failure event.
   *
   * This is intentionally non-blocking — if the DB write fails, the error
   * is silently swallowed so it never disrupts the primary operation.
   */
  record(input: RecordFailureInput): FailureEvent | null {
    try {
      const id = generateFailureId();
      const now = nowISO();

      const event: FailureEvent = {
        id,
        scopeId: input.scopeId,
        operation: input.operation,
        contentType: input.contentType,
        strategy: input.strategy,
        ccrId: input.ccrId,
        memoryId: input.memoryId,
        errorReason: input.errorReason,
        eventType: input.eventType,
        createdAt: now,
        metadata: input.metadata,
      };

      runStmt(
        this.db,
        `INSERT INTO failure_events (
           id, scope_id, operation, content_type, strategy,
           ccr_id, memory_id, error_reason, event_type,
           created_at, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.scopeId,
          event.operation,
          event.contentType ?? null,
          event.strategy ?? null,
          event.ccrId ?? null,
          event.memoryId ?? null,
          event.errorReason ?? null,
          event.eventType,
          event.createdAt,
          event.metadata ? JSON.stringify(event.metadata) : null,
        ],
      );

      return event;
    } catch {
      // Non-blocking: never throw from record()
      return null;
    }
  }

  // ==========================================================================
  // List
  // ==========================================================================

  /**
   * List failure events with optional filtering.
   */
  list(opts: ListFailuresOptions): ListFailuresResult {
    const conditions: string[] = ["scope_id = ?"];
    const params: SqlValue[] = [opts.scopeId];

    if (opts.eventType) {
      conditions.push("event_type = ?");
      params.push(opts.eventType);
    }
    if (opts.operation) {
      conditions.push("operation = ?");
      params.push(opts.operation);
    }

    const where = conditions.join(" AND ");
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;

    // Count total
    const countRow = queryOne(
      this.db,
      `SELECT COUNT(*) as cnt FROM failure_events WHERE ${where}`,
      params,
    );
    const total = Number(countRow?.["cnt"] ?? 0);

    // Fetch page
    const rows = queryAll(
      this.db,
      `SELECT * FROM failure_events
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const items = rows.map((r) => this.rowToEvent(r));

    return { scopeId: opts.scopeId, items, total, limit, offset };
  }

  // ==========================================================================
  // Stats
  // ==========================================================================

  /**
   * Return aggregate failure statistics for a scope.
   */
  stats(scopeId: string): FailureStats {
    // Total events
    const totalRow = queryOne(
      this.db,
      `SELECT COUNT(*) as cnt FROM failure_events WHERE scope_id = ?`,
      [scopeId],
    );
    const totalEvents = Number(totalRow?.["cnt"] ?? 0);

    // By eventType
    const byTypeRows = queryAll(
      this.db,
      `SELECT event_type, COUNT(*) as cnt
       FROM failure_events
       WHERE scope_id = ?
       GROUP BY event_type
       ORDER BY cnt DESC`,
      [scopeId],
    );
    const byEventType: Record<string, number> = {};
    for (const r of byTypeRows) {
      byEventType[r["event_type"] as string] = Number(r["cnt"]);
    }

    // By operation
    const byOpRows = queryAll(
      this.db,
      `SELECT operation, COUNT(*) as cnt
       FROM failure_events
       WHERE scope_id = ?
       GROUP BY operation
       ORDER BY cnt DESC`,
      [scopeId],
    );
    const byOperation: Record<string, number> = {};
    for (const r of byOpRows) {
      byOperation[r["operation"] as string] = Number(r["cnt"]);
    }

    // Recent events (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentRow = queryOne(
      this.db,
      `SELECT COUNT(*) as cnt FROM failure_events
       WHERE scope_id = ? AND created_at >= ?`,
      [scopeId, oneDayAgo],
    );
    const recentEvents = Number(recentRow?.["cnt"] ?? 0);

    // Top CCRs by failure count
    const topCcrRows = queryAll(
      this.db,
      `SELECT ccr_id, COUNT(*) as cnt
       FROM failure_events
       WHERE scope_id = ? AND ccr_id IS NOT NULL
       GROUP BY ccr_id
       ORDER BY cnt DESC
       LIMIT 10`,
      [scopeId],
    );
    const topCcrIds = topCcrRows.map((r) => ({
      ccrId: r["ccr_id"] as string,
      count: Number(r["cnt"]),
    }));

    return {
      scopeId,
      totalEvents,
      byEventType,
      byOperation,
      recentEvents,
      topCcrIds,
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Check if a high_retrieve_count event was already recorded for this CCR
   * since its last reset. Avoids duplicate events when the same CCR keeps
   * being retrieved.
   */
  hasRecentHighRetrieveEvent(ccrId: string, scopeId: string): boolean {
    const row = queryOne(
      this.db,
      `SELECT 1 FROM failure_events
       WHERE scope_id = ? AND ccr_id = ? AND event_type = 'high_retrieve_count'
       ORDER BY created_at DESC
       LIMIT 1`,
      [scopeId, ccrId],
    );
    return row !== null;
  }

  /**
   * Get the current retrieveCount for a CCR (from compressed_contexts).
   */
  getRetrieveCount(ccrId: string): number {
    const row = queryOne(
      this.db,
      `SELECT retrieve_count FROM compressed_contexts WHERE id = ?`,
      [ccrId],
    );
    return Number(row?.["retrieve_count"] ?? 0);
  }

  // ------------------------------------------------------------------
  // Row mapping
  // ------------------------------------------------------------------

  private rowToEvent(row: Record<string, unknown>): FailureEvent {
    return {
      id: row["id"] as string,
      scopeId: row["scope_id"] as string,
      operation: row["operation"] as FailureOperation,
      contentType: (row["content_type"] as string) ?? undefined,
      strategy: (row["strategy"] as string) ?? undefined,
      ccrId: (row["ccr_id"] as string) ?? undefined,
      memoryId: (row["memory_id"] as string) ?? undefined,
      errorReason: (row["error_reason"] as string) ?? undefined,
      eventType: row["event_type"] as FailureEventType,
      createdAt: row["created_at"] as string,
      metadata: this.safeParseMetadata(row["metadata"] as string | null),
    };
  }

  private safeParseMetadata(
    raw: string | null | undefined,
  ): Record<string, unknown> | undefined {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}
