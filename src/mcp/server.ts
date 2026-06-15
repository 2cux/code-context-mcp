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
import { handleCompressContext } from "./tools/compressContext.js";
import { handleListCompressions } from "./tools/listCompressions.js";
import { handleRetrieveOriginal } from "./tools/retrieveOriginal.js";
import { handleDeleteOriginal } from "./tools/deleteOriginal.js";
import { handleCleanupOriginals } from "./tools/cleanupOriginals.js";
import { handleRememberContext } from "./tools/rememberContext.js";
import { handleRecallContext } from "./tools/recallContext.js";
import { handleForgetContext } from "./tools/forgetContext.js";
import { handleListContext } from "./tools/listContext.js";
import { handleAnalyzeContext } from "./tools/analyzeContext.js";
import { handleListFailures } from "./tools/listFailures.js";
import { handleFailureStats } from "./tools/failureStats.js";
import { TOOL_DEFINITIONS } from "./toolSchemas.js";

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
      version: "1.0.0",
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
    compress_context: (args) => handleCompressContext(ctx, args),
    retrieve_original: (args) => handleRetrieveOriginal(ctx, args),
    delete_original: (args) => handleDeleteOriginal(ctx, args),
    cleanup_originals: (args) => handleCleanupOriginals(ctx, args),
    list_compressions: (args) => handleListCompressions(ctx, args),
    remember_context: (args) => handleRememberContext(ctx, args),
    recall_context: (args) => handleRecallContext(ctx, args),
    forget_context: (args) => handleForgetContext(ctx, args),
    list_context: (args) => handleListContext(ctx, args),
    analyze_context: (args) => handleAnalyzeContext(ctx, args),
    list_failures: (args) => handleListFailures(ctx, args),
    failure_stats: (args) => handleFailureStats(ctx, args),
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
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
