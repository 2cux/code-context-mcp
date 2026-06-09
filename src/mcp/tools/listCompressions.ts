/**
 * MCP Tool: list_compressions
 *
 * Lists compressed context records for a project scope.
 * Supports optional contentType filtering and offset-based pagination.
 *
 * PRD §11.5 — list_compressions
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { CompressedStore, type ContentType } from "../../compressed/compressedStore.js";

/** Content types recognized by the API (subset that makes sense to filter by). */
const VALID_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "test_output",
  "log",
  "command_output",
  "code",
  "json",
  "markdown",
  "plain_text",
  "rag_chunk",
  "file_summary",
  "conversation_history",
  "unknown",
]);

export async function handleListCompressions(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  // --- scopeId (required) ---
  const scopeId = args["scopeId"] as string | undefined;
  if (!scopeId || typeof scopeId !== "string" || !scopeId.trim()) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Missing required parameter: scopeId",
            hint: 'Use current_scope to obtain the scopeId, or pass it explicitly: { "scopeId": "repo_xxxxxxxx" }',
          }),
        },
      ],
      isError: true,
    };
  }

  // --- contentType (optional, validated) ---
  let contentType: ContentType | undefined;
  const rawType = args["contentType"] as string | undefined;
  if (rawType !== undefined) {
    if (typeof rawType !== "string" || !VALID_CONTENT_TYPES.has(rawType)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Invalid contentType: "${rawType}"`,
              validTypes: Array.from(VALID_CONTENT_TYPES),
            }),
          },
        ],
        isError: true,
      };
    }
    contentType = rawType as ContentType;
  }

  // --- limit / offset (optional, clamped) ---
  let limit = 20;
  let offset = 0;

  if (args["limit"] !== undefined) {
    const raw = Number(args["limit"]);
    if (!Number.isNaN(raw) && Number.isFinite(raw)) {
      limit = Math.max(1, Math.min(Math.trunc(raw), 100)); // clamp to [1, 100]
    }
  }

  if (args["offset"] !== undefined) {
    const raw = Number(args["offset"]);
    if (!Number.isNaN(raw) && Number.isFinite(raw)) {
      offset = Math.max(0, Math.trunc(raw));
    }
  }

  // --- Query ---
  const store = new CompressedStore(ctx.db);
  const result = store.list({ scopeId, contentType, limit, offset });

  // --- Audit receipt ---
  ctx.receipts.create({
    operation: "list",
    scopeId,
    resultIds: result.items.map((item) => item.ccrId),
    query: contentType ? `contentType:${contentType}` : undefined,
  });

  // --- Compute aggregate statistics ---
  const stats = computeStats(result.items);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            scopeId: result.scopeId,
            items: result.items,
            total: result.total,
            limit: result.limit,
            offset: result.offset,
            stats,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ListStats {
  totalItems: number;
  failedCount: number;
  successCount: number;
  totalTokensSaved: number;
  totalTokensBefore: number;
  totalTokensAfter: number;
  averageCompressionRatio: number;
}

function computeStats(items: { tokensSaved: number; tokensBefore: number; tokensAfter: number; failed: boolean }[]): ListStats {
  const totalItems = items.length;
  let failedCount = 0;
  let totalTokensSaved = 0;
  let totalTokensBefore = 0;
  let totalTokensAfter = 0;

  for (const item of items) {
    if (item.failed) failedCount++;
    totalTokensSaved += item.tokensSaved;
    totalTokensBefore += item.tokensBefore;
    totalTokensAfter += item.tokensAfter;
  }

  const averageCompressionRatio =
    totalItems > 0
      ? items.reduce((sum, i) => {
          const ratio =
            i.tokensBefore > 0
              ? i.tokensSaved / i.tokensBefore
              : 0;
          return sum + ratio;
        }, 0) / totalItems
      : 0;

  return {
    totalItems,
    failedCount,
    successCount: totalItems - failedCount,
    totalTokensSaved,
    totalTokensBefore,
    totalTokensAfter,
    averageCompressionRatio: Math.round(averageCompressionRatio * 10000) / 10000,
  };
}
