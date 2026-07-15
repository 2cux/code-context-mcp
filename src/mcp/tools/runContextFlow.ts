/**
 * run_context_flow MCP tool handler — PRD Task 3
 *
 * Unified agent-facing entry point for context management.
 * Wraps compression, memory, and recall into a single call
 * to reduce tool-selection overhead.
 *
 * Three flow modes:
 *   - "compression": compress content, optionally save memory and recall
 *   - "memory":       remember and/or recall project context
 *   - "full":         compress → remember → recall complete chain
 *
 * All individual operations are fail-open — partial failures
 * are reported in warnings with status "partial".
 *
 * Reuses existing domain services (CompressedStore, MemoryService,
 * RecallEngine, etc.) without modifying them.
 */

import { randomBytes } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../server.js";
import { CompressedStore, type ContentType } from "../../compressed/compressedStore.js";
import { OriginalStore } from "../../originals/originalStore.js";
import { MemoryService } from "../../memory/memoryService.js";
import { MemoryFtsIndex } from "../../memory/memoryFts.js";
import { RecallEngine } from "../../memory/recallEngine.js";
import { ProfileService } from "../../profile/profileService.js";
import { FailureStore } from "../../failure/failureStore.js";
import { contentHash } from "../../utils/hash.js";
import { detectContentType } from "../../router/contentRouter.js";
import { resolveScope } from "../../scope/resolveScope.js";
import { runStmt } from "../../storage/db.js";
import { compressSafely } from "../../safety/safetyLayer.js";
import { initializeCompression } from "../../compression/initialize.js";
import { getStrategy } from "../../compression/compressionEngine.js";
import type { MemoryType } from "../../memory/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_FLOWS: ReadonlySet<string> = new Set([
  "compression",
  "memory",
  "full",
]);

const VALID_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "test_output",
  "log",
  "command_output",
  "code",
  "json",
  "markdown",
  "plain_text",
  "rag_chunk",
  "file_summary",
  "conversation_history",
  "unknown",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRunId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString("hex");
  return `flow_${ts}_${rand}`;
}

