/**
 * MCP Tool: cleanup_originals
 *
 * Remove all expired original content records for a project scope.
 * For each affected CCR that no longer has any originals, sets
 * canRetrieveOriginal = 0.
 *
 * PRD Phase 3 / §19.3 — cleanup_originals
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { OriginalStore } from "../../originals/originalStore.js";
import { contentHash } from "../../utils/hash.js";

export async function handleCleanupOriginals(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  // ---- Validate scopeId ----
  const scopeId = typeof args.scopeId === "string" ? args.scopeId.trim() : "";
  if (!scopeId) {
    return {
      content: [{ type: "text", text: "Error: scopeId is required." }],
      isError: true,
    };
  }

  // ---- Cleanup ----
  const store = new OriginalStore(ctx.db);
  const result = store.cleanup(scopeId);

  // ---- Receipt ----
  const receipt = ctx.receipts.create({
    operation: "cleanup_originals",
    scopeId,
    inputHash: contentHash(`cleanup:${scopeId}:${Date.now()}`),
    ccrIds: result.affectedCcrIds,
    failed: false,
  });

  // ---- Response ----
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            scopeId,
            deleted: result.deleted,
            affectedCcrIds: result.affectedCcrIds,
            message:
              result.deleted === 0
                ? "No expired originals to clean up."
                : `Deleted ${result.deleted} expired original(s). ${result.affectedCcrIds.length} CCR(s) affected.`,
            receiptId: receipt.id,
          },
          null,
          2,
        ),
      },
    ],
  };
}
