/**
 * MCP Tool: delete_original
 *
 * Delete a single original content record by originalRef.
 * Updates the associated CCR to reflect that the original is no longer
 * retrievable. Scope-isolated — only deletes within the given scopeId.
 *
 * PRD Phase 3 / §19.3 — delete_original
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { OriginalStore } from "../../originals/originalStore.js";
import { contentHash } from "../../utils/hash.js";

export async function handleDeleteOriginal(
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

  // ---- Validate originalRef ----
  const originalRef = typeof args.originalRef === "string" ? args.originalRef.trim() : "";
  if (!originalRef) {
    return {
      content: [{ type: "text", text: "Error: originalRef is required." }],
      isError: true,
    };
  }

  // ---- Delete ----
  const store = new OriginalStore(ctx.db);
  const deleted = store.delete(originalRef, scopeId);

  // ---- Receipt ----
  const receipt = ctx.receipts.create({
    operation: "delete_original",
    scopeId,
    inputHash: contentHash(`${scopeId}:${originalRef}`),
    originalRefs: [originalRef],
    failed: !deleted,
    errorReason: deleted ? undefined : "original_not_found_or_scope_mismatch",
  });

  // ---- Response ----
  if (!deleted) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            scopeId,
            originalRef,
            deleted: false,
            error: "original_not_found_or_scope_mismatch",
            hint: "The original may have already been deleted, or belongs to a different scope.",
            receiptId: receipt.id,
          }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            scopeId,
            originalRef,
            deleted: true,
            receiptId: receipt.id,
          },
          null,
          2,
        ),
      },
    ],
  };
}
