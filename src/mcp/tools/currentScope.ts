import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { resolveScope, toScopeRecord } from "../../scope/resolveScope.js";
import { runStmt } from "../../storage/db.js";

function validateCwd(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  // Reject empty, relative, or path-traversal patterns
  if (!raw.trim() || !raw.startsWith("/") && !/^[A-Z]:\\/i.test(raw)) {
    return undefined; // fall back to process.cwd(), don't fail
  }
  if (raw.includes("..")) {
    return undefined; // silently reject traversal
  }
  return raw;
}

export async function handleCurrentScope(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const cwd = validateCwd(args["cwd"]);
  const scope = resolveScope(cwd);
  const record = toScopeRecord(scope);

  // Upsert scope
  runStmt(
    ctx.db,
    `INSERT INTO scopes (scope_id, git_root, remote, branch, cwd, scope_strategy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope_id) DO UPDATE SET
       git_root   = excluded.git_root,
       remote     = excluded.remote,
       branch     = excluded.branch,
       cwd        = excluded.cwd,
       updated_at = excluded.updated_at`,
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

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            scopeId: scope.scopeId,
            gitRoot: scope.gitRoot,
            remote: scope.remote,
            branch: scope.branch,
            scopeStrategy: scope.scopeStrategy,
          },
          null,
          2,
        ),
      },
    ],
  };
}
