/**
 * Phase 5 Integration Tests — rememberContext Tool Handler (PRD §18.4)
 *
 * Covers the complete remember_context MCP tool:
 *   18.4.1 — Save project_rule
 *   18.4.2 — Save current_task
 *   18.4.3 — Save test_failure
 *   18.4.4 — Save with sourceRef
 *   18.4.5 — Save to static profile
 *   18.4.6 — Save to dynamic profile
 *   18.4.7 — Receipt generation
 *   18.3.1 — Invalid type error
 *   18.3.2 — Empty content error
 *   18.3.3 — Content exceeds max length
 *   18.3.4 — Invalid confidence
 *   18.3.5 — Invalid profileTarget
 *   18.3.6 — Invalid expiresAt
 *   18.3.7 — Scope auto-resolution
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt, queryOne } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { handleRememberContext } from "../src/mcp/tools/rememberContext.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../src/mcp/server.js";

let db: Database;
let ctx: ServerContext;

const SCOPE_ID = "repo_remember_test";

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

/** Check if a tool result is an error. */
function isError(result: { content: { type: string; text?: string }[]; isError?: boolean }): boolean {
  return result.isError === true;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("remember_context Tool Handler", () => {
  beforeAll(async () => {
    await initAndMigrate(":memory:");
    db = getDb();
    const receipts = new ReceiptService(db);
    ctx = { db, receipts };
    ensureScope();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clean up tables in FK-safe order
    try { db.exec("DELETE FROM memories_fts"); } catch { /* may not exist */ }
    db.exec("DELETE FROM profile_facts");
    db.exec("DELETE FROM receipts");
    db.exec("DELETE FROM memories");
  });

  // ==========================================================================
  // 18.4.1 — Save project_rule
  // ==========================================================================

  describe("18.4.1 — Save project_rule", () => {
    it("creates a project_rule memory and returns memoryId + receiptId", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Always use pnpm as the package manager. Never use npm or yarn.",
        summary: "Use pnpm",
        confidence: 0.95,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.memoryId).toMatch(/^mem_/);
      expect(data.receiptId).toMatch(/^rcp_/);
      expect(data.scopeId).toBe(SCOPE_ID);
      expect(data.type).toBe("project_rule");
      expect(data.status).toBe("active");
    });

    it("persists all fields to the database", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Use TypeScript strict mode for all new files.",
        summary: "Strict TS",
        confidence: 0.9,
        sourceRef: "tsconfig.json",
        tags: ["typescript", "config"],
      });

      const data = parseToolText(result);
      const row = queryOne(
        db,
        "SELECT * FROM memories WHERE id = ?",
        [data.memoryId as string],
      );
      expect(row).not.toBeNull();
      expect(row!["type"]).toBe("project_rule");
      expect(row!["content"]).toContain("strict mode");
      expect(row!["summary"]).toBe("Strict TS");
      expect(row!["confidence"]).toBe(0.9);
      expect(row!["source_ref"]).toBe("tsconfig.json");
      expect(row!["status"]).toBe("active");
    });
  });

  // ==========================================================================
  // 18.4.2 — Save current_task
  // ==========================================================================

  describe("18.4.2 — Save current_task", () => {
    it("creates a current_task memory", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "current_task",
        content: "Fixing auth/session.ts refresh token cookie cleanup issue.",
        summary: "Auth session cookie fix",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.type).toBe("current_task");
      expect(data.status).toBe("active");

      const row = queryOne(db, "SELECT * FROM memories WHERE id = ?", [data.memoryId as string]);
      expect(row!["type"]).toBe("current_task");
      expect(row!["content"]).toContain("refresh token");
    });
  });

  // ==========================================================================
  // 18.4.3 — Save test_failure
  // ==========================================================================

  describe("18.4.3 — Save test_failure", () => {
    it("creates a test_failure memory", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "test_failure",
        content: "auth/session.test.ts > should clear cookie on logout — Expected true but got false.",
        summary: "Session logout test failure",
        tags: ["auth", "test", "bug"],
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.type).toBe("test_failure");
      expect(data.status).toBe("active");

      const row = queryOne(db, "SELECT * FROM memories WHERE id = ?", [data.memoryId as string]);
      expect(row!["type"]).toBe("test_failure");
      expect(row!["content"]).toContain("Expected true but got false");
    });
  });

  // ==========================================================================
  // 18.4.4 — Save with sourceRef
  // ==========================================================================

  describe("18.4.4 — Save with sourceRef", () => {
    it("persists sourceRef correctly", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "decision",
        content: "Decided to use React Router v6 for client-side routing.",
        summary: "React Router v6",
        sourceRef: "docs/architecture.md#routing",
      });

      const data = parseToolText(result);
      expect(data.sourceRef).toBe("docs/architecture.md#routing");

      const row = queryOne(db, "SELECT * FROM memories WHERE id = ?", [data.memoryId as string]);
      expect(row!["source_ref"]).toBe("docs/architecture.md#routing");
    });

    it("handles user:manual style sourceRef", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "All API calls must go through src/lib/api.ts.",
        sourceRef: "user:manual",
      });

      const data = parseToolText(result);
      expect(data.sourceRef).toBe("user:manual");
    });

    it("omits sourceRef from response when not provided", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "bug",
        content: "Memory leak in WebSocket connection handler.",
      });

      const data = parseToolText(result);
      expect(data.sourceRef).toBeUndefined();
    });
  });

  // ==========================================================================
  // 18.4.5 — Save to static profile
  // ==========================================================================

  describe("18.4.5 — Save to static profile", () => {
    it("creates a profile_fact in the static layer", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Never modify auto-generated files. They are owned by the code generator.",
        summary: "Do not modify generated files",
        profileTarget: "static",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.profileTarget).toBe("static");

      // Verify profile_facts row
      const pfRows = db.exec(
        `SELECT * FROM profile_facts WHERE scope_id = '${SCOPE_ID}' AND layer = 'static'`,
      );
      expect(pfRows.length).toBeGreaterThan(0);
      const values = pfRows[0]!.values[0]!;
      expect(values[3]).toBe("Do not modify generated files"); // content = summary
      expect(values[4]).toBe(data.memoryId); // source_memory_id
    });

    it("falls back to content when summary is not provided for profile facts", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "decision",
        content: "Use Zod for runtime schema validation.",
        profileTarget: "static",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      const pfRow = queryOne(
        db,
        "SELECT content FROM profile_facts WHERE source_memory_id = ?",
        [data.memoryId as string],
      );
      // MemoryService.writeProfileFact uses summary ?? content
      expect(pfRow!["content"]).toBe("Use Zod for runtime schema validation.");
    });
  });

  // ==========================================================================
  // 18.4.6 — Save to dynamic profile
  // ==========================================================================

  describe("18.4.6 — Save to dynamic profile", () => {
    it("creates a profile_fact in the dynamic layer", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "current_task",
        content: "Working on remember_context MCP tool implementation.",
        summary: "Implement remember_context",
        profileTarget: "dynamic",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.profileTarget).toBe("dynamic");

      const pfRows = db.exec(
        `SELECT * FROM profile_facts WHERE scope_id = '${SCOPE_ID}' AND layer = 'dynamic'`,
      );
      expect(pfRows.length).toBeGreaterThan(0);
      const values = pfRows[0]!.values[0]!;
      expect(values[3]).toBe("Implement remember_context");
      expect(values[4]).toBe(data.memoryId);
    });

    it("does not create profile fact when profileTarget is not specified", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "bug",
        content: "Login page crashes on empty password field.",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.profileTarget).toBeUndefined();

      const countRow = queryOne(
        db,
        "SELECT COUNT(*) as cnt FROM profile_facts WHERE scope_id = ?",
        [SCOPE_ID],
      );
      expect(Number(countRow!["cnt"])).toBe(0);
    });
  });

  // ==========================================================================
  // 18.4.7 — Receipt generation
  // ==========================================================================

  describe("18.4.7 — Receipt generation", () => {
    it("generates a receipt for every remember operation", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Use ESLint with the company preset.",
      });

      const data = parseToolText(result);
      const receiptId = data.receiptId as string;
      expect(receiptId).toMatch(/^rcp_/);

      // Verify receipt in database
      const row = queryOne(db, "SELECT * FROM receipts WHERE id = ?", [receiptId]);
      expect(row).not.toBeNull();
      expect(row!["operation"]).toBe("remember");
      expect(row!["scope_id"]).toBe(SCOPE_ID);

      // Verify memory_ids contains our memoryId
      const memoryIds = JSON.parse(row!["memory_ids"] as string);
      expect(memoryIds).toContain(data.memoryId);
    });

    it("generates unique receiptIds for each call", async () => {
      const r1 = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID, type: "bug", content: "Bug A",
      });
      const r2 = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID, type: "bug", content: "Bug B",
      });

      const d1 = parseToolText(r1);
      const d2 = parseToolText(r2);
      expect(d1.receiptId).not.toBe(d2.receiptId);
    });

    it("receipt is fetchable via ReceiptService", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "decision",
        content: "Adopt Vitest as the test framework.",
      });

      const data = parseToolText(result);
      const receipts = new ReceiptService(db);
      const receipt = receipts.get(data.receiptId as string);
      expect(receipt).not.toBeNull();
      expect(receipt!.operation).toBe("remember");
      expect(receipt!.scopeId).toBe(SCOPE_ID);
    });
  });

  // ==========================================================================
  // 18.3.1 — Invalid type
  // ==========================================================================

  describe("18.3.1 — Invalid type error", () => {
    it("returns error for missing type", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        content: "Some content",
      });

      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("type is required");
    });

    it("returns error for invalid type", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "invalid_type",
        content: "Some content",
      });

      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("Invalid type");
      expect(text).toContain("invalid_type");
    });

    it("lists valid types in error message", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "bogus",
        content: "Test",
      });

      const text = result.content[0]!.text!;
      expect(text).toContain("decision");
      expect(text).toContain("project_rule");
      expect(text).toContain("current_task");
    });
  });

  // ==========================================================================
  // 18.3.2 — Empty content
  // ==========================================================================

  describe("18.3.2 — Empty content error", () => {
    it("returns error for missing content", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
      });

      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("content is required");
    });

    it("returns error for empty string content", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "",
      });

      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("content is required");
    });

    it("returns error for whitespace-only content", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "   ",
      });

      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("content is required");
    });
  });

  // ==========================================================================
  // 18.3.3 — Content exceeds max length
  // ==========================================================================

  describe("18.3.3 — Content exceeds max length", () => {
    it("returns error when content exceeds MAX_CONTENT_LENGTH", async () => {
      const hugeContent = "x".repeat(300_000); // 300K > 256K limit
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "bug",
        content: hugeContent,
      });

      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("exceeds maximum length");
    });

    it("allows content at exactly MAX_CONTENT_LENGTH", async () => {
      const exactContent = "x".repeat(256_000);
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "bug",
        content: exactContent,
      });

      // Should succeed (not error)
      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.memoryId).toMatch(/^mem_/);
    });
  });

  // ==========================================================================
  // 18.3.4 — Invalid confidence
  // ==========================================================================

  describe("18.3.4 — Invalid confidence", () => {
    it("returns error for confidence > 1", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Test",
        confidence: 1.5,
      });

      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("confidence must be");
    });

    it("returns error for confidence < 0", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Test",
        confidence: -0.1,
      });

      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("confidence must be");
    });

    it("accepts confidence at 0 and 1 boundaries", async () => {
      const r1 = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID, type: "bug", content: "Zero", confidence: 0,
      });
      const r2 = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID, type: "bug", content: "One", confidence: 1,
      });

      expect(isError(r1)).toBe(false);
      expect(isError(r2)).toBe(false);
    });

    it("defaults confidence to 0.8", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "decision",
        content: "Default confidence test.",
      });

      const data = parseToolText(result);
      const row = queryOne(db, "SELECT confidence FROM memories WHERE id = ?", [data.memoryId as string]);
      expect(row!["confidence"]).toBe(0.8);
    });
  });

  // ==========================================================================
  // 18.3.5 — Invalid profileTarget
  // ==========================================================================

  describe("18.3.5 — Invalid profileTarget", () => {
    it("returns error for invalid profileTarget", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Test",
        profileTarget: "invalid",
      });

      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("Invalid profileTarget");
      expect(result.content[0]!.text!).toContain("static");
      expect(result.content[0]!.text!).toContain("dynamic");
    });

    it("accepts 'static' profileTarget", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Static rule",
        profileTarget: "static",
      });

      expect(isError(result)).toBe(false);
    });

    it("accepts 'dynamic' profileTarget", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "current_task",
        content: "Dynamic task",
        profileTarget: "dynamic",
      });

      expect(isError(result)).toBe(false);
    });
  });

  // ==========================================================================
  // 18.3.6 — Invalid expiresAt
  // ==========================================================================

  describe("18.3.6 — Invalid expiresAt", () => {
    it("returns error for invalid date string", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Test",
        expiresAt: "not-a-date",
      });

      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("expiresAt must be a valid ISO 8601");
    });

    it("accepts a valid ISO 8601 date", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "project_rule",
        content: "Temporary rule",
        expiresAt: "2027-12-31T23:59:59Z",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      const row = queryOne(db, "SELECT expires_at FROM memories WHERE id = ?", [data.memoryId as string]);
      expect(row!["expires_at"]).toBe("2027-12-31T23:59:59Z");
    });

    it("accepts ISO 8601 with timezone offset", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "bug",
        content: "Date with offset",
        expiresAt: "2027-06-15T00:00:00+08:00",
      });

      expect(isError(result)).toBe(false);
    });
  });

  // ==========================================================================
  // 18.3.7 — Scope auto-resolution
  // ==========================================================================

  describe("18.3.7 — Scope auto-resolution", () => {
    it("auto-resolves scopeId when not provided", async () => {
      const result = await handleRememberContext(ctx, {
        type: "project_rule",
        content: "Auto-scoped memory.",
      });

      // Should succeed — scope is auto-resolved from current directory
      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.scopeId).toBeDefined();
      expect(typeof data.scopeId).toBe("string");
      expect((data.scopeId as string).length).toBeGreaterThan(0);
    });

    it("uses explicitly provided scopeId when given", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: "my_custom_scope",
        type: "project_rule",
        content: "Scoped memory.",
      });

      const data = parseToolText(result);
      expect(data.scopeId).toBe("my_custom_scope");
    });
  });

  // ==========================================================================
  // 18.4.8 — Additional edge cases
  // ==========================================================================

  describe("18.4.8 — Edge cases", () => {
    it("handles all valid memory types", async () => {
      const allTypes = [
        "decision", "bug", "command", "file_summary", "project_rule",
        "user_preference", "current_task", "test_failure", "api_contract", "dependency",
      ];

      for (const t of allTypes) {
        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: t,
          content: `Memory of type ${t}`,
        });
        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.type).toBe(t);
      }
    });

    it("handles tags as array", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "bug",
        content: "Tagged memory",
        tags: ["critical", "login", "v2.0"],
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      const row = queryOne(db, "SELECT tags FROM memories WHERE id = ?", [data.memoryId as string]);
      const tags = JSON.parse(row!["tags"] as string);
      expect(tags).toEqual(["critical", "login", "v2.0"]);
    });

    it("handles empty tags array gracefully", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "bug",
        content: "No tags memory",
        tags: [],
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      const row = queryOne(db, "SELECT tags FROM memories WHERE id = ?", [data.memoryId as string]);
      expect(row!["tags"]).toBeNull(); // empty array not stored
    });

    it("handles expiresAt as null/omitted", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "decision",
        content: "No expiration",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      const row = queryOne(db, "SELECT expires_at FROM memories WHERE id = ?", [data.memoryId as string]);
      expect(row!["expires_at"]).toBeNull();
    });

    it("creates unique memoryIds", async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "bug",
          content: `Unique memory ${i}`,
        });
        const data = parseToolText(result);
        ids.add(data.memoryId as string);
      }
      expect(ids.size).toBe(10);
    });

    it("summary is optional and defaults to undefined", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "decision",
        content: "No summary provided.",
      });

      const data = parseToolText(result);
      expect(data.summary).toBeUndefined();
    });

    it("response includes summary when provided", async () => {
      const result = await handleRememberContext(ctx, {
        scopeId: SCOPE_ID,
        type: "decision",
        content: "With summary.",
        summary: "A brief summary",
      });

      const data = parseToolText(result);
      expect(data.summary).toBe("A brief summary");
    });
  });
});
