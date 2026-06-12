/**
 * list_context MCP tool handler — PRD §11.9
 *
 * Lists project memories with filtering, sorting, and pagination.
 * Supports auditing by type, status, and scope.
 *
 * Pipeline:
 *   1. Validate inputs (scopeId, types, status, limit, offset, sortBy, sortOrder).
 *   2. Delegate to MemoryService.list() which handles:
 *      - Scope isolation
 *      - Type/status filtering
 *      - Sorting
 *      - Pagination
 *   3. Return the result with an audit receipt.
 *
 * All validation errors return early with isError: true.
 * MemoryService call is wrapped in try/catch for fail-open behavior.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { MemoryService } from "../../memory/memoryService.js";
import type {
  MemoryType,
  MemoryStatus,
  ListMemorySortField,
  SortOrder,
} from "../../memory/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All valid memory types from PRD §15.4 */
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

/** All valid memory statuses from PRD §15.4 */
const VALID_MEMORY_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "superseded",
  "forgotten",
  "expired",
]);

/** Valid sort fields for list_context */
const VALID_SORT_FIELDS: ReadonlySet<string> = new Set([
  "createdAt",
  "updatedAt",
  "type",
  "status",
  "confidence",
]);

/** Valid sort orders */
const VALID_SORT_ORDERS: ReadonlySet<string> = new Set(["asc", "desc"]);

// ---------------------------------------------------------------------------
// Output item shape (PRD §11.9)
// ---------------------------------------------------------------------------

interface ListContextItem {
  id: string;
  type: string;
  summary?: string;
  status: string;
  sourceRef?: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleListContext(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const { db, receipts } = ctx;

  // ==========================================================================
  // 22.1 — Input processing
  // ==========================================================================

  // ---- Validate scopeId (required) ----
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

  // ---- Validate types (optional) ----
  let types: MemoryType[] | undefined;
  const rawTypes = args["types"] as unknown;
  if (rawTypes !== undefined) {
    if (!Array.isArray(rawTypes)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: 'Invalid "types" parameter: must be an array of strings.',
              validTypes: Array.from(VALID_MEMORY_TYPES),
            }),
          },
        ],
        isError: true,
      };
    }
    const invalidTypes = (rawTypes as string[]).filter(
      (t) => typeof t !== "string" || !VALID_MEMORY_TYPES.has(t),
    );
    if (invalidTypes.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Invalid memory type(s): ${invalidTypes.join(", ")}`,
              validTypes: Array.from(VALID_MEMORY_TYPES),
            }),
          },
        ],
        isError: true,
      };
    }
    if (rawTypes.length > 0) {
      types = rawTypes as MemoryType[];
    }
  }

  // ---- Validate status (optional) ----
  let status: MemoryStatus[] | undefined;
  const rawStatus = args["status"] as unknown;
  if (rawStatus !== undefined) {
    if (!Array.isArray(rawStatus)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: 'Invalid "status" parameter: must be an array of strings.',
              validStatuses: Array.from(VALID_MEMORY_STATUSES),
            }),
          },
        ],
        isError: true,
      };
    }
    const invalidStatuses = (rawStatus as string[]).filter(
      (s) => typeof s !== "string" || !VALID_MEMORY_STATUSES.has(s),
    );
    if (invalidStatuses.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Invalid memory status(es): ${invalidStatuses.join(", ")}`,
              validStatuses: Array.from(VALID_MEMORY_STATUSES),
            }),
          },
        ],
        isError: true,
      };
    }
    if (rawStatus.length > 0) {
      status = rawStatus as MemoryStatus[];
    }
  }

  // ---- Validate sortBy (optional) ----
  let sortBy: ListMemorySortField | undefined;
  const rawSortBy = args["sortBy"] as string | undefined;
  if (rawSortBy !== undefined) {
    if (typeof rawSortBy !== "string" || !VALID_SORT_FIELDS.has(rawSortBy)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Invalid sortBy: "${rawSortBy}"`,
              validSortBy: Array.from(VALID_SORT_FIELDS),
            }),
          },
        ],
        isError: true,
      };
    }
    sortBy = rawSortBy as ListMemorySortField;
  }

  // ---- Validate sortOrder (optional) ----
  let sortOrder: SortOrder | undefined;
  const rawSortOrder = args["sortOrder"] as string | undefined;
  if (rawSortOrder !== undefined) {
    if (typeof rawSortOrder !== "string" || !VALID_SORT_ORDERS.has(rawSortOrder)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Invalid sortOrder: "${rawSortOrder}"`,
              validSortOrder: ["asc", "desc"],
            }),
          },
        ],
        isError: true,
      };
    }
    sortOrder = rawSortOrder as SortOrder;
  }

  // ---- Validate limit / offset (optional, clamped) ----
  let limit = 50;
  let offset = 0;

  if (args["limit"] !== undefined) {
    const raw = Number(args["limit"]);
    if (!Number.isNaN(raw) && Number.isFinite(raw)) {
      limit = Math.max(1, Math.min(Math.trunc(raw), 100));
    }
  }

  if (args["offset"] !== undefined) {
    const raw = Number(args["offset"]);
    if (!Number.isNaN(raw) && Number.isFinite(raw)) {
      offset = Math.max(0, Math.trunc(raw));
    }
  }

  // ==========================================================================
  // 22.2 — Query
  // ==========================================================================

  const service = new MemoryService(db);

  try {
    const result = service.list({
      scopeId: scopeId.trim(),
      types,
      status,
      limit,
      offset,
      sortBy,
      sortOrder,
    });

    // Map items to the PRD output shape (§11.9)
    const items: ListContextItem[] = result.items.map((item) => ({
      id: item.id,
      type: item.type,
      summary: item.summary,
      status: item.status,
      sourceRef: item.sourceRef,
      confidence: item.confidence,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    // ==========================================================================
    // 22.3 — Audit receipt
    // ==========================================================================

    const queryParts: string[] = [];
    if (types && types.length > 0) {
      queryParts.push(`types:${types.join(",")}`);
    }
    if (status && status.length > 0) {
      queryParts.push(`status:${status.join(",")}`);
    }
    if (sortBy) {
      queryParts.push(`sortBy:${sortBy}`);
    }
    if (sortOrder) {
      queryParts.push(`sortOrder:${sortOrder}`);
    }

    receipts.create({
      operation: "list",
      scopeId: scopeId.trim(),
      query: queryParts.length > 0 ? queryParts.join(" ") : undefined,
      memoryIds: items.map((item) => item.id),
    });

    // Build response per PRD §11.9
    const response: Record<string, unknown> = {
      scopeId: result.scopeId,
      items,
      total: result.total,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `Error: Failed to list context — ${message}`,
        },
      ],
      isError: true,
    };
  }
}
