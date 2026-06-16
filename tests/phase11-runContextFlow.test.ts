/**
 * Phase 11 Integration Tests — runContextFlow Tool Handler
 *
 * Covers the complete run_context_flow MCP tool:
 *   - Input validation (missing flow, invalid flow, missing content, invalid contentType)
 *   - Compression flow (basic, +saveMemory, +includeRecall, no keepOriginal, auto scope)
 *   - Memory flow (remember only, recall only, remember+recall, missing content+query)
 *   - Full flow (complete chain, without query, with goal)
 *   - Error resilience (compression fail-open, ContentRouter fallback)
 *   - Receipt audit (compression receipt, full flow nested receipts)
 *   - Response structure (required fields, runId format, status values)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { handleRunContextFlow } from "../src/mcp/tools/runContextFlow.js";
import { registerAllStrategies } from "../src/compression/registerStrategies.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../src/mcp/server.js";

let db: Database;
let ctx: ServerContext;

const SCOPE_ID = "repo_flow_test";

function ensureScope(scopeId?: string) {
  const id = scopeId ?? SCOPE_ID;
  runStmt(
    db,
    `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
     VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`,
    [id, process.cwd()],
  );
}

function parseToolText(result: { content: { type: string; text?: string }[] }): Record<string, unknown> {
  const text = result.content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

function isError(result: { content: { type: string; text?: string }[]; isError?: boolean }): boolean {
  return result.isError === true;
}

// Reusable test content with enough tokens to trigger compression
const SAMPLE_LOG_CONTENT = [
  "FAIL  tests/auth.test.ts > login > should refresh token on expiry",
  "Error: Expected 200 but got 401",
  "  at AuthService.refreshToken (src/auth/service.ts:42:15)",
  "  at processLogin (src/auth/login.ts:18:3)",
  "  at runTest (tests/auth.test.ts:156:7)",
  "",
  "FAIL  tests/auth.test.ts > logout > should clear session cookie",
  "Error: Expected cookie 'session' to be cleared",
  "  at AuthService.logout (src/auth/service.ts:78:10)",
  "  at runTest (tests/auth.test.ts:204:7)",
  "",
  "FAIL  tests/api.test.ts > rate limit > should return 429 after threshold",
  "Error: Expected 429 but got 200",
  "  at RateLimiter.check (src/middleware/rateLimit.ts:33:12)",
  "  at runTest (tests/api.test.ts:89:7)",
  "",
].join("\n");

const SAMPLE_LONG_CONTENT = (SAMPLE_LOG_CONTENT + "\n").repeat(20); // ~3KB, enough for compression

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("run_context_flow Tool Handler", () => {
  beforeAll(async () => {
    await initAndMigrate(":memory:");
    db = getDb();
    ctx = { db, receipts: new ReceiptService(db) };
    ensureScope();
    // Register compression strategies
    registerAllStrategies();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clean tables in FK-safe order
    try { db.exec("DELETE FROM memories_fts"); } catch { /* may not exist */ }
    db.exec("DELETE FROM profile_facts");
    db.exec("DELETE FROM receipts");
    db.exec("DELETE FROM memories");
    db.exec("DELETE FROM original_contents");
    db.exec("DELETE FROM compressed_contexts");
    db.exec("DELETE FROM failure_events");
    // Re-seed scope
    ensureScope();
  });

  // ==========================================================================
  // 1. Input Validation
  // ==========================================================================

  describe("Input Validation", () => {
    it("rejects missing flow", async () => {
      const result = await handleRunContextFlow(ctx, {});
      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("flow is required");
    });

    it("rejects invalid flow", async () => {
      const result = await handleRunContextFlow(ctx, { flow: "invalid" });
      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("Invalid flow");
      expect(text).toContain("compression");
      expect(text).toContain("memory");
      expect(text).toContain("full");
    });

    it("rejects compression without content", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("content is required");
    });

    it("rejects full without content", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "full",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("content is required");
    });

    it("rejects invalid contentType", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: "test",
        contentType: "invalid_type",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("Invalid contentType");
    });

    it("rejects memory without content or query", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("content");
      expect(result.content[0]!.text!).toContain("query");
    });
  });

  // ==========================================================================
  // 2. Compression Flow
  // ==========================================================================

  describe("Compression Flow", () => {
    it("compresses content successfully", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.flow).toBe("compression");
      expect(data.status).toBe("ok");
      expect(typeof data.runId).toBe("string");
      expect(data.runId).toMatch(/^flow_/);
      expect(typeof data.summary).toBe("string");
      expect(data.ccrId).toBeDefined();
      expect(data.compressedContent).toBeDefined();
      expect(data.originalRef).toBeDefined();
      expect(typeof data.tokensBefore).toBe("number");
      expect(typeof data.tokensAfter).toBe("number");
      expect(typeof data.tokensSaved).toBe("number");
      expect(typeof data.compressionRatio).toBe("number");
      expect(data.receiptId).toBeDefined();
      expect(Array.isArray(data.warnings)).toBe(true);
    });

    it("saves memory when saveMemory is true", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        options: { saveMemory: true },
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.memories).toBeDefined();
      const mems = data.memories as Record<string, unknown>[];
      expect(mems.length).toBeGreaterThanOrEqual(1);
      // First memory should be the saved one
      const saved = mems.find((m) => !m.score);
      expect(saved).toBeDefined();
      expect(saved!.id).toMatch(/^mem_/);
    });

    it("runs recall when includeRecall is true with query", async () => {
      // First, save a memory so recall has something to find
      await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "Project uses pnpm as package manager. Always use pnpm install.",
        scopeId: SCOPE_ID,
      });

      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        query: "package manager",
        options: { includeRecall: true },
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.status).toBe("ok");
      expect(data.profile).toBeDefined();
      expect(data.memories).toBeDefined();
      // May include both the recall results and the saved memory
    });

    it("does not save original when keepOriginal is false", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        options: { keepOriginal: false },
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.originalRef).toBeUndefined();
    });

    it("auto-resolves scope when scopeId is omitted", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        // no scopeId — should auto-resolve
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.status).toBe("ok");
    });
  });

  // ==========================================================================
  // 3. Memory Flow
  // ==========================================================================

  describe("Memory Flow", () => {
    it("remembers content when only content is provided", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "Always use tabs for indentation in this project.",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.flow).toBe("memory");
      expect(data.status).toBe("ok");
      expect(data.runId).toMatch(/^flow_/);
      expect(data.memories).toBeDefined();
      const mems = data.memories as Record<string, unknown>[];
      expect(mems.length).toBeGreaterThanOrEqual(1);
      expect(mems[0]!.id).toMatch(/^mem_/);
      expect(mems[0]!.type).toBe("file_summary");
      expect(mems[0]!.status).toBe("active");
      expect(data.receiptId).toBeDefined();
    });

    it("recalls when only query is provided (may return empty)", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        query: "indentation tabs",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.flow).toBe("memory");
      expect(data.status).toBe("ok");
      expect(data.profile).toBeDefined();
    });

    it("remembers and then recalls when both content and query provided", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "Project uses ESLint with strict TypeScript rules.",
        query: "ESLint TypeScript",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.status).toBe("ok");
      expect(data.memories).toBeDefined();
      // Should have at least the saved memory; may also have recall matches
      const mems = data.memories as Record<string, unknown>[];
      expect(mems.length).toBeGreaterThanOrEqual(1);
    });

    it("correctly recalls previously saved memory", async () => {
      // Save a memory first
      await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "The database connection string is in .env.local — never commit it.",
        scopeId: SCOPE_ID,
      });

      // Now recall
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        query: "database connection string",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      const mems = data.memories as Record<string, unknown>[];
      const found = mems.filter((m) =>
        typeof m.content === "string" && m.content.includes("connection string")
      );
      expect(found.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // 4. Full Flow
  // ==========================================================================

  describe("Full Flow", () => {
    it("executes compress → remember → recall complete chain", async () => {
      // Pre-seed a memory for recall to find
      await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "Auth module uses JWT with RS256 algorithm for token signing.",
        scopeId: SCOPE_ID,
      });

      const result = await handleRunContextFlow(ctx, {
        flow: "full",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        query: "auth token JWT",
        goal: "Compress test failure log and find related auth context",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.flow).toBe("full");
      expect(data.status).toBe("ok");
      expect(data.runId).toMatch(/^flow_/);

      // Compression results
      expect(data.ccrId).toBeDefined();
      expect(data.compressedContent).toBeDefined();
      expect(data.originalRef).toBeDefined();
      expect(typeof data.tokensBefore).toBe("number");
      expect(typeof data.tokensAfter).toBe("number");
      expect(typeof data.tokensSaved).toBe("number");

      // Memory results
      expect(data.memories).toBeDefined();
      const mems = data.memories as Record<string, unknown>[];
      expect(mems.length).toBeGreaterThanOrEqual(1);

      // Profile
      expect(data.profile).toBeDefined();

      // Audit
      expect(data.receiptId).toBeDefined();

      // Goal echoed
      expect(data.goal).toBe("Compress test failure log and find related auth context");
    });

    it("handles full flow without query gracefully", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "full",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        // no query — recall is skipped
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.flow).toBe("full");
      // Should still compress and remember
      expect(data.ccrId).toBeDefined();
      // Status should be ok (recall skipped is not a failure)
      expect(data.status).toBe("ok");
    });

    it("uses goal as query fallback in full flow", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "full",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        goal: "debug session cookie refresh failure",
        // no explicit query — goal is used as query
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.goal).toBe("debug session cookie refresh failure");
      expect(data.status).toBe("ok");
    });
  });

  // ==========================================================================
  // 5. Error Resilience (Fail-Open)
  // ==========================================================================

  describe("Error Resilience", () => {
    it("handles compression of empty-like content gracefully", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: "short",
        contentType: "unknown",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      // Very short content may not compress much, but should still succeed
      expect(data.status).toBeDefined();
      expect(data.compressedContent).toBeDefined();
    });

    it("falls back on ContentRouter failure by using unknown type", async () => {
      // Content that's just random bytes as string — ContentRouter should handle or fallback
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: Buffer.from([0x00, 0xFF, 0xFE, 0x01, 0x02]).toString("binary"),
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.status).toBeDefined();
    });
  });

  // ==========================================================================
  // 6. Receipt Audit
  // ==========================================================================

  describe("Receipt Audit", () => {
    it("generates receipt for compression flow", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.receiptId).toBeDefined();
      expect(data.receiptId).toMatch(/^rcp_/);
    });

    it("generates receipts for multiple operations in full flow", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "full",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        query: "test",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.receiptId).toBeDefined();
      // Verify receipts exist in DB
      const row = db.exec("SELECT COUNT(*) as cnt FROM receipts WHERE scope_id = ?", [SCOPE_ID]);
      if (row.length > 0 && row[0].values.length > 0) {
        const cnt = Number(row[0].values[0][0]);
        // Full flow should create at least 2 receipts (compress + recall)
        // May also include memory receipt
        expect(cnt).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ==========================================================================
  // 7. Response Structure
  // ==========================================================================

  describe("Response Structure", () => {
    it("includes all required output fields", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      // All responses must have these fields
      expect(data.flow).toBeDefined();
      expect(data.status).toBeDefined();
      expect(data.summary).toBeDefined();
      expect(data.runId).toBeDefined();
      expect(data.warnings).toBeDefined();
    });

    it("has valid runId format", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "test",
        scopeId: SCOPE_ID,
      });

      const data = parseToolText(result);
      expect(data.runId).toMatch(/^flow_[a-z0-9]+_[a-f0-9]+$/);
    });

    it("returns unique runId per invocation", async () => {
      const r1 = await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "test a",
        scopeId: SCOPE_ID,
      });
      const r2 = await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "test b",
        scopeId: SCOPE_ID,
      });

      const d1 = parseToolText(r1);
      const d2 = parseToolText(r2);
      expect(d1.runId).not.toBe(d2.runId);
    });

    it("status is one of ok, partial, error", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
      });

      const data = parseToolText(result);
      expect(["ok", "partial", "error"]).toContain(data.status);
    });
  });
});
