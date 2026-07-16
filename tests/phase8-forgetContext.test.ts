/**
 * Phase 8 Integration Tests — forgetContext Tool Handler (PRD §21)
 *
 * Covers the complete forget_context MCP tool and recall behavior:
 *   21.2.1 — soft_forget mode
 *   21.2.2 — supersede mode
 *   21.2.3 — expire mode
 *   21.2.4 — hard_delete mode
 *   21.2.5 — Input validation (missing id, invalid mode, supersede without supersededBy)
 *   21.2.6 — Forget receipt generation
 *   21.3.1 — Recall default exclusion (inactive memories not in results)
 *   21.3.2 — Recall includeInactive flag includes all statuses
 *   21.3.3 — list_context visibility (inactive memories visible in list)
 *   21.4 — Cross-scope isolation for forget
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt, queryAll } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { handleForgetContext } from "../src/mcp/tools/forgetContext.js";
import { handleRememberContext } from "../src/mcp/tools/rememberContext.js";
import { handleRecallContext } from "../src/mcp/tools/recallContext.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../src/mcp/server.js";

let db: Database;
let ctx: ServerContext;

const SCOPE_ID = "repo_forget_test";
const SCOPE_B = "repo_forget_test_b";

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
    content: "Default seed content for forget test.",
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

describe("forget_context Tool Handler", () => {
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
    db.exec("DELETE FROM profile_facts");
    db.exec("DELETE FROM receipts");
    db.exec("DELETE FROM memories");
    // Re-create scope records
    ensureScope();
    ensureScope(SCOPE_B);
  });

  // ==========================================================================
  // 21.2.1 — soft_forget
  // ==========================================================================

  describe("21.2.1 — soft_forget mode", () => {
    it("transitions an active memory to forgotten", async () => {
      const mem = await seedMemory({
        type: "project_rule",
        content: "Old project rule that should be forgotten.",
      });

      const result = await handleForgetContext(ctx, {
        id: mem.memoryId,
        mode: "soft_forget",
        reason: "No longer relevant — project migrated.",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.memoryId).toBe(mem.memoryId);
      expect(data.previousStatus).toBe("active");
      expect(data.newStatus).toBe("forgotten");
      expect(data.receiptId).toMatch(/^rcp_/);
      expect(data.reason).toBe("No longer relevant — project migrated.");
    });

    it("creates an audit receipt with reason", async () => {
      const mem = await seedMemory({
        content: "Rule to be forgotten with reason.",
      });

      await handleForgetContext(ctx, {
        id: mem.memoryId,
        mode: "soft_forget",
        reason: "Outdated policy",
        scopeId: SCOPE_ID,
      });

      // Check the receipt was created
      const receiptRows = queryAll(
        db,
        "SELECT * FROM receipts WHERE operation = 'forget' AND memory_ids LIKE ?",
        [`%${mem.memoryId}%`],
      );
      expect(receiptRows.length).toBeGreaterThanOrEqual(1);
      expect(receiptRows[0]!["error_reason"]).toBe("Outdated policy");
    });
  });

  // ==========================================================================
  // 21.2.2 — supersede mode
  // ==========================================================================

  describe("21.2.2 — supersede mode", () => {
    it("transitions an active memory to superseded with supersededBy", async () => {
      const oldMem = await seedMemory({
        content: "Old rule — use npm.",
        type: "project_rule",
      });
      const newMem = await seedMemory({
        content: "New rule — use pnpm.",
        type: "project_rule",
      });

      const result = await handleForgetContext(ctx, {
        id: oldMem.memoryId,
        mode: "supersede",
        supersededBy: newMem.memoryId,
        reason: "Migrated from npm to pnpm.",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.memoryId).toBe(oldMem.memoryId);
      expect(data.previousStatus).toBe("active");
      expect(data.newStatus).toBe("superseded");
      expect(data.supersededBy).toBe(newMem.memoryId);
      expect(data.receiptId).toMatch(/^rcp_/);
    });

    it("excludes superseded memory from default recall, keeps replacement active", async () => {
      const oldMem = await seedMemory({
        content: "Old dependency policy.",
        type: "dependency",
      });
      const newMem = await seedMemory({
        content: "New dependency policy.",
        type: "dependency",
      });

      await handleForgetContext(ctx, {
        id: oldMem.memoryId,
        mode: "supersede",
        supersededBy: newMem.memoryId,
        scopeId: SCOPE_ID,
      });

      // Verify recall: old (superseded) excluded, new (active) included.
      // (supersedes field population is tested at the service layer in memory.test.ts)
      const recallResult = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "dependency policy",
        includeInactive: false,
      });

      const recallData = parseToolText(recallResult);
      // The new memory should be returned (active)
      const newMemInResults = (recallData.memories as Record<string, unknown>[])
        .find((m) => m.id === newMem.memoryId);
      expect(newMemInResults).toBeDefined();

      // The old memory should NOT be in results (superseded, excluded by default)
      const oldMemInResults = (recallData.memories as Record<string, unknown>[])
        .find((m) => m.id === oldMem.memoryId);
      expect(oldMemInResults).toBeUndefined();
    });

    it("rejects supersede without supersededBy", async () => {
      const mem = await seedMemory({ content: "Some memory." });

      const result = await handleForgetContext(ctx, {
        id: mem.memoryId,
        mode: "supersede",
        scopeId: SCOPE_ID,
        // No supersededBy
      });

      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("supersededBy is required");
    });
  });

  // ==========================================================================
  // 21.2.3 — expire mode
  // ==========================================================================

  describe("21.2.3 — expire mode", () => {
    it("transitions an active memory to expired", async () => {
      const mem = await seedMemory({
        content: "Memory that is expiring.",
        type: "current_task",
      });

      const result = await handleForgetContext(ctx, {
        id: mem.memoryId,
        mode: "expire",
        reason: "Task completed.",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.memoryId).toBe(mem.memoryId);
      expect(data.previousStatus).toBe("active");
      expect(data.newStatus).toBe("expired");
      expect(data.receiptId).toMatch(/^rcp_/);
    });

    it("creates a forget receipt for expire", async () => {
      const mem = await seedMemory({ content: "Will expire." });

      await handleForgetContext(ctx, {
        id: mem.memoryId,
        mode: "expire",
        scopeId: SCOPE_ID,
      });

      const receiptRows = queryAll(
        db,
        "SELECT * FROM receipts WHERE operation = 'forget'",
      );
      expect(receiptRows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // 21.2.4 — hard_delete mode
  // ==========================================================================

  describe("21.2.4 — hard_delete mode", () => {
    it("permanently removes the memory record", async () => {
      const mem = await seedMemory({
        content: "Memory to be permanently deleted.",
        type: "bug",
      });

      const result = await handleForgetContext(ctx, {
        id: mem.memoryId,
        mode: "hard_delete",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.memoryId).toBe(mem.memoryId);
      expect(data.previousStatus).toBe("active");
      expect(data.action).toBe("hard_deleted");
      expect(data.deleted).toBe(true);
      expect(data.profileFactsDeleted).toBe(0);
      expect(data).not.toHaveProperty("newStatus");
      expect(data.receiptId).toMatch(/^rcp_/);

      // Verify memory is gone — recall should not find it
      const recallResult = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "permanently deleted",
        includeInactive: true,
      });
      const recallData = parseToolText(recallResult);
      expect((recallData.memories as unknown[]).length).toBe(0);
    });

    it("also removes associated profile facts", async () => {
      const mem = await seedMemory({
        content: "Important rule for profile.",
        type: "project_rule",
        profileTarget: "static",
      });

      // Verify profile fact was created
      const pfBefore = queryAll(
        db,
        "SELECT * FROM profile_facts WHERE source_memory_id = ?",
        [mem.memoryId],
      );
      expect(pfBefore.length).toBeGreaterThanOrEqual(1);

      // Hard delete
      const result = await handleForgetContext(ctx, {
        id: mem.memoryId,
        mode: "hard_delete",
        scopeId: SCOPE_ID,
      });
      const data = parseToolText(result);
      expect(data.profileFactsDeleted).toBe(pfBefore.length);

      // Profile fact should be gone
      const pfAfter = queryAll(
        db,
        "SELECT * FROM profile_facts WHERE source_memory_id = ?",
        [mem.memoryId],
      );
      expect(pfAfter.length).toBe(0);
    });

    it("rolls back memory, FTS, profile facts, and receipt when a delete step fails", async () => {
      const mem = await seedMemory({
        content: "Atomic hard-delete rollback sentinel.",
        type: "project_rule",
        profileTarget: "static",
      });
      const memoryId = mem.memoryId as string;
      const hasFts = queryAll(
        db,
        "SELECT name FROM sqlite_master WHERE name = 'memories_fts'",
      ).length > 0;
      const ftsBefore = hasFts
        ? queryAll(db, "SELECT * FROM memories_fts WHERE id = ?", [memoryId]).length
        : 0;

      runStmt(
        db,
        `CREATE TRIGGER fail_memory_hard_delete
         BEFORE DELETE ON memories
         WHEN OLD.id = '${memoryId}'
         BEGIN SELECT RAISE(ABORT, 'forced hard-delete failure'); END`,
      );

      const result = await handleForgetContext(ctx, {
        id: memoryId,
        mode: "hard_delete",
        scopeId: SCOPE_ID,
      });
      runStmt(db, "DROP TRIGGER fail_memory_hard_delete");

      expect(isError(result)).toBe(true);
      expect(queryAll(db, "SELECT * FROM memories WHERE id = ?", [memoryId])).toHaveLength(1);
      expect(queryAll(db, "SELECT * FROM profile_facts WHERE source_memory_id = ?", [memoryId])).toHaveLength(1);
      if (hasFts) {
        expect(queryAll(db, "SELECT * FROM memories_fts WHERE id = ?", [memoryId])).toHaveLength(ftsBefore);
      }
      expect(queryAll(
        db,
        "SELECT * FROM receipts WHERE operation = 'forget' AND memory_ids LIKE ?",
        [`%${memoryId}%`],
      )).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 21.2.5 — Input validation
  // ==========================================================================

  describe("21.2.5 — Input validation", () => {
    it("rejects missing id", async () => {
      const result = await handleForgetContext(ctx, {
        mode: "soft_forget",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text).toContain("id is required");
    });

    it("rejects missing mode", async () => {
      const result = await handleForgetContext(ctx, {
        id: "mem_123",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text).toContain("mode is required");
    });

    it("rejects invalid mode", async () => {
      const result = await handleForgetContext(ctx, {
        id: "mem_123",
        mode: "invalid_mode",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text).toContain("Invalid mode");
    });

    it("rejects non-existent memory id", async () => {
      const result = await handleForgetContext(ctx, {
        id: "mem_nonexistent_12345",
        mode: "soft_forget",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text).toContain("not found");
    });

    it("rejects wrong scope for memory", async () => {
      const mem = await seedMemory({ scopeId: SCOPE_ID, content: "Test." });

      const result = await handleForgetContext(ctx, {
        id: mem.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_B,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text).toContain("not found");
    });
  });

  // ==========================================================================
  // 21.3.1 — Recall default exclusion
  // ==========================================================================

  describe("21.3.1 — Recall default exclusion of inactive memories", () => {
    it("excludes forgotten memories from default recall", async () => {
      // Create one active and one forgotten memory
      await seedMemory({
        content: "Active memory about React patterns.",
        type: "project_rule",
      });
      const forgottenMem = await seedMemory({
        content: "Forgotten memory about old patterns.",
        type: "project_rule",
      });

      await handleForgetContext(ctx, {
        id: forgottenMem.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_ID,
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "patterns",
      });

      const data = parseToolText(result);
      const ids = (data.memories as Record<string, unknown>[]).map((m) => m.id);

      // Should include the active memory
      expect(ids.length).toBe(1);
      // Should NOT include the forgotten memory
      expect(ids).not.toContain(forgottenMem.memoryId);
    });

    it("excludes superseded memories from default recall", async () => {
      const oldMem = await seedMemory({
        content: "Old API contract v1.",
        type: "api_contract",
      });
      const newMem = await seedMemory({
        content: "New API contract v2.",
        type: "api_contract",
      });

      await handleForgetContext(ctx, {
        id: oldMem.memoryId,
        mode: "supersede",
        supersededBy: newMem.memoryId,
        scopeId: SCOPE_ID,
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "API contract",
      });

      const data = parseToolText(result);
      const ids = (data.memories as Record<string, unknown>[]).map((m) => m.id);

      // Should include the new (active) memory
      expect(ids).toContain(newMem.memoryId);
      // Should NOT include the old (superseded) memory
      expect(ids).not.toContain(oldMem.memoryId);
    });

    it("excludes expired memories from default recall", async () => {
      const expiredMem = await seedMemory({
        content: "Expired task about fixing login.",
        type: "current_task",
      });
      await seedMemory({
        content: "Active task about dashboard.",
        type: "current_task",
      });

      await handleForgetContext(ctx, {
        id: expiredMem.memoryId,
        mode: "expire",
        scopeId: SCOPE_ID,
      });

      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "task",
      });

      const data = parseToolText(result);
      const ids = (data.memories as Record<string, unknown>[]).map((m) => m.id);

      expect(ids.length).toBe(1);
      expect(ids).not.toContain(expiredMem.memoryId);
    });
  });

  // ==========================================================================
  // 21.3.2 — Recall includeInactive flag
  // ==========================================================================

  describe("21.3.2 — Recall includeInactive flag", () => {
    it("includes all statuses when includeInactive is true", async () => {
      const activeMem = await seedMemory({
        content: "Active project rule.",
        type: "project_rule",
      });
      const forgottenMem = await seedMemory({
        content: "Forgotten decision.",
        type: "decision",
      });
      const supersededMem = await seedMemory({
        content: "Superseded rule.",
        type: "project_rule",
      });
      const expiredMem = await seedMemory({
        content: "Expired task.",
        type: "current_task",
      });

      // Set different statuses
      await handleForgetContext(ctx, {
        id: forgottenMem.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_ID,
      });
      await handleForgetContext(ctx, {
        id: supersededMem.memoryId,
        mode: "supersede",
        supersededBy: activeMem.memoryId,
        scopeId: SCOPE_ID,
      });
      await handleForgetContext(ctx, {
        id: expiredMem.memoryId,
        mode: "expire",
        scopeId: SCOPE_ID,
      });

      // Search with includeInactive=true
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "rule decision task",
        includeInactive: true,
      });

      const data = parseToolText(result);
      const ids = (data.memories as Record<string, unknown>[]).map((m) => m.id);

      // All four memories should appear
      expect(ids).toContain(activeMem.memoryId);
      expect(ids).toContain(forgottenMem.memoryId);
      expect(ids).toContain(supersededMem.memoryId);
      expect(ids).toContain(expiredMem.memoryId);
    });

    it("includeInactive=false is the default behavior", async () => {
      const forgottenMem = await seedMemory({
        content: "Forgotten bug about login crash.",
        type: "bug",
      });

      await handleForgetContext(ctx, {
        id: forgottenMem.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_ID,
      });

      // Default recall (no includeInactive flag)
      const result = await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: "login crash",
      });

      const data = parseToolText(result);
      const mems = data.memories as unknown[];
      // Should be empty (the only matching memory is forgotten)
      expect(mems.length).toBe(0);
    });
  });

  // ==========================================================================
  // 21.3.3 — list_context visibility
  // ==========================================================================

  describe("21.3.3 — list_context visibility", () => {
    it("list by default shows all statuses (active + inactive)", async () => {
      const activeMem = await seedMemory({
        content: "Active memory visible in list.",
        type: "project_rule",
      });
      const forgottenMem = await seedMemory({
        content: "Forgotten memory still visible in list.",
        type: "decision",
      });

      await handleForgetContext(ctx, {
        id: forgottenMem.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_ID,
      });

      // Use the MemoryService list() directly via the DB
      const { MemoryService } = await import(
        "../src/memory/memoryService.js"
      );
      const service = new MemoryService(db);
      const listResult = service.list({ scopeId: SCOPE_ID });

      const ids = listResult.items.map((i) => i.id);
      expect(ids).toContain(activeMem.memoryId);
      expect(ids).toContain(forgottenMem.memoryId);
      expect(listResult.total).toBe(2);
    });

    it("list can filter to show only active memories", async () => {
      await seedMemory({
        content: "Active memory 1.",
        type: "project_rule",
      });
      const forgottenMem = await seedMemory({
        content: "Forgotten memory.",
        type: "decision",
      });

      await handleForgetContext(ctx, {
        id: forgottenMem.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_ID,
      });

      const { MemoryService } = await import(
        "../src/memory/memoryService.js"
      );
      const service = new MemoryService(db);
      const listResult = service.list({
        scopeId: SCOPE_ID,
        status: ["active"],
      });

      expect(listResult.total).toBe(1);
      expect(listResult.items[0]!.status).toBe("active");
    });

    it("list can filter to show only forgotten memories", async () => {
      await seedMemory({ content: "Active.", type: "project_rule" });
      const forgottenMem = await seedMemory({
        content: "Forgotten.",
        type: "decision",
      });

      await handleForgetContext(ctx, {
        id: forgottenMem.memoryId,
        mode: "soft_forget",
        scopeId: SCOPE_ID,
      });

      const { MemoryService } = await import(
        "../src/memory/memoryService.js"
      );
      const service = new MemoryService(db);
      const listResult = service.list({
        scopeId: SCOPE_ID,
        status: ["forgotten"],
      });

      expect(listResult.total).toBe(1);
      expect(listResult.items[0]!.status).toBe("forgotten");
    });
  });

  // ==========================================================================
  // 21.2.6 — Forget receipt generation
  // ==========================================================================

  describe("21.2.6 — Forget receipt generation", () => {
    it("creates receipt with correct operation type", async () => {
      const mem = await seedMemory({ content: "Receipt test." });

      const result = await handleForgetContext(ctx, {
        id: mem.memoryId,
        mode: "soft_forget",
        reason: "Testing receipt",
        scopeId: SCOPE_ID,
      });

      const data = parseToolText(result);
      const receiptId = data.receiptId as string;

      // Verify receipt exists in DB
      const receiptService = new ReceiptService(db);
      const receipt = receiptService.get(receiptId);
      expect(receipt).not.toBeNull();
      expect(receipt!.operation).toBe("forget");
      expect(receipt!.scopeId).toBe(SCOPE_ID);
      expect(receipt!.memoryIds).toContain(mem.memoryId);
      expect(receipt!.errorReason).toBe("Testing receipt");
    });

    it("creates receipt for each forget mode", async () => {
      const modes = ["soft_forget", "supersede", "expire", "hard_delete"] as const;
      const receiptIds: string[] = [];

      for (const mode of modes) {
        // For supersede, create two memories
        if (mode === "supersede") {
          const oldMem = await seedMemory({
            content: `Test ${mode} old.`,
          });
          const newMem = await seedMemory({
            content: `Test ${mode} new.`,
          });
          const result = await handleForgetContext(ctx, {
            id: oldMem.memoryId,
            mode,
            supersededBy: newMem.memoryId,
            scopeId: SCOPE_ID,
          });
          receiptIds.push(parseToolText(result).receiptId as string);
        } else {
          const mem = await seedMemory({
            content: `Test ${mode}.`,
          });
          const result = await handleForgetContext(ctx, {
            id: mem.memoryId,
            mode,
            scopeId: SCOPE_ID,
          });
          receiptIds.push(parseToolText(result).receiptId as string);
        }
      }

      // All 4 receipts should exist
      const receiptService = new ReceiptService(db);
      for (const rid of receiptIds) {
        expect(receiptService.get(rid)).not.toBeNull();
      }

      // Verify distinct receipts
      const uniqueIds = new Set(receiptIds);
      expect(uniqueIds.size).toBe(4);
    });
  });
});