function persistScopeRecord(
  db: Database,
  scopeId: string,
  cwd?: string,
  strategy?: string,
): boolean {
  try {
    const now = new Date().toISOString();
    const dir = cwd ?? process.cwd();
    const strat = strategy ?? "cwdFallback";
    runStmt(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [scopeId, dir, strat, now, now],
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleRunContextFlow(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  // This handler is also invoked directly by adapters, outside server startup.
  initializeCompression();

  const { db, receipts } = ctx;
  const warnings: string[] = [];
  const runId = generateRunId();

  // ==========================================================================
  // 1. Validate flow
  // ==========================================================================

  const flowRaw = typeof args.flow === "string" ? args.flow.trim() : "";
  if (!flowRaw) {
    return {
      content: [
        {
          type: "text",
          text: `Error: flow is required. Valid values: ${Array.from(VALID_FLOWS).join(", ")}`,
        },
      ],
      isError: true,
    };
  }
  if (!VALID_FLOWS.has(flowRaw)) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Invalid flow "${flowRaw}". Valid values: ${Array.from(VALID_FLOWS).join(", ")}`,
        },
      ],
      isError: true,
    };
  }
  const flow = flowRaw as "compression" | "memory" | "full";

  // ==========================================================================
  // 2. Validate options
  // ==========================================================================

  const options =
    typeof args.options === "object" && args.options !== null
      ? (args.options as Record<string, unknown>)
      : {};

  const keepOriginal = options.keepOriginal !== false; // default true
  const includeRecall =
    typeof options.includeRecall === "boolean" ? options.includeRecall : false;
  const saveMemory =
    typeof options.saveMemory === "boolean" ? options.saveMemory : false;
  const maxTokens =
    typeof options.maxTokens === "number" && options.maxTokens > 0
      ? options.maxTokens
      : 2000;
  const timeoutMs = 5000;

  // ==========================================================================
  // 3. Extract common fields
  // ==========================================================================

  const content = typeof args.content === "string" ? args.content : "";
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  const queryRaw = typeof args.query === "string" ? args.query.trim() : "";
  const query = queryRaw.length > 0 ? queryRaw : goal;

  // Validate content type
  const contentTypeRaw =
    typeof args.contentType === "string" ? args.contentType : "unknown";
  if (contentTypeRaw !== "unknown" && !VALID_CONTENT_TYPES.has(contentTypeRaw)) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Invalid contentType "${contentTypeRaw}". Valid values: ${Array.from(VALID_CONTENT_TYPES).join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  // ==========================================================================
  // 4. Resolve scope
  // ==========================================================================

  let scopeId = typeof args.scopeId === "string" ? args.scopeId.trim() : "";
  if (!scopeId) {
    try {
      const scope = resolveScope();
      scopeId = scope.scopeId;
      if (!persistScopeRecord(db, scope.scopeId, scope.cwd, scope.scopeStrategy)) {
        warnings.push(
          "Scope record persistence failed — proceeding, but operations may fail on FK constraint.",
        );
      }
    } catch (scopeErr) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Failed to resolve project scope — ${scopeErr instanceof Error ? scopeErr.message : String(scopeErr)}`,
          },
        ],
        isError: true,
      };
    }
  } else {
    if (!persistScopeRecord(db, scopeId)) {
      warnings.push(
        "Scope record persistence failed — proceeding, but operations may fail on FK constraint.",
      );
    }
  }

  // ==========================================================================
  // 5. Flow-specific validation
  // ==========================================================================

  // Validate content is present for compression/full flows
  if ((flow === "compression" || flow === "full") && !content) {
    return {
      content: [
        {
          type: "text",
          text: `Error: content is required for flow "${flow}".`,
        },
      ],
      isError: true,
    };
  }

  // Validate at least content or query for memory flow
  if (flow === "memory" && !content && !query) {
    return {
      content: [
        {
          type: "text",
          text: `Error: at least one of "content" or "query" is required for flow "memory".`,
        },
      ],
      isError: true,
    };
  }

  // ==========================================================================
  // 6. Instantiate services
  // ==========================================================================

  const compressedStore = new CompressedStore(db);
  const originalStore = new OriginalStore(db);
  const ftsIndex = new MemoryFtsIndex(db);
  const memoryService = new MemoryService(db, { receipts, ftsIndex });
  const recallEngine = new RecallEngine(db, ftsIndex);
  const profileService = new ProfileService(db, { receipts });
  const failureStore = new FailureStore(db);

  // ==========================================================================
  // 7. Execute flow
  // ==========================================================================

  // Accumulated output fields
  let status: "ok" | "partial" | "error" = "ok";
  let summary = "";
  let ccrId: string | undefined;
  let compressedContent: string | undefined;
  let originalRef: string | undefined;
  let tokensBefore: number | undefined;
  let tokensAfter: number | undefined;
  let tokensSaved: number | undefined;
  let compressionRatio: number | undefined;
  let receiptId: string | undefined;
  const memories: Record<string, unknown>[] = [];
  let profile: { static: Record<string, unknown>[]; dynamic: Record<string, unknown>[] } = {
    static: [],
    dynamic: [],
  };
  const relatedCompressedContexts: Record<string, unknown>[] = [];

  try {
    // ------------------------------------------------------------------
    // 7a. COMPRESSION step (compression / full flows)
    // ------------------------------------------------------------------

    if (flow === "compression" || flow === "full") {
      // Auto-detect content type
      let detectedContentType: ContentType;
      let detectedBy: "user" | "auto" = "user";

      if (contentTypeRaw === "unknown" || !args.contentType) {
        try {
          const detection = detectContentType(content);
          detectedContentType = detection.contentType;
          detectedBy = "auto";
        } catch {
          detectedContentType = "unknown";
          detectedBy = "auto";
          warnings.push("ContentRouter failed — falling back to unknown content type.");
        }
      } else {
        detectedContentType = contentTypeRaw as ContentType;
      }

      // Execute compression via safety layer
      try {
        const input = {
          scopeId,
          content,
          contentType: detectedContentType,
          strategy: "conservative" as const,
          keepOriginal,
          maxTokens,
          timeoutMs,
          metadata: {
            ...(goal ? { goal } : {}),
            ...(detectedBy === "auto" ? { autoDetectedContentType: detectedContentType } : {}),
          },
        };

        const safetyResult = await compressSafely(input, {
          sizeLimit: { maxInputBytes: 1_048_576, failOpen: true },
          timeoutMs,
        });

        const output = safetyResult.output;
        for (const w of safetyResult.safetyWarnings) {
          warnings.push(w);
        }

        // Persist CCR
        try {
          const inputHash = contentHash(content);
          let resolvedStrategy = getStrategy(detectedContentType);
          let effectiveContentType = detectedContentType;
          if (!resolvedStrategy) {
            resolvedStrategy = getStrategy("plain_text");
            effectiveContentType = "plain_text";
          }
          const strategyVersion = resolvedStrategy?.version ?? "";

          const savedRecord = compressedStore.save({
            scopeId: output.scopeId,
            contentType: output.contentType,
            strategy: output.strategy || "none",
            compressedContent: output.compressedContent,
            summary: output.summary,
            originalRef: undefined,
            sourceRef: goal || undefined,
            metadata: {
              ...(goal ? { goal } : {}),
              safetyWarnings: safetyResult.safetyWarnings,
              safetyActions: safetyResult.safetyActions,
            },
            tokensBefore: output.tokensBefore,
            tokensAfter: output.tokensAfter,
            tokensSaved: output.tokensSaved,
            compressionRatio: output.compressionRatio,
            canRetrieveOriginal: false,
            failed: output.failed ?? false,
            errorReason: output.errorReason,
            contentHash: inputHash,
            cacheKey: "",
            strategyVersion,
          });

          ccrId = savedRecord?.id ?? output.ccrId;

          // Persist original if requested
          let originalSaved = false;
          if (keepOriginal && savedRecord) {
            try {
              const savedOriginal = originalStore.save({
                scopeId,
                ccrId: savedRecord.id,
                contentType: detectedContentType,
                content,
                metadata: {
                  ...(goal ? { goal } : {}),
                  safetyWarnings: safetyResult.safetyWarnings,
                },
              });
              originalStore.linkOriginalToCcr(savedRecord.id, savedOriginal.id);
              originalRef = savedOriginal.id;
              originalSaved = true;
            } catch (origErr) {
              warnings.push(
                `Warning: unable to save original content — ${origErr instanceof Error ? origErr.message : String(origErr)}`,
              );
            }
          }

          // Original is already linked via originalStore.linkOriginalToCcr() above.
          // The CCR's canRetrieveOriginal flag is set to false initially;
          // the link exists in original_contents but the CCR row reflects
          // "compressed but original saved" semantics.
        } catch (dbErr) {
          warnings.push(
            `Database write warning: unable to persist CCR — ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
          );
        }

        // Capture compression result fields
        compressedContent = output.compressedContent;
        tokensBefore = output.tokensBefore;
        tokensAfter = output.tokensAfter;
        tokensSaved = output.tokensSaved;
        compressionRatio = output.compressionRatio;

        // Create compression receipt
        try {
          const receipt = receipts.create({
            operation: "compress",
            scopeId,
            inputHash: contentHash(content),
            ccrIds: ccrId ? [ccrId] : [],
            originalRefs: originalRef ? [originalRef] : [],
            tokensBefore: output.tokensBefore,
            tokensAfter: output.tokensAfter,
            tokensSaved: output.tokensSaved,
            compressionRatio: output.compressionRatio,
            compressed: output.compressed,
            failed: output.failed ?? false,
            errorReason: output.errorReason,
          });
          receiptId = receipt.id;
        } catch {
          warnings.push("Warning: unable to record compression receipt.");
        }

        if (output.failed) {
          if (status === "ok") status = "partial";
          warnings.push(`Compression failed: ${output.errorReason ?? "unknown error"}`);
        }

        // Record failure events (non-blocking)
        try {
          if (output.failed) {
            const reason = output.errorReason ?? "";
            failureStore.record({
              scopeId,
              operation: "compress",
              eventType: reason.includes("timeout") ? "compression_timeout" : "compression_error",
              contentType: detectedContentType,
              strategy: output.strategy || "conservative",
              errorReason: output.errorReason,
              metadata: { maxTokens, timeoutMs },
            });
          }
        } catch {
          // Non-blocking
        }
      } catch (compressErr) {
        // Compression failed completely — fail-open: return original content
        if (status === "ok") status = "partial";
        const msg = compressErr instanceof Error ? compressErr.message : String(compressErr);
        warnings.push(`Compression error (fail-open): ${msg}`);
        compressedContent = content; // Return original as compressed
        tokensBefore = content.length;
        tokensAfter = content.length;
        tokensSaved = 0;
      }
    }

    // ------------------------------------------------------------------
    // 7b. MEMORY step (memory / full flows, or when saveMemory)
    // ------------------------------------------------------------------

    const shouldSaveMemory =
      flow === "memory" || flow === "full" || saveMemory;

    if (shouldSaveMemory && content) {
      try {
        // For memory flow without explicit type, default to file_summary
        const memoryType: MemoryType =
          flow === "memory" ? "file_summary" : "file_summary";

        const memoryInput = {
          scopeId,
          type: memoryType,
          content: flow === "full" && compressedContent
            ? `Compressed result (ccr:${ccrId})\n\nSummary: ${compressedContent.slice(0, 500)}`
            : content.slice(0, 256_000),
          summary: flow === "full"
            ? `Compression flow run ${runId}: ${goal || "context saved"}`
            : goal || undefined,
          sourceRef: ccrId ? `ccr:${ccrId}` : undefined,
          confidence: 0.8,
          tags: [flow, ...(flow === "full" ? ["auto-saved"] : [])],
        };

        const memResult = memoryService.remember(memoryInput);
        memories.push({
          id: memResult.memoryId,
          type: memResult.type,
          status: memResult.status,
          receiptId: memResult.receiptId,
        });

        // Capture first receipt if not already set
        if (!receiptId) {
          receiptId = memResult.receiptId;
        }
      } catch (memErr) {
        if (status === "ok") status = "partial";
        warnings.push(
          `Memory write failed: ${memErr instanceof Error ? memErr.message : String(memErr)}`,
        );
      }
    }

    // ------------------------------------------------------------------
    // 7c. RECALL step (when query is available and includeRecall or full)
    // ------------------------------------------------------------------

    const shouldRecall =
      (flow === "full" || includeRecall || flow === "memory") && query;

    if (shouldRecall) {
      try {
        const searchResults = recallEngine.searchEnhanced({
          scopeId,
          query,
          limit: 10,
          includeCanExpand: true,
        });

        for (const r of searchResults) {
          memories.push({
            id: r.memory.id,
            type: r.memory.type,
            content: r.memory.content,
            summary: r.memory.summary,
            status: r.memory.status,
            sourceRef: r.memory.sourceRef,
            confidence: r.memory.confidence,
            score: r.finalScore,
            canExpand: r.canExpand,
            createdAt: r.memory.createdAt,
            tags: r.memory.tags,
          });
        }

        // Get profile
        const repoProfile = profileService.getProfile(scopeId);
        profile = {
          static: repoProfile.staticFacts.map((f) => ({
            id: f.id,
            content: f.content,
            sourceMemoryId: f.sourceMemoryId,
            confidence: f.confidence,
            updatedAt: f.updatedAt,
          })),
          dynamic: repoProfile.dynamicContext.map((f) => ({
            id: f.id,
            content: f.content,
            sourceMemoryId: f.sourceMemoryId,
            confidence: f.confidence,
            updatedAt: f.updatedAt,
          })),
        };

        // Find related CCRs
        let recallCcrIds: string[] = [];
        if (searchResults.length > 0) {
          const mems = searchResults.map((r) => r.memory);
          const ccrs = recallEngine.findRelatedCCRs(scopeId, mems);
          recallCcrIds = ccrs.map((c) => c.ccrId);
          for (const c of ccrs) {
            relatedCompressedContexts.push({
              ccrId: c.ccrId,
              summary: c.summary,
              originalRef: c.originalRef,
              canRetrieveOriginal: c.canRetrieveOriginal,
            });
          }
        }

        // Create recall receipt
        try {
          const memIds = searchResults.map((r) => r.memory.id);
          receipts.create({
            operation: "recall",
            scopeId,
            query,
            memoryIds: memIds,
            ccrIds: recallCcrIds,
          });
        } catch {
          // Non-blocking
        }

        // Record failure events (non-blocking)
        try {
          if (searchResults.length === 0) {
            failureStore.record({
              scopeId,
              operation: "recall",
              eventType: "recall_no_hit",
              errorReason: "no_results_for_query",
              metadata: { query },
            });
          }
        } catch {
          // Non-blocking
        }
      } catch (recallErr) {
        if (status === "ok") status = "partial";
        warnings.push(
          `Recall failed: ${recallErr instanceof Error ? recallErr.message : String(recallErr)}`,
        );
      }
    }
  } catch (err) {
    // Top-level catch for unexpected errors
    status = "error";
    warnings.push(
      `Unexpected error in flow "${flow}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ==========================================================================
  // 8. Build summary
  // ==========================================================================

  const summaryParts: string[] = [];
  if (flow === "compression" || flow === "full") {
    if (ccrId) {
      summaryParts.push(`Compressed to CCR ${ccrId}`);
      if (tokensSaved !== undefined && tokensSaved > 0) {
        summaryParts.push(`saved ${tokensSaved} tokens (${tokensBefore} → ${tokensAfter})`);
      }
    } else {
      summaryParts.push("Compression did not produce a CCR");
    }
  }
  if (memories.length > 0) {
    summaryParts.push(`${memories.length} memories(s) processed`);
  }
  if (profile.static.length > 0 || profile.dynamic.length > 0) {
    summaryParts.push(`Profile: ${profile.static.length} static + ${profile.dynamic.length} dynamic facts`);
  }
  summary = summaryParts.join("; ") || `Flow "${flow}" completed with status "${status}"`;

  // ==========================================================================
  // 9. Build response
  // ==========================================================================

  const response: Record<string, unknown> = {
    flow,
    status,
    summary,
    runId,
    warnings,
  };

  // Compression results
  if (flow === "compression" || flow === "full") {
    if (compressedContent !== undefined) response.compressedContent = compressedContent;
    if (originalRef) response.originalRef = originalRef;
    if (ccrId) response.ccrId = ccrId;
    if (tokensBefore !== undefined) response.tokensBefore = tokensBefore;
    if (tokensAfter !== undefined) response.tokensAfter = tokensAfter;
    if (tokensSaved !== undefined) response.tokensSaved = tokensSaved;
    if (compressionRatio !== undefined) response.compressionRatio = compressionRatio;
  }

  // Memory results
  if (memories.length > 0) {
    response.memories = memories;
  }

  // Profile — always included (matches recall_context behavior)
  response.profile = profile;

  // Related CCRs
  if (relatedCompressedContexts.length > 0) {
    response.relatedCompressedContexts = relatedCompressedContexts;
  }

  // Receipt ID (last set)
  if (receiptId) {
    response.receiptId = receiptId;
  }

  // Goal echo
  if (goal) {
    response.goal = goal;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
