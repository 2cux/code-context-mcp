/**
 * CompressedStore Tests — §10.4
 *
 * Covers:
 *   - Creating compressed context records
 *   - Querying by ccrId with scope validation
 *   - Listing by scope with sorting and pagination
 *   - Filtering by contentType
 *   - Scope isolation
 *   - Failed records (failed=true, errorReason)
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, execRaw } from "../src/storage/db.js";
import { CompressedStore, type SaveCCRInput } from "../src/compressed/compressedStore.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal valid save input with defaults for required fields. */
function makeInput(overrides?: Partial<SaveCCRInput>): SaveCCRInput {
  return {
    scopeId: "repo_test",
    contentType: "test_output",
    strategy: "test_output_conservative_v1",
    compressedContent: "FAILED: auth.test.ts — Expected true, received false",
    summary: "auth.test.ts failed due to cookie not cleared",
    originalRef: "orig_abc123",
    tokensBefore: 5000,
    tokensAfter: 500,
    tokensSaved: 4500,
    compressionRatio: 0.9,
    ...overrides,
  };
}

const SCOPE_A = "repo_aaaaaaaa";
const SCOPE_B = "repo_bbbbbbbb";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CompressedStore", () => {
  let store: CompressedStore;

  beforeAll(async () => {
    // Use :memory: for isolated, fast tests
    await initAndMigrate(":memory:");
    // Insert placeholder scope rows so FK constraints pass
    const db = getDb();
    execRaw(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES ('repo_test', '/tmp/test', 'cwdFallback', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    execRaw(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES ('${SCOPE_A}', '/tmp/a', 'cwdFallback', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    execRaw(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES ('${SCOPE_B}', '/tmp/b', 'cwdFallback', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    store = new CompressedStore(db);
  });

  afterAll(() => {
    closeDb();
  });

  // ==========================================================================
  // 10.4.1 — Creating compressed records
  // ==========================================================================

  describe("save (10.4.1 — creation)", () => {
    it("creates a record and returns it with generated id and timestamps", () => {
      const record = store.save(makeInput());

      expect(record.id).toMatch(/^ccr_/);
      expect(record.scopeId).toBe("repo_test");
      expect(record.contentType).toBe("test_output");
      expect(record.strategy).toBe("test_output_conservative_v1");
      expect(record.compressedContent).toBe(
        "FAILED: auth.test.ts — Expected true, received false",
      );
      expect(record.summary).toBe("auth.test.ts failed due to cookie not cleared");
      expect(record.originalRef).toBe("orig_abc123");
      expect(record.tokensBefore).toBe(5000);
      expect(record.tokensAfter).toBe(500);
      expect(record.tokensSaved).toBe(4500);
      expect(record.compressionRatio).toBe(0.9);
      expect(record.canRetrieveOriginal).toBe(true);
      expect(record.retrieveCount).toBe(0);
      expect(record.failed).toBe(false);
      expect(record.errorReason).toBeUndefined();
      expect(record.createdAt).toBeTruthy();
      expect(record.updatedAt).toBeTruthy();
      // ISO 8601 format
      expect(record.createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("stores metadata as JSON", () => {
      const record = store.save(
        makeInput({
          metadata: { source: "pnpm test", commandHash: "abc" },
        }),
      );

      expect(record.metadata).toEqual({
        source: "pnpm test",
        commandHash: "abc",
      });

      // Verify it round-trips through get()
      const fetched = store.get(record.id, "repo_test");
      expect(fetched?.metadata).toEqual({
        source: "pnpm test",
        commandHash: "abc",
      });
    });

    it("stores a failed record with errorReason", () => {
      const record = store.save(
        makeInput({
          failed: true,
          errorReason: "compression_timeout",
          compressedContent: "original content (unchanged)",
          tokensAfter: 5000,
          tokensSaved: 0,
          compressionRatio: 0,
        }),
      );

      expect(record.failed).toBe(true);
      expect(record.errorReason).toBe("compression_timeout");
      expect(record.tokensSaved).toBe(0);
      expect(record.compressionRatio).toBe(0);
    });

    it("generates unique ids for each record", () => {
      const a = store.save(makeInput());
      const b = store.save(makeInput());
      const c = store.save(makeInput());

      expect(a.id).not.toBe(b.id);
      expect(b.id).not.toBe(c.id);
      expect(a.id).not.toBe(c.id);
    });

    it("sets canRetrieveOriginal default to true", () => {
      const record = store.save(
        makeInput({ canRetrieveOriginal: undefined }),
      );
      expect(record.canRetrieveOriginal).toBe(true);
    });

    it("respects explicit canRetrieveOriginal = false", () => {
      const record = store.save(
        makeInput({ canRetrieveOriginal: false }),
      );
      expect(record.canRetrieveOriginal).toBe(false);
    });

    it("stores sourceRef when provided", () => {
      const record = store.save(
        makeInput({ sourceRef: "file://tests/auth.test.ts" }),
      );
      expect(record.sourceRef).toBe("file://tests/auth.test.ts");

      const fetched = store.get(record.id, "repo_test");
      expect(fetched?.sourceRef).toBe("file://tests/auth.test.ts");
    });
  });

  // ==========================================================================
  // 10.4.2 — Querying by ccrId
  // ==========================================================================

  describe("get (10.4.2 — query by ccrId)", () => {
    it("retrieves a record by id with matching scopeId", () => {
      const saved = store.save(makeInput({ scopeId: SCOPE_A }));
      const fetched = store.get(saved.id, SCOPE_A);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(saved.id);
      expect(fetched!.scopeId).toBe(SCOPE_A);
      expect(fetched!.contentType).toBe("test_output");
      expect(fetched!.compressedContent).toBe(saved.compressedContent);
    });

    it("returns null when id does not exist", () => {
      const result = store.get("ccr_nonexistent", SCOPE_A);
      expect(result).toBeNull();
    });

    it("returns null when scopeId does not match (scope isolation)", () => {
      const saved = store.save(makeInput({ scopeId: SCOPE_A }));
      const result = store.get(saved.id, SCOPE_B);
      expect(result).toBeNull();
    });

    it("returns the full record with all fields", () => {
      const saved = store.save(
        makeInput({
          scopeId: SCOPE_A,
          contentType: "log",
          strategy: "log_conservative_v1",
          compressedContent: "[ERROR] ... (filtered)",
          summary: "3 errors in app.log",
          originalRef: "orig_log_001",
          sourceRef: "app.log",
          metadata: { logLevel: "ERROR" },
          tokensBefore: 10000,
          tokensAfter: 1200,
          tokensSaved: 8800,
          compressionRatio: 0.88,
          canRetrieveOriginal: true,
          failed: false,
        }),
      );

      const fetched = store.get(saved.id, SCOPE_A)!;
      expect(fetched.id).toBe(saved.id);
      expect(fetched.scopeId).toBe(SCOPE_A);
      expect(fetched.contentType).toBe("log");
      expect(fetched.strategy).toBe("log_conservative_v1");
      expect(fetched.compressedContent).toBe("[ERROR] ... (filtered)");
      expect(fetched.summary).toBe("3 errors in app.log");
      expect(fetched.originalRef).toBe("orig_log_001");
      expect(fetched.sourceRef).toBe("app.log");
      expect(fetched.metadata).toEqual({ logLevel: "ERROR" });
      expect(fetched.tokensBefore).toBe(10000);
      expect(fetched.tokensAfter).toBe(1200);
      expect(fetched.tokensSaved).toBe(8800);
      expect(fetched.compressionRatio).toBe(0.88);
      expect(fetched.canRetrieveOriginal).toBe(true);
      expect(fetched.retrieveCount).toBe(0);
      expect(fetched.failed).toBe(false);
      expect(fetched.errorReason).toBeUndefined();
    });
  });

  // ==========================================================================
  // 10.4.3 — Scope isolation
  // ==========================================================================

  describe("scope isolation (10.4.3)", () => {
    // Clear the DB before this suite for a clean state
    let scopeA1: string;
    let scopeA2: string;
    let scopeB1: string;

    beforeEach(() => {
      // Save records across two scopes
      const r1 = store.save(
        makeInput({ scopeId: SCOPE_A, contentType: "test_output" }),
      );
      const r2 = store.save(
        makeInput({ scopeId: SCOPE_A, contentType: "log" }),
      );
      const r3 = store.save(
        makeInput({ scopeId: SCOPE_B, contentType: "code" }),
      );

      scopeA1 = r1.id;
      scopeA2 = r2.id;
      scopeB1 = r3.id;
    });

    it("list() only returns records for the requested scope", () => {
      const resultA = store.list({ scopeId: SCOPE_A });
      const idsA = resultA.items.map((i) => i.ccrId);

      expect(idsA).toContain(scopeA1);
      expect(idsA).toContain(scopeA2);
      expect(idsA).not.toContain(scopeB1);

      const resultB = store.list({ scopeId: SCOPE_B });
      const idsB = resultB.items.map((i) => i.ccrId);
      expect(idsB).toContain(scopeB1);
      expect(idsB).not.toContain(scopeA1);
    });

    it("get() enforces scope isolation", () => {
      expect(store.get(scopeA1, SCOPE_A)).not.toBeNull();
      expect(store.get(scopeA1, SCOPE_B)).toBeNull();
    });

    it("count() is scoped", () => {
      const countA = store.count(SCOPE_A);
      const countB = store.count(SCOPE_B);
      expect(countA).toBeGreaterThanOrEqual(2);
      expect(countB).toBeGreaterThanOrEqual(1);
    });

    it("count() with contentType filter is scoped", () => {
      const count = store.count(SCOPE_A, "test_output");
      expect(count).toBeGreaterThanOrEqual(1);

      // SCOPE_B has no test_output records from our setup
      const countBTest = store.count(SCOPE_B, "test_output");
      expect(countBTest).toBe(0);
    });
  });

  // ==========================================================================
  // 10.4.4 — Pagination and sorting
  // ==========================================================================

  describe("list pagination (10.4.4)", () => {
    const PAGE_SCOPE = "repo_pagination_test";

    beforeAll(() => {
      // Ensure scope row exists
      const db = getDb();
      execRaw(
        db,
        `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
         VALUES ('${PAGE_SCOPE}', '/tmp/page', 'cwdFallback', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      );

      // Create 15 records to test pagination
      for (let i = 0; i < 15; i++) {
        store.save(
          makeInput({
            scopeId: PAGE_SCOPE,
            contentType: i % 3 === 0 ? "log" : "code",
            tokensBefore: 1000 * (i + 1),
            tokensSaved: 500 * (i + 1),
          }),
        );
      }
    });

    it("returns at most `limit` items", () => {
      const result = store.list({ scopeId: PAGE_SCOPE, limit: 5 });
      expect(result.items.length).toBe(5);
      expect(result.limit).toBe(5);
      expect(result.total).toBeGreaterThanOrEqual(15);
    });

    it("offset skips the first N records", () => {
      const page1 = store.list({ scopeId: PAGE_SCOPE, limit: 5, offset: 0 });
      const page2 = store.list({ scopeId: PAGE_SCOPE, limit: 5, offset: 5 });

      expect(page1.items.length).toBe(5);
      expect(page2.items.length).toBe(5);

      // No overlap between pages
      const ids1 = new Set(page1.items.map((i) => i.ccrId));
      const ids2 = new Set(page2.items.map((i) => i.ccrId));
      for (const id of ids1) {
        expect(ids2.has(id)).toBe(false);
      }
    });

    it("sorts by created_at DESC (most recent first)", () => {
      const result = store.list({ scopeId: PAGE_SCOPE, limit: 15 });
      const dates = result.items.map((i) => i.createdAt);

      // Verify descending order
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]! >= dates[i]!).toBe(true);
      }
    });

    it("defaults to limit=20, offset=0", () => {
      const result = store.list({ scopeId: PAGE_SCOPE });
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it("returns empty items when offset exceeds total", () => {
      const result = store.list({
        scopeId: PAGE_SCOPE,
        limit: 5,
        offset: 999,
      });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBeGreaterThanOrEqual(15);
    });

    it("returns total count correctly", () => {
      const result = store.list({ scopeId: PAGE_SCOPE, limit: 3 });
      expect(result.total).toBeGreaterThanOrEqual(15);
      expect(result.items.length).toBe(3); // limited, but total reflects all
    });
  });

  // ==========================================================================
  // 10.4.5 — Failed records
  // ==========================================================================

  describe("failed records (10.4.5)", () => {
    it("saves and retrieves a failed record with errorReason", () => {
      const record = store.save(
        makeInput({
          scopeId: SCOPE_A,
          failed: true,
          errorReason: "compression_timeout",
          tokensSaved: 0,
          compressionRatio: 0,
        }),
      );

      expect(record.failed).toBe(true);
      expect(record.errorReason).toBe("compression_timeout");

      const fetched = store.get(record.id, SCOPE_A);
      expect(fetched?.failed).toBe(true);
      expect(fetched?.errorReason).toBe("compression_timeout");
    });

    it("invalid strategy mode produces a failed record", () => {
      const record = store.save(
        makeInput({
          scopeId: SCOPE_A,
          failed: true,
          errorReason: 'Invalid strategy mode: "aggressive"',
          strategy: "",
          compressedContent:
            "FAILED: auth.test.ts — Expected true, received false",
          tokensAfter: 5000,
          tokensSaved: 0,
          compressionRatio: 0,
        }),
      );

      expect(record.failed).toBe(true);
      expect(record.errorReason).toContain("Invalid strategy mode");
      expect(record.strategy).toBe("");
      expect(record.tokensSaved).toBe(0);

      // Verify it appears in list results
      const result = store.list({ scopeId: SCOPE_A });
      const failedItem = result.items.find((i) => i.ccrId === record.id);
      expect(failedItem).toBeDefined();
      expect(failedItem!.failed).toBe(true);
    });

    it("distinct failed vs success records in list stats", () => {
      // Save one failed + one success
      store.save(makeInput({ scopeId: SCOPE_A, failed: true, errorReason: "test" }));
      store.save(makeInput({ scopeId: SCOPE_A, failed: false }));

      const result = store.list({ scopeId: SCOPE_A });
      const failedCount = result.items.filter((i) => i.failed).length;
      const successCount = result.items.filter((i) => !i.failed).length;

      expect(failedCount).toBeGreaterThanOrEqual(1);
      expect(successCount).toBeGreaterThanOrEqual(1);
      expect(failedCount + successCount).toBe(result.items.length);
    });

    it("failed records can omit errorReason (undefined)", () => {
      const record = store.save(
        makeInput({
          scopeId: SCOPE_A,
          failed: true,
          errorReason: undefined,
        }),
      );

      expect(record.failed).toBe(true);
      expect(record.errorReason).toBeUndefined();
    });
  });

  // ==========================================================================
  // 10.4.6 — contentType filtering in list
  // ==========================================================================

  describe("list with contentType filter", () => {
    const FILTER_SCOPE = "repo_filter_test";

    beforeAll(() => {
      const db = getDb();
      execRaw(
        db,
        `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
         VALUES ('${FILTER_SCOPE}', '/tmp/filter', 'cwdFallback', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      );

      // Mixed content types
      store.save(
        makeInput({ scopeId: FILTER_SCOPE, contentType: "test_output" }),
      );
      store.save(makeInput({ scopeId: FILTER_SCOPE, contentType: "log" }));
      store.save(makeInput({ scopeId: FILTER_SCOPE, contentType: "log" }));
      store.save(makeInput({ scopeId: FILTER_SCOPE, contentType: "code" }));
      store.save(makeInput({ scopeId: FILTER_SCOPE, contentType: "json" }));
    });

    it("filters by contentType", () => {
      const result = store.list({
        scopeId: FILTER_SCOPE,
        contentType: "log",
      });
      expect(result.items.length).toBe(2);
      for (const item of result.items) {
        expect(item.contentType).toBe("log");
      }
    });

    it("returns empty when no records match contentType", () => {
      const result = store.list({
        scopeId: FILTER_SCOPE,
        contentType: "conversation_history",
      });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("returns all types when contentType is not specified", () => {
      const result = store.list({ scopeId: FILTER_SCOPE });
      expect(result.total).toBeGreaterThanOrEqual(5);
      const types = new Set(result.items.map((i) => i.contentType));
      expect(types.size).toBeGreaterThanOrEqual(3); // test_output, log, code, json
    });
  });

  // ==========================================================================
  // 10.4.7 — Edge cases
  // ==========================================================================

  describe("edge cases", () => {
    it("handles empty scope gracefully", () => {
      const result = store.list({ scopeId: "repo_nonexistent" });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("handles empty string summary", () => {
      const record = store.save(makeInput({ summary: "" }));
      expect(record.summary).toBe("");
    });

    it("handles null/undefined optional fields", () => {
      const record = store.save(
        makeInput({
          summary: undefined,
          originalRef: undefined,
          sourceRef: undefined,
          metadata: undefined,
          errorReason: undefined,
          expiresAt: undefined,
        }),
      );

      expect(record.summary).toBeUndefined();
      expect(record.originalRef).toBeUndefined();
      expect(record.errorReason).toBeUndefined();

      const fetched = store.get(record.id, "repo_test");
      expect(fetched?.summary).toBeUndefined();
      expect(fetched?.originalRef).toBeUndefined();
    });

    it("corrupt metadata JSON is handled safely", () => {
      // Direct DB insert of corrupt metadata to test safeParseJSON
      const db = getDb();
      const id = "ccr_corrupt_test";
      execRaw(
        db,
        `INSERT OR IGNORE INTO compressed_contexts
         (id, scope_id, content_type, strategy, compressed_content,
          tokens_before, tokens_after, tokens_saved, compression_ratio,
          metadata, created_at, updated_at)
         VALUES ('${id}', 'repo_test', 'test_output', 't_v1', 'x',
          100, 50, 50, 0.5, '{invalid json', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      );

      const record = store.get(id, "repo_test");
      expect(record).not.toBeNull();
      // Metadata should be undefined (fail-open), not throw
      expect(record!.metadata).toBeUndefined();
    });
  });
});
