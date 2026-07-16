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
import {
  CompressedStore,
  type CompressedContextRecord,
  type ContentType,
} from "../../compressed/compressedStore.js";
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
import { canCache, computeCacheKey } from "../../cache/cacheService.js";
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

type FlowStatus = "ok" | "partial" | "failed";
type StepStatus = "ok" | "failed" | "skipped";

interface StepResult {
  status: StepStatus;
  durationMs: number;
  error?: string;
  reason?: string;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function requestedStep(
  status: StepStatus = "skipped",
  reason = "not requested",
): StepResult {
  return { status, durationMs: 0, ...(status === "skipped" ? { reason } : {}) };
}

function aggregateStatus(steps: StepResult[]): FlowStatus {
  const requested = steps.filter((step) => step.reason !== "not requested");
  const failed = requested.filter((step) => step.status === "failed").length;
  if (failed === 0) return "ok";
  return requested.some((step) => step.status === "ok") ? "partial" : "failed";
}

type VerificationStatus =
  | "VERIFIED"
  | "UNVERIFIED"
  | "UNKNOWN"
  | "CONTRADICTORY";

interface StructuredMemorySummary {
  facts: string[];
  inferences: string[];
  verificationStatus: VerificationStatus;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMemorySummary(
  args: Record<string, unknown>,
): StructuredMemorySummary {
  const candidate =
    typeof args.memorySummary === "object" && args.memorySummary !== null
      ? (args.memorySummary as Record<string, unknown>)
      : typeof args.summary === "object" && args.summary !== null
        ? (args.summary as Record<string, unknown>)
        : {};
  const rawStatus =
    typeof candidate.verificationStatus === "string"
      ? candidate.verificationStatus.trim().toUpperCase()
      : "UNKNOWN";
  const contradictory =
    candidate.contradictory === true || candidate.hasContradictions === true;
  const verificationStatus: VerificationStatus =
    contradictory ||
    rawStatus === "CONTRADICTORY" ||
    rawStatus === "CONFLICTING"
      ? "CONTRADICTORY"
      : rawStatus === "VERIFIED"
        ? "VERIFIED"
        : rawStatus === "UNVERIFIED"
          ? "UNVERIFIED"
          : "UNKNOWN";

  return {
    facts: stringList(candidate.facts),
    inferences: stringList(candidate.inferences),
    verificationStatus,
  };
}

function isVerificationSensitive(
  contentType: ContentType,
  content: string,
  goal: string,
): boolean {
  if (contentType === "test_output" || contentType === "command_output")
    return true;
  return /\b(?:build|security[ -]?scan|vulnerability|sast|dast|dependency[ -]?audit)\b/i.test(
    `${goal}\n${content.slice(0, 4_000)}`,
  );
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
  const saveMemoryOption =
    typeof options.saveMemory === "boolean" ? options.saveMemory : undefined;
  const requireVerifiedSummary =
    typeof options.requireVerifiedSummary === "boolean"
      ? options.requireVerifiedSummary
      : true;
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
  const memorySummary = parseMemorySummary(args);

  // Validate content type
  const contentTypeRaw =
    typeof args.contentType === "string" ? args.contentType : "unknown";
  if (
    contentTypeRaw !== "unknown" &&
    !VALID_CONTENT_TYPES.has(contentTypeRaw)
  ) {
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
      if (
        !persistScopeRecord(db, scope.scopeId, scope.cwd, scope.scopeStrategy)
      ) {
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
  let status: FlowStatus = "ok";
  let summary = "";
  let ccrId: string | undefined;
  let compressedContent: string | undefined;
  let originalRef: string | undefined;
  let tokensBefore: number | undefined;
  let tokensAfter: number | undefined;
  let tokensSaved: number | undefined;
  let compressionRatio: number | undefined;
  let receiptId: string | undefined;
  let resolvedContentType: ContentType = contentTypeRaw as ContentType;
  const memories: Record<string, unknown>[] = [];
  let profile: {
    static: Record<string, unknown>[];
    dynamic: Record<string, unknown>[];
  } = {
    static: [],
    dynamic: [],
  };
  const relatedCompressedContexts: Record<string, unknown>[] = [];

  const compressionRequested = flow === "compression" || flow === "full";
  const memoryRequested =
    Boolean(content) &&
    (flow === "memory" ||
      (flow === "compression" && saveMemoryOption === true) ||
      (flow === "full" && saveMemoryOption !== false));
  const recallRequested = Boolean(
    (flow === "full" || includeRecall || flow === "memory") && query,
  );
  const compression = requestedStep(
    "skipped",
    compressionRequested ? "pending" : "not requested",
  );
  const ccrPersistence = requestedStep(
    "skipped",
    compressionRequested ? "pending" : "not requested",
  );
  const originalPersistence = requestedStep(
    "skipped",
    compressionRequested && keepOriginal ? "pending" : "not requested",
  );
  const memory = requestedStep(
    "skipped",
    memoryRequested ? "pending" : "not requested",
  );
  const recall = requestedStep(
    "skipped",
    recallRequested ? "pending" : "not requested",
  );

  try {
    // ------------------------------------------------------------------
    // 7a. COMPRESSION step (compression / full flows)
    // ------------------------------------------------------------------

    if (compressionRequested) {
      const compressionStartedAt = performance.now();
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
          warnings.push(
            "ContentRouter failed — falling back to unknown content type.",
          );
        }
      } else {
        detectedContentType = contentTypeRaw as ContentType;
      }
      resolvedContentType = detectedContentType;

      const inputHash = contentHash(content);
      let resolvedStrategy = getStrategy(detectedContentType);
      let effectiveContentType = detectedContentType;
      if (!resolvedStrategy) {
        resolvedStrategy = getStrategy("plain_text");
        effectiveContentType = "plain_text";
      }
      const strategyVersion = resolvedStrategy?.version ?? "";
      const cacheInputHash = goal
        ? contentHash(`${content}\n\0goal:${goal}`)
        : inputHash;
      const cacheKey = canCache(strategyVersion)
        ? computeCacheKey(
            scopeId,
            cacheInputHash,
            effectiveContentType,
            strategyVersion,
            maxTokens,
            keepOriginal,
          )
        : undefined;

      /**
       * Adopt an existing cache entry. This is checked both before compression
       * and immediately before INSERT: concurrent calls that missed the first
       * lookup converge on the same CCR without attempting a duplicate write.
       */
      const serveCached = (cached: CompressedContextRecord | null): boolean => {
        if (!cached) return false;

        let cachedOriginalUsable = !keepOriginal;
        if (keepOriginal) {
          cachedOriginalUsable = Boolean(
            cached.originalRef &&
            cached.canRetrieveOriginal &&
            originalStore.exists(cached.originalRef, scopeId),
          );

          // A cache record can outlive its original after partial failure or
          // manual cleanup. Repair it before treating the entry as a hit.
          if (!cachedOriginalUsable) {
            try {
              const repairedOriginal = originalStore.save({
                scopeId,
                ccrId: cached.id,
                contentType: detectedContentType,
                content,
                metadata: {
                  ...(goal ? { goal } : {}),
                  repairedFromCache: true,
                },
              });
              originalStore.linkOriginalToCcr(cached.id, repairedOriginal.id);
              cached.originalRef = repairedOriginal.id;
              cached.canRetrieveOriginal = true;
              cachedOriginalUsable = true;
            } catch {
              return false;
            }
          }
        }

        if (!cached.compressedContent || !cachedOriginalUsable) return false;

        compressedStore.incrementCacheHit(cached.id);
        ccrId = cached.id;
        compressedContent = cached.compressedContent;
        originalRef = cached.originalRef;
        tokensBefore = cached.tokensBefore;
        tokensAfter = cached.tokensAfter;
        tokensSaved = cached.tokensSaved;
        compressionRatio = cached.compressionRatio;
        compression.status = cached.failed ? "failed" : "ok";
        compression.durationMs = elapsedMs(compressionStartedAt);
        delete compression.reason;
        if (cached.failed)
          compression.error = cached.errorReason ?? "cached compression failed";
        ccrPersistence.status = "ok";
        ccrPersistence.durationMs = 0;
        delete ccrPersistence.reason;
        if (keepOriginal) {
          originalPersistence.status = "ok";
          originalPersistence.durationMs = 0;
          delete originalPersistence.reason;
        }
        warnings.push(
          `cacheHit=true (served from cache, hit #${cached.cacheHitCount + 1})`,
        );

        try {
          const cacheReceipt = receipts.create({
            operation: "compress",
            scopeId,
            inputHash,
            resultIds: [cached.id],
            ccrIds: [cached.id],
            originalRefs: cached.originalRef ? [cached.originalRef] : [],
            tokensBefore: cached.tokensBefore,
            tokensAfter: cached.tokensAfter,
            tokensSaved: cached.tokensSaved,
            compressionRatio: cached.compressionRatio,
            compressed: cached.tokensSaved > 0,
            failed: cached.failed,
            errorReason: cached.errorReason,
            cacheHit: true,
          });
          receiptId = cacheReceipt.id;
        } catch {
          warnings.push("Warning: unable to record compression receipt.");
        }

        return true;
      };

      // The second lookup after the await closes the concurrent-request race.
      compressionWork: {
        if (
          cacheKey &&
          serveCached(compressedStore.findByCacheKey(cacheKey, scopeId))
        ) {
          break compressionWork;
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
            goal: goal || undefined,
            metadata: {
              ...(goal ? { goal } : {}),
              ...(detectedBy === "auto"
                ? { autoDetectedContentType: detectedContentType }
                : {}),
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

          compressedContent = output.compressedContent;
          tokensBefore = output.tokensBefore;
          tokensAfter = output.tokensAfter;
          tokensSaved = output.tokensSaved;
          compressionRatio = output.compressionRatio;
          compression.status = output.failed ? "failed" : "ok";
          compression.durationMs = elapsedMs(compressionStartedAt);
          delete compression.reason;
          if (output.failed) {
            compression.error = output.errorReason ?? "unknown error";
            warnings.push(`Compression failed: ${compression.error}`);
          }

          if (
            cacheKey &&
            serveCached(compressedStore.findByCacheKey(cacheKey, scopeId))
          ) {
            break compressionWork;
          }

          // Persist CCR
          const ccrStartedAt = performance.now();
          try {
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
              cacheKey,
              strategyVersion,
            });

            if (!savedRecord?.id) {
              throw new Error("CompressedStore.save did not return a CCR id");
            }
            ccrId = savedRecord.id;
            ccrPersistence.status = "ok";
            ccrPersistence.durationMs = elapsedMs(ccrStartedAt);
            delete ccrPersistence.reason;

            // Persist original if requested
            if (keepOriginal) {
              const originalStartedAt = performance.now();
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
                originalStore.linkOriginalToCcr(
                  savedRecord.id,
                  savedOriginal.id,
                );
                originalRef = savedOriginal.id;
                originalPersistence.status = "ok";
                originalPersistence.durationMs = elapsedMs(originalStartedAt);
                delete originalPersistence.reason;
              } catch (origErr) {
                const message =
                  origErr instanceof Error ? origErr.message : String(origErr);
                originalPersistence.status = "failed";
                originalPersistence.durationMs = elapsedMs(originalStartedAt);
                originalPersistence.error = message;
                delete originalPersistence.reason;
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
            const message =
              dbErr instanceof Error ? dbErr.message : String(dbErr);
            ccrPersistence.status = "failed";
            ccrPersistence.durationMs = elapsedMs(ccrStartedAt);
            ccrPersistence.error = message;
            delete ccrPersistence.reason;
            if (keepOriginal) {
              originalPersistence.status = "skipped";
              originalPersistence.reason = "CCR persistence failed";
            }
            warnings.push(
              `Database write warning: unable to persist CCR — ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
            );
          }

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

          // Record failure events (non-blocking)
          try {
            if (output.failed) {
              const reason = output.errorReason ?? "";
              failureStore.record({
                scopeId,
                operation: "compress",
                eventType: reason.includes("timeout")
                  ? "compression_timeout"
                  : "compression_error",
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
          const msg =
            compressErr instanceof Error
              ? compressErr.message
              : String(compressErr);
          compression.status = "failed";
          compression.durationMs = elapsedMs(compressionStartedAt);
          compression.error = msg;
          delete compression.reason;
          ccrPersistence.status = "skipped";
          ccrPersistence.reason = "compression failed before CCR persistence";
          if (keepOriginal) {
            originalPersistence.status = "skipped";
            originalPersistence.reason = "CCR was not persisted";
          }
          warnings.push(`Compression error (fail-open): ${msg}`);
          compressedContent = content; // Return original as compressed
          tokensBefore = content.length;
          tokensAfter = content.length;
          tokensSaved = 0;
        }
      }
    }

    // ------------------------------------------------------------------
    // 7b. MEMORY step (memory / full flows, or when saveMemory)
    // ------------------------------------------------------------------

    if (memoryRequested) {
      const memoryDependsOnCcr = flow === "full";
      const verificationSensitive =
        flow === "full" &&
        isVerificationSensitive(resolvedContentType, content, goal);
      if (memoryDependsOnCcr && (ccrPersistence.status !== "ok" || !ccrId)) {
        memory.status = "skipped";
        memory.reason = "CCR persistence failed";
      } else if (flow === "full" && compression.status !== "ok") {
        memory.status = "skipped";
        memory.reason = "compression failed";
      } else if (flow === "full" && resolvedContentType === "unknown") {
        memory.status = "skipped";
        memory.reason = "content type is UNKNOWN";
      } else if (
        flow === "full" &&
        memorySummary.verificationStatus === "CONTRADICTORY"
      ) {
        memory.status = "skipped";
        memory.reason = "summary is contradictory";
      } else if (
        flow === "full" &&
        memorySummary.verificationStatus === "UNKNOWN"
      ) {
        memory.status = "skipped";
        memory.reason = "verificationStatus is UNKNOWN";
      } else if (
        flow === "full" &&
        requireVerifiedSummary &&
        memorySummary.verificationStatus !== "VERIFIED"
      ) {
        memory.status = "skipped";
        memory.reason = "verified summary is required";
      } else if (
        verificationSensitive &&
        memorySummary.verificationStatus !== "VERIFIED"
      ) {
        memory.status = "skipped";
        memory.reason = "verifiable output requires a verified summary";
      } else {
        const memoryStartedAt = performance.now();
        try {
          // For memory flow without explicit type, default to file_summary
          const memoryType: MemoryType =
            flow === "memory" ? "file_summary" : "file_summary";

          if (
            verificationSensitive &&
            (!originalRef || originalPersistence.status !== "ok")
          ) {
            memory.status = "skipped";
            memory.durationMs = elapsedMs(memoryStartedAt);
            memory.reason =
              "verifiable output requires a persisted originalRef";
          } else {
            const admittedFacts = flow === "full" ? memorySummary.facts : [];
            const admittedInferences =
              flow === "full" && !verificationSensitive
                ? memorySummary.inferences
                : [];
            if (
              flow === "full" &&
              admittedFacts.length === 0 &&
              admittedInferences.length === 0
            ) {
              memory.status = "skipped";
              memory.durationMs = elapsedMs(memoryStartedAt);
              memory.reason = verificationSensitive
                ? "verifiable output has no verified facts"
                : "summary has no admissible facts or inferences";
            } else {
              const structuredContent =
                flow === "full"
                  ? JSON.stringify({
                      facts: admittedFacts,
                      inferences: admittedInferences,
                      verificationStatus: memorySummary.verificationStatus,
                      ...(originalRef ? { originalRef } : {}),
                    })
                  : content.slice(0, 256_000);
              const memoryInput = {
                scopeId,
                type: memoryType,
                content: structuredContent,
                summary:
                  flow === "full"
                    ? (admittedFacts[0] ?? admittedInferences[0])
                    : goal || undefined,
                sourceRef: ccrId ? `ccr:${ccrId}` : undefined,
                confidence: 0.8,
                tags: [
                  flow,
                  ...(flow === "full"
                    ? [
                        "auto-saved",
                        `verification:${memorySummary.verificationStatus.toLowerCase()}`,
                      ]
                    : []),
                ],
              };

              const memResult = memoryService.remember(memoryInput);
              memories.push({
                id: memResult.memoryId,
                type: memResult.type,
                status: memResult.status,
                receiptId: memResult.receiptId,
                ...(flow === "full"
                  ? {
                      facts: admittedFacts,
                      inferences: admittedInferences,
                      verificationStatus: memorySummary.verificationStatus,
                      ...(originalRef ? { originalRef } : {}),
                    }
                  : {}),
              });

              // Capture first receipt if not already set
              if (!receiptId) {
                receiptId = memResult.receiptId;
              }
              memory.status = "ok";
              memory.durationMs = elapsedMs(memoryStartedAt);
              delete memory.reason;
            }
          }
        } catch (memErr) {
          const message =
            memErr instanceof Error ? memErr.message : String(memErr);
          memory.status = "failed";
          memory.durationMs = elapsedMs(memoryStartedAt);
          memory.error = message;
          delete memory.reason;
          warnings.push(
            `Memory write failed: ${memErr instanceof Error ? memErr.message : String(memErr)}`,
          );
        }
      }
    }

    // ------------------------------------------------------------------
    // 7c. RECALL step (when query is available and includeRecall or full)
    // ------------------------------------------------------------------

    if (recallRequested) {
      const recallStartedAt = performance.now();
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
            matchMethod: r.matchMethod,
            matchedTerms: r.matchedTerms,
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
        recall.status = "ok";
        recall.durationMs = elapsedMs(recallStartedAt);
        delete recall.reason;
      } catch (recallErr) {
        const message =
          recallErr instanceof Error ? recallErr.message : String(recallErr);
        recall.status = "failed";
        recall.durationMs = elapsedMs(recallStartedAt);
        recall.error = message;
        delete recall.reason;
        warnings.push(
          `Recall failed: ${recallErr instanceof Error ? recallErr.message : String(recallErr)}`,
        );
      }
    }
  } catch (err) {
    // Top-level catch for unexpected errors
    const message = err instanceof Error ? err.message : String(err);
    for (const step of [
      compression,
      ccrPersistence,
      originalPersistence,
      memory,
      recall,
    ]) {
      if (step.reason === "pending") {
        step.status = "failed";
        step.error = message;
        delete step.reason;
      }
    }
    warnings.push(
      `Unexpected error in flow "${flow}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  status = aggregateStatus([
    compression,
    ccrPersistence,
    originalPersistence,
    memory,
    recall,
  ]);

  // ==========================================================================
  // 8. Build summary
  // ==========================================================================

  const summaryParts: string[] = [];
  if (flow === "compression" || flow === "full") {
    if (ccrId) {
      summaryParts.push(`Compressed to CCR ${ccrId}`);
      if (tokensSaved !== undefined && tokensSaved > 0) {
        summaryParts.push(
          `saved ${tokensSaved} tokens (${tokensBefore} → ${tokensAfter})`,
        );
      }
    } else {
      summaryParts.push("Compression did not produce a CCR");
    }
  }
  if (memories.length > 0) {
    summaryParts.push(`${memories.length} memories(s) processed`);
  }
  if (profile.static.length > 0 || profile.dynamic.length > 0) {
    summaryParts.push(
      `Profile: ${profile.static.length} static + ${profile.dynamic.length} dynamic facts`,
    );
  }
  summary =
    summaryParts.join("; ") ||
    `Flow "${flow}" completed with status "${status}"`;

  // ==========================================================================
  // 9. Build response
  // ==========================================================================

  const response: Record<string, unknown> = {
    flow,
    status,
    summary,
    runId,
    warnings,
    compression,
    ccrPersistence,
    originalPersistence,
    memory,
    recall,
  };

  // Compression results
  if (flow === "compression" || flow === "full") {
    if (compressedContent !== undefined)
      response.compressedContent = compressedContent;
    if (originalRef) response.originalRef = originalRef;
    if (ccrId) response.ccrId = ccrId;
    if (tokensBefore !== undefined) response.tokensBefore = tokensBefore;
    if (tokensAfter !== undefined) response.tokensAfter = tokensAfter;
    if (tokensSaved !== undefined) response.tokensSaved = tokensSaved;
    if (compressionRatio !== undefined)
      response.compressionRatio = compressionRatio;
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
