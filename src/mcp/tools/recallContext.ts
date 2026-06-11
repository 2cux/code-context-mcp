/**
 * recall_context MCP tool handler — PRD §11.7
 *
 * Recalls project profile, relevant memories, and compressed context references
 * for a given query. Merges profile facts (static + dynamic), ranks memories
 * via BM25 + confidence + recency, and links related compressed contexts.
 *
 * Pipeline:
 *   1. Validate and process inputs (query, types, status, scope, profile flags).
 *   2. Run enhanced search via RecallEngine (BM25 → confidence → recency).
 *   3. Merge profile facts (static + dynamic) when includeProfile is true.
 *   4. Find related compressed contexts by sourceRef.
 *   5. Generate a recall receipt (always, even for empty results).
 *   6. Return RecallResult JSON.
 *
 * All validation errors return early with isError: true.
 * Search/DB errors are caught for fail-open behavior.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../server.js";
import { RecallEngine } from "../../memory/recallEngine.js";
import { MemoryFtsIndex } from "../../memory/memoryFts.js";
import { ProfileService } from "../../profile/profileService.js";
import { resolveScope } from "../../scope/resolveScope.js";
import { runStmt } from "../../storage/db.js";
import type {
  MemoryType,
  MemoryStatus,
  RecallResult,
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

/** All valid memory statuses */
const VALID_MEMORY_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "superseded",
  "forgotten",
  "expired",
]);

/** Maximum query length */
const MAX_QUERY_LENGTH = 1000;

/** Default limit for recall results */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

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

