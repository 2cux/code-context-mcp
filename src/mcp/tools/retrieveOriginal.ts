/**
 * MCP Tool: retrieve_original — PRD §13
 *
 * Retrieve original (uncompressed) content by originalRef.
 * Supports offset/limit pagination for large originals.
 * Scope-isolated: only returns content belonging to the given scopeId.
 *
 * §13.1 Tool Input Processing:
 *   - Validate originalRef
 *   - Auto-resolve scope when scopeId is not provided
 *   - Validate scopeId
 *   - Support offset / limit
 *
 * §13.2 Tool Output Processing:
 *   - Return original content
 *   - Return metadata
 *   - Return contentType
 *   - Return tokens
 *   - Increment retrieveCount (done in OriginalStore)
 *   - Create retrieve receipt
 *
 * §13.3 Tool Exception Handling:
 *   - original_not_found  — no original exists with this ref
 *   - scope_mismatch      — original exists but belongs to a different scope
 *   - original_deleted    — original was explicitly deleted via delete_original
 *   - storage_error       — database error during retrieval
 *
 * §13.4 Integration Tests: see tests/phase3-acceptance.test.ts
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { OriginalStore } from "../../originals/originalStore.js";
import { contentHash } from "../../utils/hash.js";
import { resolveScope, toScopeRecord } from "../../scope/resolveScope.js";
import { runStmt } from "../../storage/db.js";

// ---------------------------------------------------------------------------
// Error types — discriminated so callers can programmatically handle failures
// ---------------------------------------------------------------------------

type RetrieveError =
  | "original_not_found"
  | "scope_mismatch"
  | "original_deleted"
  | "storage_error";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a standardized error response for retrieve_original failures.
 * Every error path still generates a receipt for auditability.
 */
