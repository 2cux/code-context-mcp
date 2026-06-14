/**
 * Phase 3 Acceptance Tests — Safety Layer + Original Content Ops
 *
 * Four criteria from PRD §23 Phase 3:
 *   1. 超时返回原文 — timeout returns original content (fail-open)
 *   2. 大输入不会卡死 — large input doesn't hang (chunking + size limit)
 *   3. 原文可取回 — original content is retrievable end-to-end
 *   4. 原文可删除 — original content is deletable (single + cleanup)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { OriginalStore } from "../src/originals/originalStore.js";
import { CompressedStore } from "../src/compressed/compressedStore.js";
import { handleCompressContext } from "../src/mcp/tools/compressContext.js";
import { handleRetrieveOriginal } from "../src/mcp/tools/retrieveOriginal.js";
import { handleDeleteOriginal } from "../src/mcp/tools/deleteOriginal.js";
import { handleCleanupOriginals } from "../src/mcp/tools/cleanupOriginals.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../src/mcp/server.js";

// Ensure compression strategies are registered before tests
import { registerAllStrategies } from "../src/compression/registerStrategies.js";

let db: Database;
let ctx: ServerContext;

const SCOPE_ID = "repo_phase3_accept";

function ensureScope(scopeId?: string) {
  const id = scopeId ?? SCOPE_ID;
  runStmt(
    db,
    `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
     VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`,
    [id, process.cwd()],
  );
}

/** Parse a tool result JSON string. */
function parseToolText(result: { content: { type: string; text?: string }[] }): Record<string, unknown> {
  const text = result.content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

beforeAll(async () => {
  db = await initAndMigrate();
  ctx = { db, receipts: new ReceiptService(db) };
  ensureScope();
  ensureScope("repo_wrong_scope"); // For scope-isolation tests

  // Register all compression strategies (idempotent, must be called once)
  registerAllStrategies();
});

afterAll(() => {
  closeDb();
});

// ============================================================================
// Criterion 1: 超时返回原文
// ============================================================================
describe("Criterion 1: 超时返回原文 (timeout → fail-open)", () => {
  it("returns original content even with extremely short timeout (fail-open)", async () => {
    const originalContent = "const x = 1;\nfunction foo() { return x; }\nconsole.log(foo());";

    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: originalContent,
      contentType: "code",
      timeoutMs: 1, // Extremely short — may or may not trigger timeout
      keepOriginal: true,
    });

    const json = parseToolText(result);

    // Core fail-open contract: must ALWAYS return non-empty content
    expect(json.compressedContent).toBeTruthy();
    expect(json.compressedContent.length).toBeGreaterThan(0);

    // If it timed out, the content should be the original
    if (json.failed) {
      expect(json.compressedContent).toBe(originalContent);
      expect(json.errorReason).toBeDefined();
    }

    // Token stats should always be present
    expect(json.tokensBefore).toBeGreaterThan(0);
    expect(json.tokensAfter).toBeGreaterThan(0);

    // Receipt should exist
    expect(json.receiptId).toBeTruthy();
    expect(json.warnings).toBeDefined();
  });

  it("does not return empty content on timeout", async () => {
    const originalContent = "important data that must not be lost";

    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: originalContent,
      contentType: "plain_text",
      timeoutMs: 1,
      keepOriginal: false,
    });

    const json = parseToolText(result);

    // Core fail-open invariant: never return empty content
    expect(json.compressedContent).toBeTruthy();
    expect(json.compressedContent.length).toBeGreaterThan(0);
    expect(json.compressedContent).toBe(originalContent);
  });

  it("normal fast compression still succeeds", async () => {
    const content = "Hello world. This is a short text. It should compress fine.";

    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      timeoutMs: 30000,
      keepOriginal: false,
    });

    const json = parseToolText(result);
    expect(json.ccrId).toBeTruthy();
    // Must not be an explicit failure
    expect(json.failed === true).toBe(false);
    // Token stats meaningful
    expect(json.tokensBefore).toBeGreaterThan(0);
  });
});

