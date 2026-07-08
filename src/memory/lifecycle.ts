/**
 * Memory Lifecycle — Phase 5
 *
 * Manages memory status transitions and bulk expiration.
 *
 * Valid transitions:
 *   active     → superseded | forgotten | expired
 *   superseded → active
 *   forgotten  → active
 *   expired    → active
 */

import type { Database } from "sql.js";
import { queryAll, runStmt } from "../storage/db.js";
import { nowISO } from "../utils/time.js";
import type { MemoryStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, MemoryStatus[]> = {
  active: ["superseded", "forgotten", "expired"],
  superseded: ["active"],
  forgotten: ["active"],
  expired: ["active"],
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidTransition(
  from: MemoryStatus,
  to: MemoryStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Bulk expiration
// ---------------------------------------------------------------------------

/**
 * Find all active memories with an expiresAt in the past and mark them
 * as "expired".
 *
 * Returns the number of memories that were expired.
 *
 * IMPORTANT: This must be called explicitly — it does NOT run automatically
 * on every query.  Callers (CLI or MCP tools) should invoke it periodically
 * or before recall to keep the index clean.
 */
export function expireMemories(db: Database): number {
  const now = nowISO();

  // Find expired but still active memories
  const rows = queryAll(
    db,
    `SELECT id, scope_id FROM memories
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?`,
    [now],
  );

  if (rows.length === 0) return 0;

  for (const row of rows) {
    runStmt(
      db,
      `UPDATE memories SET status = 'expired', updated_at = ? WHERE id = ?`,
      [now, row["id"] as string],
    );
  }

  return rows.length;
}