function errorResponse(
  scopeId: string,
  originalRef: string,
  error: RetrieveError,
  receiptId: string,
  extra?: Record<string, unknown>,
): CallToolResult {
  const hints: Record<RetrieveError, string> = {
    original_not_found:
      "The originalRef does not match any saved original. " +
      "It may never have been saved, or the ref is mistyped.",
    scope_mismatch:
      "The original exists but belongs to a different project scope. " +
      "Use the correct scopeId to retrieve it.",
    original_deleted:
      "The original content for this ref is no longer available. " +
      "It may have been explicitly deleted via delete_original, expired, " +
      "or was never saved (keepOriginal=false). " +
      "The compressed version may still be available via the CCR.",
    storage_error:
      "A database error occurred while retrieving the original. " +
      "The storage may be corrupted or temporarily unavailable.",
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          scopeId,
          originalRef,
          found: false,
          error,
          hint: hints[error],
          receiptId,
          ...extra,
        }),
      },
    ],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleRetrieveOriginal(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const { db, receipts } = ctx;
  const store = new OriginalStore(db);

  // ------------------------------------------------------------------
  // §13.1.1: Auto-resolve scope when scopeId is not provided
  // ------------------------------------------------------------------
  let scopeId = typeof args.scopeId === "string" ? args.scopeId.trim() : "";
  let scopeAutoResolved = false;
  if (!scopeId) {
    const scope = resolveScope();
    scopeId = scope.scopeId;
    scopeAutoResolved = true;
    // Persist the auto-resolved scope record (non-blocking)
    try {
      const record = toScopeRecord(scope);
      runStmt(
        db,
        `INSERT OR IGNORE INTO scopes (scope_id, git_root, remote, branch, cwd, scope_strategy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.scope_id,
          record.git_root,
          record.remote,
          record.branch,
          record.cwd,
          record.scope_strategy,
          record.created_at,
          record.updated_at,
        ],
      );
    } catch {
      // Scope persistence is best-effort — never blocks retrieval
    }
  }

  // ------------------------------------------------------------------
  // §13.1.1: Validate originalRef
  // ------------------------------------------------------------------
  const originalRef = typeof args.originalRef === "string"
    ? args.originalRef.trim()
    : "";
  if (!originalRef) {
    // Even for missing originalRef, create a receipt
    const receipt = receipts.create({
      operation: "retrieve_original",
      scopeId,
      inputHash: contentHash(`${scopeId}:<empty>`),
      originalRefs: [],
      failed: true,
      errorReason: "original_not_found",
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            scopeId,
            originalRef: "",
            found: false,
            error: "original_not_found",
            hint: "originalRef is required.",
            receiptId: receipt.id,
          }),
        },
      ],
      isError: true,
    };
  }

  // ------------------------------------------------------------------
  // §13.1.2-3: Parse offset / limit
  // ------------------------------------------------------------------
  const offset = typeof args.offset === "number" && Number.isFinite(args.offset)
    ? Math.max(0, Math.trunc(args.offset))
    : 0;
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit)
    ? Math.max(0, Math.trunc(args.limit))
    : 10000;

  // ------------------------------------------------------------------
  // §13.3: Differentiate error types before attempting retrieval
  // ------------------------------------------------------------------

  // Step 1: Does the original exist at all? (without scope check)
  let actualScopeId: string | null;
  try {
    actualScopeId = store.lookupScope(originalRef);
  } catch (dbErr) {
    // Database error during the lookup itself
    const receipt = receipts.create({
      operation: "retrieve_original",
      scopeId,
      inputHash: contentHash(`${scopeId}:${originalRef}`),
      originalRefs: [originalRef],
      failed: true,
      errorReason: "storage_error",
    });

    return errorResponse(scopeId, originalRef, "storage_error", receipt.id, {
      detail: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
  }

  if (actualScopeId === null) {
    // Step 2: Not found in original_contents — check if it was deleted
    let deletedCheck: { found: boolean; deleted?: boolean };
    try {
      deletedCheck = store.checkDeleted(originalRef);
    } catch {
      deletedCheck = { found: false };
    }

    const errorType: RetrieveError =
      deletedCheck.found && deletedCheck.deleted
        ? "original_deleted"
        : "original_not_found";

    const receipt = receipts.create({
      operation: "retrieve_original",
      scopeId,
      inputHash: contentHash(`${scopeId}:${originalRef}`),
      originalRefs: [originalRef],
      failed: true,
      errorReason: errorType,
    });

    return errorResponse(scopeId, originalRef, errorType, receipt.id);
  }

  // Step 3: Original exists but belongs to a different scope
  if (actualScopeId !== scopeId) {
    const receipt = receipts.create({
      operation: "retrieve_original",
      scopeId,
      inputHash: contentHash(`${scopeId}:${originalRef}`),
      originalRefs: [originalRef],
      failed: true,
      errorReason: "scope_mismatch",
    });

    return errorResponse(scopeId, originalRef, "scope_mismatch", receipt.id, {
      actualScopeId,
    });
  }

  // ------------------------------------------------------------------
  // §13.2: Retrieve the original content
  // ------------------------------------------------------------------
  let result;
  try {
    result = store.retrieve(originalRef, scopeId, { offset, limit });
  } catch (dbErr) {
    const receipt = receipts.create({
      operation: "retrieve_original",
      scopeId,
      inputHash: contentHash(`${scopeId}:${originalRef}`),
      originalRefs: [originalRef],
      failed: true,
      errorReason: "storage_error",
    });

    return errorResponse(scopeId, originalRef, "storage_error", receipt.id, {
      detail: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
  }

  // Defensive: store.retrieve() returned null despite our pre-checks
  // (should not happen, but handle gracefully)
  if (!result) {
    const receipt = receipts.create({
      operation: "retrieve_original",
      scopeId,
      inputHash: contentHash(`${scopeId}:${originalRef}`),
      originalRefs: [originalRef],
      failed: true,
      errorReason: "original_not_found",
    });

    return errorResponse(scopeId, originalRef, "original_not_found", receipt.id);
  }

  // ------------------------------------------------------------------
  // §13.2.6: Create retrieve receipt (success path)
  // ------------------------------------------------------------------
  const receipt = receipts.create({
    operation: "retrieve_original",
    scopeId,
    inputHash: contentHash(`${scopeId}:${originalRef}`),
    originalRefs: [originalRef],
    retrievedOriginal: true,
  });

  // ------------------------------------------------------------------
  // §13.2.1-5: Build response
  // ------------------------------------------------------------------
  const responseData: Record<string, unknown> = {
    scopeId: result.scopeId,
    originalRef: result.originalRef,
    contentType: result.contentType,
    content: result.content,
    tokens: result.tokens,
    metadata: result.metadata,
    createdAt: result.createdAt,
    receiptId: receipt.id,
  };

  // Include pagination info when the content was truncated
  if (result.totalChars > result.returnedChars) {
    responseData.offset = result.offset;
    responseData.returnedChars = result.returnedChars;
    responseData.totalChars = result.totalChars;
    responseData.hasMore = result.hasMore;
  }

  // Include auto-resolve signal
  if (scopeAutoResolved) {
    responseData.scopeAutoResolved = true;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(responseData, null, 2),
      },
    ],
  };
}