export async function handleRecallContext(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const { db, receipts } = ctx;
  const warnings: string[] = [];

  // ==========================================================================
  // 20.1 — Input processing
  // ==========================================================================

  // ---- Validate query ----
  const queryRaw = typeof args.query === "string" ? args.query.trim() : "";
  if (!queryRaw) {
    return {
      content: [{ type: "text", text: "Error: query is required." }],
      isError: true,
    };
  }
  if (queryRaw.length > MAX_QUERY_LENGTH) {
    return {
      content: [
        {
          type: "text",
          text: `Error: query exceeds maximum length of ${MAX_QUERY_LENGTH} characters (got ${queryRaw.length}).`,
        },
      ],
      isError: true,
    };
  }
  const query = queryRaw;

  // ---- Validate types (optional) ----
  let types: MemoryType[] | undefined;
  if (Array.isArray(args.types) && args.types.length > 0) {
    const rawTypes = args.types.filter(
      (t): t is string => typeof t === "string" && t.length > 0,
    );
    if (rawTypes.length === 0) {
      types = undefined;
    } else {
      const invalid = rawTypes.filter((t) => !VALID_MEMORY_TYPES.has(t));
      if (invalid.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Invalid type(s): ${invalid.join(", ")}. Valid types: ${Array.from(VALID_MEMORY_TYPES).join(", ")}`,
            },
          ],
          isError: true,
        };
      }
      types = rawTypes as MemoryType[];
    }
  }

  // ---- Validate status (optional, defaults to ["active"]) ----
  let status: MemoryStatus[] | undefined;
  if (Array.isArray(args.status) && args.status.length > 0) {
    const rawStatus = args.status.filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
    if (rawStatus.length > 0) {
      const invalid = rawStatus.filter((s) => !VALID_MEMORY_STATUSES.has(s));
      if (invalid.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Invalid status(es): ${invalid.join(", ")}. Valid statuses: ${Array.from(VALID_MEMORY_STATUSES).join(", ")}`,
            },
          ],
          isError: true,
        };
      }
      status = rawStatus as MemoryStatus[];
    }
  }

  // ---- Process limit ----
  let limit = DEFAULT_LIMIT;
  if (typeof args.limit === "number") {
    if (Number.isNaN(args.limit) || args.limit < 1) {
      return {
        content: [
          {
            type: "text",
            text: `Error: limit must be a positive number (got ${args.limit}).`,
          },
        ],
        isError: true,
      };
    }
    limit = Math.min(Math.trunc(args.limit), MAX_LIMIT);
  }

  // ---- Process profile flags ----
  const includeProfile =
    typeof args.includeProfile === "boolean" ? args.includeProfile : true;
  const includeStatic =
    typeof args.includeStatic === "boolean"
      ? args.includeStatic
      : includeProfile;
  const includeDynamic =
    typeof args.includeDynamic === "boolean"
      ? args.includeDynamic
      : includeProfile;

  // ---- Process compressed refs flag (PRD §11.7) ----
  const includeCompressedRefs =
    typeof args.includeCompressedRefs === "boolean"
      ? args.includeCompressedRefs
      : true;

  // ---- Process retrieveOriginal flag (PRD §11.7, default false, future feature) ----
  const retrieveOriginal =
    typeof args.retrieveOriginal === "boolean"
      ? args.retrieveOriginal
      : false;
  if (retrieveOriginal) {
    warnings.push(
      "retrieveOriginal=true is not yet implemented — original content retrieval will be available in a future version.",
    );
  }

  // ---- Auto-resolve scope ----
  let scopeId = typeof args.scopeId === "string" ? args.scopeId.trim() : "";
  if (!scopeId) {
    try {
      const scope = resolveScope();
      scopeId = scope.scopeId;
      if (!persistScopeRecord(db, scope.scopeId, scope.cwd, scope.scopeStrategy)) {
        warnings.push(
          "Scope record persistence failed — proceeding, but recall may be incomplete.",
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
    // Ensure the scope record exists
    if (!persistScopeRecord(db, scopeId)) {
      warnings.push(
        "Scope record persistence failed — proceeding, but recall may be incomplete.",
      );
    }
  }

  // ==========================================================================
  // 20.1–20.3 — Search, profile merge, related CCRs
  // ==========================================================================

  // Build search engine
  const ftsIndex = new MemoryFtsIndex(db);
  const engine = new RecallEngine(db, ftsIndex);
  const profileService = new ProfileService(db, { receipts });

  // Collect result data (populated inside try/catch for fail-open)
  let memories: RecallResult["memories"] = [];
  let profile: RecallResult["profile"] = { static: [], dynamic: [] };
  let relatedCompressedContexts: RecallResult["relatedCompressedContexts"] = [];
  let memoryIds: string[] = [];
  let ccrIds: string[] = [];

  try {
    // 20.1 — Enhanced search
    const searchResults = engine.searchEnhanced({
      scopeId,
      query,
      types,
      status,
      limit,
      includeCanExpand: true,
    });

    memories = searchResults.map((r) => ({
      ...r.memory,
      score: r.finalScore,
      canExpand: r.canExpand,
    }));

    memoryIds = memories.map((m) => m.id);

    // 20.2 — Profile merge
    if (includeProfile) {
      const repoProfile = profileService.getProfile(scopeId);
      if (includeStatic) {
        profile.static = repoProfile.staticFacts;
      }
      if (includeDynamic) {
        profile.dynamic = repoProfile.dynamicContext;
      }
    }

    // 20.3 — Related compressed contexts (controlled by includeCompressedRefs, PRD §11.7)
    if (includeCompressedRefs && memories.length > 0) {
      relatedCompressedContexts = engine.findRelatedCCRs(
        scopeId,
        memories,
      );
      ccrIds = relatedCompressedContexts.map((c) => c.ccrId);
    }
  } catch (err) {
    // Fail-open: return empty results rather than blocking the agent
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Recall search failed open: ${message}`);
    memories = [];
    profile = { static: [], dynamic: [] };
    relatedCompressedContexts = [];
    memoryIds = [];
    ccrIds = [];
  }

  // ==========================================================================
  // 20.4 — Receipt (always generated, even for empty results)
  // ==========================================================================

  const receipt = receipts.create({
    operation: "recall",
    scopeId,
    query,
    memoryIds,
    ccrIds,
  });

  // ==========================================================================
  // Build response per PRD §11.7
  // ==========================================================================

  const response: Record<string, unknown> = {
    scopeId,
    profile: {
      static: profile.static.map((f) => ({
        id: f.id,
        content: f.content,
        sourceMemoryId: f.sourceMemoryId,
        sourceRef: f.sourceRef,
        confidence: f.confidence,
        updatedAt: f.updatedAt,
      })),
      dynamic: profile.dynamic.map((f) => ({
        id: f.id,
        content: f.content,
        sourceMemoryId: f.sourceMemoryId,
        sourceRef: f.sourceRef,
        confidence: f.confidence,
        updatedAt: f.updatedAt,
      })),
    },
    memories: memories.map((m) => ({
      id: m.id,
      type: m.type,
      content: m.content,
      summary: m.summary,
      sourceRef: m.sourceRef,
      confidence: m.confidence,
      status: m.status,
      score: m.score,
      canExpand: m.canExpand,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      tags: m.tags,
    })),
    relatedCompressedContexts,
    receiptId: receipt.id,
  };

  if (warnings.length > 0) {
    response.warnings = warnings;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
