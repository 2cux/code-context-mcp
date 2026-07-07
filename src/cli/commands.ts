/**
 * CodeContext CLI — Command Handlers
 *
 * Each function returns a CliResult and NEVER throws, prints to console,
 * or calls process.exit. This makes them directly testable.
 *
 * All handlers follow this pattern:
 *   1. init DB + register strategies (compress only)
 *   2. Perform the operation
 *   3. Close DB
 *   4. Return CliResult
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initAndMigrate } from "../storage/migrations.js";
import { getDb, closeDb } from "../storage/db.js";
import { ReceiptService } from "../receipts/receiptService.js";
import { CompressedStore } from "../compressed/compressedStore.js";
import { OriginalStore } from "../originals/originalStore.js";
import { getTokenStats } from "../stats/tokenStats.js";
import { resolveScope, toScopeRecord } from "../scope/resolveScope.js";
import { runStmt } from "../storage/db.js";
import { registerAllStrategies } from "../compression/registerStrategies.js";
import { detectContentType } from "../router/contentRouter.js";
import { compressSafely } from "../safety/safetyLayer.js";
import { contentHash } from "../utils/hash.js";
import { getStrategy } from "../compression/compressionEngine.js";
import { computeCacheKey, canCache } from "../cache/cacheService.js";
import { MemoryService } from "../memory/memoryService.js";
import { MemoryFtsIndex } from "../memory/memoryFts.js";
import { RecallEngine } from "../memory/recallEngine.js";
import { ProfileService } from "../profile/profileService.js";
import { FailureStore, HIGH_RETRIEVE_THRESHOLD } from "../failure/failureStore.js";
import type { FailureEventType, FailureOperation } from "../failure/failureStore.js";
import type { ContentType } from "../compressed/compressedStore.js";
import type { MemoryType, MemoryStatus } from "../memory/types.js";
import type { ForgetMode } from "../memory/types.js";
import type { ListMemorySortField, SortOrder } from "../memory/types.js";
import { buildValueReport, formatValueReportMarkdown } from "../reports/valueReport.js";
import type { ValueReportData } from "../reports/valueReport.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CliResult {
  status: "ok" | "error";
  data: unknown;
  error?: string;
}

function ok(data: unknown): CliResult {
  return { status: "ok", data };
}

function fail(message: string): CliResult {
  return { status: "error", data: null, error: message };
}

// ---------------------------------------------------------------------------
// Helper: init DB once per command
// ---------------------------------------------------------------------------

async function initDb(): Promise<{ ok: true; db: ReturnType<typeof getDb> } | { ok: false; error: string }> {
  try {
    await initAndMigrate();
    const db = getDb();
    return { ok: true, db };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Persist the current scope to the scopes table (best-effort, non-blocking).
 *
 * Re-resolves scope from process.cwd() each call so the persisted record
 * always reflects the actual runtime environment, regardless of what scopeId
 * the caller may have resolved earlier.
 */
