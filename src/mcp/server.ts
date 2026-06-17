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
import { TOOL_DEFINITIONS } from "./toolSchemas.js";
import { createToolHandlers } from "./toolRegistry.js";
import { resolveToolMode, isToolAllowed, describeMode } from "./toolMode.js";
import { registerAllFlows } from "../harness/register.js";

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

  // Register all harness flows so MCP tools can discover and run them
  registerAllFlows();

  const ctx: ServerContext = { db, receipts };

  // Resolve tool surface mode (env MCP_TOOL_MODE, default "agent")
  const mode = resolveToolMode();
  const modeDescription = describeMode(mode);

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

  const tools = createToolHandlers(ctx);

  // Filter tool definitions to only expose mode-appropriate tools
  const visibleDefinitions = TOOL_DEFINITIONS.filter((t) => isToolAllowed(t.name, mode));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visibleDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Block calls to tools not allowed in the current mode
    if (!isToolAllowed(name, mode)) {
      return {
        content: [
          {
            type: "text",
            text: `Tool "${name}" is not available in ${modeDescription}`,
          },
        ],
        isError: true,
      };
    }

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
