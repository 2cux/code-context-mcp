/**
 * MCP Tool: list_failures — Failure Learning §33.5
 *
 * List failure events with optional filtering by eventType and operation.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { FailureStore } from "../../failure/failureStore.js";
import type { FailureEventType, FailureOperation } from "../../failure/failureStore.js";
import { resolveScope, toScopeRecord } from "../../scope/resolveScope.js";
import { runStmt } from "../../storage/db.js";

const VALID_EVENT_TYPES = new Set([
  "compression_timeout", "compression_error",
  "oversized_input", "poor_compression_ratio",
  "recall_no_hit", "recall_low_confidence",
  "recall_wrong_memory", "high_retrieve_count",
]);

const VALID_OPERATIONS = new Set([
  "compress", "recall", "retrieve_original",
]);

export async function handleListFailures(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const { db } = ctx;
  const failureStore = new FailureStore(db);

  // Auto-resolve scope
  let scopeId = typeof args.scopeId === "string" ? args.scopeId.trim() : "";
  if (!scopeId) {
    const scope = resolveScope();
    scopeId = scope.scopeId;
    try {
      const record = toScopeRecord(scope);
      runStmt(
        db,
        `INSERT OR IGNORE INTO scopes (scope_id, git_root, remote, branch, cwd, scope_strategy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.scope_id, record.git_root, record.remote, record.branch,
          record.cwd, record.scope_strategy, record.created_at, record.updated_at,
        ],
      );
    } catch {
      // Best-effort
    }
  }

  // Validate eventType
  let eventType: FailureEventType | undefined;
  if (typeof args.eventType === "string" && args.eventType.trim()) {
    const raw = args.eventType.trim();
    if (!VALID_EVENT_TYPES.has(raw)) {
      return {
        content: [{ type: "text", text: `Error: Invalid eventType "${raw}". Valid values: ${Array.from(VALID_EVENT_TYPES).join(", ")}` }],
        isError: true,
      };
    }
    eventType = raw as FailureEventType;
  }

  // Validate operation
  let operation: FailureOperation | undefined;
  if (typeof args.operation === "string" && args.operation.trim()) {
    const raw = args.operation.trim();
    if (!VALID_OPERATIONS.has(raw)) {
      return {
        content: [{ type: "text", text: `Error: Invalid operation "${raw}". Valid values: ${Array.from(VALID_OPERATIONS).join(", ")}` }],
        isError: true,
      };
    }
    operation = raw as FailureOperation;
  }

  const limit = typeof args.limit === "number" && Number.isFinite(args.limit)
    ? Math.max(1, Math.min(Math.trunc(args.limit), 100))
    : 20;
  const offset = typeof args.offset === "number" && Number.isFinite(args.offset)
    ? Math.max(0, Math.trunc(args.offset))
    : 0;

  const result = failureStore.list({ scopeId, eventType, operation, limit, offset });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          scopeId: result.scopeId,
          items: result.items.map((e) => ({
            id: e.id,
            operation: e.operation,
            eventType: e.eventType,
            contentType: e.contentType,
            strategy: e.strategy,
            ccrId: e.ccrId,
            memoryId: e.memoryId,
            errorReason: e.errorReason,
            metadata: e.metadata,
            createdAt: e.createdAt,
          })),
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        }, null, 2),
      },
    ],
  };
}