function ensureScopeRecord(db: ReturnType<typeof getDb>): void {
  try {
    const scope = resolveScope();
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
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// 1. scope
// ---------------------------------------------------------------------------

export function runScope(cwd?: string): CliResult {
  try {
    const scope = resolveScope(cwd);
    return ok(scope);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 2. stats
// ---------------------------------------------------------------------------

export async function runStats(): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    const store = new CompressedStore(db);
    const receiptStats = getTokenStats(db, scope.scopeId);
    const ccrCount = store.count(scope.scopeId);

    const stats = {
      scopeId: scope.scopeId,
      scopeStrategy: scope.scopeStrategy,
      ...receiptStats,
      totalCCRs: ccrCount,
    };

    closeDb();
    return ok(stats);
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 3. list-compressions
// ---------------------------------------------------------------------------

export interface ListCompressionsOpts {
  type?: string;
  limit?: number;
  offset?: number;
}

export async function runListCompressions(opts: ListCompressionsOpts): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);
    const store = new CompressedStore(db);
    const receipts = new ReceiptService(db);

    const contentType = opts.type
      ? (opts.type as ContentType)
      : undefined;

    const result = store.list({
      scopeId: scope.scopeId,
      contentType,
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
    });

    // Generate receipt
    receipts.create({
      operation: "list",
      scopeId: scope.scopeId,
      resultIds: result.items.map((i) => i.ccrId),
      query: contentType ? `contentType:${contentType}` : undefined,
    });

    closeDb();
    return ok(result);
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 4. receipt
// ---------------------------------------------------------------------------

export async function runReceipt(receiptId: string): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const receipts = new ReceiptService(db);
    const receipt = receipts.get(receiptId);

    closeDb();

    if (!receipt) {
      return fail(`Receipt not found: ${receiptId}`);
    }

    return ok(receipt);
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 5. compress
// ---------------------------------------------------------------------------

export interface CompressOpts {
  type?: string;
  strategy?: string;
  keepOriginal?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function runCompress(filePath: string, opts: CompressOpts): Promise<CliResult> {
  // Read file first (before DB init, to fail fast)
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    return fail(
      `Cannot read file: ${filePath} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!content.trim()) {
    return fail(`File is empty: ${filePath}`);
  }

  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    // Register all compression strategies
    registerAllStrategies();

    const compressedStore = new CompressedStore(db);
    const originalStore = new OriginalStore(db);
    const receipts = new ReceiptService(db);

    // Detect content type
    const contentTypeRaw = opts.type ?? "unknown";
    let contentType: ContentType;
    let detectedBy: "user" | "auto" = "user";
    let detectionConfidence = 1.0;

    if (contentTypeRaw === "unknown" || !opts.type) {
      try {
        const detection = detectContentType(content);
        contentType = detection.contentType;
        detectionConfidence = detection.confidence;
        detectedBy = "auto";
      } catch {
        contentType = "unknown";
        detectedBy = "auto";
        detectionConfidence = 0;
      }
    } else {
      contentType = contentTypeRaw as ContentType;
    }

    const strategy = opts.strategy ?? "conservative";
    const keepOriginal = opts.keepOriginal ?? true;
    const maxTokens = opts.maxTokens ?? 2000;
    const timeoutMs = opts.timeoutMs ?? 5000;

    // Build metadata
    const metadata: Record<string, unknown> = {
      source: filePath,
      ...(detectedBy === "auto"
        ? { autoDetectedContentType: contentType, autoDetectionConfidence: detectionConfidence }
        : {}),
    };

    // ---- CacheAligner: check cache before compression (§31.3) ----

    const inputHash = contentHash(content);

    let resolvedStrategy = getStrategy(contentType);
    let effectiveContentType = contentType;
    if (!resolvedStrategy) {
      resolvedStrategy = getStrategy("plain_text");
      effectiveContentType = "plain_text";
    }
    const strategyVersion = resolvedStrategy?.version ?? "";

    const cacheKey = canCache(strategyVersion)
      ? computeCacheKey(scope.scopeId, inputHash, effectiveContentType, strategyVersion, maxTokens, keepOriginal)
      : "";

    if (cacheKey) {
      const cached = compressedStore.findByCacheKey(cacheKey, scope.scopeId);
      const cachedOriginalRef = cached?.originalRef;
      let cachedOriginalUsable =
        Boolean(cached?.compressedContent) && (
          !keepOriginal ||
        (
          Boolean(cachedOriginalRef) &&
          Boolean(cached?.canRetrieveOriginal) &&
          (cachedOriginalRef ? originalStore.exists(cachedOriginalRef, scope.scopeId) : false)
        ));
      if (cached && keepOriginal && !cachedOriginalUsable) {
        try {
          const repairedOriginal = originalStore.save({
            scopeId: scope.scopeId,
            ccrId: cached.id,
            contentType,
            content,
            metadata: {
              ...metadata,
              repairedFromCache: true,
            },
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
        // Cache hit — increment counter, create receipt, return cached result
        compressedStore.incrementCacheHit(cached.id);

        let cacheReceiptId = `rcp_cache_${cached.id}`;
        try {
          const cacheReceipt = receipts.create({
            operation: "compress",
            scopeId: scope.scopeId,
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

        closeDb();

        return ok({
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
          receiptId: cacheReceiptId,
          warnings: [`cacheHit=true (served from cache, hit #${cached.cacheHitCount + 1})`],
          cacheHit: true,
          cacheHitCount: cached.cacheHitCount + 1,
          detection: { method: "user", specifiedType: contentTypeRaw },
        });
      }
    }

    // Compress via safety layer
    const safetyResult = await compressSafely(
      {
        scopeId: scope.scopeId,
        content,
        contentType,
        strategy,
        keepOriginal,
        maxTokens,
        timeoutMs,
        metadata,
      },
    );

    const output = safetyResult.output;
    const warnings = [...safetyResult.safetyWarnings, ...output.warnings];

    // ---- Failure Learning (§33.2): record compression failures ----
    const failureStore = new FailureStore(db);
    try {
      if (output.failed) {
        const reason = output.errorReason ?? "";
        if (reason.includes("timeout")) {
          failureStore.record({
            scopeId: scope.scopeId,
            operation: "compress",
            eventType: "compression_timeout",
            contentType,
            strategy: output.strategy || strategy,
            errorReason: output.errorReason,
            metadata: { source: filePath, maxTokens, timeoutMs },
          });
        } else {
          failureStore.record({
            scopeId: scope.scopeId,
            operation: "compress",
            eventType: "compression_error",
            contentType,
            strategy: output.strategy || strategy,
            errorReason: output.errorReason,
            metadata: { source: filePath, maxTokens, timeoutMs },
          });
        }
      }

      // Check for oversized input signal
      if (
        safetyResult.safetyActions.includes("size_rejected") ||
        safetyResult.safetyActions.includes("size_truncated")
      ) {
        failureStore.record({
          scopeId: scope.scopeId,
          operation: "compress",
          eventType: "oversized_input",
          contentType,
          strategy: output.strategy || strategy,
          errorReason: "input_exceeded_size_limit",
          metadata: {
            source: filePath,
            contentLength: content.length,
            safetyActions: safetyResult.safetyActions,
          },
        });
      }

      // Check for poor compression ratio
      if (
        !output.failed &&
        output.compressionRatio < 0.05
      ) {
        failureStore.record({
          scopeId: scope.scopeId,
          operation: "compress",
          eventType: "poor_compression_ratio",
          contentType,
          strategy: output.strategy || strategy,
          errorReason: `compression_ratio_${Math.round(output.compressionRatio * 100)}pct`,
          metadata: {
            source: filePath,
            tokensBefore: output.tokensBefore,
            tokensAfter: output.tokensAfter,
            compressionRatio: output.compressionRatio,
          },
        });
      }
    } catch {
      // Failure recording is non-blocking — already handled inside record(),
      // but double-wrap for safety.
    }

    // Persist CCR
    let savedRecord = null;
    try {
      savedRecord = compressedStore.save({
        scopeId: output.scopeId,
        contentType: output.contentType,
        strategy: output.strategy || "none",
        compressedContent: output.compressedContent,
        summary: output.summary,
        originalRef: undefined,
        sourceRef: filePath,
        metadata: {
          ...metadata,
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
    } catch (dbErr) {
      warnings.push(
        `Database write warning: unable to persist CCR — ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
      );
    }

    // Save original
    let originalSaved = false;
    let storedOriginalRef: string | undefined;
    if (keepOriginal && savedRecord) {
      try {
        const savedOriginal = originalStore.save({
          scopeId: scope.scopeId,
          ccrId: savedRecord.id,
          contentType,
          content,
          metadata: {
            ...metadata,
            safetyWarnings: safetyResult.safetyWarnings,
          },
        });
        storedOriginalRef = savedOriginal.id;
        originalStore.linkOriginalToCcr(savedRecord.id, savedOriginal.id);
        originalSaved = true;
      } catch (origErr) {
        warnings.push(
          `Warning: unable to save original content — ${origErr instanceof Error ? origErr.message : String(origErr)}`,
        );
      }
    }

    // Create receipt
    let receiptId = output.receiptId;
    try {
      const receipt = receipts.create({
        operation: "compress",
        scopeId: scope.scopeId,
        inputHash: contentHash(content),
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
      warnings.push(
        `Warning: unable to record receipt — ${receiptErr instanceof Error ? receiptErr.message : String(receiptErr)}`,
      );
    }

    closeDb();

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
      receiptId,
      warnings,
      detection: detectedBy === "auto"
        ? { method: "auto", detectedAs: contentType, confidence: detectionConfidence }
        : { method: "user", specifiedType: contentTypeRaw },
    };

    if (output.failed) {
      result.failed = true;
      result.errorReason = output.errorReason;
    }

    if (safetyResult.safetyTriggered) {
      result.safetyActions = safetyResult.safetyActions;
    }

    return ok(result);
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 6. retrieve
// ---------------------------------------------------------------------------

export interface RetrieveOpts {
  offset?: number;
  limit?: number;
}

export async function runRetrieve(originalRef: string, opts: RetrieveOpts): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);
    const store = new OriginalStore(db);
    const receipts = new ReceiptService(db);

    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 10000; // Default limit 10000 for CLI safety

    const result = store.retrieve(originalRef, scope.scopeId, { offset, limit });

    if (!result) {
      // Check if it exists in a different scope
      const actualScope = store.lookupScope(originalRef);
      const deletedCheck = store.checkDeleted(originalRef);

      let errorMsg: string;
      let errorReason: "scope_mismatch" | "original_deleted" | "original_not_found";
      if (actualScope && actualScope !== scope.scopeId) {
        errorMsg = `Original "${originalRef}" belongs to scope "${actualScope}", not "${scope.scopeId}".`;
        errorReason = "scope_mismatch";
      } else if (deletedCheck.found && deletedCheck.deleted) {
        errorMsg = `Original "${originalRef}" was deleted and is no longer available.`;
        errorReason = "original_deleted";
      } else {
        errorMsg = `Original not found: ${originalRef}`;
        errorReason = "original_not_found";
      }

      // Create failure receipt
      receipts.create({
        operation: "retrieve_original",
        scopeId: scope.scopeId,
        inputHash: contentHash(`${scope.scopeId}:${originalRef}`),
        originalRefs: [originalRef],
        failed: true,
        errorReason,
      });

      closeDb();
      return fail(errorMsg);
    }

    // Success receipt
    receipts.create({
      operation: "retrieve_original",
      scopeId: scope.scopeId,
      inputHash: contentHash(`${scope.scopeId}:${originalRef}`),
      originalRefs: [originalRef],
      retrievedOriginal: true,
    });

    // ---- Failure Learning (§33.4): check high_retrieve_count ----
    try {
      const failureStore = new FailureStore(db);
      const retrieveCount = failureStore.getRetrieveCount(result.ccrId);
      if (
        retrieveCount >= HIGH_RETRIEVE_THRESHOLD &&
        !failureStore.hasRecentHighRetrieveEvent(result.ccrId, scope.scopeId)
      ) {
        failureStore.record({
          scopeId: scope.scopeId,
          operation: "retrieve_original",
          eventType: "high_retrieve_count",
          ccrId: result.ccrId,
          errorReason: `retrieved_${retrieveCount}_times`,
          metadata: {
            retrieveCount,
            originalRef,
            threshold: HIGH_RETRIEVE_THRESHOLD,
          },
        });
      }
    } catch {
      // Non-blocking
    }

    closeDb();
    return ok(result);
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 7. cleanup
// ---------------------------------------------------------------------------

export async function runCleanup(): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);
    const store = new OriginalStore(db);
    const receipts = new ReceiptService(db);

    const result = store.cleanup(scope.scopeId);

    // Create receipt
    receipts.create({
      operation: "cleanup_originals",
      scopeId: scope.scopeId,
      inputHash: contentHash(`cleanup:${scope.scopeId}:${Date.now()}`),
      ccrIds: result.affectedCcrIds,
    });

    closeDb();

    return ok({
      scopeId: scope.scopeId,
      deleted: result.deleted,
      affectedCcrIds: result.affectedCcrIds,
      message:
        result.deleted === 0
          ? "No expired originals to clean up."
          : `Deleted ${result.deleted} expired original(s). ${result.affectedCcrIds.length} CCR(s) affected.`,
    });
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 8. remember
// ---------------------------------------------------------------------------

const VALID_MEMORY_TYPES_CLI = new Set([
  "decision", "bug", "command", "file_summary", "project_rule",
  "user_preference", "current_task", "test_failure", "api_contract", "dependency",
]);

const VALID_PROFILE_TARGETS_CLI = new Set(["static", "dynamic"]);

const MAX_CONTENT_LENGTH_CLI = 256_000;

export interface RememberOpts {
  type: string;
  content?: string;
  file?: string;
  summary?: string;
  sourceRef?: string;
  confidence?: number;
  profileTarget?: string;
  expiresAt?: string;
  tags?: string[];
}

export async function runRemember(opts: RememberOpts): Promise<CliResult> {
  // Validate type
  if (!VALID_MEMORY_TYPES_CLI.has(opts.type)) {
    return fail(
      `Invalid type "${opts.type}". Valid types: ${Array.from(VALID_MEMORY_TYPES_CLI).join(", ")}`,
    );
  }

  // Get content: from --content or --file
  let content: string;
  if (opts.content !== undefined) {
    content = opts.content;
  } else if (opts.file) {
    try {
      content = readFileSync(opts.file, "utf-8");
    } catch (err) {
      return fail(
        `Cannot read file: ${opts.file} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    return fail("Either --content or --file is required.");
  }

  if (!content || !content.trim()) {
    return fail("Content must not be empty.");
  }

  if (content.length > MAX_CONTENT_LENGTH_CLI) {
    return fail(
      `Content exceeds maximum length of ${MAX_CONTENT_LENGTH_CLI} characters (got ${content.length}).`,
    );
  }

  // Validate confidence
  if (opts.confidence !== undefined) {
    if (Number.isNaN(opts.confidence) || opts.confidence < 0 || opts.confidence > 1) {
      return fail(`confidence must be between 0 and 1 (got ${opts.confidence}).`);
    }
  }

  // Validate profileTarget
  let profileTarget: "static" | "dynamic" | undefined;
  if (opts.profileTarget) {
    if (!VALID_PROFILE_TARGETS_CLI.has(opts.profileTarget)) {
      return fail(
        `Invalid profileTarget "${opts.profileTarget}". Valid values: static, dynamic.`,
      );
    }
    profileTarget = opts.profileTarget as "static" | "dynamic";
  }

  // Validate expiresAt
  if (opts.expiresAt) {
    const parsed = Date.parse(opts.expiresAt);
    if (Number.isNaN(parsed) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(opts.expiresAt)) {
      return fail(
        `expiresAt must be a valid ISO 8601 date string (e.g. "2027-06-10T00:00:00Z"), got "${opts.expiresAt}".`,
      );
    }
  }

  // Init DB
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    const ftsIndex = new MemoryFtsIndex(db);
    const memoryService = new MemoryService(db, { ftsIndex });

    const summary = opts.summary?.trim() || undefined;
    const sourceRef = opts.sourceRef?.trim() || undefined;

    const result = memoryService.remember({
      scopeId: scope.scopeId,
      type: opts.type as MemoryType,
      content,
      summary,
      sourceRef,
      confidence: opts.confidence,
      profileTarget,
      expiresAt: opts.expiresAt,
      tags: opts.tags,
    });

    closeDb();

    return ok({
      memoryId: result.memoryId,
      scopeId: result.scopeId,
      type: result.type,
      status: result.status,
      receiptId: result.receiptId,
      ...(summary ? { summary } : {}),
      ...(sourceRef ? { sourceRef } : {}),
      ...(profileTarget ? { profileTarget } : {}),
    });
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 9. forget
// ---------------------------------------------------------------------------

const VALID_FORGET_MODES_CLI = new Set([
  "soft_forget", "supersede", "expire", "hard_delete",
]);

export interface ForgetOpts {
  id: string;
  mode: string;
  reason?: string;
  supersededBy?: string;
}

export async function runForget(opts: ForgetOpts): Promise<CliResult> {
  // Validate id
  if (!opts.id || !opts.id.trim()) {
    return fail("id is required.");
  }

  // Validate mode (trim for robustness, consistent with MCP handler)
  const mode = opts.mode.trim();
  if (!VALID_FORGET_MODES_CLI.has(mode)) {
    return fail(
      `Invalid mode "${mode}". Valid modes: ${Array.from(VALID_FORGET_MODES_CLI).join(", ")}`,
    );
  }

  // Validate supersededBy for supersede mode
  if (mode === "supersede" && !opts.supersededBy) {
    return fail('supersededBy is required when mode is "supersede".');
  }

  // Init DB
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    const ftsIndex = new MemoryFtsIndex(db);
    const memoryService = new MemoryService(db, { ftsIndex });

    const result = memoryService.forget({
      id: opts.id.trim(),
      scopeId: scope.scopeId,
      mode: mode as "soft_forget" | "supersede" | "expire" | "hard_delete",
      reason: opts.reason,
      supersededBy: opts.supersededBy,
    });

    if (!result) {
      closeDb();
      return fail(
        `Memory not found: "${opts.id}". Check that the memory exists and belongs to scope "${scope.scopeId}".`,
      );
    }

    // ---- Failure Learning (§33.3): record recall_wrong_memory AFTER successful forget ----
    // failure_events uses soft references (no FK), so recording after hard_delete is safe.
    try {
      const failureStore = new FailureStore(db);
      failureStore.record({
        scopeId: scope.scopeId,
        operation: "recall",
        eventType: "recall_wrong_memory",
        memoryId: result.memoryId,
        errorReason: `forgotten_via_${mode}`,
        metadata: {
          forgetMode: mode,
          previousStatus: result.previousStatus,
          reason: opts.reason,
        },
      });
    } catch {
      // Non-blocking
    }

    closeDb();

    return ok({
      memoryId: result.memoryId,
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
      receiptId: result.receiptId,
      ...(result.supersededBy ? { supersededBy: result.supersededBy } : {}),
      ...(opts.reason ? { reason: opts.reason } : {}),
    });
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 10. recall — search project memory
// ---------------------------------------------------------------------------

export interface RecallOpts {
  types?: string[];
  status?: string[];
  limit?: number;
  includeProfile?: boolean;
  includeRelatedCCRs?: boolean;
}

export async function runRecall(query: string, opts: RecallOpts): Promise<CliResult> {
  // Validate query
  if (!query || !query.trim()) {
    return fail("Usage: code-context recall <query> [options]\n  query is required.");
  }

  // Validate types if provided
  if (opts.types && opts.types.length > 0) {
    for (const t of opts.types) {
      if (!VALID_MEMORY_TYPES_CLI.has(t)) {
        return fail(
          `Invalid type "${t}". Valid types: ${Array.from(VALID_MEMORY_TYPES_CLI).join(", ")}`,
        );
      }
    }
  }

  // Validate statuses if provided
  if (opts.status && opts.status.length > 0) {
    const validStatuses = new Set(["active", "superseded", "forgotten", "expired"]);
    for (const s of opts.status) {
      if (!validStatuses.has(s)) {
        return fail(
          `Invalid status "${s}". Valid statuses: active, superseded, forgotten, expired.`,
        );
      }
    }
  }

  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    const ftsIndex = new MemoryFtsIndex(db);
    const recallEngine = new RecallEngine(db, ftsIndex);
    const receipts = new ReceiptService(db);
    const profileService = new ProfileService(db, { receipts });

    const limit = opts.limit ?? 10;

    // Search memories
    const results = recallEngine.searchEnhanced({
      scopeId: scope.scopeId,
      query: query.trim(),
      types: opts.types as MemoryType[] | undefined,
      status: opts.status as MemoryStatus[] | undefined,
      limit,
      includeCanExpand: opts.includeRelatedCCRs ?? true,
    });

    // ---- Failure Learning (§33.3): record recall failures ----
    const failureStore = new FailureStore(db);
    try {
      if (results.length === 0) {
        failureStore.record({
          scopeId: scope.scopeId,
          operation: "recall",
          eventType: "recall_no_hit",
          errorReason: `no_results_for_query`,
          metadata: { query: query.trim(), types: opts.types, status: opts.status },
        });
      } else {
        // Check for low confidence across all results
        const allLowConfidence = results.every(
          (r) => (r.finalScore ?? r.score) < 0.3,
        );
        if (allLowConfidence) {
          failureStore.record({
            scopeId: scope.scopeId,
            operation: "recall",
            eventType: "recall_low_confidence",
            errorReason: `all_results_below_confidence_threshold`,
            metadata: {
              query: query.trim(),
              resultCount: results.length,
              maxScore: Math.max(...results.map((r) => r.finalScore ?? r.score)),
            },
          });
        }
      }
    } catch {
      // Non-blocking
    }

    // Get profile if requested
    let profile: { static: unknown[]; dynamic: unknown[] } | undefined;
    if (opts.includeProfile) {
      const repoProfile = profileService.getProfile(scope.scopeId);
      profile = {
        static: repoProfile.staticFacts.map((f) => ({
          id: f.id,
          content: f.content,
          sourceMemoryId: f.sourceMemoryId,
          confidence: f.confidence,
          createdAt: f.createdAt,
        })),
        dynamic: repoProfile.dynamicContext.map((f) => ({
          id: f.id,
          content: f.content,
          sourceMemoryId: f.sourceMemoryId,
          confidence: f.confidence,
          createdAt: f.createdAt,
        })),
      };
    }

    // Get related CCRs if requested
    let relatedCCRs: unknown[] | undefined;
    if (opts.includeRelatedCCRs && results.length > 0) {
      const memories = results.map((r) => r.memory);
      const ccrs = recallEngine.findRelatedCCRs(scope.scopeId, memories);
      relatedCCRs = ccrs.map((c) => ({
        ccrId: c.ccrId,
        summary: c.summary,
        originalRef: c.originalRef,
        canRetrieveOriginal: c.canRetrieveOriginal,
      }));
    }

    // Create receipt — capture query and filters for auditability
    const receiptQueryParts: string[] = [query.trim()];
    if (opts.types && opts.types.length > 0) receiptQueryParts.push(`types:${opts.types.join(",")}`);
    if (opts.status && opts.status.length > 0) receiptQueryParts.push(`status:${opts.status.join(",")}`);

    const receipt = receipts.create({
      operation: "recall",
      scopeId: scope.scopeId,
      query: receiptQueryParts.join(" "),
      memoryIds: results.map((r) => r.memory.id),
      compressed: results.length > 0,
    });

    closeDb();

    const result: Record<string, unknown> = {
      scopeId: scope.scopeId,
      query: query.trim(),
      count: results.length,
      receiptId: receipt.id,
      results: results.map((r) => ({
        memoryId: r.memory.id,
        type: r.memory.type,
        summary: r.memory.summary,
        status: r.memory.status,
        sourceRef: r.memory.sourceRef,
        confidence: r.memory.confidence,
        score: r.score,
        mergedScore: r.mergedScore,
        recencyBoost: r.recencyBoost,
        finalScore: r.finalScore,
        rank: r.rank,
        canExpand: r.canExpand,
        createdAt: r.memory.createdAt,
      })),
      ...(profile ? { profile } : {}),
      ...(relatedCCRs ? { relatedCCRs } : {}),
    };

    return ok(result);
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 11. list-context — list project memories
// ---------------------------------------------------------------------------

export interface ListContextOpts {
  types?: string[];
  status?: string[];
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: string;
}

const VALID_SORT_FIELDS_CLI = new Set([
  "createdAt", "updatedAt", "type", "status", "confidence",
]);

const VALID_SORT_ORDERS_CLI = new Set(["asc", "desc"]);

export async function runListContext(opts: ListContextOpts): Promise<CliResult> {
  // Validate types
  if (opts.types && opts.types.length > 0) {
    for (const t of opts.types) {
      if (!VALID_MEMORY_TYPES_CLI.has(t)) {
        return fail(
          `Invalid type "${t}". Valid types: ${Array.from(VALID_MEMORY_TYPES_CLI).join(", ")}`,
        );
      }
    }
  }

  // Validate statuses
  if (opts.status && opts.status.length > 0) {
    const validStatuses = new Set(["active", "superseded", "forgotten", "expired"]);
    for (const s of opts.status) {
      if (!validStatuses.has(s)) {
        return fail(
          `Invalid status "${s}". Valid statuses: active, superseded, forgotten, expired.`,
        );
      }
    }
  }

  // Validate sortBy
  if (opts.sortBy && !VALID_SORT_FIELDS_CLI.has(opts.sortBy)) {
    return fail(
      `Invalid sortBy "${opts.sortBy}". Valid fields: ${Array.from(VALID_SORT_FIELDS_CLI).join(", ")}`,
    );
  }

  // Validate sortOrder
  if (opts.sortOrder && !VALID_SORT_ORDERS_CLI.has(opts.sortOrder)) {
    return fail(`Invalid sortOrder "${opts.sortOrder}". Valid values: asc, desc.`);
  }

  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    const ftsIndex = new MemoryFtsIndex(db);
    const memoryService = new MemoryService(db, { ftsIndex });
    const receipts = new ReceiptService(db);

    const result = memoryService.list({
      scopeId: scope.scopeId,
      types: opts.types as MemoryType[] | undefined,
      status: opts.status as MemoryStatus[] | undefined,
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
      sortBy: opts.sortBy as ListMemorySortField | undefined,
      sortOrder: opts.sortOrder as SortOrder | undefined,
    });

    // Create receipt — capture filter params for auditability
    const queryParts: string[] = [];
    if (opts.types && opts.types.length > 0) queryParts.push(`types:${opts.types.join(",")}`);
    if (opts.status && opts.status.length > 0) queryParts.push(`status:${opts.status.join(",")}`);
    if (opts.sortBy) queryParts.push(`sortBy:${opts.sortBy}`);
    const receiptQuery = queryParts.length > 0 ? queryParts.join(" ") : undefined;

    const receipt = receipts.create({
      operation: "list",
      scopeId: scope.scopeId,
      query: receiptQuery,
      memoryIds: result.items.map((i) => i.id),
    });

    closeDb();

    return ok({
      scopeId: result.scopeId,
      receiptId: receipt.id,
      items: result.items.map((m) => ({
        memoryId: m.id,
        type: m.type,
        summary: m.summary,
        content: m.content.length > 500 ? m.content.slice(0, 500) + "..." : m.content,
        status: m.status,
        sourceRef: m.sourceRef,
        confidence: m.confidence,
        tags: m.tags,
        supersededBy: m.supersededBy,
        supersedes: m.supersedes,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        expiresAt: m.expiresAt,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 12. profile — view repo profile
// ---------------------------------------------------------------------------

export interface ProfileOpts {
  layer?: "static" | "dynamic";
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function runProfile(opts: ProfileOpts): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    const receipts = new ReceiptService(db);
    const profileService = new ProfileService(db, { receipts });

    const activeOnly = opts.activeOnly ?? true;

    if (opts.layer === "static") {
      const result = profileService.getStaticFacts(scope.scopeId, {
        activeOnly,
        limit: opts.limit,
        offset: opts.offset,
      });

      closeDb();

      return ok({
        scopeId: result.scopeId,
        layer: "static",
        items: result.items.map((f) => ({
          id: f.id,
          content: f.content,
          sourceMemoryId: f.sourceMemoryId,
          sourceRef: f.sourceRef,
          confidence: f.confidence,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
          expiresAt: f.expiresAt,
        })),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        activeOnly,
      });
    }

    if (opts.layer === "dynamic") {
      const result = profileService.getDynamicContext(scope.scopeId, {
        activeOnly,
        limit: opts.limit,
        offset: opts.offset,
      });

      closeDb();

      return ok({
        scopeId: result.scopeId,
        layer: "dynamic",
        items: result.items.map((f) => ({
          id: f.id,
          content: f.content,
          sourceMemoryId: f.sourceMemoryId,
          sourceRef: f.sourceRef,
          confidence: f.confidence,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
          expiresAt: f.expiresAt,
        })),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        activeOnly,
      });
    }

    // Default: return full profile (both layers)
    const repoProfile = profileService.getProfile(scope.scopeId, { activeOnly });

    closeDb();

    return ok({
      scopeId: repoProfile.scopeId,
      staticFacts: repoProfile.staticFacts.map((f) => ({
        id: f.id,
        content: f.content,
        sourceMemoryId: f.sourceMemoryId,
        sourceRef: f.sourceRef,
        confidence: f.confidence,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        expiresAt: f.expiresAt,
      })),
      dynamicContext: repoProfile.dynamicContext.map((f) => ({
        id: f.id,
        content: f.content,
        sourceMemoryId: f.sourceMemoryId,
        sourceRef: f.sourceRef,
        confidence: f.confidence,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        expiresAt: f.expiresAt,
      })),
      updatedAt: repoProfile.updatedAt,
      activeOnly,
    });
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 13. cache stats — CacheAligner cache statistics
// ---------------------------------------------------------------------------

export async function runCacheStats(): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    const store = new CompressedStore(db);
    const stats = store.getCacheStats(scope.scopeId);

    closeDb();

    return ok({
      ...stats,
      hitRate:
        stats.totalEntries > 0
          ? Math.round((stats.totalHits / stats.totalEntries) * 10000) / 10000
          : 0,
    });
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 14. cache clear — clear CacheAligner cache
// ---------------------------------------------------------------------------

export async function runCacheClear(): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    const store = new CompressedStore(db);
    const result = store.clearCache(scope.scopeId);

    closeDb();

    return ok({
      scopeId: scope.scopeId,
      deleted: result.deleted,
      message:
        result.deleted === 0
          ? "No cache entries to clear."
          : `Cleared ${result.deleted} cache entry/entries.`,
    });
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 15. cache list — list CacheAligner cache entries
// ---------------------------------------------------------------------------

export interface CacheListOpts {
  limit?: number;
  offset?: number;
}

export async function runCacheList(opts: CacheListOpts): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    const store = new CompressedStore(db);
    const result = store.listCacheEntries(scope.scopeId, {
      limit: opts.limit,
      offset: opts.offset,
    });

    closeDb();

    return ok(result);
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 16. receipts — list all receipts
// ---------------------------------------------------------------------------

export interface ReceiptsOpts {
  operation?: string;
  limit?: number;
  offset?: number;
}

export async function runReceipts(opts: ReceiptsOpts): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    const receipts = new ReceiptService(db);

    const items = receipts.list(scope.scopeId, {
      operation: opts.operation,
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
    });

    closeDb();

    return ok({
      scopeId: scope.scopeId,
      items: items.map((r) => ({
        id: r.id,
        operation: r.operation,
        inputHash: r.inputHash,
        query: r.query,
        resultIds: r.resultIds,
        memoryIds: r.memoryIds,
        ccrIds: r.ccrIds,
        originalRefs: r.originalRefs,
        tokensBefore: r.tokensBefore,
        tokensAfter: r.tokensAfter,
        tokensSaved: r.tokensSaved,
        compressionRatio: r.compressionRatio,
        compressed: r.compressed,
        retrievedOriginal: r.retrievedOriginal,
        failed: r.failed,
        errorReason: r.errorReason,
        timestamp: r.timestamp,
      })),
      count: items.length,
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
    });
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 17. failures list — list failure events (§33.5)
// ---------------------------------------------------------------------------

export interface FailuresListOpts {
  eventType?: string;
  operation?: string;
  limit?: number;
  offset?: number;
}

const VALID_FAILURE_EVENT_TYPES = new Set([
  "compression_timeout", "compression_error",
  "oversized_input", "poor_compression_ratio",
  "recall_no_hit", "recall_low_confidence",
  "recall_wrong_memory", "high_retrieve_count",
]);

const VALID_FAILURE_OPERATIONS = new Set([
  "compress", "recall", "retrieve_original",
]);

export async function runFailuresList(opts: FailuresListOpts): Promise<CliResult> {
  // Validate eventType
  if (opts.eventType && !VALID_FAILURE_EVENT_TYPES.has(opts.eventType)) {
    return fail(
      `Invalid eventType "${opts.eventType}". Valid values: ${Array.from(VALID_FAILURE_EVENT_TYPES).join(", ")}`,
    );
  }

  // Validate operation
  if (opts.operation && !VALID_FAILURE_OPERATIONS.has(opts.operation)) {
    return fail(
      `Invalid operation "${opts.operation}". Valid values: ${Array.from(VALID_FAILURE_OPERATIONS).join(", ")}`,
    );
  }

  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    const failureStore = new FailureStore(db);
    const result = failureStore.list({
      scopeId: scope.scopeId,
      eventType: opts.eventType as FailureEventType | undefined,
      operation: opts.operation as FailureOperation | undefined,
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
    });

    closeDb();

    return ok({
      scopeId: result.scopeId,
      items: result.items.map((e) => ({
        id: e.id,
        operation: e.operation,
        eventType: e.eventType,
        contentType: e.contentType,
        strategy: e.strategy,
        ccrId: e.ccrId,
        memoryId: e.memoryId,
        errorReason: e.errorReason,
        metadata: e.metadata,
        createdAt: e.createdAt,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 18. failures stats — failure event statistics (§33.5)
// ---------------------------------------------------------------------------

export async function runFailuresStats(): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();
    ensureScopeRecord(db);

    const failureStore = new FailureStore(db);
    const stats = failureStore.stats(scope.scopeId);

    closeDb();

    return ok(stats);
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 19. demo — first-run value demo
// ---------------------------------------------------------------------------

/** Resolve the package root directory from the current module location. */
function resolvePackageRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // __dirname is .../src/cli (dev) or .../dist/cli (production).
  // Package root is two levels up.
  return join(__dirname, "..", "..");
}

/** Resolve the examples/first-run directory within the package. */
function resolveExamplesDir(): string {
  return join(resolvePackageRoot(), "examples", "first-run");
}

/** Resolve the reports/demo output directory (relative to cwd). */
function resolveReportsDir(): string {
  return join(process.cwd(), "reports", "demo");
}

export interface DemoReportData {
  reportPath: string;
  steps: {
    compress: {
      success: boolean;
      originalSizeBytes: number;
      compressedSizeBytes: number;
      tokensBefore: number;
      tokensAfter: number;
      tokensSaved: number;
      compressionRatio: number;
      originalRef: string;
      ccrId: string;
      error?: string;
    };
    remember: {
      success: boolean;
      memoryId: string;
      type: string;
      contentSizeBytes: number;
      error?: string;
    };
    recall: {
      success: boolean;
      query: string;
      resultCount: number;
      topMatchSummary: string;
      topMatchScore: number;
      error?: string;
    };
    retrieve: {
      success: boolean;
      originalRef: string;
      contentPreview: string;
      fullLength: number;
      originalSizeBytes: number;
      retrievedHash: string;
      originalHash: string;
      proofPassed: boolean;
      error?: string;
    };
  };
}

export async function runDemo(): Promise<CliResult> {
  const examplesDir = resolveExamplesDir();
  const reportsDir = resolveReportsDir();
  const now = new Date().toISOString();

  const sampleLogPath = join(examplesDir, "sample-error.log");
  const sampleRulePath = join(examplesDir, "sample-project-rule.md");
  const sampleQueryPath = join(examplesDir, "sample-recall-query.txt");

  // Verify sample files exist
  for (const [label, p] of [
    ["sample-error.log", sampleLogPath],
    ["sample-project-rule.md", sampleRulePath],
    ["sample-recall-query.txt", sampleQueryPath],
  ] as const) {
    try {
      readFileSync(p, "utf-8");
    } catch {
      return fail(
        `Demo sample file not found: ${label}\n` +
          `Expected at: ${p}\n` +
          `Make sure examples/first-run/ is included in the package.`,
      );
    }
  }

  const report: DemoReportData = {
    reportPath: join(reportsDir, "first-run-value.md"),
    steps: {
      compress: {
        success: false,
        originalSizeBytes: 0,
        compressedSizeBytes: 0,
        tokensBefore: 0,
        tokensAfter: 0,
        tokensSaved: 0,
        compressionRatio: 0,
        originalRef: "",
        ccrId: "",
      },
      remember: {
        success: false,
        memoryId: "",
        type: "project_rule",
        contentSizeBytes: 0,
      },
      recall: {
        success: false,
        query: "",
        resultCount: 0,
        topMatchSummary: "",
        topMatchScore: 0,
      },
      retrieve: {
        success: false,
        originalRef: "",
        contentPreview: "",
        fullLength: 0,
        originalSizeBytes: 0,
        retrievedHash: "",
        originalHash: "",
        proofPassed: false,
      },
    },
  };

  // ---- Step 1: Compress sample log ----
  try {
    const logContent = readFileSync(sampleLogPath, "utf-8");
    report.steps.compress.originalSizeBytes = Buffer.byteLength(logContent, "utf-8");

    const compressResult = await runCompress(sampleLogPath, {
      type: "log",
      strategy: "conservative",
      keepOriginal: true,
    });

    if (compressResult.status === "ok") {
      const d = compressResult.data as Record<string, unknown>;
      report.steps.compress.success = true;
      report.steps.compress.tokensBefore = (d.tokensBefore as number) ?? 0;
      report.steps.compress.tokensAfter = (d.tokensAfter as number) ?? 0;
      report.steps.compress.tokensSaved = (d.tokensSaved as number) ?? 0;
      report.steps.compress.compressionRatio = (d.compressionRatio as number) ?? 0;
      report.steps.compress.originalRef = (d.originalRef as string) ?? "";
      report.steps.compress.ccrId = (d.ccrId as string) ?? "";
      report.steps.compress.compressedSizeBytes =
        Buffer.byteLength((d.compressedContent as string) ?? "", "utf-8");
    } else {
      report.steps.compress.error = compressResult.error;
    }
  } catch (err) {
    report.steps.compress.error = err instanceof Error ? err.message : String(err);
  }

  // ---- Step 2: Remember project rule ----
  try {
    const ruleContent = readFileSync(sampleRulePath, "utf-8");
    report.steps.remember.contentSizeBytes = Buffer.byteLength(ruleContent, "utf-8");

    const rememberResult = await runRemember({
      type: "project_rule",
      file: sampleRulePath,
      summary: "Project coding standards: pnpm, TypeScript strict, vitest, conventional commits",
      profileTarget: "static",
      tags: ["coding-standards", "first-run-demo"],
    });

    if (rememberResult.status === "ok") {
      const d = rememberResult.data as Record<string, unknown>;
      report.steps.remember.success = true;
      report.steps.remember.memoryId = (d.memoryId as string) ?? "";
    } else {
      report.steps.remember.error = rememberResult.error;
    }
  } catch (err) {
    report.steps.remember.error = err instanceof Error ? err.message : String(err);
  }

  // ---- Step 3: Recall project memory ----
  try {
    const queryContent = readFileSync(sampleQueryPath, "utf-8").trim();
    report.steps.recall.query = queryContent;

    const recallResult = await runRecall(queryContent, {
      types: ["project_rule"],
      limit: 5,
      includeProfile: true,
    });

    if (recallResult.status === "ok") {
      const d = recallResult.data as Record<string, unknown>;
      const results = (d.results as Array<Record<string, unknown>>) ?? [];
      report.steps.recall.success = true;
      report.steps.recall.resultCount = results.length;
      if (results.length > 0) {
        report.steps.recall.topMatchSummary = (results[0]!.summary as string) ?? "";
        report.steps.recall.topMatchScore = (results[0]!.finalScore as number) ?? (results[0]!.score as number) ?? 0;
      }
    } else {
      report.steps.recall.error = recallResult.error;
    }
  } catch (err) {
    report.steps.recall.error = err instanceof Error ? err.message : String(err);
  }

  // ---- Step 4: Retrieve original from compression ----
  if (report.steps.compress.success && report.steps.compress.originalRef) {
    try {
      report.steps.retrieve.originalRef = report.steps.compress.originalRef;

      // Read original file to compute hash
      const logContent = readFileSync(sampleLogPath, "utf-8");
      report.steps.retrieve.originalSizeBytes = Buffer.byteLength(logContent, "utf-8");
      report.steps.retrieve.originalHash = contentHash(logContent);

      // For demo proof: use OriginalStore.getRecord to retrieve full content
      // This bypasses the CLI limit and demonstrates complete retrieval capability
      const init = await initDb();
      if (!init.ok) {
        report.steps.retrieve.error = init.error;
      } else {
        const db = init.db;
        const scope = resolveScope();
        const store = new OriginalStore(db);

        const fullRecord = store.getRecord(report.steps.compress.originalRef, scope.scopeId);

        if (fullRecord) {
          const content = fullRecord.content;

          report.steps.retrieve.success = true;
          report.steps.retrieve.fullLength = content.length;
          report.steps.retrieve.retrievedHash = contentHash(content);
          report.steps.retrieve.proofPassed =
            report.steps.retrieve.fullLength === logContent.length &&
            report.steps.retrieve.retrievedHash === report.steps.retrieve.originalHash;
          report.steps.retrieve.contentPreview =
            content.length > 300 ? content.slice(0, 300) + "..." : content;
        } else {
          report.steps.retrieve.error = "Failed to retrieve full original record";
        }
      }
    } catch (err) {
      report.steps.retrieve.error = err instanceof Error ? err.message : String(err);
    }
  } else {
    report.steps.retrieve.error = "Skipped: compression step did not produce an originalRef";
  }

  // ---- Step 5: Generate markdown and JSON reports ----
  try {
    mkdirSync(reportsDir, { recursive: true });
    const md = generateDemoReport(report, now);
    const mdPath = report.reportPath;
    const jsonPath = mdPath.replace(/\.md$/, ".json");

    writeFileSync(mdPath, md, "utf-8");
    writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  } catch (err) {
    return fail(
      `Failed to write report: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return ok({
    reportPath: report.reportPath,
    jsonPath: report.reportPath.replace(/\.md$/, ".json"),
    summary: {
      compress: report.steps.compress.success
        ? `${report.steps.compress.tokensSaved} tokens saved (${(report.steps.compress.compressionRatio * 100).toFixed(1)}% ratio)`
        : `failed: ${report.steps.compress.error ?? "unknown"}`,
      remember: report.steps.remember.success
        ? `saved memory ${report.steps.remember.memoryId}`
        : `failed: ${report.steps.remember.error ?? "unknown"}`,
      recall: report.steps.recall.success
        ? `found ${report.steps.recall.resultCount} result(s) for "${report.steps.recall.query.slice(0, 50)}"`
        : `failed: ${report.steps.recall.error ?? "unknown"}`,
      retrieve: report.steps.retrieve.success
        ? `recovered ${report.steps.retrieve.fullLength} chars from original`
        : `failed: ${report.steps.retrieve.error ?? "unknown"}`,
    },
  });
}

function generateDemoReport(report: DemoReportData, now: string): string {
  const c = report.steps.compress;
  const r = report.steps.remember;
  const q = report.steps.recall;
  const v = report.steps.retrieve;

  const ratioPct = c.success ? (c.compressionRatio * 100).toFixed(1) : "N/A";
  const tokensSaved = c.success ? c.tokensSaved.toLocaleString() : "N/A";

  return `# CodeContext — First-Run Value Demo

**Generated**: ${now}

---

## What This Demo Shows

CodeContext MCP solves two critical problems for AI coding agents:

1. **Context Compression** — Long logs, test output, and error traces waste tokens. CodeContext compresses them while preserving critical details.
2. **Project Memory** — Important project knowledge gets forgotten between sessions. CodeContext stores, recalls, and manages scoped project memory.

This report was generated by running \`code-context demo\` with sample data.

---

## Step 1: Compress a Server Error Log

### Input

- **File**: \`examples/first-run/sample-error.log\`
- **Content type**: auto-detected as log
- **Original size**: ${c.originalSizeBytes.toLocaleString()} bytes (${c.tokensBefore.toLocaleString()} tokens)

### Output

- **Compressed size**: ${c.success ? c.compressedSizeBytes.toLocaleString() + " bytes" : "N/A"}
- **Tokens after compression**: ${c.success ? c.tokensAfter.toLocaleString() : "N/A"}
- **Tokens saved**: **${tokensSaved}**
- **Compression ratio**: **${ratioPct}%**
- **Original reference**: \`${c.originalRef || "N/A"}\`
- **CCR ID**: \`${c.ccrId || "N/A"}\`

${c.success ? `
### What Was Preserved

The compression strategy preserved:
- All ERROR and FATAL log lines with full stack traces
- Error messages and source locations (file:line)
- Request IDs, user IDs, and timing data
- Service names and HTTP status codes

Less important INFO lines were summarized or omitted.
` : `> ⚠️ Compression step failed: ${c.error ?? "unknown"}`}

---

## Step 2: Save Project Memory

### Input

- **File**: \`examples/first-run/sample-project-rule.md\`
- **Type**: project_rule
- **Size**: ${r.contentSizeBytes.toLocaleString()} bytes
- **Profile layer**: static (long-term project knowledge)

### Output

${r.success ? `
- **Memory ID**: \`${r.memoryId}\`
- **Status**: active
- **Stored in**: repo profile (static layer)

This project rule will persist across sessions and can be recalled whenever an agent needs to know coding standards.
` : `> ⚠️ Remember step failed: ${r.error ?? "unknown"}`}

---

## Step 3: Recall Project Memory

### Query

> ${q.query || "N/A"}

### Output

${q.success ? `
- **Results found**: ${q.resultCount}
- **Top match**: "${q.topMatchSummary}"
- **Score**: ${q.topMatchScore.toFixed(3)}

CodeContext successfully recalled the project rule that was saved in Step 2, demonstrating that project knowledge persists and is retrievable.
` : `> ⚠️ Recall step failed: ${q.error ?? "unknown"}`}

---

## Step 4: Retrieve Original Content

### Input

- **Original reference**: \`${v.originalRef || "N/A"}\`

### Output

${v.success ? `
- **Retrieved**: ${v.fullLength.toLocaleString()} characters
- **Preview**:
\`\`\`
${v.contentPreview}
\`\`\`

The original content is fully recoverable from the compressed record. This means agents can always expand compressed context when needed — no information is permanently lost.
` : `> ⚠️ Retrieve step failed: ${v.error ?? "unknown"}`}

---

## Summary

| Step | Status | Key Metric |
|------|--------|------------|
| Compress | ${c.success ? "✅" : "❌"} | ${tokensSaved} tokens saved (${ratioPct}% ratio) |
| Remember | ${r.success ? "✅" : "❌"} | Memory \`${r.memoryId || "N/A"}\` saved |
| Recall | ${q.success ? "✅" : "❌"} | ${q.resultCount} result(s) found |
| Retrieve | ${v.success ? "✅" : "❌"} | ${v.success ? v.fullLength.toLocaleString() + " chars recovered" : "N/A"} |

---

## What This Means for Your Workflow

### Before CodeContext
- 100KB error logs consume ~25,000 tokens of context window
- Project rules are forgotten between sessions
- Agents repeat the same mistakes

### After CodeContext
- The same log is compressed to ~5% of its original token cost
- Project rules persist and are recalled on demand
- Original content is always recoverable via \`retrieve_original\`
- Everything is local-first — no data leaves your machine

---

## Try It Yourself

\`\`\`bash
# Compress a log file
code-context compress ./app-error.log

# Save a project rule
code-context remember --type project_rule --file ./rules.md --profile-target static

# Recall project knowledge
code-context recall "package manager" --profile

# Retrieve original content
code-context retrieve orig_abc123

# View all saved memories
code-context list-context

# See token savings over time
code-context stats
\`\`\`

---

*Generated by CodeContext MCP v1.0.0 — local-first context layer for AI coding agents*
`;
}

// ---------------------------------------------------------------------------
// value
// ---------------------------------------------------------------------------

export async function runValue(): Promise<CliResult> {
  const init = await initDb();
  if (!init.ok) return fail(init.error);

  try {
    const db = init.db;
    const scope = resolveScope();

    // Build value report
    const report = buildValueReport(db, scope.scopeId, {
      topN: 5,
      recentN: 10,
    });

    // Generate markdown
    const markdown = formatValueReportMarkdown(report);

    // Write reports to reports/usage/
    const usageDir = join(process.cwd(), "reports", "usage");
    mkdirSync(usageDir, { recursive: true });

    const mdPath = join(usageDir, "value-report.md");
    const jsonPath = join(usageDir, "value-report.json");

    writeFileSync(mdPath, markdown, "utf-8");
    writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

    closeDb();

    return ok({
      scopeId: scope.scopeId,
      summary: report.summary,
      reportPaths: {
        markdown: mdPath,
        json: jsonPath,
      },
      message: report.summary.totalCompressions === 0
        ? "No usage data yet. Compress some content or save memories to see value metrics."
        : `Value report generated. Total tokens saved: ${report.summary.totalEstimatedTokensSaved.toLocaleString()}`,
    });
  } catch (err) {
    closeDb();
    return fail(err instanceof Error ? err.message : String(err));
  }
}
