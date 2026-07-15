/**
 * MCP Tool Schema Definitions
 *
 * Extracted from server.ts so that both the server and tests can import
 * the schemas without needing to instantiate a full MCP server.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOL_DEFINITIONS: Tool[] = [
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
      type: "object" as const,
      properties: {
        scopeId: {
          type: "string",
          description:
            "The scopeId from current_scope. " +
            "When omitted, the scope is auto-resolved from the current directory. " +
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
          description: "Target max output tokens (default 2000).",
        },
        timeoutMs: {
          type: "number",
          description: "Compression timeout in milliseconds (default 5000).",
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
      required: ["content"],
    },
  },
  {
    name: "current_scope",
    description:
      "Resolve the current project scope. " +
      "Returns a stable scopeId for the current repository " +
      "(prefers git remote + git root). " +
      "Tools use this scopeId to isolate compression, memory, and receipts " +
      "per repository; tools that support auto-resolution may omit it.",
    inputSchema: {
      type: "object" as const,
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
      type: "object" as const,
      properties: {
        scopeId: {
          type: "string",
          description:
            "The scopeId from current_scope. " +
            "When omitted, the scope is auto-resolved from the current directory. " +
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
      required: ["originalRef"],
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
      type: "object" as const,
      properties: {
        scopeId: {
          type: "string",
          description: "The scopeId from current_scope (required).",
        },
        originalRef: {
          type: "string",
          description: "The originalRef to delete (required).",
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
      type: "object" as const,
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
      type: "object" as const,
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
          description: "Maximum number of records to return (1-100, default 20).",
        },
        offset: {
          type: "number",
          description: "Number of records to skip for pagination (default 0).",
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
      "Supports exact deduplication (same scope+type+content won't " +
      "create duplicates) and atomic supersede (replace old memory " +
      "with new in a single transaction). " +
      "Every remember operation generates an audit receipt. " +
      "Returns action: created, deduplicated, or replaced. " +
      "Valid types: decision, bug, command, file_summary, project_rule, " +
      "user_preference, current_task, test_failure, api_contract, dependency.",
    inputSchema: {
      type: "object" as const,
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
        ccrId: {
          type: "string",
          description:
            "Optional CCR ID to link this memory to a compressed context. " +
            "Auto-derives sourceRef as ccr:<ccrId>.",
        },
        originalRef: {
          type: "string",
          description:
            "Optional originalRef to link this memory to original content. " +
            "Auto-derives sourceRef as orig:<originalRef>.",
        },
        supersedesMemoryId: {
          type: "string",
          description:
            "Optional ID of an existing active memory to replace. " +
            "When provided, the operation is atomic: the new memory is created, " +
            "the old memory is marked as superseded with a link to the new one, " +
            "and a single receipt covers both actions. " +
            "If any step fails, the entire operation is rolled back. " +
            "Use this to explicitly replace outdated project knowledge.",
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
      type: "object" as const,
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
          description: "Maximum number of memories to return (1-50, default 10).",
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
      type: "object" as const,
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
    name: "analyze_context",
    description:
      "Analyze content and/or query to recommend context management actions. " +
      "Returns shouldCompress, shouldRecall, shouldSaveMemory, and " +
      "shouldRetrieveOriginal decisions with confidence scores and " +
      "human-readable reasons. Also suggests which tools to call next. " +
      "NOTE: This tool only provides SUGGESTIONS — it does not " +
      "automatically invoke compress_context, recall_context, or any " +
      "other tool. The agent decides which actions to take (§32.5).",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description:
            "The raw content to analyze for compression / memory-saving " +
            "decisions. Required for shouldCompress, shouldSaveMemory, " +
            "and shouldRetrieveOriginal analysis.",
        },
        contentType: {
          type: "string",
          description:
            "Known or expected content type. When omitted, a basic " +
            "heuristic is used. Valid values: test_output, log, " +
            "command_output, code, json, markdown, plain_text, " +
            "rag_chunk, file_summary, conversation_history, unknown.",
        },
        query: {
          type: "string",
          description:
            "The user's current query / request. Required for " +
            "shouldRecall analysis. Also used for shouldSaveMemory " +
            "to detect task/decision/bug patterns.",
        },
        source: {
          type: "string",
          description:
            "Source hint — where the content came from. " +
            "E.g. 'agent', 'user', 'command_output', 'test_runner', " +
            "'log_file'. Used to refine compression recommendations.",
        },
        metadata: {
          type: "object",
          description:
            "Optional metadata (command, filePath, etc.) for additional signals.",
        },
      },
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
      type: "object" as const,
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
          description: "Maximum number of records to return (1-100, default 50).",
        },
        offset: {
          type: "number",
          description: "Number of records to skip for pagination (default 0).",
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
  {
    name: "list_failures",
    description:
      "List failure events recorded by the Failure Learning system (§33). " +
      "Returns paginated failure events with optional filtering by eventType " +
      "(compression_timeout, compression_error, oversized_input, " +
      "poor_compression_ratio, recall_no_hit, recall_low_confidence, " +
      "recall_wrong_memory, high_retrieve_count) and operation " +
      "(compress, recall, retrieve_original). " +
      "Use this to review what's failing and adjust strategies.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scopeId: {
          type: "string",
          description:
            "The scopeId from current_scope. " +
            "When omitted, the scope is auto-resolved from the current directory.",
        },
        eventType: {
          type: "string",
          description:
            "Optional filter by event type. " +
            "Valid values: compression_timeout, compression_error, " +
            "oversized_input, poor_compression_ratio, recall_no_hit, " +
            "recall_low_confidence, recall_wrong_memory, high_retrieve_count.",
        },
        operation: {
          type: "string",
          description:
            "Optional filter by operation. " +
            "Valid values: compress, recall, retrieve_original.",
        },
        limit: {
          type: "number",
          description: "Maximum number of records to return (1-100, default 20).",
        },
        offset: {
          type: "number",
          description: "Number of records to skip for pagination (default 0).",
        },
      },
    },
  },
  {
    name: "failure_stats",
    description:
      "Show failure event statistics for a scope (§33.5). " +
      "Returns total event count, breakdowns by eventType and operation, " +
      "recent events (last 24h), and top CCRs by failure count. " +
      "Use this to identify patterns and prioritize fixes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scopeId: {
          type: "string",
          description:
            "The scopeId from current_scope. " +
            "When omitted, the scope is auto-resolved from the current directory.",
        },
      },
    },
  },
  {
    name: "list_harness_flows",
    description:
      "List all registered Harness business-flow manifests. " +
      "Returns each flow's id, name, description, phases, coveredTools, " +
      "and inputSchema. Use this to discover which flows are available " +
      "before running or checking a specific flow. " +
      "Optionally filter by tag or capability.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tag: {
          type: "string",
          description:
            "Optional filter by tag (e.g. 'smoke', 'acceptance', 'mcp', 'cli'). " +
            "When omitted, all flows are returned.",
        },
        capability: {
          type: "string",
          description:
            "Optional filter by capability category (e.g. 'compression', 'memory', 'smoke-test'). " +
            "When omitted, all flows are returned.",
        },
      },
    },
  },
  {
    name: "run_harness_flow",
    description:
      "Execute a registered Harness business flow by flowId. " +
      "Runs the full closed-loop execution pipeline: validates input, " +
      "executes setup/run/check hooks, writes artifacts, and records " +
      "a run receipt. Returns the runId, status, output, receiptId, " +
      "and produced artifacts. On failure, the run state includes error " +
      "details — the call itself does not throw.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flowId: {
          type: "string",
          description:
            "The flow manifest id to execute (required). " +
            "Use list_harness_flows to discover available flow ids.",
        },
        input: {
          type: "object",
          description:
            "Input data for the flow (optional). " +
            "Must conform to the flow's inputSchema if one is declared.",
        },
      },
      required: ["flowId"],
    },
  },
  {
    name: "get_harness_run",
    description:
      "Retrieve the full state of a previous harness run by runId. " +
      "Returns the run state (status, checkpoints, artifacts), " +
      "associated receipts, event logs, and artifact contents. " +
      "Use this to inspect a run after it completes or diagnose failures.",
    inputSchema: {
      type: "object" as const,
      properties: {
        runId: {
          type: "string",
          description:
            "The run identifier returned by run_harness_flow (required).",
        },
      },
      required: ["runId"],
    },
  },
  {
    name: "check_harness_flow",
    description:
      "Validate a harness flow manifest without executing it. " +
      "Checks that the manifest is well-formed, the flow is registered, " +
      "example input conforms to the declared inputSchema, and all " +
      "artifact declarations are valid. Returns a structured check result. " +
      "Use this before running a flow to catch configuration issues early.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flowId: {
          type: "string",
          description:
            "The flow manifest id to check (required). " +
            "Use list_harness_flows to discover available flow ids.",
        },
        exampleInput: {
          type: "object",
          description:
            "Optional example input to validate against the flow's inputSchema. " +
            "When omitted, only manifest structure checks are performed.",
        },
      },
      required: ["flowId"],
    },
  },
  {
    name: "run_context_flow",
    description:
      "Unified agent-facing entry point for context management. " +
      "Wraps compression, memory, and recall into a single call " +
      "to reduce tool-selection overhead. " +
      "Three flow modes: " +
      "'compression' (compress content, optionally save memory and recall), " +
      "'memory' (remember and/or recall project context), " +
      "'full' (compress -> remember -> recall complete chain). " +
      "Returns a runId for tracking and a receiptId for audit. " +
      "All individual operations are fail-open — partial failures " +
      "are reported in warnings with status 'partial'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flow: {
          type: "string",
          description:
            "Flow mode (required). " +
            "Valid values: compression, memory, full. " +
            "compression: compress content with optional remember/recall. " +
            "memory: remember and/or recall project context via query. " +
            "full: complete compress -> remember -> recall chain.",
        },
        scopeId: {
          type: "string",
          description:
            "The scopeId from current_scope. " +
            "When omitted, the scope is auto-resolved from the current directory.",
        },
        goal: {
          type: "string",
          description:
            "What the agent is trying to accomplish. " +
            "Used as context for recall and memory operations to " +
            "improve relevance of results.",
        },
        content: {
          type: "string",
          description:
            "Raw content to compress. Required for compression and full flows. " +
            "Optional for memory flow (used as memory content to save).",
        },
        contentType: {
          type: "string",
          description:
            "Content type hint. Defaults to auto-detection via ContentRouter. " +
            "Valid values: test_output, log, command_output, code, json, " +
            "markdown, plain_text, rag_chunk, file_summary, " +
            "conversation_history, unknown.",
        },
        query: {
          type: "string",
          description:
            "Search query for recall. Used in memory and full flows. " +
            "Optional — when omitted, recall is skipped.",
        },
        options: {
          type: "object",
          description:
            "Flow-level options controlling which sub-operations are performed.",
          properties: {
            keepOriginal: {
              type: "boolean",
              description:
                "Save original content for later retrieval. Default: true.",
            },
            includeRecall: {
              type: "boolean",
              description:
                "Run recall after compression to find related memories and profiles. " +
                "Default: false. Requires query to be set.",
            },
            saveMemory: {
              type: "boolean",
              description:
                "Save the compressed result as a project memory. " +
                "Default: false for compression flow, true for full flow.",
            },
            maxTokens: {
              type: "number",
              description:
                "Target max output tokens for compression. Default: 2000.",
            },
          },
        },
      },
      required: ["flow"],
    },
  },
];

/** Map from tool name to definition for quick lookup. */
export const TOOL_MAP: Record<string, Tool> = Object.fromEntries(
  TOOL_DEFINITIONS.map((t) => [t.name, t]),
);
