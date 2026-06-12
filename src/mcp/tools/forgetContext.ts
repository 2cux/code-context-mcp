/**
 * forget_context MCP tool handler — PRD §11.8
 *
 * Forgets, supersedes, or expires a project memory to prevent stale
 * information from polluting future recall results.
 *
 * Pipeline:
 *   1. Validate inputs (id, mode, reason, supersededBy, scopeId).
 *   2. Delegate to MemoryService.forget() which handles:
 *      - Lifecycle transition validation
 *      - Status update (or hard delete)
 *      - FTS index sync
 *      - Receipt creation
 *   3. Return the result.
 *
 * All validation errors return early with isError: true.
 * MemoryService call is wrapped in try/catch for fail-open behavior.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../server.js";
import { MemoryService } from "../../memory/memoryService.js";
import { MemoryFtsIndex } from "../../memory/memoryFts.js";
import { resolveScope } from "../../scope/resolveScope.js";
import { runStmt } from "../../storage/db.js";
import type { ForgetMode } from "../../memory/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All valid forget modes from PRD §11.8 */
const VALID_FORGET_MODES: ReadonlySet<string> = new Set([
  "soft_forget",
  "supersede",
  "expire",
  "hard_delete",
]);

/** Maximum reason length in characters. */
const MAX_REASON_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a scope row exists (INSERT OR IGNORE).
 */
function persistScopeRecord(
  db: Database,
  scopeId: string,
  cwd?: string,
  strategy?: string,
): boolean {
  try {
    const now = new Date().toISOString();
    const dir = cwd ?? process.cwd();
    const strat = strategy ?? "cwdFallback";
    runStmt(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [scopeId, dir, strat, now, now],
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleForgetContext(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const { db, receipts } = ctx;
  const warnings: string[] = [];

  // ==========================================================================
  // 21.2 — Input processing
  // ==========================================================================

  // ---- Validate id ----
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) {
    return {
      content: [{ type: "text", text: "Error: id is required." }],
      isError: true,
    };
  }

  // ---- Validate mode ----
  const modeRaw = typeof args.mode === "string" ? args.mode.trim() : "";
  if (!modeRaw) {
    return {
      content: [{ type: "text", text: "Error: mode is required." }],
      isError: true,
    };
  }
  if (!VALID_FORGET_MODES.has(modeRaw)) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Invalid mode "${modeRaw}". Valid modes: ${Array.from(VALID_FORGET_MODES).join(", ")}`,
        },
      ],
      isError: true,
    };
  }
  const mode = modeRaw as ForgetMode;

  // ---- Validate reason (optional) ----
  let reason: string | undefined;
  if (typeof args.reason === "string" && args.reason.trim().length > 0) {
    const raw = args.reason.trim();
    if (raw.length > MAX_REASON_LENGTH) {
      return {
        content: [
          {
            type: "text",
            text: `Error: reason exceeds maximum length of ${MAX_REASON_LENGTH} characters (got ${raw.length}).`,
          },
        ],
        isError: true,
      };
    }
    reason = raw;
  }

  // ---- Validate supersededBy (required for supersede mode) ----
  let supersededBy: string | undefined;
  if (typeof args.supersededBy === "string" && args.supersededBy.trim().length > 0) {
    supersededBy = args.supersededBy.trim();
  }

  if (mode === "supersede" && !supersededBy) {
    return {
      content: [
        {
          type: "text",
          text: 'Error: supersededBy is required when mode is "supersede".',
        },
      ],
      isError: true,
    };
  }

  // ---- Auto-resolve scope ----
  let scopeId = typeof args.scopeId === "string" ? args.scopeId.trim() : "";
  if (!scopeId) {
    try {
      const scope = resolveScope();
      scopeId = scope.scopeId;
      if (!persistScopeRecord(db, scope.scopeId, scope.cwd, scope.scopeStrategy)) {
        warnings.push(
          "Scope record persistence failed — proceeding, but forget may fail.",
        );
      }
    } catch (scopeErr) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Failed to resolve project scope — ${scopeErr instanceof Error ? scopeErr.message : String(scopeErr)}`,
          },
        ],
        isError: true,
      };
    }
  } else {
    if (!persistScopeRecord(db, scopeId)) {
      warnings.push(
        "Scope record persistence failed — proceeding, but forget may fail.",
      );
    }
  }

  // ==========================================================================
  // 21.2 — Forget execution
  // ==========================================================================

  const ftsIndex = new MemoryFtsIndex(db);
  const memoryService = new MemoryService(db, { receipts, ftsIndex });

  try {
    const result = memoryService.forget({
      id,
      scopeId,
      mode,
      reason,
      supersededBy,
    });

    if (!result) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Memory not found: "${id}". Check that the memory exists and belongs to scope "${scopeId}".`,
          },
        ],
        isError: true,
      };
    }

    // Build response per PRD §11.8
    const response: Record<string, unknown> = {
      memoryId: result.memoryId,
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
      receiptId: result.receiptId,
    };

    if (result.supersededBy) {
      response.supersededBy = result.supersededBy;
    }

    if (reason) {
      response.reason = reason;
    }

    if (warnings.length > 0) {
      response.warnings = warnings;
    }

    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `Error: Failed to forget context — ${message}`,
        },
      ],
      isError: true,
    };
  }
}