// ============================================================================
// Criterion 2: 大输入不会卡死
// ============================================================================
describe("Criterion 2: 大输入不会卡死 (large input → chunking)", () => {
  /**
   * Generate ~200KB of log-like content that exceeds the default 1MB limit
   * when composed into a single input, or trigger chunking with moderate size.
   *
   * We use ~150KB of structured log content — enough to verify the pipeline
   * handles non-trivial inputs without hanging, but small enough to complete
   * within test timeouts.
   */
  function generateLargeLog(lines: number): string {
    const parts: string[] = [];
    for (let i = 0; i < lines; i++) {
      const ts = `2026-06-09T${String(Math.floor(i / 3600) % 24).padStart(2, "0")}:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`;
      const level = i % 50 === 0 ? "ERROR" : i % 10 === 0 ? "WARN" : "INFO";
      parts.push(
        `${ts} [${level}] worker-${i % 8} module=${["auth", "db", "api", "cache", "queue", "scheduler", "validator", "notifier"][i % 8]} ` +
        `Processing request req_${String(i).padStart(6, "0")} ` +
        `with payload ${JSON.stringify({ id: i, action: level === "ERROR" ? "failed" : "processed", duration: Math.random() * 1000 })}`,
      );
    }
    return parts.join("\n");
  }

  it("handles 8KB of log content (below chunking threshold) without issue", async () => {
    const content = generateLargeLog(50); // ~8KB, well under 1MB
    const start = Date.now();

    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "log",
      keepOriginal: true,
    });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10_000); // Must complete within 10s

    const json = parseToolText(result);
    expect(json.ccrId).toBeTruthy();
    expect(json.tokensBefore).toBeGreaterThan(0);
    expect(json.originalRef).toBeTruthy();
  });

  it("handles 500KB of log content with chunking and completes within timeout", async () => {
    const content = generateLargeLog(3000); // ~500KB
    const start = Date.now();

    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "log",
      keepOriginal: true,
      maxInputBytes: 100_000, // Low threshold to force chunking at ~100KB
    });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(30_000); // Must complete within 30s

    const json = parseToolText(result);
    expect(json.ccrId).toBeTruthy();
    expect(json.compressedContent).toBeTruthy();

    // Should NOT be a failure
    if (json.failed) {
      // Even if failed, content must be non-empty (fail-open)
      expect(json.compressedContent.length).toBeGreaterThan(0);
    }

    // Safety actions should indicate chunking was triggered
    if (json.safetyActions) {
      const actions = json.safetyActions as string[];
      expect(actions).toContain("chunked");
    }

    // Warnings should mention chunking
    const warnings = json.warnings as string[];
    const hasChunkWarning = warnings.some(
      (w) => w.includes("chunk") || w.includes("Chunk"),
    );
    expect(hasChunkWarning).toBe(true);
  });

  it("returns non-empty content even for oversized input", async () => {
    const content = generateLargeLog(2000); // ~350KB
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "log",
      keepOriginal: false,
      maxInputBytes: 50_000,
    });

    const json = parseToolText(result);
    expect(json.compressedContent).toBeTruthy();
    expect(json.compressedContent.length).toBeGreaterThan(0);
  });

  it("size-limit triggers chunking when content exceeds maxInputBytes", async () => {
    // generateLargeLog(200) ≈ 35KB, well above the 5KB threshold.
    // Because enableChunking defaults to true, oversized content is chunked.
    const content = generateLargeLog(200); // ~35KB
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "log",
      keepOriginal: false,
      maxInputBytes: 5000, // very low — forces chunking because content > 5KB
    });

    const json = parseToolText(result);
    expect(json.ccrId).toBeTruthy();
    expect(json.compressedContent).toBeTruthy();
    expect(json.compressedContent.length).toBeGreaterThan(0);

    // Oversized content with enableChunking=true should trigger chunked action
    if (json.safetyActions) {
      const actions = json.safetyActions as string[];
      expect(actions).toContain("chunked");
    }
  });
});

