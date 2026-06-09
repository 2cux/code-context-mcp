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
    compress_context: (args) => handleCompressContext(ctx, args),
    retrieve_original: (args) => handleRetrieveOriginal(ctx, args),
    delete_original: (args) => handleDeleteOriginal(ctx, args),
    cleanup_originals: (args) => handleCleanupOriginals(ctx, args),
    list_compressions: (args) => handleListCompressions(ctx, args),
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "compress_context",
        description:
          "Compress long context to reduce token consumption. " +
          "Automatically detects content type, applies type-specific " +
          "compression strategies, and handles oversized inputs via " +
          "chunking. Returns compressed content with token statistics, " +
          "originalRef for later retrieval, and a receipt for audit. " +
          "On failure, returns original content (fail-open).",
        inputSchema: {
          type: "object",
          properties: {
            scopeId: {
              type: "string",
              description:
                "The scopeId from current_scope (required). " +
                "Used for scope isolation and persistence.",
            },
            content: {
              type: "string",
              description:
                "The raw content to compress (required). " +
                "Can be any size; the safety layer handles oversized inputs.",
            },
            contentType: {
              type: "string",
              description:
                "Content type hint. Defaults to 'unknown'. " +
                "Valid values: test_output, log, command_output, code, " +
                "json, markdown, plain_text, rag_chunk, file_summary, " +
                "conversation_history, unknown.",
            },
            strategy: {
              type: "string",
              description:
                "Compression strategy mode: 'conservative' (default) or 'auto'.",
            },
            keepOriginal: {
              type: "boolean",
              description:
                "Whether to save original content for later retrieval. " +
                "Default: true.",
            },
            maxTokens: {
              type: "number",
              description:
                "Target max output tokens (default 2000).",
            },
            timeoutMs: {
              type: "number",
              description:
                "Compression timeout in milliseconds (default 5000).",
            },
            maxInputBytes: {
              type: "number",
              description:
                "Maximum input size in bytes before chunking (default 1MB).",
            },
            metadata: {
              type: "object",
              description:
                "Optional metadata (source, command, filePath, etc.).",
            },
          },
          required: ["scopeId", "content"],
        },
      },
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
        name: "retrieve_original",
        description:
          "Retrieve original (uncompressed) content by originalRef. " +
          "Returns the full original content that was saved during " +
          "compress_context. Supports offset/limit for paginating " +
          "large originals. Scope-isolated — only retrieves content " +
          "belonging to the given scopeId. " +
          "Increments retrieveCount on the associated CCR and " +
          "generates a retrieval receipt.",
        inputSchema: {
          type: "object",
          properties: {
            scopeId: {
              type: "string",
              description:
                "The scopeId from current_scope (required). " +
                "Only originals within this scope can be retrieved.",
            },
            originalRef: {
              type: "string",
              description:
                "The originalRef returned by compress_context (required). " +
                "Identifies the original content to retrieve.",
            },
            offset: {
              type: "number",
              description:
                "Character offset for paginating large originals (default 0).",
            },
            limit: {
              type: "number",
              description:
                "Max characters to return (default 10000). " +
                "Use with offset for pagination.",
            },
          },
          required: ["scopeId", "originalRef"],
        },
      },
      {
        name: "delete_original",
        description:
          "Delete a single original content record by originalRef. " +
          "Updates the associated CCR to reflect that the original " +
          "is no longer retrievable. Scope-isolated — only deletes " +
          "within the given scopeId. " +
          "Use this to remove sensitive or unneeded cached originals.",
        inputSchema: {
          type: "object",
          properties: {
            scopeId: {
              type: "string",
              description:
                "The scopeId from current_scope (required).",
            },
            originalRef: {
              type: "string",
              description:
                "The originalRef to delete (required).",
            },
          },
          required: ["scopeId", "originalRef"],
        },
      },
      {
        name: "cleanup_originals",
        description:
          "Remove all expired original content records for a project scope. " +
          "For each affected CCR that no longer has any originals, " +
          "sets canRetrieveOriginal = 0. " +
          "Use this for routine maintenance to free storage and ensure " +
          "expired originals are properly cleaned up.",
        inputSchema: {
          type: "object",
          properties: {
            scopeId: {
              type: "string",
              description:
                "The scopeId from current_scope (required). " +
                "Only expired originals within this scope are cleaned up.",
            },
          },
          required: ["scopeId"],
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
