/**
 * MCP Adapter
 *
 * Provides a programmatic interface for calling MCP tools directly
 * (bypassing the stdio transport). Used by the MCP tools smoke flow
 * to invoke each tool handler and capture results.
 *
 * The real adapter uses an in-memory sql.js database + ReceiptService
 * to construct a ServerContext, then delegates to the shared
 * createToolHandlers() registry from src/mcp/toolRegistry.ts.
 *
 * PRD §34: MCP tools 验收适配器。
 */

import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { ReceiptService } from "../../receipts/receiptService.js";
import type { ServerContext } from "../../mcp/server.js";
import { createToolHandlers, ALL_TOOL_NAMES } from "../../mcp/toolRegistry.js";
import { registerAllFlows } from "../../harness/register.js";
import { clearRegistry, listModules } from "../../harness/core/registry.js";
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

// ── Schema Loading ────────────────────────────────────────────────────────────

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

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a real MCP adapter backed by in-memory SQLite.
 *
 * Supports ALL 18 registered MCP tools via the shared createToolHandlers()
 * registry. On first call, initializes an in-memory database, seeds a scope
 * row, and registers harness flows. The adapter never throws — all errors
 * are returned as McpCallResult with isError: true.
 */
export function createMcpAdapter(): McpAdapter {
  let _db: Database | null = null;
  let _handlers: Record<string, ReturnType<typeof createToolHandlers>[string]> | null = null;
  let _flowsRegistered = false;

  async function ensureDb(): Promise<Database> {
    if (!_db) {
      _db = await createInMemoryDb();
    }
    return _db;
  }

  async function ensureHandlers(): Promise<NonNullable<typeof _handlers>> {
    if (!_handlers) {
      const db = await ensureDb();
      const ctx: ServerContext = { db, receipts: new ReceiptService(db) };
      ensureFlowsRegistered();
      _handlers = createToolHandlers(ctx);
    }
    return _handlers;
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
    try {
      const handlers = await ensureHandlers();
      const handler = handlers[toolName];

      if (!handler) {
        return {
          toolName,
          content: [
            {
              type: "text",
              text: `Error: Unknown tool "${toolName}". Available tools: [${ALL_TOOL_NAMES.join(", ")}]`,
            },
          ],
          isError: true,
        };
      }

      const result = await handler(args);
      return {
        toolName,
        content: result.content,
        isError: result.isError ?? false,
      };
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
