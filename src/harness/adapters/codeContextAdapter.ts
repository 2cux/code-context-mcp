/**
 * CodeContext Service Adapter
 *
 * Provides a unified interface for Harness flows to interact with
 * CodeContext services: compression, memory, profile, originals,
 * scope, failure stats, and context analysis.
 *
 * Each method is a thin wrapper that delegates to existing service
 * implementations — no business logic is duplicated here.
 *
 * PRD §34: Harness 适配现有 CodeContext 服务。
 * §8.1-8.3: Adapter 职责 — Scope Resolver, MCP tool handlers,
 *   compression, originals, memory, profile, receipt, failure, cache.
 */

import type { Database } from "sql.js";

// ── Service imports ────────────────────────────────────────────────────────────

import { CompressedStore } from "../../compressed/compressedStore.js";
import type { ContentType } from "../../compressed/compressedStore.js";
import { OriginalStore } from "../../originals/originalStore.js";
import { ReceiptService } from "../../receipts/receiptService.js";
import { MemoryService } from "../../memory/memoryService.js";
import { FailureStore } from "../../failure/failureStore.js";
import type { FailureStats } from "../../failure/failureStore.js";
import { RecallEngine } from "../../memory/recallEngine.js";
import { MemoryFtsIndex } from "../../memory/memoryFts.js";
import type { MemoryType, MemoryStatus, ForgetMode, ListMemoryResult } from "../../memory/types.js";

import { resolveScope } from "../../scope/resolveScope.js";
import type { ScopeResult } from "../../scope/resolveScope.js";
import { toScopeRecord } from "../../scope/resolveScope.js";
import { runStmt } from "../../storage/db.js";

import { compress } from "../../compression/compressionEngine.js";
import type { CompressionOutput } from "../../compression/compressionEngine.js";
import { detectContentType } from "../../router/contentRouter.js";
import { contentHash } from "../../utils/hash.js";

import { analyzeContext } from "../../intelligence/contextDecision.js";
import type { AnalysisResult } from "../../intelligence/contextDecision.js";

// ── Run result types ───────────────────────────────────────────────────────────

/** Simplified compression result returned by runCompressContext. */
export interface CompressResult {
  ccrId: string;
  compressed: boolean;
  scopeId: string;
  contentType: string;
  strategy: string;
  compressedContent: string;
  summary?: string;
  originalRef?: string;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  compressionRatio: number;
  canRetrieveOriginal: boolean;
  receiptId: string;
  failed: boolean;
  errorReason?: string;
  warnings: string[];
  detection: { method: "auto" | "user"; detectedAs?: string; confidence?: number; specifiedType?: string };
}

/** Result from runRememberContext. */
export interface RememberResult {
  memoryId: string;
  scopeId: string;
  type: MemoryType;
  status: MemoryStatus;
  receiptId: string;
}

/** A single recall result item. */
export interface RecallResultItem {
  id: string;
  content: string;
  type: MemoryType;
  status: MemoryStatus;
  score: number;
  confidence: number;
  rank: number;
  canExpand: boolean;
  matchMethod: "original" | "expanded" | "original+expanded";
  matchedTerms: string[];
}

/** Result from runRecallContext. */
export interface RecallResult {
  items: RecallResultItem[];
  total: number;
}

/** Result from runForgetContext. */
export interface ForgetResult {
  memoryId: string;
  previousStatus: MemoryStatus;
  newStatus?: MemoryStatus;
  action?: "hard_deleted";
  deleted?: true;
  profileFactsDeleted?: number;
  supersededBy?: string;
  receiptId: string;
}

/** Options for runCompressContext. */
export interface CompressOptions {
  /** Content type hint. When omitted or "unknown", auto-detected via ContentRouter. */
  contentType?: string;
  /** Compression strategy: "conservative" (default) or "auto". */
  strategy?: "conservative" | "auto";
  /** Whether to save original content for later retrieval (default true). */
  keepOriginal?: boolean;
  /** Max output tokens after compression (default 2000). */
  maxTokens?: number;
  /** Compression timeout in ms (default 5000). */
  timeoutMs?: number;
  /** Arbitrary metadata to attach to the stored record. */
  metadata?: Record<string, unknown>;
}