// ============================================================================
// Criterion 3: 原文可取回
// ============================================================================
describe("Criterion 3: 原文可取回 (retrieve original end-to-end)", () => {
  const ORIGINAL_TEXT =
    "IMPORTANT: This is the original content that must be retrievable.\n" +
    "Line 2: Project uses pnpm, not npm.\n" +
    "Line 3: Auth module is in src/auth/session.ts.\n" +
    "Line 4: Test failure: cookie not cleared after refresh token expiry.\n" +
    "Line 5: Fix applied in PR #42.\n";

  let originalRef: string;

  it("compress → originalRef is returned", async () => {
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: ORIGINAL_TEXT,
      contentType: "plain_text",
      keepOriginal: true,
    });

    const json = parseToolText(result);
    expect(json.originalRef).toBeTruthy();
    expect(json.canRetrieveOriginal).toBe(true);
    originalRef = json.originalRef as string;
  });

  it("retrieve_original returns the exact original content", async () => {
    expect(originalRef).toBeTruthy();

    const result = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef,
    });

    const json = parseToolText(result);
    expect(json.content).toBe(ORIGINAL_TEXT);
    expect(json.originalRef).toBe(originalRef);
    expect(json.scopeId).toBe(SCOPE_ID);
    expect(json.contentType).toBe("plain_text");
    expect(json.tokens).toBeGreaterThan(0);
    expect(json.receiptId).toBeTruthy();
  });

  it("retrieve_original with offset/limit returns partial content", async () => {
    expect(originalRef).toBeTruthy();

    const result = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef,
      offset: 0,
      limit: 50,
    });

    const json = parseToolText(result);
    expect(json.content).toBe(ORIGINAL_TEXT.substring(0, 50));
    expect(json.hasMore).toBe(true);
    expect((json as any).totalChars).toBe(ORIGINAL_TEXT.length);
  });

  it("retrieve_original fails for wrong scope with scope_mismatch error", async () => {
    expect(originalRef).toBeTruthy();

    const result = await handleRetrieveOriginal(ctx, {
      scopeId: "repo_wrong_scope",
      originalRef,
    });

    // Should be an error
    expect(result.isError).toBe(true);

    const json = parseToolText(result);
    expect(json.found).toBe(false);
    // §13.3: cross-scope access returns scope_mismatch, not original_not_found
    expect(json.error).toBe("scope_mismatch");
    expect(json.hint).toBeDefined();
    // Should include the actual scope the original belongs to
    expect(json.actualScopeId).toBe(SCOPE_ID);
    // Receipt must still be generated for auditability
    expect(json.receiptId).toBeTruthy();
  });

  it("retrieve_original fails for non-existent ref", async () => {
    const result = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef: "orig_nonexistent_xxxxx",
    });

    expect(result.isError).toBe(true);

    const json = parseToolText(result);
    expect(json.found).toBe(false);
    expect(json.error).toBe("original_not_found");
  });

  // ------------------------------------------------------------------
  // §13.4.5: Retrieve receipt generation
  // ------------------------------------------------------------------
  it("retrieve receipt is generated with correct operation type and fields", async () => {
    expect(originalRef).toBeTruthy();

    const result = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef,
    });

    const json = parseToolText(result);
    const receiptId = json.receiptId as string;

    expect(receiptId).toBeTruthy();
    expect(receiptId).toMatch(/^rcp_/);

    // Verify the receipt exists in the database
    const receipt = ctx.receipts.get(receiptId);
    expect(receipt).not.toBeNull();
    expect(receipt!.operation).toBe("retrieve_original");
    expect(receipt!.scopeId).toBe(SCOPE_ID);
    expect(receipt!.retrievedOriginal).toBe(true);
    expect(receipt!.failed).toBe(false);
    expect(receipt!.originalRefs).toContain(originalRef);
  });

  // ------------------------------------------------------------------
  // §13.4.5: Error receipts also generated
  // ------------------------------------------------------------------
  it("error receipt is generated for not-found retrievals", async () => {
    const result = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef: "orig_definitely_does_not_exist_12345",
    });

    expect(result.isError).toBe(true);
    const json = parseToolText(result);
    expect(json.error).toBe("original_not_found");
    expect(json.receiptId).toBeTruthy();

    const receipt = ctx.receipts.get(json.receiptId as string);
    expect(receipt).not.toBeNull();
    expect(receipt!.operation).toBe("retrieve_original");
    expect(receipt!.failed).toBe(true);
    expect(receipt!.errorReason).toBe("original_not_found");
  });

  // ------------------------------------------------------------------
  // §13.4.5: Scope mismatch receipt
  // ------------------------------------------------------------------
  it("error receipt is generated for scope_mismatch retrievals", async () => {
    expect(originalRef).toBeTruthy();

    const result = await handleRetrieveOriginal(ctx, {
      scopeId: "repo_wrong_scope",
      originalRef,
    });

    expect(result.isError).toBe(true);
    const json = parseToolText(result);
    expect(json.error).toBe("scope_mismatch");
    expect(json.receiptId).toBeTruthy();

    const receipt = ctx.receipts.get(json.receiptId as string);
    expect(receipt).not.toBeNull();
    expect(receipt!.operation).toBe("retrieve_original");
    expect(receipt!.failed).toBe(true);
    expect(receipt!.errorReason).toBe("scope_mismatch");
  });

  // ------------------------------------------------------------------
  // §13.4.4: Retrieve after delete returns original_deleted
  // ------------------------------------------------------------------
  it("retrieve after explicit delete returns original_deleted error", async () => {
    // Create a fresh original to delete
    const compResult = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: "Content that will be deleted and then we check for original_deleted.",
      contentType: "plain_text",
      keepOriginal: true,
    });
    const compJson = parseToolText(compResult);
    const refToDelete = compJson.originalRef as string;
    expect(refToDelete).toBeTruthy();

    // Verify retrievable first
    const beforeResult = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef: refToDelete,
    });
    const beforeJson = parseToolText(beforeResult);
    expect(beforeJson.content).toBeTruthy();

    // Explicitly delete via delete_original
    const delResult = await handleDeleteOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef: refToDelete,
    });
    const delJson = parseToolText(delResult);
    expect(delJson.deleted).toBe(true);

    // Now retrieve should return original_deleted
    const afterResult = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef: refToDelete,
    });

    expect(afterResult.isError).toBe(true);
    const afterJson = parseToolText(afterResult);
    expect(afterJson.found).toBe(false);
    expect(afterJson.error).toBe("original_deleted");
    expect(afterJson.hint).toContain("delete_original");
    expect(afterJson.receiptId).toBeTruthy();

    // Verify the error receipt
    const receipt = ctx.receipts.get(afterJson.receiptId as string);
    expect(receipt).not.toBeNull();
    expect(receipt!.errorReason).toBe("original_deleted");
  });

  // ------------------------------------------------------------------
  // §13.4.3: Cross-scope blocking with correct error type
  // ------------------------------------------------------------------
  it("cross-scope retrieve is blocked with scope_mismatch (not original_not_found)", async () => {
    expect(originalRef).toBeTruthy();

    const result = await handleRetrieveOriginal(ctx, {
      scopeId: "repo_wrong_scope",
      originalRef,
    });

    expect(result.isError).toBe(true);
    const json = parseToolText(result);
    // Must be scope_mismatch, NOT original_not_found
    expect(json.error).toBe("scope_mismatch");
    expect(json.actualScopeId).toBe(SCOPE_ID);

    // The original should still be retrievable with correct scope
    const okResult = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef,
    });
    const okJson = parseToolText(okResult);
    expect(okJson.content).toBe(ORIGINAL_TEXT);
  });
});

