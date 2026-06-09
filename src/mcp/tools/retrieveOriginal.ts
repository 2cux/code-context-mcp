/**
 * MCP Tool: retrieve_original
 *
 * Retrieve original (uncompressed) content by originalRef.
 * Supports offset/limit pagination for large originals.
 * Scope-isolated: only returns content belonging to the given scopeId.
 *
 * PRD §11.3 — retrieve_original
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { OriginalStore } from "../../originals/originalStore.js";
import { contentHash } from "../../utils/hash.js";

export async function handleRetrieveOriginal(
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

  // ---- Parse offset / limit ----
  const offset = typeof args.offset === "number" && Number.isFinite(args.offset)
    ? Math.max(0, Math.trunc(args.offset))
    : 0;
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit)
    ? Math.max(0, Math.trunc(args.limit))
    : 10000;

  // ---- Retrieve ----
  const store = new OriginalStore(ctx.db);
  const result = store.retrieve(originalRef, scopeId, { offset, limit });

  if (!result) {
    // Generate receipt even for not-found (auditability)
    const inputHash = contentHash(`${scopeId}:${originalRef}`);
    ctx.receipts.create({
      operation: "retrieve_original",
      scopeId,
      inputHash,
      originalRefs: [originalRef],
      failed: true,
      errorReason: "original_not_found",
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            scopeId,
            originalRef,
            found: false,
            error: "original_not_found",
            hint: "The original may have been deleted, expired, or belongs to a different scope.",
          }),
        },
      ],
      isError: true,
    };
  }

  // ---- Receipt ----
  const receipt = ctx.receipts.create({
    operation: "retrieve_original",
    scopeId,
    inputHash: contentHash(`${scopeId}:${originalRef}`),
    originalRefs: [originalRef],
    retrievedOriginal: true,
  });

  // ---- Build response (PRD §11.3 output format) ----
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            scopeId: result.scopeId,
            originalRef: result.originalRef,
            contentType: result.contentType,
            content: result.content,
            tokens: result.tokens,
            ...(result.totalChars > result.returnedChars
              ? {
                  offset: result.offset,
                  returnedChars: result.returnedChars,
                  totalChars: result.totalChars,
                  hasMore: result.hasMore,
                }
              : {}),
            metadata: result.metadata,
            createdAt: result.createdAt,
            receiptId: receipt.id,
          },
          null,
          2,
        ),
      },
    ],
  };
}
