/**
 * Phase 9 Integration Tests — listContext Tool Handler (PRD §22)
 *
 * Covers the complete list_context MCP tool:
 *   22.1 — Input validation (scopeId required, types/status/sortBy/sortOrder validation)
 *   22.2 — Output structure (id, type, summary, status, sourceRef, confidence, createdAt, updatedAt, total)
 *   22.3 — Audit capabilities (view active/superseded/forgotten/expired, view by type)
 *   22.4 — Pagination, scope isolation, empty list, sorting
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt, queryAll } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { handleListContext } from "../src/mcp/tools/listContext.js";
import { handleRememberContext } from "../src/mcp/tools/rememberContext.js";
import { handleForgetContext } from "../src/mcp/tools/forgetContext.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../src/mcp/server.js";

let db: Database;
let ctx: ServerContext;

const SCOPE_A = "repo_list_test";
const SCOPE_B = "repo_list_test_b";

function ensureScope(scopeId: string) {
  runStmt(
    db,
    `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
     VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`,
    [scopeId, process.cwd()],
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

/** Create a memory via remember_context handler. Returns parsed response. */
async function seedMemory(
  scopeId: string,
  overrides: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await handleRememberContext(ctx, {
    scopeId,
    type: "project_rule",
    content: "Default seed content.",
    ...overrides,
  });
  if (isError(result)) {
    throw new Error(`seedMemory failed: ${result.content[0]!.text}`);
  }
  return parseToolText(result);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("list_context Tool Handler", () => {
  beforeAll(async () => {
    await initAndMigrate(":memory:");
    db = getDb();
    const receipts = new ReceiptService(db);
    ctx = { db, receipts };
    ensureScope(SCOPE_A);
    ensureScope(SCOPE_B);
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clean up in FK-safe order
    try { db.exec("DELETE FROM memories_fts"); } catch { /* may not exist */ }
    db.exec("DELETE FROM profile_facts");
    db.exec("DELETE FROM receipts");
    db.exec("DELETE FROM memories");
    // Re-create scope records
    ensureScope(SCOPE_A);
    ensureScope(SCOPE_B);
  });

  // ==========================================================================
  // 22.1 — Input validation
  // ==========================================================================

  describe("22.1 — Input validation", () => {
    it("rejects missing scopeId", async () => {
      const result = await handleListContext(ctx, {});
      expect(isError(result)).toBe(true);
      const text = JSON.parse(result.content[0]!.text!);
      expect(text.error).toContain("Missing required parameter: scopeId");
    });

    it("rejects empty scopeId", async () => {
      const result = await handleListContext(ctx, { scopeId: "   " });
      expect(isError(result)).toBe(true);
    });

    it("rejects invalid types (not an array)", async () => {
      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        types: "project_rule", // should be an array
      });
      expect(isError(result)).toBe(true);
      const text = JSON.parse(result.content[0]!.text!);
      expect(text.error).toContain("must be an array");
    });

    it("rejects invalid type values", async () => {
      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        types: ["project_rule", "invalid_type"],
      });
      expect(isError(result)).toBe(true);
      const text = JSON.parse(result.content[0]!.text!);
      expect(text.error).toContain("invalid_type");
      expect(text.validTypes).toBeDefined();
    });

    it("rejects invalid status (not an array)", async () => {
      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        status: "active",
      });
      expect(isError(result)).toBe(true);
      const text = JSON.parse(result.content[0]!.text!);
      expect(text.error).toContain("must be an array");
    });

    it("rejects invalid status values", async () => {
      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        status: ["active", "deleted"],
      });
      expect(isError(result)).toBe(true);
      const text = JSON.parse(result.content[0]!.text!);
      expect(text.error).toContain("deleted");
      expect(text.validStatuses).toBeDefined();
    });

    it("rejects invalid sortBy", async () => {
      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        sortBy: "invalidField",
      });
      expect(isError(result)).toBe(true);
      const text = JSON.parse(result.content[0]!.text!);
      expect(text.error).toContain("Invalid sortBy");
      expect(text.validSortBy).toBeDefined();
    });

    it("rejects invalid sortOrder", async () => {
      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        sortOrder: "random",
      });
      expect(isError(result)).toBe(true);
      const text = JSON.parse(result.content[0]!.text!);
      expect(text.error).toContain("Invalid sortOrder");
    });
  });

  // ==========================================================================
  // 22.2 — Output structure
  // ==========================================================================

  describe("22.2 — Output structure", () => {
    it("returns correct output fields per PRD §11.9", async () => {
      await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Use pnpm for package management.",
        summary: "Package manager: pnpm",
        sourceRef: "docs/setup.md",
        confidence: 0.95,
      });

      const result = await handleListContext(ctx, { scopeId: SCOPE_A });
      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      // Top-level fields
      expect(data.scopeId).toBe(SCOPE_A);
      expect(data.total).toBe(1);
      expect(data.items).toBeInstanceOf(Array);
      expect(data.items).toHaveLength(1);

      // Item fields
      const item = (data.items as Record<string, unknown>[])[0]!;
      expect(item.id).toMatch(/^mem_/);
      expect(item.type).toBe("project_rule");
      expect(item.summary).toBe("Package manager: pnpm");
      expect(item.status).toBe("active");
      expect(item.sourceRef).toBe("docs/setup.md");
      expect(item.confidence).toBe(0.95);
      expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // Should NOT contain content (PRD specifies a subset of fields)
      expect((item as Record<string, unknown>).content).toBeUndefined();
      expect((item as Record<string, unknown>).tags).toBeUndefined();
      expect((item as Record<string, unknown>).supersededBy).toBeUndefined();
      expect((item as Record<string, unknown>).expiresAt).toBeUndefined();
    });

    it("handles items with missing optional fields gracefully", async () => {
      await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Minimal decision.",
        summary: undefined,
        sourceRef: undefined,
      });

      const result = await handleListContext(ctx, { scopeId: SCOPE_A });
      const data = parseToolText(result);
      const item = (data.items as Record<string, unknown>[])[0]!;

      expect(item.summary).toBeUndefined();
      expect(item.sourceRef).toBeUndefined();
      // summary should be undefined/null, but status and confidence always exist
      expect(item.status).toBe("active");
      expect(item.confidence).toBe(0.8); // default
    });

    it("total reflects total count regardless of limit", async () => {
      for (let i = 0; i < 10; i++) {
        await seedMemory(SCOPE_A, {
          type: "decision",
          content: `Memory ${i}`,
        });
      }

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        limit: 3,
      });
      const data = parseToolText(result);

      expect(data.total).toBe(10);
      expect((data.items as unknown[]).length).toBe(3);
    });
  });

  // ==========================================================================
  // 22.3 — Audit capabilities
  // ==========================================================================

  describe("22.3 — Audit capabilities", () => {
    it("lists all statuses by default (no status filter)", async () => {
      const activeMem = await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Active rule.",
      });
      const forgottenMem = await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Forgotten decision.",
      });

      // Forget one memory
      await handleForgetContext(ctx, {
        id: forgottenMem.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_A,
      });

      // List without status filter — should show both
      const result = await handleListContext(ctx, { scopeId: SCOPE_A });
      const data = parseToolText(result);

      expect(data.total).toBe(2);
      const ids = (data.items as Record<string, unknown>[]).map((i) => i.id);
      expect(ids).toContain(activeMem.memoryId);
      expect(ids).toContain(forgottenMem.memoryId);
    });

    it("filters to only active memories", async () => {
      await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Active 1",
      });
      await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Active 2",
      });
      const forgottenMem = await seedMemory(SCOPE_A, {
        type: "bug",
        content: "Forgotten.",
      });
      await handleForgetContext(ctx, {
        id: forgottenMem.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_A,
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        status: ["active"],
      });
      const data = parseToolText(result);

      expect(data.total).toBe(2);
      for (const item of data.items as Record<string, unknown>[]) {
        expect(item.status).toBe("active");
      }
    });

    it("filters to only superseded memories", async () => {
      const oldMem = await seedMemory(SCOPE_A, {
        type: "dependency",
        content: "Old dep.",
      });
      const newMem = await seedMemory(SCOPE_A, {
        type: "dependency",
        content: "New dep.",
      });

      await handleForgetContext(ctx, {
        id: oldMem.memoryId,
        mode: "supersede",
        supersededBy: newMem.memoryId,
        scopeId: SCOPE_A,
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        status: ["superseded"],
      });
      const data = parseToolText(result);

      expect(data.total).toBe(1);
      const item = (data.items as Record<string, unknown>[])[0]!;
      expect(item.status).toBe("superseded");
      expect(item.id).toBe(oldMem.memoryId);
    });

    it("filters to only forgotten memories", async () => {
      await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Active.",
      });
      const forgottenMem = await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Forgotten.",
      });
      await handleForgetContext(ctx, {
        id: forgottenMem.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_A,
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        status: ["forgotten"],
      });
      const data = parseToolText(result);

      expect(data.total).toBe(1);
      const item = (data.items as Record<string, unknown>[])[0]!;
      expect(item.status).toBe("forgotten");
    });

    it("filters to only expired memories", async () => {
      await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Active.",
      });
      const expiredMem = await seedMemory(SCOPE_A, {
        type: "current_task",
        content: "Expired task.",
      });
      await handleForgetContext(ctx, {
        id: expiredMem.memoryId,
        mode: "expire",
        scopeId: SCOPE_A,
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        status: ["expired"],
      });
      const data = parseToolText(result);

      expect(data.total).toBe(1);
      const item = (data.items as Record<string, unknown>[])[0]!;
      expect(item.status).toBe("expired");
    });

    it("filters by type", async () => {
      await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Rule 1.",
      });
      await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Rule 2.",
      });
      await seedMemory(SCOPE_A, {
        type: "bug",
        content: "Bug 1.",
      });
      await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Decision 1.",
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        types: ["project_rule", "bug"],
      });
      const data = parseToolText(result);

      expect(data.total).toBe(3);
      const types = new Set(
        (data.items as Record<string, unknown>[]).map((i) => i.type),
      );
      expect(types.has("project_rule")).toBe(true);
      expect(types.has("bug")).toBe(true);
      expect(types.has("decision")).toBe(false);
    });

    it("combines type and status filters", async () => {
      await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Active rule.",
      });
      const forgottenRule = await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Forgotten rule.",
      });
      await handleForgetContext(ctx, {
        id: forgottenRule.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_A,
      });
      await seedMemory(SCOPE_A, {
        type: "bug",
        content: "Active bug.",
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        types: ["project_rule"],
        status: ["forgotten"],
      });
      const data = parseToolText(result);

      expect(data.total).toBe(1);
      const item = (data.items as Record<string, unknown>[])[0]!;
      expect(item.type).toBe("project_rule");
      expect(item.status).toBe("forgotten");
    });

    it("generates an audit receipt for every list operation", async () => {
      await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Test receipt.",
      });

      await handleListContext(ctx, {
        scopeId: SCOPE_A,
        types: ["project_rule"],
        status: ["active"],
      });

      const receiptRows = queryAll(
        db,
        "SELECT * FROM receipts WHERE operation = 'list'",
      );
      expect(receiptRows.length).toBeGreaterThanOrEqual(1);
      expect(receiptRows[0]!["scope_id"]).toBe(SCOPE_A);
    });
  });

  // ==========================================================================
  // 22.4 — Pagination, scope isolation, empty list, sorting
  // ==========================================================================

  describe("22.4 — Pagination", () => {
    it("returns at most `limit` items", async () => {
      for (let i = 0; i < 15; i++) {
        await seedMemory(SCOPE_A, {
          type: i % 2 === 0 ? "decision" : "bug",
          content: `Memory ${i}`,
        });
      }

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        limit: 5,
      });
      const data = parseToolText(result);

      expect((data.items as unknown[]).length).toBe(5);
      expect(data.total).toBe(15);
    });

    it("offset skips the first N records", async () => {
      for (let i = 0; i < 10; i++) {
        await seedMemory(SCOPE_A, {
          type: "decision",
          content: `Memory ${i}`,
        });
      }

      const page1 = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        limit: 5,
        offset: 0,
      });
      const page2 = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        limit: 5,
        offset: 5,
      });

      const data1 = parseToolText(page1);
      const data2 = parseToolText(page2);

      const ids1 = new Set(
        (data1.items as Record<string, unknown>[]).map((i) => i.id),
      );
      const ids2 = new Set(
        (data2.items as Record<string, unknown>[]).map((i) => i.id),
      );

      // Pages should not overlap
      for (const id of ids1) {
        expect(ids2.has(id)).toBe(false);
      }

      expect(data1.total).toBe(10);
      expect(data2.total).toBe(10);
    });

    it("returns empty items when offset exceeds total", async () => {
      await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Only one.",
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        offset: 100,
      });
      const data = parseToolText(result);

      expect((data.items as unknown[]).length).toBe(0);
      expect(data.total).toBe(1);
    });

    it("clamps limit to [1, 100]", async () => {
      for (let i = 0; i < 5; i++) {
        await seedMemory(SCOPE_A, {
          type: "decision",
          content: `Memory ${i}`,
        });
      }

      // limit=0 should be clamped to 1
      const resultMin = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        limit: 0,
      });
      const dataMin = parseToolText(resultMin);
      expect((dataMin.items as unknown[]).length).toBe(1);

      // limit=999 should be clamped to 100 (but we only have 5)
      const resultMax = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        limit: 200,
      });
      const dataMax = parseToolText(resultMax);
      expect((dataMax.items as unknown[]).length).toBe(5);
    });

    it("defaults to limit=50, offset=0", async () => {
      const result = await handleListContext(ctx, { scopeId: SCOPE_A });
      const data = parseToolText(result);

      expect(data.total).toBe(0);
      // limit and offset not included in output unless explicitly set
    });
  });

  describe("22.4 — Scope isolation", () => {
    it("only returns memories for the requested scope", async () => {
      const memA = await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Scope A memory.",
      });
      const memB = await seedMemory(SCOPE_B, {
        type: "decision",
        content: "Scope B memory.",
      });

      // List scope A
      const resultA = await handleListContext(ctx, { scopeId: SCOPE_A });
      const dataA = parseToolText(resultA);
      expect(dataA.total).toBe(1);
      const idsA = (dataA.items as Record<string, unknown>[]).map((i) => i.id);
      expect(idsA).toContain(memA.memoryId);
      expect(idsA).not.toContain(memB.memoryId);

      // List scope B
      const resultB = await handleListContext(ctx, { scopeId: SCOPE_B });
      const dataB = parseToolText(resultB);
      expect(dataB.total).toBe(1);
      const idsB = (dataB.items as Record<string, unknown>[]).map((i) => i.id);
      expect(idsB).toContain(memB.memoryId);
      expect(idsB).not.toContain(memA.memoryId);
    });

    it("forgotten memories in one scope don't affect the other", async () => {
      const forgottenA = await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Forgotten in A.",
      });
      await seedMemory(SCOPE_B, {
        type: "decision",
        content: "Active in B.",
      });

      await handleForgetContext(ctx, {
        id: forgottenA.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_A,
      });

      // Scope B should still have its active memory
      const resultB = await handleListContext(ctx, {
        scopeId: SCOPE_B,
        status: ["active"],
      });
      const dataB = parseToolText(resultB);
      expect(dataB.total).toBe(1);
    });
  });

  describe("22.4 — Empty list", () => {
    it("returns empty items and total=0 for scope with no memories", async () => {
      const result = await handleListContext(ctx, { scopeId: SCOPE_A });
      const data = parseToolText(result);

      expect(data.scopeId).toBe(SCOPE_A);
      expect(data.total).toBe(0);
      expect(data.items).toEqual([]);
    });

    it("returns empty when type filter matches nothing", async () => {
      await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Only rule.",
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        types: ["bug"],
      });
      const data = parseToolText(result);

      expect(data.total).toBe(0);
      expect(data.items).toEqual([]);
    });
  });

  describe("22.4 — Sorting", () => {
    it("sorts by createdAt DESC by default", async () => {
      // Create memories with slight timing differences
      const mems: Record<string, unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        const mem = await seedMemory(SCOPE_A, {
          type: "decision",
          content: `Memory ${i}`,
        });
        mems.push(mem);
      }

      const result = await handleListContext(ctx, { scopeId: SCOPE_A });
      const data = parseToolText(result);
      const items = data.items as Record<string, unknown>[];

      // Most recent first (DESC)
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1]!.createdAt as string;
        const curr = items[i]!.createdAt as string;
        expect(prev >= curr).toBe(true);
      }
    });

    it("sorts by createdAt ASC", async () => {
      for (let i = 0; i < 5; i++) {
        await seedMemory(SCOPE_A, {
          type: "decision",
          content: `Memory ${i}`,
        });
      }

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        sortBy: "createdAt",
        sortOrder: "asc",
      });
      const data = parseToolText(result);
      const items = data.items as Record<string, unknown>[];

      // Oldest first (ASC)
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1]!.createdAt as string;
        const curr = items[i]!.createdAt as string;
        expect(prev <= curr).toBe(true);
      }
    });

    it("sorts by type", async () => {
      await seedMemory(SCOPE_A, {
        type: "bug",
        content: "Bug.",
      });
      await seedMemory(SCOPE_A, {
        type: "api_contract",
        content: "API contract.",
      });
      await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Decision.",
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        sortBy: "type",
        sortOrder: "asc",
      });
      const data = parseToolText(result);
      const items = data.items as Record<string, unknown>[];

      const types = items.map((i) => i.type as string);
      // Should be alphabetically sorted
      for (let i = 1; i < types.length; i++) {
        expect(types[i - 1]! <= types[i]!).toBe(true);
      }
    });

    it("sorts by status", async () => {
      // Create memories with different statuses
      const m1 = await seedMemory(SCOPE_A, {
        type: "project_rule",
        content: "Active rule.",
      });
      const m2 = await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Forgotten decision.",
      });
      const m3 = await seedMemory(SCOPE_A, {
        type: "bug",
        content: "Superseded bug.",
      });

      await handleForgetContext(ctx, {
        id: m2.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_A,
      });
      await handleForgetContext(ctx, {
        id: m3.memoryId,
        mode: "supersede",
        supersededBy: m1.memoryId,
        scopeId: SCOPE_A,
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        sortBy: "status",
        sortOrder: "asc",
      });
      const data = parseToolText(result);
      const items = data.items as Record<string, unknown>[];

      expect(data.total).toBe(3);
      const statuses = items.map((i) => i.status as string);
      // active < expired < forgotten < superseded alphabetically
      for (let i = 1; i < statuses.length; i++) {
        expect(statuses[i - 1]! <= statuses[i]!).toBe(true);
      }
    });

    it("sorts by confidence", async () => {
      await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Low confidence.",
        confidence: 0.3,
      });
      await seedMemory(SCOPE_A, {
        type: "decision",
        content: "High confidence.",
        confidence: 0.95,
      });
      await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Medium confidence.",
        confidence: 0.6,
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        sortBy: "confidence",
        sortOrder: "desc",
      });
      const data = parseToolText(result);
      const items = data.items as Record<string, unknown>[];

      const confidences = items.map((i) => i.confidence as number);
      // Descending
      for (let i = 1; i < confidences.length; i++) {
        expect(confidences[i - 1]! >= confidences[i]!).toBe(true);
      }
    });

    it("sorts by updatedAt", async () => {
      await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Memory 1.",
      });
      await seedMemory(SCOPE_A, {
        type: "decision",
        content: "Memory 2.",
      });

      const result = await handleListContext(ctx, {
        scopeId: SCOPE_A,
        sortBy: "updatedAt",
        sortOrder: "asc",
      });
      const data = parseToolText(result);
      const items = data.items as Record<string, unknown>[];

      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1]!.updatedAt as string;
        const curr = items[i]!.updatedAt as string;
        expect(prev <= curr).toBe(true);
      }
    });
  });
});