// ── Adapter Interface ──────────────────────────────────────────────────────────

export interface CodeContextAdapter {
  /** The SQLite database handle. */
  db: Database;

  /** Resolve the current repository scope. */
  runCurrentScope(): ScopeResult;

  /** Detect type → compress → store → receipt. */
  runCompressContext(content: string, opts?: CompressOptions): Promise<CompressResult>;

  /** Retrieve original content by CCR id. */
  runRetrieveOriginal(ccrId: string): Promise<{ content: string; contentType: string } | null>;

  /** Delete original content by CCR id. */
  runDeleteOriginal(ccrId: string): Promise<boolean>;

  /** Save a new project memory. */
  runRememberContext(content: string, type: string, tags?: string[]): RememberResult;

  /** Search project memory by query. */
  runRecallContext(query: string, limit?: number): RecallResult;

  /** Forget (soft-delete or hard-delete) a memory. */
  runForgetContext(id: string, mode?: string): ForgetResult | null;

  /** List memories, optionally filtered by status. */
  runListContext(status?: string, limit?: number, offset?: number): ListMemoryResult;

  /** Analyse content/query for context management recommendations. */
  runAnalyzeContext(content: string, query?: string): AnalysisResult;

  /** Return aggregate failure statistics for the current scope. */
  runFailureStats(): FailureStats;

  /** Run batch cleanup of expired original content. */
  runCleanupOriginals(): { deleted: number; affectedCcrIds: string[] };
}

// ── Factory ────────────────────────────────────────────────────────────────────

/** Valid content types (from MCP tool handler validation). */
const VALID_CONTENT_TYPES = new Set<string>([
  "test_output", "log", "command_output", "code", "json",
  "markdown", "plain_text", "rag_chunk", "file_summary",
  "conversation_history", "unknown",
]);

/** Valid memory types (from memory/types.ts). */
const VALID_MEMORY_TYPES = new Set<string>([
  "decision", "bug", "command", "file_summary", "project_rule",
  "user_preference", "current_task", "test_failure", "api_contract",
  "dependency",
]);

/** Default max tokens for compression. */
const DEFAULT_MAX_TOKENS = 2000;
/** Default compression timeout in ms. */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Create a CodeContext adapter backed by real service implementations.
 *
 * Creates all service instances once and auto-resolves the current
 * repository scope. Each method is a thin wrapper that delegates to
 * the underlying services.
 */