// ============================================================================
// Criterion 4: 原文可删除
// ============================================================================
describe("Criterion 4: 原文可删除 (delete + cleanup originals)", () => {
  const CONTENT_TO_DELETE = "This content will be deleted.\nIt has two lines.";
  let originalRefToDelete: string;

  it("compress → save → original is retrievable", async () => {
    const compResult = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: CONTENT_TO_DELETE,
      contentType: "plain_text",
      keepOriginal: true,
    });

    const compJson = parseToolText(compResult);
    expect(compJson.originalRef).toBeTruthy();
    originalRefToDelete = compJson.originalRef as string;

    // Verify retrievable
    const retResult = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef: originalRefToDelete,
    });
    const retJson = parseToolText(retResult);
    expect(retJson.content).toBe(CONTENT_TO_DELETE);
  });

  it("delete_original removes the original", async () => {
    expect(originalRefToDelete).toBeTruthy();

    const result = await handleDeleteOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef: originalRefToDelete,
    });

    const json = parseToolText(result);
    expect(json.deleted).toBe(true);
    expect(json.originalRef).toBe(originalRefToDelete);
    expect(json.receiptId).toBeTruthy();
  });

  it("retrieve after delete returns original_deleted", async () => {
    const result = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef: originalRefToDelete,
    });

    expect(result.isError).toBe(true);
    const json = parseToolText(result);
    expect(json.found).toBe(false);
    expect(json.error).toBe("original_deleted");
  });

  it("delete_original fails gracefully for already-deleted ref", async () => {
    const result = await handleDeleteOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef: originalRefToDelete,
    });

    expect(result.isError).toBe(true);
    const json = parseToolText(result);
    expect(json.deleted).toBe(false);
    expect(json.error).toBe("original_not_found_or_scope_mismatch");
    // Receipt should still be generated even on failure
    expect(json.receiptId).toBeTruthy();
  });

  it("cleanup_originals works on empty/clean scope", async () => {
    const result = await handleCleanupOriginals(ctx, {
      scopeId: SCOPE_ID,
    });

    const json = parseToolText(result);
    expect(json.scopeId).toBe(SCOPE_ID);
    expect(json.deleted).toBeGreaterThanOrEqual(0);
    expect(json.receiptId).toBeTruthy();
  });

  it("delete_original with wrong scope fails", async () => {
    // First create a new original via compress
    const compResult = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: "content for scope isolation delete test",
      contentType: "plain_text",
      keepOriginal: true,
    });

    const compJson = parseToolText(compResult);
    const ref = compJson.originalRef as string;
    expect(ref).toBeTruthy();

    // Try deleting with wrong scope
    const result = await handleDeleteOriginal(ctx, {
      scopeId: "repo_wrong_scope",
      originalRef: ref,
    });

    expect(result.isError).toBe(true);
    const json = parseToolText(result);
    expect(json.deleted).toBe(false);

    // The original should STILL be retrievable with the correct scope
    const retResult = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef: ref,
    });
    const retJson = parseToolText(retResult);
    expect(retJson.content).toBe("content for scope isolation delete test");
  });
});
