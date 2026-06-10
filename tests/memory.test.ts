/**
 * Memory Data Layer Tests — §17.4
 *
 * Covers:
 *   - Creating memories (remember)
 *   - Querying by id with scope isolation (get)
 *   - Listing by scope with type/status filters
 *   - Pagination
 *   - FTS search (LIKE fallback when FTS5 unavailable)
 *   - Status transitions (lifecycle validation)
 *   - Forget modes
 *   - Bulk expiration
 *   - Profile fact creation
 *   - Tags serialization
 *   - Edge cases
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Database } from "sql.js";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, execRaw, queryOne } from "../src/storage/db.js";
import { MemoryService } from "../src/memory/memoryService.js";
import { MemoryFtsIndex } from "../src/memory/memoryFts.js";
import { RecallEngine } from "../src/memory/recallEngine.js";
import { expireMemories, isValidTransition } from "../src/memory/lifecycle.js";
import type { SaveMemoryInput } from "../src/memory/types.js";
import type { MemoryType } from "../src/memory/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides?: Partial<SaveMemoryInput>): SaveMemoryInput {
  return {
    scopeId: "repo_test",
    type: "project_rule",
    content: "Always use pnpm as the package manager. Never use npm or yarn.",
    summary: "Use pnpm",
    sourceRef: "docs/setup.md",
    confidence: 0.9,
    tags: ["package-manager", "build"],
    ...overrides,
  };
}

const SCOPE_A = "mem_a";
const SCOPE_B = "mem_b";

const ALL_MEMORY_TYPES: MemoryType[] = [
  "decision", "bug", "command", "file_summary", "project_rule",
  "user_preference", "current_task", "test_failure", "api_contract", "dependency",
];

/** Safe cleanup: delete FKs first, then main tables. */
function cleanupTables(db: Database): void {
  // Delete in FK-safe order
  try { db.exec("DELETE FROM memories_fts"); } catch { /* FTS may not exist */ }
  db.exec("DELETE FROM profile_facts");
  db.exec("DELETE FROM receipts");
  db.exec("DELETE FROM memories");
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("Memory Data Layer", () => {
  let db: Database;
  let service: MemoryService;
  let ftsIndex: MemoryFtsIndex;
  let recallEngine: RecallEngine;

  beforeAll(async () => {
    await initAndMigrate(":memory:");
    db = getDb();

    // Insert scope rows for FK constraints
    const allScopes = [
      "repo_test", SCOPE_A, SCOPE_B,
      SCOPE_A + "_pag", SCOPE_A + "_exp", SCOPE_A + "_pf",
    ];
    for (const scopeId of allScopes) {
      execRaw(
        db,
        `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
         VALUES ('${scopeId}', '/tmp/${scopeId}', 'cwdFallback', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      );
    }

    ftsIndex = new MemoryFtsIndex(db);
    service = new MemoryService(db, { ftsIndex });
    recallEngine = new RecallEngine(db, ftsIndex);
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    cleanupTables(db);
  });

  // ==========================================================================
  // 17.4.1 — Test creating memories
  // ==========================================================================

  describe("17.4.1 — Creating memories", () => {
    it("creates a memory and returns memoryId + receiptId", () => {
      const result = service.remember(makeInput());
      expect(result.memoryId).toMatch(/^mem_/);
      expect(result.receiptId).toMatch(/^rcp_/);
      // PRD §11.6: remember returns scopeId, type, status in output
      expect(result.scopeId).toBe("repo_test");
      expect(result.type).toBe("project_rule");
      expect(result.status).toBe("active");
    });

    it("persists all fields correctly", () => {
      const { memoryId } = service.remember(makeInput());
      const record = service.get(memoryId, "repo_test");

      expect(record).not.toBeNull();
      expect(record!.type).toBe("project_rule");
      expect(record!.content).toContain("pnpm");
      expect(record!.summary).toBe("Use pnpm");
      expect(record!.sourceRef).toBe("docs/setup.md");
      expect(record!.confidence).toBe(0.9);
      expect(record!.status).toBe("active");
      expect(record!.tags).toEqual(["package-manager", "build"]);
      expect(record!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(record!.updatedAt).toBe(record!.createdAt);
    });

    it("defaults confidence to 0.8", () => {
      const { memoryId } = service.remember(makeInput({ confidence: undefined }));
      const record = service.get(memoryId, "repo_test");
      expect(record!.confidence).toBe(0.8);
    });

    it("defaults status to active", () => {
      const { memoryId } = service.remember(makeInput());
      const record = service.get(memoryId, "repo_test");
      expect(record!.status).toBe("active");
    });

    it("generates unique ids", () => {
      const a = service.remember(makeInput());
      const b = service.remember(makeInput());
      const c = service.remember(makeInput());
      expect(a.memoryId).not.toBe(b.memoryId);
      expect(b.memoryId).not.toBe(c.memoryId);
      expect(a.memoryId).not.toBe(c.memoryId);
    });

    it("stores expiresAt when provided", () => {
      const { memoryId } = service.remember(
        makeInput({ expiresAt: "2027-06-10T00:00:00Z" }),
      );
      const record = service.get(memoryId, "repo_test");
      expect(record!.expiresAt).toBe("2027-06-10T00:00:00Z");
    });

    it("handles undefined optional fields", () => {
      const { memoryId } = service.remember(
        makeInput({ summary: undefined, sourceRef: undefined, tags: undefined, expiresAt: undefined }),
      );
      const record = service.get(memoryId, "repo_test");
      expect(record!.summary).toBeUndefined();
      expect(record!.sourceRef).toBeUndefined();
      expect(record!.tags).toBeUndefined();
      expect(record!.expiresAt).toBeUndefined();
    });
  });

  // ==========================================================================
  // 17.4.2 — Test querying by scope
  // ==========================================================================

  describe("17.4.2 — Query by scope", () => {
    it("get() returns record when id and scope match", () => {
      const { memoryId } = service.remember(makeInput({ scopeId: SCOPE_A }));
      const record = service.get(memoryId, SCOPE_A);
      expect(record).not.toBeNull();
      expect(record!.id).toBe(memoryId);
    });

    it("get() returns null when id does not exist", () => {
      const record = service.get("mem_nonexistent", SCOPE_A);
      expect(record).toBeNull();
    });

    it("get() returns null when scopeId does not match (scope isolation)", () => {
      const { memoryId } = service.remember(makeInput({ scopeId: SCOPE_A }));
      const record = service.get(memoryId, SCOPE_B);
      expect(record).toBeNull();
    });

    it("list() only returns records for the requested scope", () => {
      service.remember(makeInput({ scopeId: SCOPE_A, type: "decision" }));
      service.remember(makeInput({ scopeId: SCOPE_A, type: "bug" }));
      service.remember(makeInput({ scopeId: SCOPE_B, type: "command" }));

      const resultA = service.list({ scopeId: SCOPE_A });
      expect(resultA.total).toBe(2);
      for (const item of resultA.items) {
        expect(item.scopeId).toBe(SCOPE_A);
      }

      const resultB = service.list({ scopeId: SCOPE_B });
      expect(resultB.total).toBe(1);
      for (const item of resultB.items) {
        expect(item.scopeId).toBe(SCOPE_B);
      }
    });

    it("list() returns empty for unknown scope", () => {
      const result = service.list({ scopeId: "mem_scope_nonexistent" });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ==========================================================================
  // 17.4.3 — Test query by type
  // ==========================================================================

  describe("17.4.3 — Query by type", () => {
    // Pre-populate data in each test — beforeEach cleans so we set up per-test
    function setupTypeData(): void {
      service.remember(makeInput({ scopeId: SCOPE_A, type: "decision", content: "D1" }));
      service.remember(makeInput({ scopeId: SCOPE_A, type: "bug", content: "B1" }));
      service.remember(makeInput({ scopeId: SCOPE_A, type: "bug", content: "B2" }));
      service.remember(makeInput({ scopeId: SCOPE_A, type: "project_rule", content: "P1" }));
      service.remember(makeInput({ scopeId: SCOPE_A, type: "api_contract", content: "A1" }));
    }

    it("filters by a single type", () => {
      setupTypeData();
      const result = service.list({ scopeId: SCOPE_A, types: ["bug"] });
      expect(result.items.length).toBe(2);
      for (const item of result.items) {
        expect(item.type).toBe("bug");
      }
    });

    it("filters by multiple types", () => {
      setupTypeData();
      const result = service.list({ scopeId: SCOPE_A, types: ["decision", "api_contract"] });
      expect(result.total).toBe(2);
      const types = new Set(result.items.map((i) => i.type));
      expect(types.has("decision")).toBe(true);
      expect(types.has("api_contract")).toBe(true);
      expect(types.has("bug")).toBe(false);
    });

    it("returns empty when no records match type", () => {
      setupTypeData();
      const result = service.list({ scopeId: SCOPE_A, types: ["dependency"] });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("returns all types when types filter is not specified", () => {
      setupTypeData();
      const result = service.list({ scopeId: SCOPE_A });
      expect(result.total).toBe(5);
      const types = new Set(result.items.map((i) => i.type));
      expect(types.size).toBeGreaterThanOrEqual(3);
    });
  });

  // ==========================================================================
  // 17.4.4 — Test query by status
  // ==========================================================================

  describe("17.4.4 — Query by status", () => {
    it("filters by a single status", () => {
      const { memoryId: m1 } = service.remember(
        makeInput({ scopeId: SCOPE_A, content: "active 1" }),
      );
      service.remember(makeInput({ scopeId: SCOPE_A, content: "active 2" }));
      service.updateStatus(m1, SCOPE_A, "forgotten");

      const result = service.list({ scopeId: SCOPE_A, status: ["active"] });
      expect(result.total).toBe(1);
      for (const item of result.items) {
        expect(item.status).toBe("active");
      }
    });

    it("filters by multiple statuses", () => {
      const { memoryId: m1 } = service.remember(
        makeInput({ scopeId: SCOPE_A, content: "active 1" }),
      );
      service.remember(makeInput({ scopeId: SCOPE_A, content: "active 2" }));
      service.updateStatus(m1, SCOPE_A, "forgotten");

      const result = service.list({ scopeId: SCOPE_A, status: ["active", "forgotten"] });
      expect(result.total).toBe(2);
      const statuses = new Set(result.items.map((i) => i.status));
      expect(statuses.has("active")).toBe(true);
      expect(statuses.has("forgotten")).toBe(true);
    });

    it("returns empty when no records match status", () => {
      service.remember(makeInput({ scopeId: SCOPE_A, content: "only active" }));
      const result = service.list({ scopeId: SCOPE_A, status: ["expired"] });
      expect(result.items).toHaveLength(0);
    });

    it("returns all statuses when filter is not specified", () => {
      service.remember(makeInput({ scopeId: SCOPE_A, content: "a" }));
      service.remember(makeInput({ scopeId: SCOPE_A, content: "b" }));
      const result = service.list({ scopeId: SCOPE_A });
      expect(result.total).toBe(2);
    });
  });

  // ==========================================================================
  // 17.4.5 — Pagination
  // ==========================================================================

  describe("17.4.5 — Pagination", () => {
    const PAGE_SCOPE = SCOPE_A + "_pag";

    function setupPageData(): void {
      for (let i = 0; i < 15; i++) {
        service.remember(
          makeInput({
            scopeId: PAGE_SCOPE,
            type: i % 3 === 0 ? "bug" : "decision",
            content: `Memory item ${i + 1}`,
          }),
        );
      }
    }

    it("returns at most `limit` items", () => {
      setupPageData();
      const result = service.list({ scopeId: PAGE_SCOPE, limit: 5 });
      expect(result.items.length).toBe(5);
      expect(result.limit).toBe(5);
      expect(result.total).toBe(15);
    });

    it("offset skips the first N records", () => {
      setupPageData();
      const page1 = service.list({ scopeId: PAGE_SCOPE, limit: 5, offset: 0 });
      const page2 = service.list({ scopeId: PAGE_SCOPE, limit: 5, offset: 5 });

      const ids1 = new Set(page1.items.map((i) => i.id));
      const ids2 = new Set(page2.items.map((i) => i.id));
      for (const id of ids1) {
        expect(ids2.has(id)).toBe(false);
      }
    });

    it("sorts by created_at DESC (most recent first)", () => {
      setupPageData();
      const result = service.list({ scopeId: PAGE_SCOPE, limit: 15 });
      const dates = result.items.map((i) => i.createdAt);
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]! >= dates[i]!).toBe(true);
      }
    });

    it("defaults to limit=20, offset=0", () => {
      const result = service.list({ scopeId: PAGE_SCOPE });
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it("returns empty items when offset exceeds total", () => {
      const result = service.list({ scopeId: PAGE_SCOPE, limit: 5, offset: 999 });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBeGreaterThanOrEqual(0);
    });

    it("total count is correct regardless of limit", () => {
      setupPageData();
      const result = service.list({ scopeId: PAGE_SCOPE, limit: 3 });
      expect(result.total).toBe(15);
      expect(result.items.length).toBe(3);
    });
  });

  // ==========================================================================
  // 17.4.6 — FTS search (LIKE fallback)
  // ==========================================================================

  describe("17.4.6 — FTS search", () => {
    function setupSearchData(): void {
      service.remember(
        makeInput({
          scopeId: SCOPE_A,
          type: "project_rule",
          content: "Always use pnpm as the package manager. Never use npm or yarn.",
          summary: "Use pnpm",
          tags: ["package-manager"],
        }),
      );
      service.remember(
        makeInput({
          scopeId: SCOPE_A,
          type: "bug",
          content: "Login page crashes when user enters invalid email format.",
          summary: "Login crash on invalid email",
          tags: ["bug", "login"],
        }),
      );
      service.remember(
        makeInput({
          scopeId: SCOPE_A,
          type: "decision",
          content: "Decided to use React Router v6 for client-side routing.",
          summary: "React Router v6 decision",
          tags: ["routing", "frontend"],
        }),
      );
    }

    it("searches by content text", () => {
      setupSearchData();
      const results = recallEngine.search({
        scopeId: SCOPE_A, query: "pnpm package manager", limit: 5,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.memory.content).toContain("pnpm");
    });

    it("searches by summary", () => {
      setupSearchData();
      const results = recallEngine.search({
        scopeId: SCOPE_A, query: "React Router", limit: 5,
      });
      expect(results.length).toBeGreaterThan(0);
      const hasReactRouter = results.some((r) => r.memory.summary?.includes("React Router"));
      expect(hasReactRouter).toBe(true);
    });

    it("respects type filter in search", () => {
      setupSearchData();
      const results = recallEngine.search({
        scopeId: SCOPE_A, query: "login email", types: ["bug"], limit: 5,
      });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.memory.type).toBe("bug");
      }
    });

    it("returns empty for non-matching query", () => {
      setupSearchData();
      const results = recallEngine.search({
        scopeId: SCOPE_A, query: "xyznonexistent12345", limit: 5,
      });
      expect(results.length).toBe(0);
    });

    it("returns empty for empty/whitespace query", () => {
      setupSearchData();
      const resultsEmpty = recallEngine.search({
        scopeId: SCOPE_A, query: "", limit: 5,
      });
      expect(resultsEmpty.length).toBe(0);

      const resultsWhitespace = recallEngine.search({
        scopeId: SCOPE_A, query: "   ", limit: 5,
      });
      expect(resultsWhitespace.length).toBe(0);
    });

    it("returns active memories by default", () => {
      setupSearchData();
      // Create and then forget a memory
      const { memoryId } = service.remember(
        makeInput({ scopeId: SCOPE_A, type: "decision", content: "Forgotten decision about using Webpack." }),
      );
      service.updateStatus(memoryId, SCOPE_A, "forgotten");

      const results = recallEngine.search({
        scopeId: SCOPE_A, query: "Webpack", limit: 5,
      });
      // Should NOT find the forgotten memory (default filter is active only)
      expect(results.length).toBe(0);
    });

    it("scores results by relevance", () => {
      setupSearchData();
      const results = recallEngine.search({
        scopeId: SCOPE_A, query: "login email invalid crash", limit: 10,
      });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.rank).toBeGreaterThanOrEqual(1);
      }
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.rank).toBeLessThan(results[i]!.rank);
      }
    });

    it("supports status filter in search", () => {
      setupSearchData();
      const results = recallEngine.search({
        scopeId: SCOPE_A, query: "login", status: ["active"], limit: 5,
      });
      for (const r of results) {
        expect(r.memory.status).toBe("active");
      }
    });
  });

  // ==========================================================================
  // 17.4.7 — Status transitions (lifecycle)
  // ==========================================================================

  describe("17.4.7 — Status transitions", () => {
    it("validates valid transitions", () => {
      expect(isValidTransition("active", "superseded")).toBe(true);
      expect(isValidTransition("active", "forgotten")).toBe(true);
      expect(isValidTransition("active", "expired")).toBe(true);
      expect(isValidTransition("superseded", "active")).toBe(true);
      expect(isValidTransition("forgotten", "active")).toBe(true);
      expect(isValidTransition("expired", "active")).toBe(true);
    });

    it("rejects invalid transitions", () => {
      expect(isValidTransition("active", "active")).toBe(false);
      expect(isValidTransition("superseded", "forgotten")).toBe(false);
      expect(isValidTransition("forgotten", "expired")).toBe(false);
      expect(isValidTransition("expired", "superseded")).toBe(false);
    });

    it("updateStatus throws on invalid transition", () => {
      const { memoryId } = service.remember(makeInput({ scopeId: SCOPE_A }));
      const updated = service.updateStatus(memoryId, SCOPE_A, "forgotten");
      expect(updated!.status).toBe("forgotten");

      // forgotten -> expired is INVALID
      expect(() => {
        service.updateStatus(memoryId, SCOPE_A, "expired");
      }).toThrow(/Invalid memory lifecycle transition/);
    });

    it("updateStatus updates timestamps", () => {
      const { memoryId } = service.remember(makeInput({ scopeId: SCOPE_A }));
      const original = service.get(memoryId, SCOPE_A)!;
      const updated = service.updateStatus(memoryId, SCOPE_A, "forgotten")!;
      // updatedAt should be >= original (may be equal in same ms)
      expect(updated.updatedAt >= original.updatedAt).toBe(true);
    });

    it("updateStatus can update additional fields", () => {
      const { memoryId } = service.remember(makeInput({ scopeId: SCOPE_A }));
      const updated = service.updateStatus(memoryId, SCOPE_A, "forgotten", {
        summary: "Updated summary",
        confidence: 0.5,
        tags: ["updated"],
      });
      expect(updated!.status).toBe("forgotten");
      expect(updated!.summary).toBe("Updated summary");
      expect(updated!.confidence).toBe(0.5);
      expect(updated!.tags).toEqual(["updated"]);
    });

    it("updateStatus returns null for wrong scope", () => {
      const { memoryId } = service.remember(makeInput({ scopeId: SCOPE_A }));
      const result = service.updateStatus(memoryId, SCOPE_B, "forgotten");
      expect(result).toBeNull();
    });

    it("updateStatus returns null for missing id", () => {
      const result = service.updateStatus("mem_nonexistent", SCOPE_A, "forgotten");
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // 17.4.8 — Forget modes
  // ==========================================================================

  describe("17.4.8 — Forget modes", () => {
    it("soft_forget transitions active -> forgotten", () => {
      const { memoryId } = service.remember(makeInput({ scopeId: SCOPE_A }));
      const result = service.forget({
        id: memoryId, scopeId: SCOPE_A, mode: "soft_forget", reason: "No longer relevant",
      });
      expect(result).not.toBeNull();
      expect(result!.previousStatus).toBe("active");
      expect(result!.newStatus).toBe("forgotten");
      expect(result!.receiptId).toMatch(/^rcp_/);

      const record = service.get(memoryId, SCOPE_A);
      expect(record!.status).toBe("forgotten");
    });

    it("supersede transitions active -> superseded with supersededBy", () => {
      const { memoryId: oldId } = service.remember(
        makeInput({ scopeId: SCOPE_A, content: "Old rule" }),
      );
      const { memoryId: newId } = service.remember(
        makeInput({ scopeId: SCOPE_A, content: "New rule" }),
      );

      const result = service.forget({
        id: oldId, scopeId: SCOPE_A, mode: "supersede", supersededBy: newId,
      });
      expect(result).not.toBeNull();
      expect(result!.newStatus).toBe("superseded");
      // PRD §11.8: forget output includes supersededBy
      expect(result!.supersededBy).toBe(newId);

      const record = service.get(oldId, SCOPE_A);
      expect(record!.status).toBe("superseded");
      expect(record!.supersededBy).toBe(newId);
    });

    it("supersede populates supersedes on the replacement memory (PRD §15.4)", () => {
      const { memoryId: oldId } = service.remember(
        makeInput({ scopeId: SCOPE_A, content: "Old rule" }),
      );
      const { memoryId: newId } = service.remember(
        makeInput({ scopeId: SCOPE_A, content: "New rule" }),
      );

      // Supersede old with new
      service.forget({
        id: oldId, scopeId: SCOPE_A, mode: "supersede", supersededBy: newId,
      });

      // The new memory should have supersedes = [oldId]
      const newRecord = service.get(newId, SCOPE_A);
      expect(newRecord!.supersedes).toEqual([oldId]);

      // The old memory should have supersedes = undefined (it doesn't supersede anything)
      const oldRecord = service.get(oldId, SCOPE_A);
      expect(oldRecord!.supersedes).toEqual([]);
    });

    it("expire transitions active -> expired", () => {
      const { memoryId } = service.remember(makeInput({ scopeId: SCOPE_A }));
      const result = service.forget({
        id: memoryId, scopeId: SCOPE_A, mode: "expire",
      });
      expect(result).not.toBeNull();
      expect(result!.newStatus).toBe("expired");

      const record = service.get(memoryId, SCOPE_A);
      expect(record!.status).toBe("expired");
    });

    it("hard_delete removes the record entirely", () => {
      const { memoryId } = service.remember(makeInput({ scopeId: SCOPE_A }));
      const result = service.forget({
        id: memoryId, scopeId: SCOPE_A, mode: "hard_delete",
      });
      expect(result).not.toBeNull();
      expect(result!.previousStatus).toBe("active");

      const record = service.get(memoryId, SCOPE_A);
      expect(record).toBeNull();
    });

    it("hard_delete also removes referencing profile_facts", () => {
      const { memoryId } = service.remember(
        makeInput({ scopeId: SCOPE_A, profileTarget: "static", content: "Important project rule" }),
      );

      // Verify profile fact was created
      const pfRow = queryOne(
        db,
        "SELECT COUNT(*) as cnt FROM profile_facts WHERE source_memory_id = ?",
        [memoryId],
      );
      expect(Number(pfRow?.["cnt"] ?? 0)).toBeGreaterThanOrEqual(1);

      // Hard delete
      service.forget({ id: memoryId, scopeId: SCOPE_A, mode: "hard_delete" });

      // Profile fact should be cleaned up
      const pfAfter = queryOne(
        db,
        "SELECT COUNT(*) as cnt FROM profile_facts WHERE source_memory_id = ?",
        [memoryId],
      );
      expect(Number(pfAfter?.["cnt"] ?? 0)).toBe(0);
    });

    it("forget returns null for non-existent memory", () => {
      const result = service.forget({
        id: "mem_nonexistent", scopeId: SCOPE_A, mode: "soft_forget",
      });
      expect(result).toBeNull();
    });

    it("forget returns null for wrong scope", () => {
      const { memoryId } = service.remember(makeInput({ scopeId: SCOPE_A }));
      const result = service.forget({
        id: memoryId, scopeId: SCOPE_B, mode: "soft_forget",
      });
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // 17.4.9 — Bulk expiration
  // ==========================================================================

  describe("17.4.9 — Bulk expiration", () => {
    const EXPIRE_SCOPE = SCOPE_A + "_exp";

    it("expires only active memories with past expiresAt", () => {
      // Memory that should expire
      const { memoryId: expId } = service.remember(
        makeInput({ scopeId: EXPIRE_SCOPE, content: "Should expire", expiresAt: "2025-01-01T00:00:00Z" }),
      );
      // Memory that should NOT expire
      service.remember(
        makeInput({ scopeId: EXPIRE_SCOPE, content: "Should stay active", expiresAt: "2099-01-01T00:00:00Z" }),
      );
      // Memory without expiresAt
      service.remember(
        makeInput({ scopeId: EXPIRE_SCOPE, content: "No expiration", expiresAt: undefined }),
      );

      const expiredCount = expireMemories(db);
      expect(expiredCount).toBe(1);

      const expired = service.get(expId, EXPIRE_SCOPE);
      expect(expired!.status).toBe("expired");
    });

    it("handles empty result (no expired memories)", () => {
      service.remember(
        makeInput({ scopeId: EXPIRE_SCOPE, content: "Future", expiresAt: "2099-01-01T00:00:00Z" }),
      );
      const count = expireMemories(db);
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // 17.4.10 — Profile fact creation
  // ==========================================================================

  describe("17.4.10 — Profile fact creation", () => {
    const PF_SCOPE = SCOPE_A + "_pf";

    it("creates a static profile fact when profileTarget='static'", () => {
      service.remember(
        makeInput({ scopeId: PF_SCOPE, type: "project_rule", content: "Use TypeScript strict mode", summary: "Strict TS", profileTarget: "static" }),
      );

      const rows = db.exec(
        `SELECT * FROM profile_facts WHERE scope_id = '${PF_SCOPE}' AND layer = 'static'`,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]!.values.length).toBeGreaterThanOrEqual(1);
      const content = rows[0]!.values[0]![3]; // content column
      expect(content).toBe("Strict TS"); // summary is used as content
    });

    it("creates a dynamic profile fact when profileTarget='dynamic'", () => {
      service.remember(
        makeInput({ scopeId: PF_SCOPE, type: "current_task", content: "Fixing auth session bug", summary: "Auth session fix", profileTarget: "dynamic" }),
      );

      const rows = db.exec(
        `SELECT * FROM profile_facts WHERE scope_id = '${PF_SCOPE}' AND layer = 'dynamic'`,
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("does not create a profile fact when profileTarget is not specified", () => {
      service.remember(makeInput({ scopeId: PF_SCOPE, profileTarget: undefined }));

      const countRow = queryOne(
        db,
        "SELECT COUNT(*) as cnt FROM profile_facts WHERE scope_id = ?",
        [PF_SCOPE],
      );
      expect(Number(countRow?.["cnt"] ?? 0)).toBe(0);
    });
  });

  // ==========================================================================
  // 17.4.11 — Edge cases
  // ==========================================================================

  describe("17.4.11 — Edge cases", () => {
    it("handles empty string summary", () => {
      const { memoryId } = service.remember(makeInput({ summary: "" }));
      const record = service.get(memoryId, "repo_test");
      expect(record!.summary).toBe("");
    });

    it("handles empty tags array", () => {
      const { memoryId } = service.remember(makeInput({ tags: [] }));
      const record = service.get(memoryId, "repo_test");
      expect(record!.tags).toEqual([]);
    });

    it("handles all memory types", () => {
      for (const type of ALL_MEMORY_TYPES) {
        const { memoryId } = service.remember(
          makeInput({ scopeId: SCOPE_A, type, content: `Test ${type}` }),
        );
        const record = service.get(memoryId, SCOPE_A);
        expect(record!.type).toBe(type);
      }
    });

    it("corrupt tags JSON returns undefined", () => {
      db.exec(
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at, tags)
         VALUES ('mem_corrupt', 'repo_test', 'decision', 'test', 0.8, 'active',
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '{bad json')`,
      );

      const record = service.get("mem_corrupt", "repo_test");
      expect(record).not.toBeNull();
      expect(record!.tags).toBeUndefined(); // fail-open
    });

    it("count() returns counts correctly", () => {
      service.remember(makeInput({ scopeId: SCOPE_A, type: "bug" }));
      service.remember(makeInput({ scopeId: SCOPE_A, type: "bug" }));
      service.remember(makeInput({ scopeId: SCOPE_A, type: "decision" }));

      expect(service.count(SCOPE_A)).toBe(3);
      expect(service.count(SCOPE_A, { type: "bug" })).toBe(2);
      expect(service.count(SCOPE_A, { type: "decision" })).toBe(1);
      expect(service.count(SCOPE_A, { type: "dependency" })).toBe(0);
      expect(service.count(SCOPE_A, { status: "active" })).toBe(3);
      expect(service.count(SCOPE_B)).toBe(0);
    });
  });
});
