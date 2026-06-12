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
    remember_context: (args) => handleRememberContext(ctx, args),
    recall_context: (args) => handleRecallContext(ctx, args),
    forget_context: (args) => handleForgetContext(ctx, args),
    list_context: (args) => handleListContext(ctx, args),
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
      {
        name: "remember_context",
        description:
          "Save structured project memory. " +
          "Creates a typed memory record scoped to the current repository, " +
          "optionally writing to the project profile (static for long-term " +
          "facts, dynamic for transient context). " +
          "Every remember operation generates an audit receipt. " +
          "Valid types: decision, bug, command, file_summary, project_rule, " +
          "user_preference, current_task, test_failure, api_contract, dependency.",
        inputSchema: {
          type: "object",
          properties: {
            scopeId: {
              type: "string",
              description:
                "The scopeId from current_scope. " +
                "When omitted, the scope is auto-resolved from the current directory.",
            },
            type: {
              type: "string",
              description:
                "Memory type (required). " +
                "Valid values: decision, bug, command, file_summary, " +
                "project_rule, user_preference, current_task, test_failure, " +
                "api_contract, dependency.",
            },
            content: {
              type: "string",
              description:
                "The full memory content (required). " +
                "This is the primary text that will be indexed for retrieval.",
            },
            summary: {
              type: "string",
              description:
                "Optional short summary. " +
                "When profileTarget is set, the summary is used as the profile fact content (falls back to content).",
            },
            sourceRef: {
              type: "string",
              description:
                "Optional reference to the source of this memory (e.g. 'user:manual', 'docs/setup.md', 'agent:observed').",
            },
            confidence: {
              type: "number",
              description:
                "Confidence score between 0 and 1 (default 0.8). " +
                "Higher values indicate more reliable/verified memories.",
            },
            profileTarget: {
              type: "string",
              description:
                "Which profile layer to write to. " +
                "'static' for long-term facts (tech stack, rules, decisions). " +
                "'dynamic' for transient context (current task, recent failures). " +
                "When omitted, no profile fact is created.",
            },
            expiresAt: {
              type: "string",
              description:
                "Optional ISO 8601 expiration date. " +
                "After this date the memory may be auto-expired.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional tags for categorization and filtering.",
            },
          },
          required: ["type", "content"],
        },
      },
      {
        name: "recall_context",
        description:
          "Recall project profile, relevant memories, and compressed context " +
          "references for a given query. " +
          "Searches memories using BM25 full-text search with confidence " +
          "merging and recency weighting. Returns matched memories with " +
          "relevance scores, merged profile facts (static rules + dynamic " +
          "context), and related compressed contexts from prior " +
          "compress_context operations. " +
          "Always generates an audit receipt — even when no results are found.",
        inputSchema: {
          type: "object",
          properties: {
            scopeId: {
              type: "string",
              description:
                "The scopeId from current_scope. " +
                "When omitted, the scope is auto-resolved from the current directory.",
            },
            query: {
              type: "string",
              description:
                "The search query (required). " +
                "Searches memory content, summary, and sourceRef fields.",
            },
            types: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional filter by memory types. " +
                "Valid values: decision, bug, command, file_summary, " +
                "project_rule, user_preference, current_task, test_failure, " +
                "api_contract, dependency.",
            },
            status: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional filter by memory status. " +
                "Defaults to ['active']. " +
                "Valid values: active, superseded, forgotten, expired.",
            },
            includeInactive: {
              type: "boolean",
              description:
                "When true, recall includes inactive memories " +
                "(superseded, forgotten, expired) in addition to active ones. " +
                "Equivalent to setting status to all four values. " +
                "Ignored when an explicit status filter is provided. " +
                "Default: false.",
            },
            limit: {
              type: "number",
              description:
                "Maximum number of memories to return (1-50, default 10).",
            },
            includeProfile: {
              type: "boolean",
              description:
                "Whether to include the repo profile in the result. " +
                "Default: true. When false, both static and dynamic " +
                "profiles are excluded.",
            },
            includeStatic: {
              type: "boolean",
              description:
                "Whether to include static profile facts " +
                "(project_rule, decision, dependency, api_contract). " +
                "Default: same as includeProfile.",
            },
            includeDynamic: {
              type: "boolean",
              description:
                "Whether to include dynamic profile context " +
                "(current_task, test_failure, bug, command). " +
                "Default: same as includeProfile.",
            },
            includeCompressedRefs: {
              type: "boolean",
              description:
                "Whether to include related compressed context references " +
                "from prior compress_context operations. " +
                "Matches CCRs by sourceRef. Default: true.",
            },
            retrieveOriginal: {
              type: "boolean",
              description:
                "Whether to automatically retrieve original content for " +
                "matched compressed contexts. Default: false. " +
                "NOTE: inline retrieval is planned for a future version — " +
                "setting this to true currently produces a warning.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "forget_context",
        description:
          "Forget, supersede, or expire a project memory to prevent stale " +
          "information from polluting future recall results. " +
          "Supports soft_forget (marks as forgotten), supersede (marks as " +
          "superseded by a newer memory), expire (marks as expired), and " +
          "hard_delete (permanently removes the record). " +
          "Every forget operation generates an audit receipt. " +
          "Forgotten/superseded/expired memories are excluded from recall " +
          "by default.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "The memory id to forget (required). " +
                "Obtained from remember_context or list_context outputs.",
            },
            mode: {
              type: "string",
              description:
                "Forget mode (required). " +
                "Valid values: soft_forget, supersede, expire, hard_delete. " +
                "soft_forget: marks the memory as forgotten. " +
                "supersede: marks as superseded (requires supersededBy). " +
                "expire: marks as expired. " +
                "hard_delete: permanently deletes the memory record.",
            },
            reason: {
              type: "string",
              description:
                "Optional reason for forgetting. " +
                "Stored in the forget receipt for auditability. " +
                "Max 2000 characters.",
            },
            supersededBy: {
              type: "string",
              description:
                "Required when mode is 'supersede'. " +
                "The id of the memory that replaces this one. " +
                "The replacement memory will show this memory in its " +
                "supersedes list.",
            },
            scopeId: {
              type: "string",
              description:
                "The scopeId from current_scope. " +
                "When omitted, the scope is auto-resolved from the current directory.",
            },
          },
          required: ["id", "mode"],
        },
      },
      {
        name: "list_context",
        description:
          "List project memories with filtering, sorting, and pagination. " +
          "Supports filtering by memory types and statuses for audit " +
          "purposes — view active, superseded, forgotten, or expired " +
          "memories separately or together. " +
          "Returns paginated results with memory id, type, summary, " +
          "status, sourceRef, confidence, and timestamps. " +
          "Always generates an audit receipt.",
        inputSchema: {
          type: "object",
          properties: {
            scopeId: {
              type: "string",
              description:
                "The scopeId from current_scope (required). " +
                "Used for scope isolation — only memories within this scope are returned.",
            },
            types: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional filter by memory types. " +
                "Valid values: decision, bug, command, file_summary, " +
                "project_rule, user_preference, current_task, test_failure, " +
                "api_contract, dependency. " +
                "When omitted, all types are returned.",
            },
            status: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional filter by memory status. " +
                "Valid values: active, superseded, forgotten, expired. " +
                "When omitted, all statuses are returned (useful for auditing).",
            },
            limit: {
              type: "number",
              description:
                "Maximum number of records to return (1-100, default 50).",
            },
            offset: {
              type: "number",
              description:
                "Number of records to skip for pagination (default 0).",
            },
            sortBy: {
              type: "string",
              description:
                "Field to sort by. Valid values: createdAt, updatedAt, " +
                "type, status, confidence. Default: createdAt.",
            },
            sortOrder: {
              type: "string",
              description:
                "Sort order: asc or desc. Default: desc (most recent first).",
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
