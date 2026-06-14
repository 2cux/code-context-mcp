/**
 * Token Stats Unit Tests
 *
 * Covers:
 *   - getTokenStats with no data (all zeros)
 *   - getTokenStats with single/multiple operations
 *   - Correct aggregation of token sums and compression ratio
 *   - Scope isolation
 *   - Failure counting
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { getTokenStats, type TokenStats } from "../src/stats/tokenStats.js";
import type { Database } from "sql.js";

let db: Database;
let receipts: ReceiptService;

const SCOPE = "repo_stats_test";
const SCOPE_B = "repo_stats_test_b";

function ensureScope(scopeId: string) {
  runStmt(
    db,
    `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
     VALUES (?, ?, 'cwdFallback', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    [scopeId, `/fake/${scopeId}`],
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("getTokenStats", () => {
  beforeAll(async () => {
    await initAndMigrate(":memory:");
    db = getDb();
    receipts = new ReceiptService(db);
    ensureScope(SCOPE);
    ensureScope(SCOPE_B);
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    db.exec("DELETE FROM receipts");
    ensureScope(SCOPE);
    ensureScope(SCOPE_B);
  });

  // ==========================================================================
  // Empty / Zero State
  // ==========================================================================

  describe("empty scope", () => {
    it("returns all zeros for a scope with no receipts", () => {
      const stats = getTokenStats(db, SCOPE);

      expect(stats.totalCompressions).toBe(0);
      expect(stats.totalRetrieves).toBe(0);
      expect(stats.totalMemories).toBe(0);
      expect(stats.totalRecalls).toBe(0);
      expect(stats.totalForgets).toBe(0);
      expect(stats.totalFailures).toBe(0);
      expect(stats.totalTokensSaved).toBe(0);
      expect(stats.totalTokensBefore).toBe(0);
      expect(stats.totalTokensAfter).toBe(0);
      expect(stats.averageCompressionRatio).toBe(0);
    });

    it("returns all zeros for a non-existent scope", () => {
      const stats = getTokenStats(db, "nonexistent_scope");

      expect(stats.totalCompressions).toBe(0);
      expect(stats.totalTokensSaved).toBe(0);
    });
  });

  // ==========================================================================
  // Single Operation
  // ==========================================================================

  describe("single operation", () => {
    it("counts a single compress operation", () => {
      receipts.create({
        operation: "compress",
        scopeId: SCOPE,
        tokensBefore: 1000,
        tokensAfter: 200,
        tokensSaved: 800,
        compressionRatio: 0.8,
      });

      const stats = getTokenStats(db, SCOPE);
      expect(stats.totalCompressions).toBe(1);
      expect(stats.totalRetrieves).toBe(0);
      expect(stats.totalMemories).toBe(0);
    });

    it("counts a single remember operation", () => {
      receipts.create({
        operation: "remember",
        scopeId: SCOPE,
        memoryIds: ["mem_test"],
      });

      const stats = getTokenStats(db, SCOPE);
      expect(stats.totalCompressions).toBe(0);
      expect(stats.totalMemories).toBe(1);
    });

    it("counts a single recall operation", () => {
      receipts.create({
        operation: "recall",
        scopeId: SCOPE,
        query: "test query",
      });

      const stats = getTokenStats(db, SCOPE);
      expect(stats.totalRecalls).toBe(1);
    });

    it("counts a single forget operation", () => {
      receipts.create({
        operation: "forget",
        scopeId: SCOPE,
        memoryIds: ["mem_old"],
      });

      const stats = getTokenStats(db, SCOPE);
      expect(stats.totalForgets).toBe(1);
    });

    it("counts a single retrieve_original operation", () => {
      receipts.create({
        operation: "retrieve_original",
        scopeId: SCOPE,
      });

      const stats = getTokenStats(db, SCOPE);
      expect(stats.totalRetrieves).toBe(1);
    });
  });

  // ==========================================================================
  // Multiple Operations — Aggregation
  // ==========================================================================

  describe("aggregation", () => {
    it("correctly sums tokens across multiple compress operations", () => {
      receipts.create({
        operation: "compress",
        scopeId: SCOPE,
        tokensBefore: 1000,
        tokensAfter: 200,
        tokensSaved: 800,
        compressionRatio: 0.8,
      });
      receipts.create({
        operation: "compress",
        scopeId: SCOPE,
        tokensBefore: 500,
        tokensAfter: 100,
        tokensSaved: 400,
        compressionRatio: 0.8,
      });

      const stats = getTokenStats(db, SCOPE);
      expect(stats.totalCompressions).toBe(2);
      expect(stats.totalTokensBefore).toBe(1500);
      expect(stats.totalTokensAfter).toBe(300);
      expect(stats.totalTokensSaved).toBe(1200);
    });

    it("calculates average compression ratio correctly", () => {
      receipts.create({
        operation: "compress",
        scopeId: SCOPE,
        tokensBefore: 1000,
        tokensAfter: 500,
        tokensSaved: 500,
        compressionRatio: 0.5,
      });
      receipts.create({
        operation: "compress",
        scopeId: SCOPE,
        tokensBefore: 1000,
        tokensAfter: 100,
        tokensSaved: 900,
        compressionRatio: 0.9,
      });

      const stats = getTokenStats(db, SCOPE);
      expect(stats.averageCompressionRatio).toBeCloseTo(0.7, 1);
    });

    it("counts failures separately", () => {
      receipts.create({
        operation: "compress",
        scopeId: SCOPE,
        failed: true,
        errorReason: "timeout",
      });
      receipts.create({
        operation: "compress",
        scopeId: SCOPE,
      });
      receipts.create({
        operation: "recall",
        scopeId: SCOPE,
        query: "test",
        failed: true,
      });

      const stats = getTokenStats(db, SCOPE);
      expect(stats.totalFailures).toBe(2);
      expect(stats.totalCompressions).toBe(2); // both are compress ops
      expect(stats.totalRecalls).toBe(1);
    });

    it("counts mixed operation types correctly", () => {
      receipts.create({ operation: "compress", scopeId: SCOPE });
      receipts.create({ operation: "compress", scopeId: SCOPE });
      receipts.create({ operation: "remember", scopeId: SCOPE });
      receipts.create({ operation: "remember", scopeId: SCOPE });
      receipts.create({ operation: "remember", scopeId: SCOPE });
      receipts.create({ operation: "recall", scopeId: SCOPE, query: "a" });
      receipts.create({ operation: "forget", scopeId: SCOPE });
      receipts.create({ operation: "forget", scopeId: SCOPE });
      receipts.create({ operation: "retrieve_original", scopeId: SCOPE });

      const stats = getTokenStats(db, SCOPE);
      expect(stats.totalCompressions).toBe(2);
      expect(stats.totalMemories).toBe(3);
      expect(stats.totalRecalls).toBe(1);
      expect(stats.totalForgets).toBe(2);
      expect(stats.totalRetrieves).toBe(1);
    });
  });

  // ==========================================================================
  // Scope Isolation
  // ==========================================================================

  describe("scope isolation", () => {
    it("only counts receipts for the given scope", () => {
      // Scope A: 3 compressions
      receipts.create({
        operation: "compress",
        scopeId: SCOPE,
        tokensSaved: 100,
      });
      receipts.create({
        operation: "compress",
        scopeId: SCOPE,
        tokensSaved: 200,
      });
      receipts.create({
        operation: "compress",
        scopeId: SCOPE,
        tokensSaved: 300,
      });

      // Scope B: 1 compression
      receipts.create({
        operation: "compress",
        scopeId: SCOPE_B,
        tokensSaved: 999,
      });

      const statsA = getTokenStats(db, SCOPE);
      expect(statsA.totalCompressions).toBe(3);
      expect(statsA.totalTokensSaved).toBe(600);

      const statsB = getTokenStats(db, SCOPE_B);
      expect(statsB.totalCompressions).toBe(1);
      expect(statsB.totalTokensSaved).toBe(999);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("edge cases", () => {
    it("handles receipts with NULL token fields", () => {
      // Create a receipt without token fields (e.g., remember op)
      receipts.create({
        operation: "remember",
        scopeId: SCOPE,
        memoryIds: ["mem_edge"],
      });

      // Should not throw
      const stats = getTokenStats(db, SCOPE);
      expect(stats.totalTokensSaved).toBe(0);
      expect(stats.totalTokensBefore).toBe(0);
      expect(stats.totalTokensAfter).toBe(0);
      expect(stats.averageCompressionRatio).toBe(0);
    });

    it("all fields are numbers", () => {
      receipts.create({ operation: "compress", scopeId: SCOPE });
      receipts.create({ operation: "remember", scopeId: SCOPE });

      const stats = getTokenStats(db, SCOPE);

      expect(typeof stats.totalCompressions).toBe("number");
      expect(typeof stats.totalRetrieves).toBe("number");
      expect(typeof stats.totalMemories).toBe("number");
      expect(typeof stats.totalRecalls).toBe("number");
      expect(typeof stats.totalForgets).toBe("number");
      expect(typeof stats.totalFailures).toBe("number");
      expect(typeof stats.totalTokensSaved).toBe("number");
      expect(typeof stats.totalTokensBefore).toBe("number");
      expect(typeof stats.totalTokensAfter).toBe("number");
      expect(typeof stats.averageCompressionRatio).toBe("number");
    });

    it("returns a valid TokenStats object shape", () => {
      const stats = getTokenStats(db, SCOPE);

      const keys: (keyof TokenStats)[] = [
        "totalCompressions",
        "totalRetrieves",
        "totalMemories",
        "totalRecalls",
        "totalForgets",
        "totalFailures",
        "totalTokensSaved",
        "totalTokensBefore",
        "totalTokensAfter",
        "averageCompressionRatio",
      ];

      for (const key of keys) {
        expect(stats).toHaveProperty(key);
        expect(typeof stats[key]).toBe("number");
        expect(Number.isFinite(stats[key])).toBe(true);
      }
    });
  });
});
