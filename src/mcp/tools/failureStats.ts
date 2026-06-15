/**
 * MCP Tool: failure_stats — Failure Learning §33.5
 *
 * Return aggregate failure event statistics for a scope.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { FailureStore } from "../../failure/failureStore.js";
import { resolveScope, toScopeRecord } from "../../scope/resolveScope.js";
import { runStmt } from "../../storage/db.js";

export async function handleFailureStats(
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

  const stats = failureStore.stats(scopeId);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(stats, null, 2),
      },
    ],
  };
}
