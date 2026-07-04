import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Database } from "sql.js";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, execRaw } from "../src/storage/db.js";
import { buildValueReport, formatValueReportMarkdown } from "../src/reports/valueReport.js";
import type { ValueReportData } from "../src/reports/valueReport.js";

describe("Value Report", () => {
  beforeAll(async () => {
    await initAndMigrate(":memory:");
    const db = getDb();
    // Insert placeholder scope rows so FK constraints pass
    execRaw(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES ('scope_test_empty', '/tmp/empty', 'cwdFallback', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    execRaw(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES ('scope_test_value', '/tmp/value', 'cwdFallback', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    execRaw(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES ('scope_test_top', '/tmp/top', 'cwdFallback', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    execRaw(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES ('scope_test_mem', '/tmp/mem', 'cwdFallback', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
  });

  afterAll(() => {
    closeDb();
  });

  describe("buildValueReport", () => {
    it("returns zero counts for empty database", () => {
      const db = getDb();
      const report = buildValueReport(db, "scope_test_empty");

      expect(report.summary.totalCompressions).toBe(0);
      expect(report.summary.totalEstimatedTokensSaved).toBe(0);
      expect(report.summary.averageCompressionRatio).toBe(0);
      expect(report.summary.cacheHits).toBe(0);
      expect(report.summary.totalRetrieves).toBe(0);
      expect(report.summary.memoriesSaved).toBe(0);
      expect(report.summary.memoriesRecalled).toBe(0);
      expect(report.summary.memoriesForgotten).toBe(0);

      expect(report.topCompressions).toHaveLength(0);
      expect(report.recentMemories).toHaveLength(0);
      expect(report.localFirstNote.noDataUploaded).toBe(true);
      expect(report.generatedAt).toBeTruthy();
    });

    it("aggregates compression stats from receipts", () => {
      const db = getDb();
      const scopeId = "scope_test_value";

      // Insert test receipts
      db.run(
        `INSERT INTO receipts (id, operation, scope_id, tokens_saved, compression_ratio, cache_hit, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ["rcp_1", "compress", scopeId, 1000, 0.8, 1, "2026-07-04T10:00:00.000Z"],
      );
      db.run(
        `INSERT INTO receipts (id, operation, scope_id, tokens_saved, compression_ratio, cache_hit, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ["rcp_2", "compress", scopeId, 2000, 0.9, 0, "2026-07-04T10:01:00.000Z"],
      );
      db.run(
        `INSERT INTO receipts (id, operation, scope_id, timestamp)
         VALUES (?, ?, ?, ?)`,
        ["rcp_3", "retrieve_original", scopeId, "2026-07-04T10:02:00.000Z"],
      );
      db.run(
        `INSERT INTO receipts (id, operation, scope_id, timestamp)
         VALUES (?, ?, ?, ?)`,
        ["rcp_4", "remember", scopeId, "2026-07-04T10:03:00.000Z"],
      );
      db.run(
        `INSERT INTO receipts (id, operation, scope_id, timestamp)
         VALUES (?, ?, ?, ?)`,
        ["rcp_5", "recall", scopeId, "2026-07-04T10:04:00.000Z"],
      );
      db.run(
        `INSERT INTO receipts (id, operation, scope_id, timestamp)
         VALUES (?, ?, ?, ?)`,
        ["rcp_6", "forget", scopeId, "2026-07-04T10:05:00.000Z"],
      );

      const report = buildValueReport(db, scopeId);

      expect(report.summary.totalCompressions).toBe(2);
      expect(report.summary.totalEstimatedTokensSaved).toBe(3000);
      expect(report.summary.averageCompressionRatio).toBeCloseTo(0.85);
      expect(report.summary.cacheHits).toBe(1);
      expect(report.summary.totalRetrieves).toBe(1);
      expect(report.summary.memoriesSaved).toBe(1);
      expect(report.summary.memoriesRecalled).toBe(1);
      expect(report.summary.memoriesForgotten).toBe(1);
    });

    it("returns top compressions sorted by tokens saved", () => {
      const db = getDb();
      const scopeId = "scope_test_top";

      // Insert test compressed contexts
      db.run(
        `INSERT INTO compressed_contexts
         (id, scope_id, content_type, strategy, compressed_content, tokens_before, tokens_after,
          tokens_saved, compression_ratio, can_retrieve_original, retrieve_count, failed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ccr_1", scopeId, "log", "conservative", "compressed1", 10000, 500, 9500, 0.95, 1, 0, 0, "2026-07-04T10:00:00.000Z", "2026-07-04T10:00:00.000Z"],
      );
      db.run(
        `INSERT INTO compressed_contexts
         (id, scope_id, content_type, strategy, compressed_content, tokens_before, tokens_after,
          tokens_saved, compression_ratio, can_retrieve_original, retrieve_count, failed, created_at, updated_at, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ccr_2", scopeId, "test_output", "conservative", "compressed2", 5000, 250, 4750, 0.95, 1, 0, 0, "2026-07-04T10:01:00.000Z", "2026-07-04T10:01:00.000Z", "Test output compressed"],
      );
      db.run(
        `INSERT INTO compressed_contexts
         (id, scope_id, content_type, strategy, compressed_content, tokens_before, tokens_after,
          tokens_saved, compression_ratio, can_retrieve_original, retrieve_count, failed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ccr_3", scopeId, "code", "conservative", "compressed3", 1000, 900, 100, 0.1, 1, 0, 0, "2026-07-04T10:02:00.000Z", "2026-07-04T10:02:00.000Z"],
      );

      const report = buildValueReport(db, scopeId, { topN: 2 });

      expect(report.topCompressions).toHaveLength(2);
      expect(report.topCompressions[0]?.ccrId).toBe("ccr_1");
      expect(report.topCompressions[0]?.tokensSaved).toBe(9500);
      expect(report.topCompressions[1]?.ccrId).toBe("ccr_2");
      expect(report.topCompressions[1]?.tokensSaved).toBe(4750);
      expect(report.topCompressions[1]?.summary).toBe("Test output compressed");
    });

    it("returns recent active memories", () => {
      const db = getDb();
      const scopeId = "scope_test_mem";

      // Insert test memories
      db.run(
        `INSERT INTO memories
         (id, scope_id, type, content, status, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["mem_1", scopeId, "project_rule", "Use TypeScript", "active", 0.9, "2026-07-04T10:00:00.000Z", "2026-07-04T10:00:00.000Z"],
      );
      db.run(
        `INSERT INTO memories
         (id, scope_id, type, content, summary, status, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["mem_2", scopeId, "bug", "Login fails on mobile", "Login bug", "active", 0.8, "2026-07-04T10:01:00.000Z", "2026-07-04T10:01:00.000Z"],
      );
      db.run(
        `INSERT INTO memories
         (id, scope_id, type, content, status, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["mem_3", scopeId, "decision", "Use React", "superseded", 0.7, "2026-07-04T09:00:00.000Z", "2026-07-04T09:00:00.000Z"],
      );

      const report = buildValueReport(db, scopeId, { recentN: 5 });

      expect(report.recentMemories).toHaveLength(2); // Only active memories
      expect(report.recentMemories[0]?.memoryId).toBe("mem_2"); // Most recent first
      expect(report.recentMemories[0]?.summary).toBe("Login bug");
      expect(report.recentMemories[1]?.memoryId).toBe("mem_1");
    });
  });

  describe("formatValueReportMarkdown", () => {
    it("formats empty report with friendly message", () => {
      const report: ValueReportData = {
        summary: {
          totalCompressions: 0,
          totalEstimatedTokensSaved: 0,
          averageCompressionRatio: 0,
          cacheHits: 0,
          totalRetrieves: 0,
          memoriesSaved: 0,
          memoriesRecalled: 0,
          memoriesForgotten: 0,
        },
        topCompressions: [],
        recentMemories: [],
        localFirstNote: {
          dataLocation: "Local SQLite database",
          noDataUploaded: true,
        },
        generatedAt: "2026-07-04T10:00:00.000Z",
      };

      const markdown = formatValueReportMarkdown(report);

      expect(markdown).toContain("# CodeContext Usage Value Report");
      expect(markdown).toContain("Generated: 2026-07-04T10:00:00.000Z");
      expect(markdown).toContain("**Total Compressions**: 0");
      expect(markdown).toContain("_No compressions yet._");
      expect(markdown).toContain("_No active memories yet._");
      expect(markdown).toContain("✓ All data stays local");
    });

    it("formats report with data", () => {
      const report: ValueReportData = {
        summary: {
          totalCompressions: 10,
          totalEstimatedTokensSaved: 50000,
          averageCompressionRatio: 0.75,
          cacheHits: 5,
          totalRetrieves: 3,
          memoriesSaved: 8,
          memoriesRecalled: 12,
          memoriesForgotten: 2,
        },
        topCompressions: [
          {
            ccrId: "ccr_abc123",
            contentType: "log",
            tokensSaved: 25000,
            compressionRatio: 0.9,
            createdAt: "2026-07-04T10:00:00.000Z",
          },
        ],
        recentMemories: [
          {
            memoryId: "mem_xyz789",
            type: "project_rule",
            summary: "Use pnpm for package management",
            createdAt: "2026-07-04T10:01:00.000Z",
            status: "active",
          },
        ],
        localFirstNote: {
          dataLocation: "Local SQLite database",
          noDataUploaded: true,
        },
        generatedAt: "2026-07-04T10:00:00.000Z",
      };

      const markdown = formatValueReportMarkdown(report);

      expect(markdown).toContain("**Total Compressions**: 10");
      expect(markdown).toContain("**Total Estimated Tokens Saved**: 50,000");
      expect(markdown).toContain("**Average Compression Ratio**: 0.75");
      expect(markdown).toContain("**Cache Hits**: 5");
      expect(markdown).toContain("ccr_abc123");
      expect(markdown).toContain("25,000");
      expect(markdown).toContain("mem_xyz789");
      expect(markdown).toContain("Use pnpm for package management");
    });
  });
});
