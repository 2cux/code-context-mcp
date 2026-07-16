/**
 * compress_context MCP tool handler — PRD §11.2
 *
 * Full compress-context pipeline:
 *   1. Validate inputs (scopeId ← auto-resolve, content, contentType).
 *   2. Auto-detect content type via ContentRouter (with fallback).
 *   3. Route through the Safety Layer (size limit → chunking → timeout → failOpen).
 *   4. Persist the CompressedContextRecord.
 *   5. Optionally save original content.
 *   6. Record a receipt.
 *   7. Return the CompressionOutput to the caller.
 *
 * All failure paths return the original content (failOpen principle).
 * SQLite failures do NOT block the main flow (warnings are attached).
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { compressSafely, type SafetyCompressResult } from "../../safety/safetyLayer.js";
import type { ServerContext } from "../server.js";
import { CompressedStore, type ContentType } from "../../compressed/compressedStore.js";
import { OriginalStore } from "../../originals/originalStore.js";
import { FailureStore } from "../../failure/failureStore.js";
import { contentHash } from "../../utils/hash.js";
import { detectContentType } from "../../router/contentRouter.js";
import { resolveScope, toScopeRecord } from "../../scope/resolveScope.js";
import { runStmt } from "../../storage/db.js";
import { getStrategy } from "../../compression/compressionEngine.js";
import { computeCacheKey, canCache } from "../../cache/cacheService.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CONTENT_TYPES = new Set<string>([
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

const VALID_STRATEGIES = new Set(["auto", "conservative"]);

/** Internal metadata keys that should not be stored in the CCR / original. */
const INTERNAL_META_KEYS = new Set([
  "_chunkIndex",
  "_chunkTotal",
  "_chunkByteOffset",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip internal metadata keys so they don't pollute stored records. */
function cleanMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!INTERNAL_META_KEYS.has(key)) {
      cleaned[key] = value;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleCompressContext(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const { db, receipts } = ctx;
  const compressedStore = new CompressedStore(db);
  const originalStore = new OriginalStore(db);
  const warnings: string[] = [];

  // ---- Validate inputs ----

  // 12.1.1: Auto-resolve scopeId when not provided
  let scopeId = typeof args.scopeId === "string" ? args.scopeId.trim() : "";
  let scopeAutoResolved = false;
  if (!scopeId) {
    const scope = resolveScope();
    scopeId = scope.scopeId;
    scopeAutoResolved = true;
    // Persist the auto-resolved scope record (non-blocking)
    try {
      const record = toScopeRecord(scope);
      runStmt(
        db,
        `INSERT OR IGNORE INTO scopes (scope_id, git_root, remote, branch, cwd, scope_strategy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.scope_id,
          record.git_root,
          record.remote,
          record.branch,
          record.cwd,
          record.scope_strategy,
          record.created_at,
          record.updated_at,
        ],
      );
    } catch {
      // Scope persistence is best-effort — never blocks compression
    }
  }

  // 12.1.2: Validate content
  const content = typeof args.content === "string" ? args.content : "";
  if (!content) {
    return {
      content: [{ type: "text", text: "Error: content is required." }],
      isError: true,
    };
  }

  // 12.1.3: Auto-detect content type via ContentRouter (with try/catch fallback)
  const contentTypeRaw = typeof args.contentType === "string"
    ? args.contentType
    : "unknown";

  let contentType: ContentType;
  let detectedBy: "user" | "auto" = "user";
  let detectionConfidence = 1.0;

  if (contentTypeRaw === "unknown" || !args.contentType) {
    // Wrap ContentRouter in try/catch for fail-safe operation
    try {
      const detection = detectContentType(content);
      contentType = detection.contentType;
      detectionConfidence = detection.confidence;
      detectedBy = "auto";
      if (detection.confidence < 0.5 && detection.contentType !== "unknown") {
        warnings.push(
          `Low-confidence content type detection: "${detection.contentType}" (confidence: ${detection.confidence.toFixed(2)})`,
        );
      }
    } catch (_routerErr) {
      // ContentRouter failed — fall back to unknown / plain_text
      contentType = "unknown";
      detectedBy = "auto";
      detectionConfidence = 0;
      warnings.push("ContentRouter failed — falling back to unknown/plain_text compression.");
    }
  } else {
    if (!VALID_CONTENT_TYPES.has(contentTypeRaw)) {
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
    contentType = contentTypeRaw as ContentType;
  }

  // 12.1.4: Select compression strategy
  const strategy = typeof args.strategy === "string" ? args.strategy : "conservative";
  if (!VALID_STRATEGIES.has(strategy)) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Invalid strategy "${strategy}". Valid values: auto, conservative.`,
        },
      ],
      isError: true,
    };
  }

  const keepOriginal = args.keepOriginal !== false; // default true
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  const maxTokens = typeof args.maxTokens === "number" ? args.maxTokens : 2000;
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 5000;
  const maxInputBytes =
    typeof args.maxInputBytes === "number" ? args.maxInputBytes : 1_048_576;
  const userMetadata: Record<string, unknown> =
    typeof args.metadata === "object" && args.metadata !== null
      ? (args.metadata as Record<string, unknown>)
      : {};

  // Build cleaned metadata for storage
  const metadata: Record<string, unknown> = {
    ...cleanMetadata(userMetadata),
    ...(detectedBy === "auto"
      ? {
          autoDetectedContentType: contentType,
          autoDetectionConfidence: detectionConfidence,
        }
      : {}),
    ...(scopeAutoResolved ? { scopeAutoResolved: true } : {}),
  };

  // ---- CacheAligner: check cache before compression (§31.3) ----

  const inputHash = contentHash(content);

  // Resolve the actual strategy to get its full semver for cache key computation.
  let resolvedStrategy = getStrategy(contentType);
  let effectiveContentType = contentType;
  if (!resolvedStrategy) {
    resolvedStrategy = getStrategy("plain_text");
    effectiveContentType = "plain_text";
  }
  const strategyVersion = resolvedStrategy?.version ?? "";

  const cacheInputHash = goal ? contentHash(`${content}\n\0goal:${goal}`) : inputHash;
  const cacheKey = canCache(strategyVersion)
    ? computeCacheKey(scopeId, cacheInputHash, effectiveContentType, strategyVersion, maxTokens, keepOriginal)
    : "";

  // Check for an existing cached result
  if (cacheKey) {
    const cached = compressedStore.findByCacheKey(cacheKey, scopeId);
    const cachedOriginalRef = cached?.originalRef;
    let cachedOriginalUsable =
      Boolean(cached?.compressedContent) && (
        !keepOriginal ||
      (
        Boolean(cachedOriginalRef) &&
        Boolean(cached?.canRetrieveOriginal) &&
        (cachedOriginalRef ? originalStore.exists(cachedOriginalRef, scopeId) : false)
      ));
    if (cached && keepOriginal && !cachedOriginalUsable) {
      try {
        const repairedOriginal = originalStore.save({
          scopeId,
          ccrId: cached.id,
          contentType,
          content,
          metadata: cleanMetadata({
            ...metadata,
            repairedFromCache: true,
          }),
        });
        originalStore.linkOriginalToCcr(cached.id, repairedOriginal.id);
        cached.originalRef = repairedOriginal.id;
        cached.canRetrieveOriginal = true;
        cachedOriginalUsable = true;
      } catch {
        cachedOriginalUsable = false;
      }
    }
    if (cached && cachedOriginalUsable) {
      // Cache hit — increment the counter and return the cached result
      compressedStore.incrementCacheHit(cached.id);

      // Create receipt with cacheHit flag for auditability
      let cacheReceiptId = `rcp_cache_${cached.id}`;
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
        cacheReceiptId = cacheReceipt.id;
      } catch {
        // Receipt write is non-blocking
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ccrId: cached.id,
                compressed: cached.tokensSaved > 0,
                scopeId: cached.scopeId,
                contentType: cached.contentType,
                strategy: cached.strategy,
                compressedContent: cached.compressedContent,
                summary: cached.summary,
                originalRef: cached.originalRef,
                tokensBefore: cached.tokensBefore,
                tokensAfter: cached.tokensAfter,
                tokensSaved: cached.tokensSaved,
                compressionRatio: cached.compressionRatio,
                canRetrieveOriginal: cached.canRetrieveOriginal,
                failed: cached.failed ?? false,
                receiptId: cacheReceiptId,
                warnings: [`cacheHit=true (served from cache, hit #${cached.cacheHitCount + 1})`],
                cacheHit: true,
                cacheHitCount: cached.cacheHitCount + 1,
                detection: detectedBy === "auto"
                  ? { method: "auto", detectedAs: contentType, confidence: detectionConfidence }
                  : { method: "user", specifiedType: contentTypeRaw },
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  // ---- Build compression input ----

  const input = {
    scopeId,
    content,
    contentType,
    strategy,
    keepOriginal,
    maxTokens,
    timeoutMs,
    goal: goal || undefined,
    metadata,
  };

  // ---- 12.1.5-6: Compress via Safety Layer (which calls Compression Engine) ----

  const safetyResult: SafetyCompressResult = await compressSafely(input, {
    sizeLimit: { maxInputBytes, failOpen: true },
    timeoutMs,
  });

  const output = safetyResult.output;

  // Fold in safety warnings
  for (const w of safetyResult.safetyWarnings) {
    warnings.push(w);
  }

  // ---- Failure Learning (§33.2): record compression failures ----
  const failureStore = new FailureStore(db);
  try {
    if (output.failed) {
      const reason = output.errorReason ?? "";
      if (reason.includes("timeout")) {
        failureStore.record({
          scopeId,
          operation: "compress",
          eventType: "compression_timeout",
          contentType,
          strategy: output.strategy || strategy,
          errorReason: output.errorReason,
          metadata: { maxTokens, timeoutMs },
        });
      } else {
        failureStore.record({
          scopeId,
          operation: "compress",
          eventType: "compression_error",
          contentType,
          strategy: output.strategy || strategy,
          errorReason: output.errorReason,
          metadata: { maxTokens, timeoutMs },
        });
      }
    }

    if (
      safetyResult.safetyActions.includes("size_rejected") ||
      safetyResult.safetyActions.includes("size_truncated")
    ) {
      failureStore.record({
        scopeId,
        operation: "compress",
        eventType: "oversized_input",
        contentType,
        strategy: output.strategy || strategy,
        errorReason: "input_exceeded_size_limit",
        metadata: {
          contentLength: content.length,
          safetyActions: safetyResult.safetyActions,
        },
      });
    }

    if (
      !output.failed &&
      output.compressionRatio < 0.05
    ) {
      failureStore.record({
        scopeId,
        operation: "compress",
        eventType: "poor_compression_ratio",
        contentType,
        strategy: output.strategy || strategy,
        errorReason: `compression_ratio_${Math.round(output.compressionRatio * 100)}pct`,
        metadata: {
          tokensBefore: output.tokensBefore,
          tokensAfter: output.tokensAfter,
          compressionRatio: output.compressionRatio,
        },
      });
    }
  } catch {
    // Failure recording is non-blocking
  }

  // ---- 12.2.2: Persist compressed record (CompressedContextRecord) ----
  // SQLite failure does NOT block the main flow (§12.3.5)

  let savedRecord = null;
  try {
    savedRecord = compressedStore.save({
      scopeId: output.scopeId,
      contentType: output.contentType,
      strategy: output.strategy || "none",
      compressedContent: output.compressedContent,
      summary: output.summary,
      originalRef: undefined,
      sourceRef: userMetadata.source as string | undefined,
      metadata: cleanMetadata({
        ...metadata,
        safetyWarnings: safetyResult.safetyWarnings,
        safetyActions: safetyResult.safetyActions,
      }),
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
  } catch (dbErr) {
    // §12.3.5: SQLite failure — still return result, add warning (non-blocking)
    const dbMessage = dbErr instanceof Error ? dbErr.message : String(dbErr);
    warnings.push(`Database write warning: unable to persist CCR — ${dbMessage}`);
  }

  // ---- 12.2.1: Save original content (OriginalContentRecord) ----
  // §12.3.3: Original save failure → warning, non-blocking

  let originalSaved = false;
  let storedOriginalRef: string | undefined;
  if (keepOriginal && savedRecord) {
    try {
      const savedOriginal = originalStore.save({
        scopeId,
        ccrId: savedRecord.id,
        contentType,
        content,
        metadata: cleanMetadata({
          ...metadata,
          safetyWarnings: safetyResult.safetyWarnings,
        }),
      });
      storedOriginalRef = savedOriginal.id;
      originalStore.linkOriginalToCcr(savedRecord.id, savedOriginal.id);
      originalSaved = true;
    } catch (origErr) {
      const origMessage = origErr instanceof Error ? origErr.message : String(origErr);
      warnings.push(`Warning: unable to save original content — ${origMessage}`);
    }
  }

  // ---- 12.2.3: Create compression receipt ----
  // §12.3.4: Receipt write failure → warning, non-blocking

  let receiptId = output.receiptId;
  try {
    const inputHash = contentHash(content);

    const receipt = receipts.create({
      operation: "compress",
      scopeId,
      inputHash,
      resultIds: savedRecord ? [savedRecord.id] : [],
      ccrIds: savedRecord ? [savedRecord.id] : [],
      originalRefs: storedOriginalRef ? [storedOriginalRef] : [],
      tokensBefore: output.tokensBefore,
      tokensAfter: output.tokensAfter,
      tokensSaved: output.tokensSaved,
      compressionRatio: output.compressionRatio,
      compressed: output.compressed,
      failed: output.failed ?? false,
      errorReason: output.errorReason,
    });
    receiptId = receipt.id;
  } catch (receiptErr) {
    const receiptMessage = receiptErr instanceof Error ? receiptErr.message : String(receiptErr);
    warnings.push(`Warning: unable to record receipt — ${receiptMessage}`);
  }

  // ---- 12.2.4-8: Build response ----

  const result: Record<string, unknown> = {
    ccrId: savedRecord?.id ?? output.ccrId,
    compressed: output.compressed,
    scopeId: output.scopeId,
    contentType: output.contentType,
    strategy: output.strategy,
    compressedContent: output.compressedContent,
    summary: output.summary,
    originalRef: storedOriginalRef,
    tokensBefore: output.tokensBefore,
    tokensAfter: output.tokensAfter,
    tokensSaved: output.tokensSaved,
    compressionRatio: output.compressionRatio,
    canRetrieveOriginal: originalSaved,
    failed: output.failed ?? false,
    receiptId,
    warnings: [...warnings, ...output.warnings],
    detection: detectedBy === "auto"
      ? { method: "auto", detectedAs: contentType, confidence: detectionConfidence }
      : { method: "user", specifiedType: contentTypeRaw },
  };

  // Include the failure reason when compression failed. The boolean itself is
  // always present so callers can distinguish success from fail-open output.
  if (output.failed) {
    result.errorReason = output.errorReason;
  }

  // Include safety actions when triggered
  if (safetyResult.safetyTriggered) {
    result.safetyActions = safetyResult.safetyActions;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
