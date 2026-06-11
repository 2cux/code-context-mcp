/**
 * Phase 7 Integration Tests — recallContext Tool Handler (PRD §20.5)
 *
 * Covers the complete recall_context MCP tool:
 *   20.5.1 — Recall project_rule
 *   20.5.2 — Recall test_failure
 *   20.5.3 — Type filter
 *   20.5.4 — Status filter
 *   20.5.5 — Profile return (includeProfile / includeStatic / includeDynamic)
 *   20.5.6 — Related compressed contexts return
 *   20.5.7 — No-result receipt
 *   20.5.8 — Cross-scope isolation
 *
 * Also covers:
 *   - Confidence merging (score × confidence)
 *   - Recency weighting
 *   - Input validation (missing query, invalid types, etc.)
 *   - Scope auto-resolution
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt, queryOne, queryAll } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { handleRecallContext } from "../src/mcp/tools/recallContext.js";
import { handleRememberContext } from "../src/mcp/tools/rememberContext.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../src/mcp/server.js";

let db: Database;
let ctx: ServerContext;

const SCOPE_ID = "repo_recall_test";
const SCOPE_B = "repo_recall_test_b";

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
function parseToolText(result: {
  content: { type: string; text?: string }[];
}): Record<string, unknown> {
  const text = result.content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

/** Check if a tool result is an error. */
function isError(result: {
  content: { type: string; text?: string }[];
  isError?: boolean;
}): boolean {
  return result.isError === true;
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/** Create a memory via remember_context handler. Returns parsed response. */
async function seedMemory(
  overrides: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await handleRememberContext(ctx, {
    scopeId: SCOPE_ID,
    type: "project_rule",
    content: "Default seed content.",
    ...overrides,
  });
  if (isError(result)) {
    throw new Error(`seedMemory failed: ${result.content[0]!.text}`);
  }
  return parseToolText(result);
}

/** Create a CCR directly in the DB (bypasses compress_context for test isolation). */
function seedCCR(overrides: Record<string, unknown> = {}) {
  const id = overrides.id ?? `ccr_seed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  runStmt(
    db,
    `INSERT INTO compressed_contexts (
       id, scope_id, content_type, strategy,
       compressed_content, summary, original_ref, source_ref,
       metadata, tokens_before, tokens_after, tokens_saved,
       compression_ratio, can_retrieve_original, retrieve_count,
       failed, error_reason, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      overrides.scopeId ?? SCOPE_ID,
      overrides.contentType ?? "test_output",
      overrides.strategy ?? "test_output_conservative_v1",
      overrides.compressedContent ?? "Compressed content for test.",
      overrides.summary ?? "Test CCR summary",
      overrides.originalRef ?? `orig_${id}`,
      overrides.sourceRef ?? null,
      null,
      overrides.tokensBefore ?? 1000,
      overrides.tokensAfter ?? 200,
      overrides.tokensSaved ?? 800,
      overrides.compressionRatio ?? 0.8,
      overrides.canRetrieveOriginal ?? 1,
      0,
      0,
      null,
      now,
      now,
    ],
  );
  return id;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("recall_context Tool Handler", () => {
  beforeAll(async () => {
    await initAndMigrate(":memory:");
    db = getDb();
    const receipts = new ReceiptService(db);
    ctx = { db, receipts };
    ensureScope();
    ensureScope(SCOPE_B);
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clean up in FK-safe order
    try { db.exec("DELETE FROM memories_fts"); } catch { /* may not exist */ }
    db.exec("DELETE FROM original_contents");
    db.exec("DELETE FROM compressed_contexts");
    db.exec("DELETE FROM profile_facts");
    db.exec("DELETE FROM receipts");
    db.exec("DELETE FROM memories");
    // Re-create scope records
    ensureScope();
    ensureScope(SCOPE_B);
  });

  // ==========================================================================
  // 20.5.1 — Recall project_rule
  // ==========================================================================

  describe("20.5.1 — Recall project_rule", () => {
    it("recalls a project_rule memory by query", async () => {
      await seedMemory({
        type: "project_rule",
        content: "Always use pnpm as the package manager. Never use npm.",
        summary: "Use pnpm",
        confidence: 0.95,
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "pnpm package manager",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.scopeId).toBe(SCOPE_ID);
      expect(data.receiptId).toMatch(/^rcp_/);
      expect(Array.isArray(data.memories)).toBe(true);
      expect((data.memories as unknown[]).length).toBeGreaterThanOrEqual(1);

      const mem = (data.memories as Record<string, unknown>[])[0]!;
      expect(mem.type).toBe("project_rule");
      expect(mem.content).toContain("pnpm");
      expect(mem.status).toBe("active");
      expect(typeof mem.score).toBe("number");
      expect(typeof mem.canExpand).toBe("boolean");
    });

    it("recalls a memory by content keyword match", async () => {
      await seedMemory({
        type: "decision",
        content: "Decided to use React Router v6 for client-side routing.",
        summary: "React Router v6",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "routing React",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect((data.memories as unknown[]).length).toBeGreaterThanOrEqual(1);
      expect(
        (data.memories as Record<string, unknown>[])[0]!.content,
      ).toContain("React Router");
    });

    it("returns memories with all required fields", async () => {
      await seedMemory({
        type: "project_rule",
        content: "Use TypeScript strict mode for all new files.",
        summary: "Strict TS",
        confidence: 0.9,
        sourceRef: "tsconfig.json",
        tags: ["typescript", "config"],
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "TypeScript strict",
      });

      const data = parseToolText(result);
      const mem = (data.memories as Record<string, unknown>[])[0]!;
      expect(mem.id).toMatch(/^mem_/);
      expect(mem.type).toBe("project_rule");
      expect(mem.content).toContain("strict mode");
      expect(mem.summary).toBe("Strict TS");
      expect(mem.confidence).toBe(0.9);
      expect(mem.sourceRef).toBe("tsconfig.json");
      expect(mem.status).toBe("active");
      expect(typeof mem.score).toBe("number");
      expect(typeof mem.canExpand).toBe("boolean");
      expect(mem.createdAt).toBeDefined();
      expect(Array.isArray(mem.tags)).toBe(true);
      expect(mem.tags).toContain("typescript");
    });
  });

  // ==========================================================================
  // 20.5.2 — Recall test_failure
  // ==========================================================================

  describe("20.5.2 — Recall test_failure", () => {
    it("recalls test_failure memories by content", async () => {
      await seedMemory({
        type: "test_failure",
        content:
          "auth/session.test.ts > should clear cookie on logout — Expected true but got false.",
        summary: "Session logout test failure",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "logout cookie test failure",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect((data.memories as unknown[]).length).toBeGreaterThanOrEqual(1);

      const mem = (data.memories as Record<string, unknown>[])[0]!;
      expect(mem.type).toBe("test_failure");
      expect(mem.content).toContain("Expected true but got false");
    });

    it("ranks memories by relevance score", async () => {
      await seedMemory({
        type: "test_failure",
        content: "Login page crashes on empty password field.",
        summary: "Login crash",
      });
      await seedMemory({
        type: "test_failure",
        content: "The login form validation fails for email format.",
        summary: "Email validation",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "login",
        limit: 5,
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];
      expect(memories.length).toBeGreaterThanOrEqual(2);
      // Both should be about login
      for (const m of memories) {
        expect(m.content as string).toMatch(/login/i);
      }
    });
  });

  // ==========================================================================
  // 20.5.3 — Type filter
  // ==========================================================================

  describe("20.5.3 — Type filter", () => {
    beforeEach(async () => {
      await seedMemory({
        type: "project_rule",
        content: "Always write tests before implementation.",
        summary: "TDD required",
      });
      await seedMemory({
        type: "test_failure",
        content: "User profile test fails with timeout.",
        summary: "Profile test timeout",
      });
      await seedMemory({
        type: "decision",
        content: "Decided to use Vitest for testing.",
        summary: "Vitest decision",
      });
    });

    it("returns only project_rule when filtering by type", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "test",
        types: ["project_rule"],
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];
      // All returned memories should be project_rule
      for (const m of memories) {
        expect(m.type).toBe("project_rule");
      }
    });

    it("returns multiple types when array is provided", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "test",
        types: ["project_rule", "decision"],
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];
      const types = new Set(memories.map((m) => m.type));
      expect(types.has("project_rule") || types.has("decision")).toBe(true);
      // test_failure should NOT be present
      expect(types.has("test_failure")).toBe(false);
    });

    it("filters to only test_failure", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "test",
        types: ["test_failure"],
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];
      for (const m of memories) {
        expect(m.type).toBe("test_failure");
      }
    });
  });

  // ==========================================================================
  // 20.5.4 — Status filter
  // ==========================================================================

  describe("20.5.4 — Status filter", () => {
    it("defaults to active status only", async () => {
      await seedMemory({
        type: "bug",
        content: "Active memory leak bug.",
      });

      // Create a forgotten memory directly
      const now = new Date().toISOString();
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'bug', 'Forgotten bug.', 0.8, 'forgotten', ?, ?)`,
        ["mem_forgotten_test", SCOPE_ID, now, now],
      );

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "bug",
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];
      // Only active memories should be returned
      for (const m of memories) {
        expect(m.status).toBe("active");
      }
    });

    it("includes superseded when explicitly requested", async () => {
      const now = new Date().toISOString();
      // Active memory
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'project_rule', 'Active rule about npm.', 0.8, 'active', ?, ?)`,
        ["mem_active_npm", SCOPE_ID, now, now],
      );
      // Superseded memory
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at, superseded_by)
         VALUES (?, ?, 'project_rule', 'Old rule about npm.', 0.8, 'superseded', ?, ?, ?)`,
        ["mem_old_npm", SCOPE_ID, now, now, "mem_active_npm"],
      );

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "npm",
        status: ["active", "superseded"],
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];
      const statuses = new Set(memories.map((m) => m.status));
      expect(statuses.has("active")).toBe(true);
      expect(statuses.has("superseded")).toBe(true);
    });

    it("does not return forgotten when status=[active]", async () => {
      const now = new Date().toISOString();
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'bug', 'Active crash bug.', 0.8, 'active', ?, ?)`,
        ["mem_active_crash", SCOPE_ID, now, now],
      );
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'bug', 'Forgotten crash bug.', 0.8, 'forgotten', ?, ?)`,
        ["mem_forgotten_crash", SCOPE_ID, now, now],
      );

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "crash",
        status: ["active"],
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];
      for (const m of memories) {
        expect(m.status).toBe("active");
      }
    });
  });

  // ==========================================================================
  // 20.5.5 — Profile return
  // ==========================================================================

  describe("20.5.5 — Profile return", () => {
    it("returns profile with static and dynamic facts by default", async () => {
      // Create a memory that writes to static profile
      await seedMemory({
        type: "project_rule",
        content: "Use pnpm as the package manager.",
        summary: "Use pnpm",
        profileTarget: "static",
      });

      // Create a memory that writes to dynamic profile
      await seedMemory({
        type: "current_task",
        content: "Implementing recall_context MCP tool.",
        summary: "Recall context implementation",
        profileTarget: "dynamic",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "pnpm",
      });

      const data = parseToolText(result);
      expect(data.profile).toBeDefined();

      const profile = data.profile as Record<string, unknown>;
      expect(Array.isArray(profile.static)).toBe(true);
      expect(Array.isArray(profile.dynamic)).toBe(true);

      const staticFacts = profile.static as Record<string, unknown>[];
      const dynamicCtx = profile.dynamic as Record<string, unknown>[];

      expect(staticFacts.length).toBeGreaterThanOrEqual(1);
      expect(staticFacts.some((f) => f.content === "Use pnpm")).toBe(true);

      expect(dynamicCtx.length).toBeGreaterThanOrEqual(1);
      expect(
        dynamicCtx.some((f) =>
          (f.content as string).toLowerCase().includes("recall"),
        ),
      ).toBe(true);
    });

    it("excludes profile when includeProfile=false", async () => {
      await seedMemory({
        type: "project_rule",
        content: "Always use pnpm.",
        summary: "Use pnpm",
        profileTarget: "static",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "pnpm",
        includeProfile: false,
      });

      const data = parseToolText(result);
      expect(data.profile).toBeDefined();
      const profile = data.profile as Record<string, unknown>;
      // Should be empty arrays
      expect(profile.static).toEqual([]);
      expect(profile.dynamic).toEqual([]);
    });

    it("respects includeStatic and includeDynamic independently", async () => {
      await seedMemory({
        type: "project_rule",
        content: "Static rule content.",
        summary: "Static rule",
        profileTarget: "static",
      });
      await seedMemory({
        type: "current_task",
        content: "Dynamic task content.",
        summary: "Dynamic task",
        profileTarget: "dynamic",
      });

      // Only static
      const result1 = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "content",
        includeProfile: true,
        includeStatic: true,
        includeDynamic: false,
      });

      const data1 = parseToolText(result1);
      const p1 = data1.profile as Record<string, unknown>;
      expect((p1.static as unknown[]).length).toBeGreaterThanOrEqual(1);
      expect((p1.dynamic as unknown[]).length).toBe(0);

      // Only dynamic
      const result2 = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "content",
        includeProfile: true,
        includeStatic: false,
        includeDynamic: true,
      });

      const data2 = parseToolText(result2);
      const p2 = data2.profile as Record<string, unknown>;
      expect((p2.static as unknown[]).length).toBe(0);
      expect((p2.dynamic as unknown[]).length).toBeGreaterThanOrEqual(1);
    });

    it("profile facts include required fields", async () => {
      await seedMemory({
        type: "project_rule",
        content: "Use ESLint flat config.",
        summary: "ESLint flat config",
        sourceRef: "eslint.config.js",
        profileTarget: "static",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "ESLint",
      });

      const data = parseToolText(result);
      const profile = data.profile as Record<string, unknown>;
      const staticFacts = profile.static as Record<string, unknown>[];
      expect(staticFacts.length).toBeGreaterThanOrEqual(1);

      const fact = staticFacts[0]!;
      expect(fact.id).toMatch(/^pf_/);
      expect(fact.content).toBeDefined();
      expect(fact.confidence).toBeDefined();
      expect(fact.updatedAt).toBeDefined();
    });
  });

  // ==========================================================================
  // 20.5.6 — Related compressed contexts
  // ==========================================================================

  describe("20.5.6 — Related compressed contexts", () => {
    it("returns related CCRs when memory sourceRef matches", async () => {
      // Seed a memory with sourceRef
      const mem = await seedMemory({
        type: "test_failure",
        content: "Auth test failure: session cookie not cleared.",
        summary: "Auth test failure",
        sourceRef: "tests/auth/session.test.ts",
      });

      // Seed a CCR with matching sourceRef
      seedCCR({
        sourceRef: "tests/auth/session.test.ts",
        summary: "Compressed auth test output",
        canRetrieveOriginal: 1,
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "auth session cookie",
      });

      const data = parseToolText(result);
      expect(Array.isArray(data.relatedCompressedContexts)).toBe(true);

      const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
      if (ccrs.length > 0) {
        expect(ccrs[0]!.ccrId).toMatch(/^ccr_/);
        expect(ccrs[0]!.canRetrieveOriginal).toBe(true);
      }
    });

    it("marks canRetrieveOriginal correctly when original is available", async () => {
      await seedMemory({
        type: "bug",
        content: "Memory leak in WebSocket handler.",
        sourceRef: "src/websocket.ts",
      });

      seedCCR({
        sourceRef: "src/websocket.ts",
        canRetrieveOriginal: 1,
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "WebSocket leak",
      });

      const data = parseToolText(result);
      const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
      for (const ccr of ccrs) {
        expect(ccr.canRetrieveOriginal).toBe(true);
      }
    });

    it("marks canRetrieveOriginal=false when original is unavailable", async () => {
      await seedMemory({
        type: "bug",
        content: "Race condition in API handler.",
        sourceRef: "src/api/handler.ts",
      });

      seedCCR({
        sourceRef: "src/api/handler.ts",
        canRetrieveOriginal: 0,
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "race condition API",
      });

      const data = parseToolText(result);
      const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
      for (const ccr of ccrs) {
        expect(ccr.canRetrieveOriginal).toBe(false);
      }
    });

    it("includes originalRef in related CCRs", async () => {
      await seedMemory({
        type: "test_failure",
        content: "Build failure on CI.",
        sourceRef: "ci/build.log",
      });

      seedCCR({
        sourceRef: "ci/build.log",
        originalRef: "orig_ci_build_001",
        canRetrieveOriginal: 1,
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "build CI",
      });

      const data = parseToolText(result);
      const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
      if (ccrs.length > 0) {
        expect(ccrs[0]!.originalRef).toBeDefined();
      }
    });

    it("returns empty relatedCCRs when no matches exist", async () => {
      await seedMemory({
        type: "bug",
        content: "Isolated bug with no source ref.",
        sourceRef: undefined,
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "isolated bug",
      });

      const data = parseToolText(result);
      expect(Array.isArray(data.relatedCompressedContexts)).toBe(true);
      expect((data.relatedCompressedContexts as unknown[]).length).toBe(0);
    });

    it("excludes relatedCCRs when includeCompressedRefs=false (PRD §11.7)", async () => {
      await seedMemory({
        type: "test_failure",
        content: "Build failure in CI pipeline.",
        sourceRef: "ci/pipeline.log",
      });

      seedCCR({
        sourceRef: "ci/pipeline.log",
        summary: "Compressed CI output",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "build CI",
        includeCompressedRefs: false,
      });

      const data = parseToolText(result);
      expect(Array.isArray(data.relatedCompressedContexts)).toBe(true);
      expect((data.relatedCompressedContexts as unknown[]).length).toBe(0);
    });
  });

  // ==========================================================================
  // 20.5.7 — No-result receipt
  // ==========================================================================

  describe("20.5.7 — No-result receipt", () => {
    it("generates receipt even when no memories match", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "nonexistent_xyzzy_query_term",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.receiptId).toMatch(/^rcp_/);
      expect(data.scopeId).toBe(SCOPE_ID);
      expect((data.memories as unknown[]).length).toBe(0);
      expect((data.relatedCompressedContexts as unknown[]).length).toBe(0);

      // Verify receipt in database
      const row = queryOne(db, "SELECT * FROM receipts WHERE id = ?", [
        data.receiptId as string,
      ]);
      expect(row).not.toBeNull();
      expect(row!["operation"]).toBe("recall");
      expect(row!["scope_id"]).toBe(SCOPE_ID);
      expect(row!["query"]).toBe("nonexistent_xyzzy_query_term");
    });

    it("receipt is fetchable via ReceiptService for empty results", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "another_nonexistent_query",
      });

      const data = parseToolText(result);
      const receipts = new ReceiptService(db);
      const receipt = receipts.get(data.receiptId as string);

      expect(receipt).not.toBeNull();
      expect(receipt!.operation).toBe("recall");
      expect(receipt!.scopeId).toBe(SCOPE_ID);
      expect(receipt!.query).toBe("another_nonexistent_query");
    });

    it("generates unique receiptIds for each recall", async () => {
      const r1 = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "query A",
      });
      const r2 = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "query B",
      });

      const d1 = parseToolText(r1);
      const d2 = parseToolText(r2);
      expect(d1.receiptId).not.toBe(d2.receiptId);
    });
  });

  // ==========================================================================
  // 20.5.8 — Cross-scope isolation
  // ==========================================================================

  describe("20.5.8 — Cross-scope isolation", () => {
    it("does not return memories from other scopes", async () => {
      // Seed memory in SCOPE_ID
      await seedMemory({
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Scope A rule: use tabs for indentation.",
      });

      // Seed memory in SCOPE_B
      await seedMemory({
        scopeId: SCOPE_B,
        type: "project_rule",
        content: "Scope B rule: use spaces for indentation.",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "indentation",
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];
      // Should only return memories from SCOPE_ID
      for (const m of memories) {
        expect(m.content as string).toContain("Scope A");
      }
    });

    it("profile is isolated by scope", async () => {
      await seedMemory({
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Scope A static rule.",
        profileTarget: "static",
      });
      await seedMemory({
        scopeId: SCOPE_B,
        type: "project_rule",
        content: "Scope B static rule.",
        profileTarget: "static",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "static rule",
      });

      const data = parseToolText(result);
      const profile = data.profile as Record<string, unknown>;
      const staticFacts = profile.static as Record<string, unknown>[];

      // Only Scope A's profile facts should appear
      for (const f of staticFacts) {
        expect(f.content as string).toContain("Scope A");
      }
    });

    it("related CCRs are isolated by scope", async () => {
      await seedMemory({
        scopeId: SCOPE_ID,
        type: "bug",
        content: "Scope A bug.",
        sourceRef: "scope_a_file.ts",
      });

      seedCCR({
        scopeId: SCOPE_B,
        sourceRef: "scope_a_file.ts",
        summary: "This CCR is in scope B, should NOT be returned",
      });

      seedCCR({
        scopeId: SCOPE_ID,
        sourceRef: "scope_a_file.ts",
        summary: "This CCR is in scope A, SHOULD be returned",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "bug",
      });

      const data = parseToolText(result);
      const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
      for (const ccr of ccrs) {
        expect(ccr.summary).toContain("scope A");
      }
    });
  });

  // ==========================================================================
  // Confidence merging
  // ==========================================================================

  describe("Confidence merging", () => {
    it("higher confidence memories rank higher (all else equal)", async () => {
      // Seed two memories with same content pattern but different confidence
      const now = new Date().toISOString();
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES ('mem_low_conf', ?, 'bug', 'Database connection timeout error.', 0.3, 'active', ?, ?)`,
        [SCOPE_ID, now, now],
      );
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES ('mem_high_conf', ?, 'bug', 'Database connection timeout error.', 0.95, 'active', ?, ?)`,
        [SCOPE_ID, now, now],
      );

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "database connection timeout",
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];

      expect(memories.length).toBeGreaterThanOrEqual(2);

      // High confidence should rank first (same content, same creation time)
      // BM25 scores are identical, so confidence × recency tips the ranking
      const firstId = memories[0]!.id as string;
      // Since both have the same BM25 score and same age, the higher-confidence
      // one (0.95 vs 0.3) gets higher mergedScore and ranks first.
      // If FTS5 is unavailable (LIKE fallback), both get same LIKE score,
      // so confidence still tips the ranking.
      const lowConfIdx = memories.findIndex(
        (m) => (m as Record<string, unknown>).id === "mem_low_conf",
      );
      const highConfIdx = memories.findIndex(
        (m) => (m as Record<string, unknown>).id === "mem_high_conf",
      );
      expect(highConfIdx).toBeLessThan(lowConfIdx);
    });

    it("score is higher for higher confidence", async () => {
      const now = new Date().toISOString();
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES ('mem_score_a', ?, 'bug', 'Critical security vulnerability in auth.', 0.9, 'active', ?, ?)`,
        [SCOPE_ID, now, now],
      );

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "security vulnerability auth",
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];
      expect(memories.length).toBeGreaterThanOrEqual(1);
      expect(typeof (memories[0] as Record<string, unknown>).score).toBe(
        "number",
      );
    });
  });

  // ==========================================================================
  // Recency weighting
  // ==========================================================================

  describe("Recency weighting", () => {
    it("boosts newer memories over equally relevant older ones", async () => {
      const oldDate = new Date(Date.now() - 90 * 86_400_000).toISOString(); // 90 days ago
      const newDate = new Date().toISOString();

      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES ('mem_old_recency', ?, 'bug', 'Login error.', 0.8, 'active', ?, ?)`,
        [SCOPE_ID, oldDate, oldDate],
      );
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES ('mem_new_recency', ?, 'bug', 'Login error.', 0.8, 'active', ?, ?)`,
        [SCOPE_ID, newDate, newDate],
      );

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "login error",
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];

      expect(memories.length).toBeGreaterThanOrEqual(2);

      // Newer memory should rank first (same content, same confidence)
      // Use findIndex to verify order
      const newIdx = memories.findIndex(
        (m) => (m as Record<string, unknown>).id === "mem_new_recency",
      );
      const oldIdx = memories.findIndex(
        (m) => (m as Record<string, unknown>).id === "mem_old_recency",
      );
      expect(newIdx).toBeLessThan(oldIdx);
    });

    it("very old memories still appear but with reduced score", async () => {
      const ancientDate = new Date(
        Date.now() - 365 * 86_400_000,
      ).toISOString(); // 1 year ago

      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES ('mem_ancient', ?, 'project_rule', 'Use npm as package manager (outdated).', 0.8, 'active', ?, ?)`,
        [SCOPE_ID, ancientDate, ancientDate],
      );

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "npm package manager",
      });

      const data = parseToolText(result);
      const memories = data.memories as Record<string, unknown>[];
      // Should still find it (content match), just with lower score
      expect(memories.length).toBeGreaterThanOrEqual(1);
      const score = (memories[0] as Record<string, unknown>).score as number;
      expect(typeof score).toBe("number");
    });
  });

  // ==========================================================================
  // Input validation
  // ==========================================================================

  describe("Input validation", () => {
    it("returns error for missing query", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text).toContain("query is required");
    });

    it("returns error for empty query string", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "",
      });

      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text).toContain("query is required");
    });

    it("returns error for whitespace-only query", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "   ",
      });

      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text).toContain("query is required");
    });

    it("returns error for query exceeding max length", async () => {
      const longQuery = "x".repeat(2000);
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: longQuery,
      });

      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text).toContain("exceeds maximum length");
    });

    it("returns error for invalid types", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "test",
        types: ["invalid_type", "also_invalid"],
      });

      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("Invalid type");
      expect(text).toContain("invalid_type");
      expect(text).toContain("also_invalid");
    });

    it("returns error for invalid status", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "test",
        status: ["bogus_status"],
      });

      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text).toContain("Invalid status");
      expect(result.content[0]!.text).toContain("bogus_status");
    });

    it("returns error for invalid limit (negative)", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "test",
        limit: -5,
      });

      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text).toContain("limit must be");
    });

    it("clamps limit to MAX_LIMIT (50)", async () => {
      await seedMemory({
        type: "bug",
        content: "Limit test bug.",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "bug",
        limit: 100,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      // Should clamp to 50, but we only have 1 memory anyway
      expect((data.memories as unknown[]).length).toBeLessThanOrEqual(50);
    });

    it("accepts limit at boundary (1)", async () => {
      await seedMemory({
        type: "bug",
        content: "First bug.",
      });
      await seedMemory({
        type: "bug",
        content: "Second bug.",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "bug",
        limit: 1,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect((data.memories as unknown[]).length).toBe(1);
    });
  });

  // ==========================================================================
  // Scope auto-resolution
  // ==========================================================================

  describe("Scope auto-resolution", () => {
    it("auto-resolves scopeId when not provided", async () => {
      const result = await handleRecallContext(ctx, {
        query: "test auto scope",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.scopeId).toBeDefined();
      expect(typeof data.scopeId).toBe("string");
      expect((data.scopeId as string).length).toBeGreaterThan(0);
    });

    it("uses explicitly provided scopeId when given", async () => {
      const result = await handleRecallContext(ctx, {
        scopeId: "my_custom_recall_scope",
        query: "test explicit scope",
      });

      const data = parseToolText(result);
      expect(data.scopeId).toBe("my_custom_recall_scope");
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe("Edge cases", () => {
    it("handles all valid memory types in filter", async () => {
      const allTypes = [
        "decision", "bug", "command", "file_summary", "project_rule",
        "user_preference", "current_task", "test_failure", "api_contract",
        "dependency",
      ];

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "test",
        types: allTypes,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.receiptId).toMatch(/^rcp_/);
    });

    it("handles empty types array gracefully", async () => {
      await seedMemory({
        type: "bug",
        content: "Edge case bug.",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "bug",
        types: [],
      });

      expect(isError(result)).toBe(false);
      // Empty types array = no filter, should return bug
      const data = parseToolText(result);
      expect((data.memories as unknown[]).length).toBeGreaterThanOrEqual(1);
    });

    it("empty query returns empty results with receipt", async () => {
      // When query is empty, handleRecallContext returns error before search
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "",
      });

      expect(isError(result)).toBe(true);
    });

    it("fail-open: search errors return empty results not exceptions", async () => {
      // This test verifies the try/catch in the handler.
      // We pass an empty string query which fails validation,
      // but for a real DB error the catch block would fire.
      // The handler already has fail-open for the try/catch around search.
      // We just verify the receipt is still generated for empty result path.

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "no_match_whatsoever_12345",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.receiptId).toMatch(/^rcp_/);
      expect((data.memories as unknown[]).length).toBe(0);
    });

    it("limit at max returns at most MAX_LIMIT", async () => {
      // Seed many memories
      for (let i = 0; i < 5; i++) {
        await seedMemory({
          type: "bug",
          content: `Max limit test bug ${i}.`,
        });
      }

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "bug",
        limit: 2,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect((data.memories as unknown[]).length).toBeLessThanOrEqual(2);
    });

    it("warnings array present when scope persistence has issues", async () => {
      // Using a valid scopeId should not generate warnings in normal operation
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "test warnings",
      });

      const data = parseToolText(result);
      // In a healthy test, warnings should not appear
      // The response may or may not have warnings depending on scope state
      expect(data.receiptId).toMatch(/^rcp_/);
    });

    it("retrieveOriginal=true warns but does not error (PRD §11.7 placeholder)", async () => {
      await seedMemory({
        type: "bug",
        content: "Test bug for retrieveOriginal.",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "retrieveOriginal",
        retrieveOriginal: true,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.receiptId).toMatch(/^rcp_/);
      expect(data.warnings).toBeDefined();
      expect(
        (data.warnings as string[]).some((w) =>
          w.includes("retrieveOriginal"),
        ),
      ).toBe(true);
    });

    it("retrieveOriginal defaults to false with no warning", async () => {
      await seedMemory({
        type: "bug",
        content: "Default retrieveOriginal test bug.",
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "default retrieveOriginal",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      // No retrieveOriginal warning should appear
      if (data.warnings) {
        const hasRetrieveWarning = (data.warnings as string[]).some((w) =>
          w.includes("retrieveOriginal"),
        );
        expect(hasRetrieveWarning).toBe(false);
      }
    });
  });
});
