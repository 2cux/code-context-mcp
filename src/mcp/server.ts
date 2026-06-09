import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { Database } from "sql.js";
import { initAndMigrate } from "../storage/migrations.js";
import { getDb, persistDb } from "../storage/db.js";
import { ReceiptService } from "../receipts/receiptService.js";
import { handleCurrentScope } from "./tools/currentScope.js";
import { handleListCompressions } from "./tools/listCompressions.js";

export interface ServerContext {
  db: Database;
  receipts: ReceiptService;
}

export async function startServer(): Promise<void> {
  // Initialize SQLite
  await initAndMigrate();
  const db = getDb();
  persistDb(); // Persist schema immediately after migration
  const receipts = new ReceiptService(db);

  const ctx: ServerContext = { db, receipts };

  const server = new Server(
    {
      name: "code-context-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ---------- tool handlers ----------

  const tools: Record<
    string,
    (args: Record<string, unknown>) => Promise<CallToolResult>
  > = {
    current_scope: (args) => handleCurrentScope(ctx, args),
    list_compressions: (args) => handleListCompressions(ctx, args),
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "current_scope",
        description:
          "Resolve the current project scope. " +
          "Returns a stable scopeId for the current repository " +
          "(prefers git remote + git root). " +
          "This scopeId is required by all other tools to isolate " +
          "compression, memory, and receipts per repository.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description:
                "Override the current working directory. Defaults to process.cwd().",
            },
          },
        },
      },
      {
        name: "list_compressions",
        description:
          "List compressed context records for a project scope. " +
          "Returns paginated results with summaries and aggregate statistics. " +
          "Supports optional filtering by contentType. " +
          "Use this to browse what has been compressed and review token savings.",
        inputSchema: {
          type: "object",
          properties: {
            scopeId: {
              type: "string",
              description:
                "The scopeId to list compressions for (required). " +
                "Use current_scope to obtain the current project's scopeId.",
            },
            contentType: {
              type: "string",
              description:
                "Optional filter by content type. " +
                "Valid values: test_output, log, command_output, code, json, " +
                "markdown, plain_text, rag_chunk, file_summary, " +
                "conversation_history, unknown.",
            },
            limit: {
              type: "number",
              description:
                "Maximum number of records to return (1-100, default 20).",
            },
            offset: {
              type: "number",
              description:
                "Number of records to skip for pagination (default 0).",
            },
          },
          required: ["scopeId"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = tools[name];

    if (!handler) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${name}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await handler((args ?? {}) as Record<string, unknown>);
      // Persist after mutation (current_scope writes a scope record)
      // In the future: skip for pure-read tools like get_receipt, list_context.
      persistDb();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          { type: "text", text: `Tool error (${name}): ${message}` },
        ],
        isError: true,
      };
    }
  });

  // ---------- transport ----------

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
