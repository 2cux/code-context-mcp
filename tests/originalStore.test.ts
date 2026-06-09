/**
 * Original Content Store Tests — Phase 3 (9.1–9.4)
 *
 * Covers:
 *   - 9.1 Save: save original, generate originalRef, compute contentHash,
 *     associate scopeId/ccrId, record metadata/tokens, support expiresAt.
 *   - 9.2 Retrieve: read by originalRef, scope validation, offset/limit,
 *     pagination, original_not_found.
 *   - 9.3 Delete & Cleanup: delete_original, cleanup_originals,
 *     expired cleanup, canRetrieveOriginal update.
 *   - 9.4 Integration: scope isolation, pagination, expiry.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt, queryOne } from "../src/storage/db.js";
import { OriginalStore } from "../src/originals/originalStore.js";
import { contentHash } from "../src/utils/hash.js";
import { countTokens } from "../src/utils/tokenCount.js";
import { nowISO, daysFromNow } from "../src/utils/time.js";
import type { Database } from "sql.js";

let db: Database;
let store: OriginalStore;

const SCOPE_A = "repo_test_scope_a";
const SCOPE_B = "repo_test_scope_b";

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function ensureScope(scopeId: string, cwd?: string) {
  runStmt(
    db,
    `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
     VALUES (?, ?, 'cwdFallback', ?, ?)`,
    [scopeId, cwd ?? `/fake/${scopeId}`, nowISO(), nowISO()],
  );
}

function ensureCcr(ccrId: string, scopeId: string, content?: string) {
  const c = content ?? "compressed content placeholder";
  runStmt(
    db,
    `INSERT OR REPLACE INTO compressed_contexts
       (id, scope_id, content_type, strategy, compressed_content,
        tokens_before, tokens_after, tokens_saved, compression_ratio,
        can_retrieve_original, created_at, updated_at)
     VALUES (?, ?, 'plain_text', 'plain_text_conservative_v1', ?,
             100, 50, 50, 0.5, 1, ?, ?)`,
    [ccrId, scopeId, c, nowISO(), nowISO()],
  );
}

function sampleContent(paragraphs = 1): string {
  const lines: string[] = [];
  for (let i = 1; i <= paragraphs; i++) {
    lines.push(
      `Paragraph ${i}: This is sample text that would normally be quite ` +
        `long and contain meaningful context about the project. The quick ` +
        `brown fox jumps over the lazy dog. Here are some additional ` +
        `details that make the content more realistic for testing.`,
    );
  }
  return lines.join("\n\n");
}

beforeAll(async () => {
  db = await initAndMigrate();
  store = new OriginalStore(db);

  // Pre-insert scopes
  ensureScope(SCOPE_A);
  ensureScope(SCOPE_B);

  // Pre-insert a CCR for scope A
  ensureCcr("ccr_test_001", SCOPE_A);
  ensureCcr("ccr_test_002", SCOPE_A);
  ensureCcr("ccr_test_003", SCOPE_B);
});

afterAll(() => {
  closeDb();
});

// Clean up originals between tests to keep isolation
beforeEach(() => {
  // Delete all originals so each test starts fresh
  db.exec("DELETE FROM original_contents");
  // Reset counter for predictable IDs
  // (counter is module-private, so we just delete rows)
});

// ============================================================================
// 9.1 — Save Original
// ============================================================================

describe("9.1 Save Original", () => {
  it("saves original content and returns a record with all fields", () => {
    const content = sampleContent(3);
    const record = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
      metadata: { source: "test", command: "pnpm test" },
    });

    expect(record.id).toMatch(/^orig_[a-z0-9]+_[a-f0-9]{6}_\d{6}$/);
    expect(record.scopeId).toBe(SCOPE_A);
    expect(record.ccrId).toBe("ccr_test_001");
    expect(record.contentType).toBe("plain_text");
    expect(record.content).toBe(content);
    expect(record.contentHash).toBe(contentHash(content));
    expect(record.tokens).toBe(countTokens(content));
    expect(record.metadata).toEqual({
      source: "test",
      command: "pnpm test",
    });
    expect(record.createdAt).toBeTruthy();
    expect(new Date(record.createdAt).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  it("generates a unique originalRef for each save", () => {
    const r1 = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Content A",
    });
    const r2 = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Content B",
    });
    const r3 = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Content C",
    });

    const ids = [r1.id, r2.id, r3.id];
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });

  it("accepts an optional pre-computed id", () => {
    const customId = "orig_custom_precomputed_001";
    const record = store.save({
      id: customId,
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Content with custom id.",
    });

    expect(record.id).toBe(customId);

    // Verify it's retrievable by the custom id
    const retrieved = store.retrieve(customId, SCOPE_A);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.originalRef).toBe(customId);
    expect(retrieved!.content).toBe("Content with custom id.");
  });

  it("generates auto id when no id is provided", () => {
    const record = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Auto-generated id.",
    });

    expect(record.id).toMatch(/^orig_[a-z0-9]+_[a-f0-9]{6}_\d{6}$/);
  });

  it("generates the same contentHash for identical content", () => {
    const content = "Identical content across saves.";
    const r1 = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });
    const r2 = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    expect(r1.contentHash).toBe(r2.contentHash);
  });

  it("generates different contentHash for different content", () => {
    const r1 = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Hello world.",
    });
    const r2 = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Hello world!",
    });

    expect(r1.contentHash).not.toBe(r2.contentHash);
  });

  it("store.saveRef returns the originalRef string", () => {
    const ref = store.saveRef({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "log",
      content: "ERROR: something broke",
    });

    expect(ref).toMatch(/^orig_/);
  });

  it("persists to the original_contents table", () => {
    const record = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "test_output",
      content: "FAIL test_baz — assertion error",
    });

    const row = queryOne(
      db,
      "SELECT * FROM original_contents WHERE id = ?",
      [record.id],
    );

    expect(row).toBeDefined();
    expect(row!["scope_id"]).toBe(SCOPE_A);
    expect(row!["ccr_id"]).toBe("ccr_test_001");
    expect(row!["content_type"]).toBe("test_output");
    expect(row!["content"]).toBe("FAIL test_baz — assertion error");
    expect(row!["content_hash"]).toBe(
      contentHash("FAIL test_baz — assertion error"),
    );
    expect(row!["tokens"]).toBeGreaterThan(0);
  });

  it("records metadata as JSON in the database", () => {
    const meta = { filePath: "/src/foo.ts", line: 42, error: true };
    const record = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "code",
      content: "export const x = 1;",
      metadata: meta,
    });

    const row = queryOne(
      db,
      "SELECT metadata FROM original_contents WHERE id = ?",
      [record.id],
    );

    const parsed = JSON.parse(row!["metadata"] as string);
    expect(parsed).toEqual(meta);
  });

  it("supports expiresAt for TTL-based expiry", () => {
    const future = daysFromNow(30);
    const record = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "This content will expire.",
      expiresAt: future,
    });

    expect(record.expiresAt).toBe(future);

    const row = queryOne(
      db,
      "SELECT expires_at FROM original_contents WHERE id = ?",
      [record.id],
    );
    expect(row!["expires_at"]).toBe(future);
  });

  it("marks the associated CCR with canRetrieveOriginal = 1", () => {
    // Create a fresh CCR with can_retrieve_original = 0
    runStmt(
      db,
      `INSERT OR REPLACE INTO compressed_contexts
         (id, scope_id, content_type, strategy, compressed_content,
          tokens_before, tokens_after, tokens_saved, compression_ratio,
          can_retrieve_original, created_at, updated_at)
       VALUES ('ccr_fresh_001', ?, 'plain_text', 'plain_text_conservative_v1', '...',
               100, 50, 50, 0.5, 0, ?, ?)`,
      [SCOPE_A, nowISO(), nowISO()],
    );

    store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_fresh_001",
      contentType: "plain_text",
      content: "Some original.",
    });

    const ccrRow = queryOne(
      db,
      "SELECT can_retrieve_original FROM compressed_contexts WHERE id = ?",
      ["ccr_fresh_001"],
    );
    expect(Number(ccrRow!["can_retrieve_original"])).toBe(1);
  });

  it("handles empty content", () => {
    const record = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "",
    });

    expect(record.content).toBe("");
    expect(record.tokens).toBe(0);
    expect(record.contentHash).toBe(contentHash(""));
  });

  it("handles Unicode content correctly", () => {
    const content = "中文测试 🎉 日本語 한국어 emoji: ✅❌🔥";
    const record = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    expect(record.content).toBe(content);
    expect(record.contentHash).toBe(contentHash(content));

    // Should be retrievable
    const retrieved = store.retrieve(record.id, SCOPE_A);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe(content);
  });

  it("handles very large content (simulates real-world log file)", () => {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(
        `[2024-01-${String((i % 28) + 1).padStart(2, "0")}T` +
          `${String(i % 24).padStart(2, "0")}:` +
          `${String(i % 60).padStart(2, "0")}:` +
          `${String(i % 60).padStart(2, "0")}Z] ` +
          `${i % 5 === 0 ? "ERROR" : "INFO"} ` +
          `Log message number ${i} with some additional context and ` +
          `details about the operation being performed at this moment.`,
      );
    }
    const content = lines.join("\n");

    const record = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "log",
      content,
    });

    expect(record.content.length).toBe(content.length);
    expect(record.tokens).toBeGreaterThan(1000);
  });
});

// ============================================================================
// 9.2 — Retrieve Original
// ============================================================================

describe("9.2 Retrieve Original", () => {
  it("retrieves original content by originalRef", () => {
    const content = sampleContent(3);
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "markdown",
      content,
    });

    const result = store.retrieve(saved.id, SCOPE_A);
    expect(result).not.toBeNull();
    expect(result!.originalRef).toBe(saved.id);
    expect(result!.scopeId).toBe(SCOPE_A);
    expect(result!.contentType).toBe("markdown");
    expect(result!.content).toBe(content);
    expect(result!.tokens).toBe(countTokens(content));
    expect(result!.totalChars).toBe(content.length);
    expect(result!.offset).toBe(0);
    expect(result!.returnedChars).toBe(content.length);
    expect(result!.hasMore).toBe(false);
    expect(result!.createdAt).toBe(saved.createdAt);
  });

  it("returns null when original is not found", () => {
    const result = store.retrieve("orig_nonexistent_001", SCOPE_A);
    expect(result).toBeNull();
  });

  it("retrieve increments the CCR's retrieveCount", () => {
    ensureCcr("ccr_ret_count", SCOPE_A);

    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_ret_count",
      contentType: "plain_text",
      content: "Retrieve count test.",
    });

    // Retrieve 3 times
    store.retrieve(saved.id, SCOPE_A);
    store.retrieve(saved.id, SCOPE_A);
    store.retrieve(saved.id, SCOPE_A);

    const ccrRow = queryOne(
      db,
      "SELECT retrieve_count FROM compressed_contexts WHERE id = ?",
      ["ccr_ret_count"],
    );
    expect(Number(ccrRow!["retrieve_count"])).toBe(3);
  });

  it("getRecord returns the full OriginalContentRecord", () => {
    const content = "Full record test content.";
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
      metadata: { key: "value" },
    });

    const record = store.getRecord(saved.id, SCOPE_A);
    expect(record).not.toBeNull();
    expect(record!.id).toBe(saved.id);
    expect(record!.content).toBe(content);
    expect(record!.metadata).toEqual({ key: "value" });
  });

  it("getRecord returns null for wrong scope", () => {
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Scope check.",
    });

    const record = store.getRecord(saved.id, SCOPE_B);
    expect(record).toBeNull();
  });
});

// ============================================================================
// 9.2b — Offset / Limit Pagination
// ============================================================================

describe("9.2b Offset / Limit Pagination", () => {
  it("returns full content when no offset/limit provided", () => {
    const content = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    const result = store.retrieve(saved.id, SCOPE_A);
    expect(result!.content).toBe(content);
    expect(result!.totalChars).toBe(26);
    expect(result!.returnedChars).toBe(26);
    expect(result!.hasMore).toBe(false);
  });

  it("applies offset correctly", () => {
    const content = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    const result = store.retrieve(saved.id, SCOPE_A, { offset: 10 });
    expect(result!.content).toBe("KLMNOPQRSTUVWXYZ");
    expect(result!.offset).toBe(10);
    expect(result!.returnedChars).toBe(16);
    expect(result!.hasMore).toBe(false);
  });

  it("applies limit correctly", () => {
    const content = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    const result = store.retrieve(saved.id, SCOPE_A, { limit: 10 });
    expect(result!.content).toBe("ABCDEFGHIJ");
    expect(result!.returnedChars).toBe(10);
    expect(result!.hasMore).toBe(true);
  });

  it("applies both offset and limit together", () => {
    const content = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    const result = store.retrieve(saved.id, SCOPE_A, {
      offset: 5,
      limit: 10,
    });
    expect(result!.content).toBe("FGHIJKLMNO");
    expect(result!.offset).toBe(5);
    expect(result!.returnedChars).toBe(10);
    expect(result!.hasMore).toBe(true); // 26 chars, offset 5, returned 10 → 15 < 26
  });

  it("reports hasMore correctly at the exact end", () => {
    const content = "ABCDEFGHIJ"; // 10 chars
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    const result = store.retrieve(saved.id, SCOPE_A, {
      offset: 5,
      limit: 5,
    });
    expect(result!.content).toBe("FGHIJ");
    expect(result!.offset).toBe(5);
    expect(result!.returnedChars).toBe(5);
    expect(result!.hasMore).toBe(false);
  });

  it("handles offset beyond content length", () => {
    const content = "Hello";
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    const result = store.retrieve(saved.id, SCOPE_A, { offset: 100 });
    expect(result!.content).toBe("");
    expect(result!.offset).toBe(5); // clamped to length
    expect(result!.returnedChars).toBe(0);
    expect(result!.hasMore).toBe(false);
  });

  it("handles negative offset (clamped to 0)", () => {
    const content = "Hello";
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    const result = store.retrieve(saved.id, SCOPE_A, { offset: -5 });
    expect(result!.offset).toBe(0);
  });

  it("handles limit = 0 gracefully", () => {
    const content = "Hello";
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    const result = store.retrieve(saved.id, SCOPE_A, { limit: 0 });
    expect(result!.content).toBe("");
    expect(result!.hasMore).toBe(true);
  });

  it("paginates through a large document in chunks", () => {
    // Build a document where we can verify each page
    const pages: string[] = [];
    for (let i = 0; i < 20; i++) {
      pages.push(`--- PAGE ${i} ---`);
      pages.push("A".repeat(47)); // ~63 chars per "page" including header + newline
    }
    const content = pages.join("\n");
    const totalLen = content.length;

    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    // Read page by page (50 chars each), dynamically until exhausted
    const CHUNK = 50;
    let offset = 0;
    const collected: string[] = [];
    let pageCount = 0;

    while (offset < totalLen) {
      const page = store.retrieve(saved.id, SCOPE_A, {
        offset,
        limit: CHUNK,
      });

      expect(page).not.toBeNull();
      collected.push(page!.content);

      const expectedHasMore = offset + CHUNK < totalLen;
      expect(page!.hasMore).toBe(expectedHasMore);

      offset += CHUNK;
      pageCount += 1;
    }

    // Should have taken at least a few pages
    expect(pageCount).toBeGreaterThan(1);

    // Reconstruct and verify
    const reconstructed = collected.join("");
    expect(reconstructed).toBe(content);
  });
});

// ============================================================================
// 9.2c — Scope Isolation
// ============================================================================

describe("9.2c Scope Isolation", () => {
  it("retrieve returns null when scope does not match", () => {
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Scope A content.",
    });

    // Try to retrieve with scope B — should fail
    const result = store.retrieve(saved.id, SCOPE_B);
    expect(result).toBeNull();
  });

  it("retrieve succeeds only for matching scope", () => {
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Proper scoped content.",
    });

    // Correct scope
    const result = store.retrieve(saved.id, SCOPE_A);
    expect(result).not.toBeNull();
    expect(result!.scopeId).toBe(SCOPE_A);
  });

  it("content saved in scope A is invisible in scope B", () => {
    const contentA = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "A's secret.",
    });

    const contentB = store.save({
      scopeId: SCOPE_B,
      ccrId: "ccr_test_003",
      contentType: "plain_text",
      content: "B's secret.",
    });

    // Scope A can see its own
    expect(store.getRecord(contentA.id, SCOPE_A)).not.toBeNull();
    // Scope A cannot see B's
    expect(store.getRecord(contentB.id, SCOPE_A)).toBeNull();
    // Scope B cannot see A's
    expect(store.getRecord(contentA.id, SCOPE_B)).toBeNull();
    // Scope B can see its own
    expect(store.getRecord(contentB.id, SCOPE_B)).not.toBeNull();
  });

  it("exists() respects scope boundaries", () => {
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Exists check.",
    });

    expect(store.exists(saved.id, SCOPE_A)).toBe(true);
    expect(store.exists(saved.id, SCOPE_B)).toBe(false);
  });
});

// ============================================================================
// 9.3 — Delete Original
// ============================================================================

describe("9.3 Delete Original", () => {
  it("deletes an original by ref and scopeId", () => {
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "To be deleted.",
    });

    expect(store.exists(saved.id, SCOPE_A)).toBe(true);

    const deleted = store.delete(saved.id, SCOPE_A);
    expect(deleted).toBe(true);

    // Should no longer be retrievable
    expect(store.getRecord(saved.id, SCOPE_A)).toBeNull();
    expect(store.exists(saved.id, SCOPE_A)).toBe(false);
  });

  it("delete returns false for nonexistent original", () => {
    const result = store.delete("orig_nonexistent_001", SCOPE_A);
    expect(result).toBe(false);
  });

  it("delete returns false when scope does not match", () => {
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Wrong scope delete.",
    });

    const result = store.delete(saved.id, SCOPE_B);
    expect(result).toBe(false);

    // Should still exist in scope A
    expect(store.exists(saved.id, SCOPE_A)).toBe(true);
  });

  it("sets canRetrieveOriginal = 0 on CCR when all originals deleted", () => {
    ensureCcr("ccr_del_test", SCOPE_A);

    // Set up CCR with can_retrieve_original = 1
    runStmt(
      db,
      `UPDATE compressed_contexts SET can_retrieve_original = 1 WHERE id = ?`,
      ["ccr_del_test"],
    );

    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_del_test",
      contentType: "plain_text",
      content: "Delete me.",
    });

    store.delete(saved.id, SCOPE_A);

    const ccrRow = queryOne(
      db,
      "SELECT can_retrieve_original FROM compressed_contexts WHERE id = ?",
      ["ccr_del_test"],
    );
    expect(Number(ccrRow!["can_retrieve_original"])).toBe(0);
  });

  it("keeps canRetrieveOriginal = 1 when other originals remain for the CCR", () => {
    ensureCcr("ccr_multi_orig", SCOPE_A);

    runStmt(
      db,
      `UPDATE compressed_contexts SET can_retrieve_original = 1 WHERE id = ?`,
      ["ccr_multi_orig"],
    );

    const r1 = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_multi_orig",
      contentType: "plain_text",
      content: "First original.",
    });

    store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_multi_orig",
      contentType: "plain_text",
      content: "Second original.",
    });

    // Delete only one
    store.delete(r1.id, SCOPE_A);

    const ccrRow = queryOne(
      db,
      "SELECT can_retrieve_original FROM compressed_contexts WHERE id = ?",
      ["ccr_multi_orig"],
    );
    // Should still be 1 because there's another original
    expect(Number(ccrRow!["can_retrieve_original"])).toBe(1);
  });

  it("deleteByScope removes all originals for a scope", () => {
    ensureCcr("ccr_scope_del_1", SCOPE_A);
    ensureCcr("ccr_scope_del_2", SCOPE_A);

    store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_scope_del_1",
      contentType: "plain_text",
      content: "Scope delete 1.",
    });
    store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_scope_del_2",
      contentType: "plain_text",
      content: "Scope delete 2.",
    });

    // Also save one in scope B to confirm it's not affected
    const bRef = store.saveRef({
      scopeId: SCOPE_B,
      ccrId: "ccr_test_003",
      contentType: "plain_text",
      content: "Should survive.",
    });

    const deletedCount = store.deleteByScope(SCOPE_A);
    expect(deletedCount).toBeGreaterThanOrEqual(2);

    // All scope A originals gone
    expect(store.exists("ccr_scope_del_1", SCOPE_A)).toBe(false);

    // Scope B original still exists
    expect(store.exists(bRef, SCOPE_B)).toBe(true);
  });
});

// ============================================================================
// 9.3b — Cleanup Expired Originals
// ============================================================================

describe("9.3b Cleanup Expired Originals", () => {
  it("cleans up originals with past expiresAt", () => {
    ensureCcr("ccr_exp_only", SCOPE_A);
    ensureCcr("ccr_exp_mixed", SCOPE_A);

    // CCR with ONLY expired content
    const expiredContent1 = "This content is already expired.";
    runStmt(
      db,
      `INSERT INTO original_contents
         (id, scope_id, ccr_id, content_type, content, content_hash,
          tokens, created_at, expires_at)
       VALUES (?, ?, ?, 'plain_text', ?, ?, ?, ?, ?)`,
      [
        "orig_expired_001",
        SCOPE_A,
        "ccr_exp_only",
        expiredContent1,
        contentHash(expiredContent1),
        countTokens(expiredContent1),
        "2024-01-01T00:00:00Z",
        "2024-06-01T00:00:00Z", // Way in the past
      ],
    );

    // CCR with BOTH expired AND fresh content (fresh prevents it from being affected)
    const expiredContent2 = "Mixed CCR expired content.";
    runStmt(
      db,
      `INSERT INTO original_contents
         (id, scope_id, ccr_id, content_type, content, content_hash,
          tokens, created_at, expires_at)
       VALUES (?, ?, ?, 'plain_text', ?, ?, ?, ?, ?)`,
      [
        "orig_expired_mixed",
        SCOPE_A,
        "ccr_exp_mixed",
        expiredContent2,
        contentHash(expiredContent2),
        countTokens(expiredContent2),
        "2024-01-01T00:00:00Z",
        "2024-06-01T00:00:00Z",
      ],
    );

    // Add a fresh original to the mixed CCR so it keeps canRetrieveOriginal = 1
    const fresh = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_exp_mixed",
      contentType: "plain_text",
      content: "Fresh content, not expired.",
    });

    const result = store.cleanup();
    expect(result.deleted).toBe(2);
    // ccr_exp_only lost its only original → affected
    expect(result.affectedCcrIds).toContain("ccr_exp_only");
    // ccr_exp_mixed still has the fresh one → not affected
    expect(result.affectedCcrIds).not.toContain("ccr_exp_mixed");

    // Expired ones are gone
    expect(store.getRecord("orig_expired_001", SCOPE_A)).toBeNull();
    expect(store.getRecord("orig_expired_mixed", SCOPE_A)).toBeNull();

    // Fresh one still exists
    expect(store.getRecord(fresh.id, SCOPE_A)).not.toBeNull();
  });

  it("cleanup returns zero deleted when nothing is expired", () => {
    store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Not expired, no expiresAt set.",
    });

    const result = store.cleanup();
    expect(result.deleted).toBe(0);
    expect(result.affectedCcrIds).toEqual([]);
  });

  it("cleanup handles multiple expired originals across different CCRs", () => {
    ensureCcr("ccr_exp_1", SCOPE_A);
    ensureCcr("ccr_exp_2", SCOPE_A);

    // Insert multiple expired originals
    const pastDate = "2025-01-01T00:00:00Z";
    for (let i = 1; i <= 3; i++) {
      const ccrId = i <= 2 ? "ccr_exp_1" : "ccr_exp_2";
      const content = `Expired content ${i}.`;
      runStmt(
        db,
        `INSERT INTO original_contents
           (id, scope_id, ccr_id, content_type, content, content_hash,
            tokens, created_at, expires_at)
         VALUES (?, ?, ?, 'plain_text', ?, ?, ?, ?, ?)`,
        [
          `orig_exp_multi_${i}`,
          SCOPE_A,
          ccrId,
          content,
          contentHash(content),
          countTokens(content),
          pastDate,
          pastDate,
        ],
      );
    }

    const result = store.cleanup();
    expect(result.deleted).toBe(3);
    // Both CCRs now have no originals
    expect(result.affectedCcrIds).toContain("ccr_exp_1");
    expect(result.affectedCcrIds).toContain("ccr_exp_2");
  });

  it("cleanup updates canRetrieveOriginal on CCRs with no remaining originals", () => {
    ensureCcr("ccr_exp_update", SCOPE_A);

    // Set can_retrieve_original = 1
    runStmt(
      db,
      `UPDATE compressed_contexts SET can_retrieve_original = 1 WHERE id = ?`,
      ["ccr_exp_update"],
    );

    const content = "Sole content, will expire.";
    runStmt(
      db,
      `INSERT INTO original_contents
         (id, scope_id, ccr_id, content_type, content, content_hash,
          tokens, created_at, expires_at)
       VALUES (?, ?, ?, 'plain_text', ?, ?, ?, ?, ?)`,
      [
        "orig_exp_sole",
        SCOPE_A,
        "ccr_exp_update",
        content,
        contentHash(content),
        countTokens(content),
        "2024-01-01T00:00:00Z",
        "2024-06-01T00:00:00Z",
      ],
    );

    store.cleanup();

    const ccrRow = queryOne(
      db,
      "SELECT can_retrieve_original FROM compressed_contexts WHERE id = ?",
      ["ccr_exp_update"],
    );
    expect(Number(ccrRow!["can_retrieve_original"])).toBe(0);
  });

  it("cleanup does not affect CCRs that still have originals", () => {
    ensureCcr("ccr_still_has", SCOPE_A);

    // One expired
    const expiredContent = "Expired.";
    runStmt(
      db,
      `INSERT INTO original_contents
         (id, scope_id, ccr_id, content_type, content, content_hash,
          tokens, created_at, expires_at)
       VALUES (?, ?, ?, 'plain_text', ?, ?, ?, ?, ?)`,
      [
        "orig_partial_exp",
        SCOPE_A,
        "ccr_still_has",
        expiredContent,
        contentHash(expiredContent),
        countTokens(expiredContent),
        "2024-01-01T00:00:00Z",
        "2024-06-01T00:00:00Z",
      ],
    );

    // One still valid (no expiresAt)
    const fresh = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_still_has",
      contentType: "plain_text",
      content: "Still valid.",
    });

    runStmt(
      db,
      `UPDATE compressed_contexts SET can_retrieve_original = 1 WHERE id = ?`,
      ["ccr_still_has"],
    );

    const result = store.cleanup();
    expect(result.deleted).toBe(1);
    // CCR is not in affectedCcrIds because it still has originals
    expect(result.affectedCcrIds).not.toContain("ccr_still_has");

    const ccrRow = queryOne(
      db,
      "SELECT can_retrieve_original FROM compressed_contexts WHERE id = ?",
      ["ccr_still_has"],
    );
    expect(Number(ccrRow!["can_retrieve_original"])).toBe(1);

    // Fresh original still exists
    expect(store.getRecord(fresh.id, SCOPE_A)).not.toBeNull();
  });
});

// ============================================================================
// 9.4 — Integration & Edge Cases
// ============================================================================

describe("9.4 Integration & Edge Cases", () => {
  it("full lifecycle: save → retrieve → delete → verify gone", () => {
    const content = "Full lifecycle test content.";
    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "command_output",
      content,
      metadata: { exitCode: 1 },
    });

    // Retrieve
    const retrieved = store.retrieve(saved.id, SCOPE_A);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe(content);
    expect(retrieved!.metadata).toEqual({ exitCode: 1 });

    // Delete
    const deleted = store.delete(saved.id, SCOPE_A);
    expect(deleted).toBe(true);

    // Verify gone
    expect(store.getRecord(saved.id, SCOPE_A)).toBeNull();
    expect(store.retrieve(saved.id, SCOPE_A)).toBeNull();
  });

  it("handles special characters in content", () => {
    // NOTE: SQLite TEXT columns cannot store null bytes (\x00) — they get
    // truncated at the first null byte. This is a C-API-level limitation.
    const content = `Line with "quotes" and 'apostrophes'.
Backticks: \`\`\`
SQL injection attempt: DROP TABLE original_contents; --
HTML: <script>alert('xss')</script>
Unicode: 中文 日本語 한국어 🚀✅`;

    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content,
    });

    const retrieved = store.retrieve(saved.id, SCOPE_A);
    expect(retrieved!.content).toBe(content);
  });

  it("handles JSON content as contentType", () => {
    const content = JSON.stringify({
      errors: [{ code: 500, message: "Internal Server Error" }],
      warnings: [{ code: 200, message: "Deprecated API" }],
    }, null, 2);

    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "json",
      content,
    });

    const retrieved = store.retrieve(saved.id, SCOPE_A);
    expect(retrieved!.contentType).toBe("json");
    expect(JSON.parse(retrieved!.content)).toEqual(JSON.parse(content));
  });

  it("metadata survives a round-trip through the database", () => {
    const complexMeta = {
      nested: { key: "value", arr: [1, 2, { three: 3 }] },
      nullValue: null,
      boolTrue: true,
      boolFalse: false,
      number: 42,
      float: 3.14,
      emptyStr: "",
    };

    const saved = store.save({
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: "Metadata test.",
      metadata: complexMeta,
    });

    const retrieved = store.getRecord(saved.id, SCOPE_A);
    expect(retrieved!.metadata).toEqual(complexMeta);
  });

  it("survives corrupt metadata in retrieve (fail-open)", () => {
    // Simulate corrupt JSON in the metadata column
    const content = "Content with corrupt metadata.";
    runStmt(
      db,
      `INSERT INTO original_contents
         (id, scope_id, ccr_id, content_type, content, content_hash,
          tokens, metadata, created_at)
       VALUES (?, ?, ?, 'plain_text', ?, ?, ?, ?, ?)`,
      [
        "orig_corrupt_meta",
        SCOPE_A,
        "ccr_test_001",
        content,
        contentHash(content),
        countTokens(content),
        "{this is not valid json!!!!",
        nowISO(),
      ],
    );

    // retrieve() should not throw — it returns the content with metadata=undefined
    const result = store.retrieve("orig_corrupt_meta", SCOPE_A);
    expect(result).not.toBeNull();
    expect(result!.content).toBe(content);
    expect(result!.metadata).toBeUndefined();

    // getRecord() should also survive
    const record = store.getRecord("orig_corrupt_meta", SCOPE_A);
    expect(record).not.toBeNull();
    expect(record!.metadata).toBeUndefined();
  });

  it("save with duplicate pre-computed id is idempotent (no throw)", () => {
    const customId = "orig_dup_test_001";
    const content1 = "First save with custom id.";

    // First save should succeed
    const r1 = store.save({
      id: customId,
      scopeId: SCOPE_A,
      ccrId: "ccr_test_001",
      contentType: "plain_text",
      content: content1,
    });
    expect(r1.id).toBe(customId);

    // Second save with same id and different content should NOT throw
    const content2 = "Second save with same id, different content.";
    const r2 = store.save({
      id: customId,
      scopeId: SCOPE_A,
      ccrId: "ccr_test_002",
      contentType: "plain_text",
      content: content2,
    });
    expect(r2.id).toBe(customId);

    // The original row should still contain the FIRST content (INSERT OR IGNORE)
    const retrieved = store.retrieve(customId, SCOPE_A);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe(content1);
  });
});
