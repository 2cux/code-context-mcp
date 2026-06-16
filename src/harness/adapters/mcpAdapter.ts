/**
 * MCP Adapter
 *
 * Provides a programmatic interface for calling MCP tools directly
 * (bypassing the stdio transport). Used by the MCP tools smoke flow
 * to invoke each tool handler and capture results.
 *
 * The real adapter uses in-memory sql.js + ReceiptService for handlers
 * that need ServerContext (run_harness_flow, get_harness_run).
 * Handlers that don't need ServerContext (list_harness_flows, check_harness_flow)
 * are called directly.
 *
 * PRD §34: MCP tools 验收适配器。
 */

import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { ReceiptService } from "../../receipts/receiptService.js";
import type { ServerContext } from "../../mcp/server.js";
import { registerAllFlows } from "../../harness/register.js";
import {
  clearRegistry,
  hasModule,
  listModules,
} from "../../harness/core/registry.js";
import { clearModules } from "../../harness/core/runner.js";
import { resetMockDatabase } from "../../harness/core/mockAdapters.js";
import { execRaw, runStmt } from "../../storage/db.js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nowISO } from "../../utils/time.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface McpCallResult {
  toolName: string;
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
}

export interface McpAdapter {
  /** Call a named MCP tool with the given arguments. */
  callTool(toolName: string, args: Record<string, unknown>): Promise<McpCallResult>;
}

// ── Schema Loading (for in-memory DB initialization) ─────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function findSchemaPath(): string {
  const candidates = [
    join(__dirname, "..", "..", "storage", "schema.sql"),
    join(__dirname, "..", "..", "..", "src", "storage", "schema.sql"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  const cwdCandidates = [
    join(process.cwd(), "src", "storage", "schema.sql"),
    join(process.cwd(), "dist", "storage", "schema.sql"),
  ];
  for (const p of cwdCandidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "Cannot find schema.sql for MCP adapter. " +
      "Searched: " + [...candidates, ...cwdCandidates].join(", "),
  );
}

// ── In-Memory DB Factory ─────────────────────────────────────────────────────

async function createInMemoryDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Run schema
  try {
    const schemaPath = findSchemaPath();
    const schemaSql = readFileSync(schemaPath, "utf-8");
    execRaw(db, schemaSql);
    db.run("PRAGMA foreign_keys = ON");
  } catch (err) {
    console.warn(
      `[mcpAdapter] Schema loading failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Ensure harness scope exists
  try {
    runStmt(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES ('harness', '/harness', 'cwdFallback', ?, ?)`,
      [nowISO(), nowISO()],
    );
  } catch {
    // Best-effort
  }

  return db;
}

// ── Tool Registry ────────────────────────────────────────────────────────────

/** Set of MCP tools that require ServerContext (db + receipts). */
const CTX_TOOLS = new Set(["run_harness_flow", "get_harness_run"]);

/** Set of harness-specific MCP tools supported by this adapter. */
const HARNESS_TOOLS = new Set([
  "list_harness_flows",
  "run_harness_flow",
  "get_harness_run",
  "check_harness_flow",
]);

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a real MCP adapter backed by in-memory SQLite.
 *
 * Supports the 4 harness MCP tools:
 *   - list_harness_flows  (no ServerContext needed)
 *   - check_harness_flow  (no ServerContext needed)
 *   - run_harness_flow    (needs ServerContext with db + receipts)
 *   - get_harness_run     (needs ServerContext with db + receipts)
 *
 * For any unsupported tool, returns an error result (never throws).
 */
export function createMcpAdapter(): McpAdapter {
  let _db: Database | null = null;
  let _ctx: ServerContext | null = null;
  let _flowsRegistered = false;

  async function ensureDb(): Promise<Database> {
    if (!_db) {
      _db = await createInMemoryDb();
    }
    return _db;
  }

  async function ensureContext(): Promise<ServerContext> {
    if (!_ctx) {
      const db = await ensureDb();
      _ctx = {
        db,
        receipts: new ReceiptService(db),
      };
    }
    return _ctx;
  }

  function ensureFlowsRegistered(): void {
    if (_flowsRegistered) return;
    try {
      if (listModules().length === 0) {
        registerAllFlows();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already registered")) {
        // Clear and re-register if we hit duplicates
        clearRegistry();
        registerAllFlows();
      } else {
        throw err;
      }
    }
    _flowsRegistered = true;
  }

  async function callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    // Ensure flows are registered for harness tools
    if (HARNESS_TOOLS.has(toolName)) {
      try {
        ensureFlowsRegistered();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          toolName,
          content: [{ type: "text", text: `Error: Failed to register flows — ${msg}` }],
          isError: true,
        };
      }
    }

    try {
      switch (toolName) {
        case "list_harness_flows": {
          // Dynamic import to avoid circular deps at module load time
          const { handleListHarnessFlows } = await import(
            "../../mcp/tools/listHarnessFlows.js"
          );
          const result = await handleListHarnessFlows(args);
          return {
            toolName,
            content: result.content,
            isError: result.isError ?? false,
          };
        }

        case "check_harness_flow": {
          const { handleCheckHarnessFlow } = await import(
            "../../mcp/tools/checkHarnessFlow.js"
          );
          const result = await handleCheckHarnessFlow(args);
          return {
            toolName,
            content: result.content,
            isError: result.isError ?? false,
          };
        }

        case "run_harness_flow": {
          const ctx = await ensureContext();
          const { handleRunHarnessFlow } = await import(
            "../../mcp/tools/runHarnessFlow.js"
          );
          const result = await handleRunHarnessFlow(ctx, args);
          return {
            toolName,
            content: result.content,
            isError: result.isError ?? false,
          };
        }

        case "get_harness_run": {
          const ctx = await ensureContext();
          const { handleGetHarnessRun } = await import(
            "../../mcp/tools/getHarnessRun.js"
          );
          const result = await handleGetHarnessRun(ctx, args);
          return {
            toolName,
            content: result.content,
            isError: result.isError ?? false,
          };
        }

        default:
          return {
            toolName,
            content: [
              {
                type: "text",
                text: `Error: Tool "${toolName}" is not supported by the harness MCP adapter. Supported tools: [${[...HARNESS_TOOLS].join(", ")}]`,
              },
            ],
            isError: true,
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      return {
        toolName,
        content: [
          {
            type: "text",
            text: `Error calling ${toolName}: ${msg}${stack ? `\n${stack}` : ""}`,
          },
        ],
        isError: true,
      };
    }
  }

  return { callTool };
}
