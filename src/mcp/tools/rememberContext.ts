/**
 * remember_context MCP tool handler — PRD §11.6
 *
 * Saves structured project memory for later recall.
 *
 * Pipeline:
 *   1. Validate and process inputs (type, content, scope, ...).
 *   2. Delegate to MemoryService.remember() which handles:
 *      - Writing to memories table
 *      - Syncing to memories_fts
 *      - Optionally writing to profile_facts (when profileTarget is set)
 *      - Creating a receipt
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
import type {
  MemoryType,
  MemoryStatus,
  SaveMemoryInput,
} from "../../memory/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All valid memory types from PRD §14.3 */
const VALID_MEMORY_TYPES: ReadonlySet<string> = new Set([
  "decision",
  "bug",
  "command",
  "file_summary",
  "project_rule",
  "user_preference",
  "current_task",
  "test_failure",
  "api_contract",
  "dependency",
]);

const VALID_PROFILE_TARGETS: ReadonlySet<string> = new Set([
  "static",
  "dynamic",
]);

/** Maximum content length in characters (256 KiB, conservative upper bound). */
const MAX_CONTENT_LENGTH = 256_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a scope row exists (INSERT OR IGNORE).
 *
 * Returns true on success, false when persistence fails.
 * Failure is non-fatal — callers should collect a warning.
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

/**
 * Validate an ISO 8601 date string.  Returns true for strings that *look* like
 * valid ISO dates — we don't parse them, just check syntax.
 *
 * Matches: 2026-06-10T00:00:00Z, 2026-06-10T00:00:00+08:00, etc.
 */
function isValidIsoDate(value: string): boolean {
  // Must be parseable and must parse to a finite number (not "Invalid Date")
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;

  // Reject obviously bogus strings that Date.parse still accepts (e.g. "abc")
  // Must contain a T separator and at least a year-month-day
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleRememberContext(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const { db } = ctx;
  const warnings: string[] = [];

  // ==========================================================================
  // 18.1 — Input processing
  // ==========================================================================

  // ---- 18.1.1: Validate type ----
  const typeRaw = typeof args.type === "string" ? args.type.trim() : "";
  if (!typeRaw) {
    return {
      content: [{ type: "text", text: "Error: type is required." }],
      isError: true,
    };
  }
  if (!VALID_MEMORY_TYPES.has(typeRaw)) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Invalid type "${typeRaw}". Valid types: ${Array.from(VALID_MEMORY_TYPES).join(", ")}`,
        },
      ],
      isError: true,
    };
  }
  const type = typeRaw as MemoryType;

  // ---- 18.1.2: Validate content ----
  const contentRaw = typeof args.content === "string" ? args.content : "";
  if (!contentRaw.trim()) {
    return {
      content: [{ type: "text", text: "Error: content is required and must not be empty." }],
      isError: true,
    };
  }
  if (contentRaw.length > MAX_CONTENT_LENGTH) {
    return {
      content: [
        {
          type: "text",
          text: `Error: content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters (got ${contentRaw.length}).`,
        },
      ],
      isError: true,
    };
  }
  const content = contentRaw;

  // ---- 18.1.3: Auto-resolve scope ----
  let scopeId = typeof args.scopeId === "string" ? args.scopeId.trim() : "";
  if (!scopeId) {
    try {
      const scope = resolveScope();
      scopeId = scope.scopeId;
      // Persist the auto-resolved scope record
      if (!persistScopeRecord(db, scope.scopeId, scope.cwd, scope.scopeStrategy)) {
        warnings.push("Scope record persistence failed — proceeding, but memory write may fail on FK constraint.");
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
    // For explicitly provided scopeId, ensure the scope record exists
    // (FK constraint on memories.scope_id → scopes.scope_id)
    if (!persistScopeRecord(db, scopeId)) {
      warnings.push("Scope record persistence failed — proceeding, but memory write may fail on FK constraint.");
    }
  }

  // ---- 18.1.4: Process summary ----
  const summary =
    typeof args.summary === "string" && args.summary.trim().length > 0
      ? args.summary.trim()
      : undefined;

  // ---- 18.1.5: Process confidence ----
  let confidence = 0.8;
  if (typeof args.confidence === "number") {
    if (Number.isNaN(args.confidence) || args.confidence < 0 || args.confidence > 1) {
      return {
        content: [
          {
            type: "text",
            text: `Error: confidence must be a number between 0 and 1 (got ${args.confidence}).`,
          },
        ],
        isError: true,
      };
    }
    confidence = args.confidence;
  }

  // ---- 18.1.6: Process sourceRef ----
  const sourceRef =
    typeof args.sourceRef === "string" && args.sourceRef.trim().length > 0
      ? args.sourceRef.trim()
      : undefined;

  // ---- 18.1.7: Process expiresAt ----
  let expiresAt: string | undefined;
  if (typeof args.expiresAt === "string" && args.expiresAt.trim().length > 0) {
    const raw = args.expiresAt.trim();
    if (!isValidIsoDate(raw)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: expiresAt must be a valid ISO 8601 date string (e.g. "2027-06-10T00:00:00Z"), got "${raw}".`,
          },
        ],
        isError: true,
      };
    }
    expiresAt = raw;
  }

  // ---- 18.1.8: Process profileTarget ----
  let profileTarget: "static" | "dynamic" | undefined;
  if (
    typeof args.profileTarget === "string" &&
    args.profileTarget.trim().length > 0
  ) {
    const raw = args.profileTarget.trim();
    if (!VALID_PROFILE_TARGETS.has(raw)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Invalid profileTarget "${raw}". Valid values: static, dynamic.`,
          },
        ],
        isError: true,
      };
    }
    profileTarget = raw as "static" | "dynamic";
  }

  // ---- Process tags ----
  let tags: string[] | undefined;
  if (Array.isArray(args.tags) && args.tags.length > 0) {
    tags = args.tags
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tags.length === 0) tags = undefined;
  }

  // ==========================================================================
  // 18.2 — Memory writing
  // ==========================================================================

  // Build the FTS index once and inject it into MemoryService
  const ftsIndex = new MemoryFtsIndex(db);
  const memoryService = new MemoryService(db, { ftsIndex });

  const input: SaveMemoryInput = {
    scopeId,
    type,
    content,
    summary,
    sourceRef,
    confidence,
    profileTarget,
    expiresAt,
    tags,
  };

  try {
    const result = memoryService.remember(input);

    // Build response per PRD §11.6
    const response: Record<string, unknown> = {
      memoryId: result.memoryId,
      scopeId: result.scopeId,
      type: result.type,
      status: result.status,
      receiptId: result.receiptId,
    };

    // Include optional fields in response for clarity
    if (summary) response.summary = summary;
    if (sourceRef) response.sourceRef = sourceRef;
    if (profileTarget) response.profileTarget = profileTarget;
    if (warnings.length > 0) response.warnings = warnings;

    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    };
  } catch (err) {
    // 18.3: Exception handling — catch all service-layer errors
    const message = err instanceof Error ? err.message : String(err);

    // Try to determine the error category for better error messages
    if (message.includes("FTS") || message.includes("fts")) {
      return {
        content: [
          {
            type: "text",
            text: `Error: FTS index write failed — ${message}`,
          },
        ],
        isError: true,
      };
    }

    if (message.includes("profile") || message.includes("profile_facts")) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Profile fact write failed — ${message}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Error: Failed to remember context — ${message}`,
        },
      ],
      isError: true,
    };
  }
}
