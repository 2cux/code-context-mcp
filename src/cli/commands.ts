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

import { readFileSync } from "node:fs";
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
import { MemoryService } from "../memory/memoryService.js";
import { MemoryFtsIndex } from "../memory/memoryFts.js";
import type { ContentType } from "../compressed/compressedStore.js";
import type { MemoryType, MemoryStatus } from "../memory/types.js";

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

    // Persist CCR
    let savedRecord = null;
    try {
      savedRecord = compressedStore.save({
        scopeId: output.scopeId,
        contentType: output.contentType,
        strategy: output.strategy || "none",
        compressedContent: output.compressedContent,
        summary: output.summary,
        originalRef: output.originalRef,
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
        canRetrieveOriginal: output.canRetrieveOriginal,
        failed: output.failed ?? false,
        errorReason: output.errorReason,
      });
    } catch (dbErr) {
      warnings.push(
        `Database write warning: unable to persist CCR — ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
      );
    }

    // Save original
    let originalSaved = false;
    if (keepOriginal && savedRecord && output.originalRef) {
      try {
        originalStore.save({
          id: output.originalRef,
          scopeId: scope.scopeId,
          ccrId: savedRecord.id,
          contentType,
          content,
          metadata: {
            ...metadata,
            safetyWarnings: safetyResult.safetyWarnings,
          },
        });
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
        originalRefs: output.originalRef ? [output.originalRef] : [],
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
      originalRef: output.originalRef,
      tokensBefore: output.tokensBefore,
      tokensAfter: output.tokensAfter,
      tokensSaved: output.tokensSaved,
      compressionRatio: output.compressionRatio,
      canRetrieveOriginal: output.canRetrieveOriginal,
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
    const limit = opts.limit ?? 10000;

    const result = store.retrieve(originalRef, scope.scopeId, { offset, limit });

    if (!result) {
      // Check if it exists in a different scope
      const actualScope = store.lookupScope(originalRef);
      const deletedCheck = store.checkDeleted(originalRef);

      let errorMsg: string;
      if (actualScope && actualScope !== scope.scopeId) {
        errorMsg = `Original "${originalRef}" belongs to scope "${actualScope}", not "${scope.scopeId}".`;
      } else if (deletedCheck.found && deletedCheck.deleted) {
        errorMsg = `Original "${originalRef}" was deleted and is no longer available.`;
      } else {
        errorMsg = `Original not found: ${originalRef}`;
      }

      // Create failure receipt
      receipts.create({
        operation: "retrieve_original",
        scopeId: scope.scopeId,
        inputHash: contentHash(`${scope.scopeId}:${originalRef}`),
        originalRefs: [originalRef],
        failed: true,
        errorReason: "original_not_found",
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