export function createCodeContextAdapter(db: Database): CodeContextAdapter {
  // ── Create service instances ───────────────────────────────────────────────

  const compressedStore = new CompressedStore(db);
  const originalStore = new OriginalStore(db);
  const receipts = new ReceiptService(db);
  const ftsIndex = new MemoryFtsIndex(db);
  const memoryService = new MemoryService(db, { receipts, ftsIndex });
  const failureStore = new FailureStore(db);
  const recallEngine = new RecallEngine(db, ftsIndex);

  // ── Resolve scope once ─────────────────────────────────────────────────────

  const scope = resolveScope();
  const scopeId = scope.scopeId;

  // Persist scope record (best-effort, non-blocking)
  try {
    const record = toScopeRecord(scope);
    runStmt(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, git_root, remote, branch, cwd, scope_strategy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.scope_id, record.git_root, record.remote, record.branch,
        record.cwd, record.scope_strategy, record.created_at, record.updated_at,
      ],
    );
  } catch {
    // Best-effort: scope persistence failure must not block the adapter
  }

  // ── Build adapter ──────────────────────────────────────────────────────────

  const adapter: CodeContextAdapter = {
    db,

    // ======================================================================
    // Scope
    // ======================================================================

    runCurrentScope(): ScopeResult {
      return scope;
    },

    // ======================================================================
    // Compression
    // ======================================================================

    async runCompressContext(
      content: string,
      opts: CompressOptions = {},
    ): Promise<CompressResult> {
      const warnings: string[] = [];

      // ── Auto-detect content type ──────────────────────────────────────────

      let contentType: ContentType;
      let detectedBy: "user" | "auto" = "user";
      let detectionConfidence = 1.0;

      const rawType = opts.contentType;
      if (rawType && rawType !== "unknown") {
        if (!VALID_CONTENT_TYPES.has(rawType)) {
          throw new Error(
            `Invalid contentType "${rawType}". Valid: ${Array.from(VALID_CONTENT_TYPES).join(", ")}`,
          );
        }
        contentType = rawType as ContentType;
      } else {
        // Auto-detect via ContentRouter
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
        } catch {
          contentType = "unknown";
          detectedBy = "auto";
          detectionConfidence = 0;
          warnings.push("ContentRouter failed — falling back to unknown/plain_text compression.");
        }
      }

      const strategy = opts.strategy ?? "conservative";
      const keepOriginal = opts.keepOriginal !== false;
      const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      // ── Call compression engine ────────────────────────────────────────────

      const output: CompressionOutput = await compress({
        scopeId,
        content,
        contentType,
        strategy,
        keepOriginal,
        maxTokens,
        timeoutMs,
      });

      // Merge warnings
      for (const w of output.warnings) {
        warnings.push(w);
      }

      // ── Failure Learning (§33.2): record compression failures ──────────────

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

      // ── Save compressed record ────────────────────────────────────────────

      let savedCcrId = output.ccrId;
      let storedOriginalRef: string | undefined;
      let canRetrieveOriginal = false;

      try {
        const saved = compressedStore.save({
          scopeId: output.scopeId,
          contentType: output.contentType,
          strategy: output.strategy || "none",
          compressedContent: output.compressedContent,
          summary: output.summary,
          sourceRef: opts.metadata?.source as string | undefined,
          metadata: opts.metadata,
          tokensBefore: output.tokensBefore,
          tokensAfter: output.tokensAfter,
          tokensSaved: output.tokensSaved,
          compressionRatio: output.compressionRatio,
          canRetrieveOriginal: false, // updated after original save
          failed: output.failed ?? false,
          errorReason: output.errorReason,
        });
        savedCcrId = saved.id;
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        warnings.push(`Database write warning: unable to persist CCR — ${msg}`);
      }

      // ── Save original content ──────────────────────────────────────────────

      if (keepOriginal && savedCcrId) {
        try {
          const orig = originalStore.save({
            scopeId,
            ccrId: savedCcrId,
            contentType,
            content,
            metadata: opts.metadata,
          });
          storedOriginalRef = orig.id;
          originalStore.linkOriginalToCcr(savedCcrId, orig.id);
          canRetrieveOriginal = true;
        } catch (origErr) {
          const msg = origErr instanceof Error ? origErr.message : String(origErr);
          warnings.push(`Warning: unable to save original content — ${msg}`);
        }
      }

      // ── Create receipt ─────────────────────────────────────────────────────

      let receiptId = output.receiptId;
      try {
        const receipt = receipts.create({
          operation: "compress",
          scopeId,
          inputHash: contentHash(content),
          resultIds: [savedCcrId],
          ccrIds: [savedCcrId],
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
      } catch {
        // Receipt write is non-blocking
      }

      return {
        ccrId: savedCcrId,
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
        canRetrieveOriginal,
        receiptId,
        failed: output.failed ?? false,
        errorReason: output.errorReason,
        warnings,
        detection: detectedBy === "auto"
          ? { method: "auto", detectedAs: contentType, confidence: detectionConfidence }
          : { method: "user", specifiedType: opts.contentType },
      };
    },

    // ======================================================================
    // Original Retrieval
    // ======================================================================

    async runRetrieveOriginal(
      ccrId: string,
    ): Promise<{ content: string; contentType: string } | null> {
      // Look up the CCR to get the originalRef
      const ccr = compressedStore.get(ccrId, scopeId);
      if (!ccr || !ccr.originalRef) return null;
      if (!ccr.canRetrieveOriginal) return null;

      const retrieved = originalStore.retrieve(ccr.originalRef, scopeId);
      if (!retrieved) return null;

      return {
        content: retrieved.content,
        contentType: retrieved.contentType,
      };
    },

    // ======================================================================
    // Original Deletion
    // ======================================================================

    async runDeleteOriginal(ccrId: string): Promise<boolean> {
      const ccr = compressedStore.get(ccrId, scopeId);
      if (!ccr || !ccr.originalRef) return false;

      return originalStore.delete(ccr.originalRef, scopeId);
    },

    // ======================================================================
    // Memory — Remember
    // ======================================================================

    runRememberContext(
      content: string,
      type: string,
      tags?: string[],
    ): RememberResult {
      if (!VALID_MEMORY_TYPES.has(type)) {
        throw new Error(
          `Invalid memory type "${type}". Valid: ${Array.from(VALID_MEMORY_TYPES).join(", ")}`,
        );
      }

      const result = memoryService.remember({
        scopeId,
        type: type as MemoryType,
        content,
        tags,
      });

      return {
        memoryId: result.memoryId,
        scopeId: result.scopeId,
        type: result.type,
        status: result.status,
        receiptId: result.receiptId,
      };
    },

    // ======================================================================
    // Memory — Recall
    // ======================================================================

    runRecallContext(
      query: string,
      limit?: number,
    ): RecallResult {
      const results = recallEngine.searchEnhanced({
        scopeId,
        query,
        limit: limit ?? 10,
        includeCanExpand: true,
      });

      return {
        items: results.map((r) => ({
          id: r.memory.id,
          content: r.memory.content,
          type: r.memory.type,
          status: r.memory.status,
          score: r.finalScore,
          confidence: r.memory.confidence,
          rank: r.rank,
          canExpand: r.canExpand,
          matchMethod: r.matchMethod,
          matchedTerms: r.matchedTerms,
        })),
        total: results.length,
      };
    },

    // ======================================================================
    // Memory — Forget
    // ======================================================================

    runForgetContext(
      id: string,
      mode?: string,
    ): ForgetResult | null {
      const forgetMode: ForgetMode = (mode as ForgetMode) ?? "soft_forget";
      const validModes: ForgetMode[] = ["soft_forget", "supersede", "expire", "hard_delete"];
      if (!validModes.includes(forgetMode)) {
        throw new Error(
          `Invalid forget mode "${mode}". Valid: ${validModes.join(", ")}`,
        );
      }

      const result = memoryService.forget({
        id,
        scopeId,
        mode: forgetMode,
      });

      if (!result) return null;

      return {
        memoryId: result.memoryId,
        previousStatus: result.previousStatus,
        receiptId: result.receiptId,
        ...(result.action === "hard_deleted"
          ? {
              action: result.action,
              deleted: result.deleted,
              profileFactsDeleted: result.profileFactsDeleted,
            }
          : { newStatus: result.newStatus, supersededBy: result.supersededBy }),
      };
    },

    // ======================================================================
    // Memory — List
    // ======================================================================

    runListContext(status?: string, limit?: number, offset?: number): ListMemoryResult {
      const statusFilter: MemoryStatus[] | undefined = status
        ? [status as MemoryStatus]
        : undefined;

      return memoryService.list({
        scopeId,
        status: statusFilter,
        limit: limit ?? 50,
        offset: offset ?? 0,
      });
    },

    // ======================================================================
    // Context Analysis
    // ======================================================================

    runAnalyzeContext(
      content: string,
      query?: string,
    ): AnalysisResult {
      return analyzeContext({
        content,
        query: query ?? "",
      });
    },

    // ======================================================================
    // Failure Stats
    // ======================================================================

    runFailureStats(): FailureStats {
      return failureStore.stats(scopeId);
    },

    // ======================================================================
    // Cleanup Originals
    // ======================================================================

    runCleanupOriginals(): { deleted: number; affectedCcrIds: string[] } {
      const result = originalStore.cleanup(scopeId);
      return {
        deleted: result.deleted,
        affectedCcrIds: result.affectedCcrIds,
      };
    },
  };

  return adapter;
}
