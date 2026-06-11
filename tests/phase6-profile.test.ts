/**
 * Phase 6 Integration Tests — Repo Profile Service (PRD §19)
 *
 * Covers:
 *   19.4.1 — Write static fact
 *   19.4.2 — Write dynamic context
 *   19.4.3 — Recall merge profile
 *   19.4.4 — Expire profile fact
 *   19.4.5 — sourceMemoryId association
 *
 * Also covers:
 *   - Static fact associations: project_rule, decision, dependency, api_contract
 *   - Dynamic context associations: current_task, test_failure, bug, command
 *   - Layer isolation (static vs dynamic)
 *   - Scope isolation
 *   - Receipt generation
 *   - Update operations
 *   - Active-only filtering
 *   - Cross-update guarding
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt, queryOne, queryAll } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { ProfileService } from "../src/profile/profileService.js";
import type { Database } from "sql.js";

let db: Database;
let profile: ProfileService;
let receipts: ReceiptService;

const SCOPE_ID = "repo_profile_test";

function ensureScope(scopeId?: string) {
  const id = scopeId ?? SCOPE_ID;
  runStmt(
    db,
    `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
     VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`,
    [id, process.cwd()],
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("Profile Service", () => {
  beforeAll(async () => {
    await initAndMigrate(":memory:");
    db = getDb();
    receipts = new ReceiptService(db);
    profile = new ProfileService(db, { receipts });
    ensureScope();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clean up in FK-safe order
    db.exec("DELETE FROM profile_facts");
    db.exec("DELETE FROM receipts");
    db.exec("DELETE FROM memories");
  });

  // ==========================================================================
  // 19.4.1 — Write static fact
  // ==========================================================================

  describe("19.4.1 — Write static fact", () => {
    it("creates a static profile fact and returns it with a receipt", () => {
      const result = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "This project uses TypeScript with strict mode enabled.",
        sourceRef: "tsconfig.json",
        confidence: 0.95,
      });

      expect(result.fact).toBeDefined();
      expect(result.fact.id).toMatch(/^pf_/);
      expect(result.fact.scopeId).toBe(SCOPE_ID);
      expect(result.fact.layer).toBe("static");
      expect(result.fact.content).toContain("TypeScript");
      expect(result.fact.sourceRef).toBe("tsconfig.json");
      expect(result.fact.confidence).toBe(0.95);
      expect(result.fact.createdAt).toBeDefined();
      expect(result.receiptId).toMatch(/^rcp_/);
    });

    it("persists the fact to the profile_facts table", () => {
      const result = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "All API endpoints use prefix /api/v1.",
        sourceRef: "src/server.ts",
      });

      const row = queryOne(
        db,
        "SELECT * FROM profile_facts WHERE id = ?",
        [result.fact.id],
      );
      expect(row).not.toBeNull();
      expect(row!["layer"]).toBe("static");
      expect(row!["content"]).toContain("/api/v1");
      expect(row!["scope_id"]).toBe(SCOPE_ID);
      expect(row!["confidence"]).toBe(0.8); // default
    });

    it("associates with project_rule memory via sourceMemoryId", () => {
      // First create a memory
      const now = new Date().toISOString();
      const memId = "mem_test_rule_001";
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'project_rule', 'Use pnpm as package manager', 0.9, 'active', ?, ?)`,
        [memId, SCOPE_ID, now, now],
      );

      const result = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Use pnpm as package manager",
        sourceMemoryId: memId,
      });

      expect(result.fact.sourceMemoryId).toBe(memId);

      // Verify in DB
      const row = queryOne(
        db,
        "SELECT source_memory_id FROM profile_facts WHERE id = ?",
        [result.fact.id],
      );
      expect(row!["source_memory_id"]).toBe(memId);
    });

    it("associates with decision memory", () => {
      const now = new Date().toISOString();
      const memId = "mem_test_decision_001";
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'decision', 'Adopt Vitest for testing', 0.85, 'active', ?, ?)`,
        [memId, SCOPE_ID, now, now],
      );

      const result = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Adopt Vitest for testing",
        sourceMemoryId: memId,
        sourceRef: "docs/decisions.md",
      });

      expect(result.fact.layer).toBe("static");
      expect(result.fact.sourceMemoryId).toBe(memId);
    });

    it("associates with dependency memory", () => {
      const now = new Date().toISOString();
      const memId = "mem_test_dep_001";
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'dependency', 'React 18.3 with TypeScript types', 0.9, 'active', ?, ?)`,
        [memId, SCOPE_ID, now, now],
      );

      const result = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "React 18.3 with TypeScript types",
        sourceMemoryId: memId,
      });

      expect(result.fact.layer).toBe("static");
      expect(result.fact.sourceMemoryId).toBe(memId);
    });

    it("associates with api_contract memory", () => {
      const now = new Date().toISOString();
      const memId = "mem_test_api_001";
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'api_contract', 'POST /auth/login returns JWT token', 1.0, 'active', ?, ?)`,
        [memId, SCOPE_ID, now, now],
      );

      const result = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "POST /auth/login returns JWT token",
        sourceMemoryId: memId,
      });

      expect(result.fact.layer).toBe("static");
      expect(result.fact.sourceMemoryId).toBe(memId);
    });

    it("generates unique IDs for each fact", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const result = profile.writeStaticFact({
          scopeId: SCOPE_ID,
          content: `Static fact ${i}`,
        });
        ids.add(result.fact.id);
      }
      expect(ids.size).toBe(10);
    });

    it("generates a receipt for each write", () => {
      const result = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Static fact with receipt check.",
      });

      const receipt = receipts.get(result.receiptId);
      expect(receipt).not.toBeNull();
      expect(receipt!.operation).toBe("remember");
      expect(receipt!.scopeId).toBe(SCOPE_ID);
    });
  });

  // ==========================================================================
  // 19.4.2 — Write dynamic context
  // ==========================================================================

  describe("19.4.2 — Write dynamic context", () => {
    it("creates a dynamic profile fact and returns it with a receipt", () => {
      const result = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Currently fixing authentication bug in login flow.",
        sourceRef: "src/auth/login.ts",
        confidence: 0.7,
      });

      expect(result.fact).toBeDefined();
      expect(result.fact.id).toMatch(/^pf_/);
      expect(result.fact.scopeId).toBe(SCOPE_ID);
      expect(result.fact.layer).toBe("dynamic");
      expect(result.fact.content).toContain("authentication bug");
      expect(result.fact.confidence).toBe(0.7);
      expect(result.fact.createdAt).toBeDefined();
      expect(result.receiptId).toMatch(/^rcp_/);
    });

    it("persists the fact to the profile_facts table", () => {
      const result = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Test failure in auth/session.test.ts: logout cookie test.",
      });

      const row = queryOne(
        db,
        "SELECT * FROM profile_facts WHERE id = ?",
        [result.fact.id],
      );
      expect(row).not.toBeNull();
      expect(row!["layer"]).toBe("dynamic");
      expect(row!["content"]).toContain("Test failure");
      expect(row!["scope_id"]).toBe(SCOPE_ID);
    });

    it("associates with current_task memory", () => {
      const now = new Date().toISOString();
      const memId = "mem_test_task_001";
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'current_task', 'Refactoring auth middleware', 0.8, 'active', ?, ?)`,
        [memId, SCOPE_ID, now, now],
      );

      const result = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Refactoring auth middleware",
        sourceMemoryId: memId,
      });

      expect(result.fact.layer).toBe("dynamic");
      expect(result.fact.sourceMemoryId).toBe(memId);
    });

    it("associates with test_failure memory", () => {
      const now = new Date().toISOString();
      const memId = "mem_test_fail_001";
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'test_failure', 'Login test fails on empty password', 0.9, 'active', ?, ?)`,
        [memId, SCOPE_ID, now, now],
      );

      const result = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Login test fails on empty password",
        sourceMemoryId: memId,
      });

      expect(result.fact.layer).toBe("dynamic");
      expect(result.fact.sourceMemoryId).toBe(memId);
    });

    it("associates with bug memory", () => {
      const now = new Date().toISOString();
      const memId = "mem_test_bug_001";
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'bug', 'Memory leak in WebSocket handler', 0.75, 'active', ?, ?)`,
        [memId, SCOPE_ID, now, now],
      );

      const result = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Memory leak in WebSocket handler",
        sourceMemoryId: memId,
      });

      expect(result.fact.layer).toBe("dynamic");
      expect(result.fact.sourceMemoryId).toBe(memId);
    });

    it("associates with command memory", () => {
      const now = new Date().toISOString();
      const memId = "mem_test_cmd_001";
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'command', 'npm run build failed with TS errors', 0.6, 'active', ?, ?)`,
        [memId, SCOPE_ID, now, now],
      );

      const result = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "npm run build failed with TS errors",
        sourceMemoryId: memId,
      });

      expect(result.fact.layer).toBe("dynamic");
      expect(result.fact.sourceMemoryId).toBe(memId);
    });

    it("generates unique receiptIds for dynamic writes", () => {
      const r1 = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Dynamic context A",
      });
      const r2 = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Dynamic context B",
      });

      expect(r1.receiptId).not.toBe(r2.receiptId);
    });
  });

  // ==========================================================================
  // 19.4.3 — Recall merge profile
  // ==========================================================================

  describe("19.4.3 — Recall merge profile", () => {
    it("returns both static and dynamic facts from getProfile", () => {
      // Write static facts
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Project uses React 18 with TypeScript.",
      });
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "All components must use functional style.",
      });

      // Write dynamic facts
      profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Working on profile service implementation.",
      });
      profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Test failure in auth module.",
      });

      const result = profile.getProfile(SCOPE_ID);

      expect(result.staticFacts).toHaveLength(2);
      expect(result.dynamicContext).toHaveLength(2);

      // Verify layer separation
      result.staticFacts.forEach((f) => expect(f.layer).toBe("static"));
      result.dynamicContext.forEach((f) => expect(f.layer).toBe("dynamic"));
    });

    it("returns empty profile when no facts exist", () => {
      const result = profile.getProfile(SCOPE_ID);
      expect(result.scopeId).toBe(SCOPE_ID);
      expect(result.staticFacts).toHaveLength(0);
      expect(result.dynamicContext).toHaveLength(0);
      expect(result.updatedAt).toBeDefined();
    });

    it("returns profile facts sorted by created_at DESC", async () => {
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "First static fact.",
      });
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Second static fact.",
      });

      const result = profile.getProfile(SCOPE_ID);
      expect(result.staticFacts).toHaveLength(2);
      // Most recent first (second fact has later timestamp)
      expect(result.staticFacts[0]!.content).toBe("Second static fact.");
      expect(result.staticFacts[1]!.content).toBe("First static fact.");
    });

    it("getProfile returns only active (non-expired) facts by default", () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday

      // Write an expired fact
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Expired static fact.",
        expiresAt: pastDate,
      });

      // Write an active fact
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Active static fact.",
      });

      const result = profile.getProfile(SCOPE_ID);
      expect(result.staticFacts).toHaveLength(1);
      expect(result.staticFacts[0]!.content).toBe("Active static fact.");
    });

    it("getProfile with activeOnly=false returns all facts including expired", () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();

      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Expired fact.",
        expiresAt: pastDate,
      });
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Active fact.",
      });

      const result = profile.getProfile(SCOPE_ID, { activeOnly: false });
      expect(result.staticFacts).toHaveLength(2);
    });

    it("getProfile scope isolation — returns empty for different scope", () => {
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Fact in test scope.",
      });

      const result = profile.getProfile("different_scope");
      expect(result.scopeId).toBe("different_scope");
      expect(result.staticFacts).toHaveLength(0);
      expect(result.dynamicContext).toHaveLength(0);
    });

    it("getProfile fail-open returns empty profile with scopeId on missing scope", () => {
      const result = profile.getProfile("non_existent_scope");
      expect(result.scopeId).toBe("non_existent_scope");
      expect(result.staticFacts).toEqual([]);
      expect(result.dynamicContext).toEqual([]);
      expect(result.updatedAt).toBeDefined();
    });

    it("getProfile includes updatedAt from the most recent fact", () => {
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "A fact.",
      });

      const result = profile.getProfile(SCOPE_ID);
      expect(result.updatedAt).toBeDefined();
      // updatedAt should be a valid ISO date
      expect(new Date(result.updatedAt).getTime()).not.toBeNaN();
    });

    it("merged profile preserves sourceMemoryId links", () => {
      const now = new Date().toISOString();
      const memId = "mem_profile_link_001";
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'project_rule', 'Use ESLint flat config', 0.9, 'active', ?, ?)`,
        [memId, SCOPE_ID, now, now],
      );

      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Use ESLint flat config",
        sourceMemoryId: memId,
      });

      const result = profile.getProfile(SCOPE_ID);
      expect(result.staticFacts).toHaveLength(1);
      expect(result.staticFacts[0]!.sourceMemoryId).toBe(memId);
    });
  });

  // ==========================================================================
  // 19.4.4 — Expire profile fact
  // ==========================================================================

  describe("19.4.4 — Expire profile fact", () => {
    it("expires a static fact by setting expiresAt", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Temporary static rule.",
      });

      expect(fact.expiresAt).toBeUndefined();

      const expired = profile.expireStaticFact(fact.id, SCOPE_ID);
      expect(expired).not.toBeNull();
      expect(expired!.fact.expiresAt).toBeDefined();
      // After expiration, the fact should not appear in active queries
      expect(new Date(expired!.fact.expiresAt!).getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
    });

    it("expired static fact is excluded from getStaticFacts with activeOnly=true", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Rule that will expire.",
      });

      profile.expireStaticFact(fact.id, SCOPE_ID);

      const result = profile.getStaticFacts(SCOPE_ID, { activeOnly: true });
      expect(result.items).toHaveLength(0);
    });

    it("expired static fact appears when activeOnly=false", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Rule that will expire.",
      });

      profile.expireStaticFact(fact.id, SCOPE_ID);

      const result = profile.getStaticFacts(SCOPE_ID, { activeOnly: false });
      expect(result.items).toHaveLength(1);
    });

    it("expires a dynamic context fact", () => {
      const { fact } = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Temporary task context.",
      });

      expect(fact.expiresAt).toBeUndefined();

      const expired = profile.expireDynamicContext(fact.id, SCOPE_ID);
      expect(expired).not.toBeNull();
      expect(expired!.fact.expiresAt).toBeDefined();
      expect(new Date(expired!.fact.expiresAt!).getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
    });

    it("expired dynamic context is excluded from getDynamicContext with activeOnly=true", () => {
      const { fact } = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Context that will expire.",
      });

      profile.expireDynamicContext(fact.id, SCOPE_ID);

      const result = profile.getDynamicContext(SCOPE_ID, { activeOnly: true });
      expect(result.items).toHaveLength(0);
    });

    it("generates a receipt for expire operation", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Fact to expire with receipt.",
      });

      const expired = profile.expireStaticFact(fact.id, SCOPE_ID);
      expect(expired!.receiptId).toMatch(/^rcp_/);

      const receipt = receipts.get(expired!.receiptId);
      expect(receipt).not.toBeNull();
      expect(receipt!.operation).toBe("forget");
      expect(receipt!.scopeId).toBe(SCOPE_ID);
    });

    it("returns null when expiring non-existent fact", () => {
      const result = profile.expireStaticFact("pf_nonexistent", SCOPE_ID);
      expect(result).toBeNull();
    });

    it("throws when expiring static fact via dynamic method", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Static fact — cannot expire as dynamic.",
      });

      expect(() => {
        profile.expireDynamicContext(fact.id, SCOPE_ID);
      }).toThrow(/Cannot expire dynamic fact/);
    });

    it("throws when expiring dynamic fact via static method", () => {
      const { fact } = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Dynamic context — cannot expire as static.",
      });

      expect(() => {
        profile.expireStaticFact(fact.id, SCOPE_ID);
      }).toThrow(/Cannot expire static fact/);
    });

    it("expire with future date keeps fact visible", () => {
      const futureDate = new Date(Date.now() + 86400000 * 30).toISOString(); // 30 days from now

      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Fact expiring in the future.",
        expiresAt: futureDate,
      });

      // The fact should still be visible because expiresAt is in the future
      const result = profile.getStaticFacts(SCOPE_ID, { activeOnly: true });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe(fact.id);
    });
  });

  // ==========================================================================
  // 19.4.5 — sourceMemoryId association
  // ==========================================================================

  describe("19.4.5 — sourceMemoryId association", () => {
    it("getStaticFacts can filter by sourceMemoryId", () => {
      const now = new Date().toISOString();
      const memIdA = "mem_link_a_001";
      const memIdB = "mem_link_b_001";

      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'project_rule', 'Rule A', 0.9, 'active', ?, ?)`,
        [memIdA, SCOPE_ID, now, now],
      );
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'project_rule', 'Rule B', 0.9, 'active', ?, ?)`,
        [memIdB, SCOPE_ID, now, now],
      );

      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Rule A content",
        sourceMemoryId: memIdA,
      });
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Rule B content",
        sourceMemoryId: memIdB,
      });

      const result = profile.getStaticFacts(SCOPE_ID, {
        sourceMemoryId: memIdA,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.content).toBe("Rule A content");
      expect(result.items[0]!.sourceMemoryId).toBe(memIdA);
      expect(result.total).toBe(1);
    });

    it("getDynamicContext can filter by sourceMemoryId", () => {
      const now = new Date().toISOString();
      const memId = "mem_task_filter_001";
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'current_task', 'Task X', 0.8, 'active', ?, ?)`,
        [memId, SCOPE_ID, now, now],
      );

      profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Task X context",
        sourceMemoryId: memId,
      });
      profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Other task context",
      });

      const result = profile.getDynamicContext(SCOPE_ID, {
        sourceMemoryId: memId,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.content).toBe("Task X context");
      expect(result.items[0]!.sourceMemoryId).toBe(memId);
    });

    it("sourceMemoryId is null/undefined when not provided", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Fact without source memory.",
      });

      expect(fact.sourceMemoryId).toBeUndefined();

      const row = queryOne(
        db,
        "SELECT source_memory_id FROM profile_facts WHERE id = ?",
        [fact.id],
      );
      expect(row!["source_memory_id"]).toBeNull();
    });

    it("sourceMemoryId is preserved on update", () => {
      const now = new Date().toISOString();
      const memId = "mem_preserve_001";
      runStmt(
        db,
        `INSERT INTO memories (id, scope_id, type, content, confidence, status, created_at, updated_at)
         VALUES (?, ?, 'project_rule', 'Original rule', 0.9, 'active', ?, ?)`,
        [memId, SCOPE_ID, now, now],
      );

      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Original content",
        sourceMemoryId: memId,
      });

      const updated = profile.updateStaticFact(fact.id, SCOPE_ID, {
        content: "Updated content",
      });

      expect(updated!.fact.sourceMemoryId).toBe(memId);
      expect(updated!.fact.content).toBe("Updated content");
    });

    it("countFacts returns correct counts by layer", () => {
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Static fact 1",
      });
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Static fact 2",
      });
      profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Dynamic context 1",
      });

      expect(profile.countFacts(SCOPE_ID, { layer: "static" })).toBe(2);
      expect(profile.countFacts(SCOPE_ID, { layer: "dynamic" })).toBe(1);
      expect(profile.countFacts(SCOPE_ID)).toBe(3);
    });

    it("countFacts with activeOnly excludes expired facts", () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();

      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Active static fact.",
      });
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Expired static fact.",
        expiresAt: pastDate,
      });

      expect(
        profile.countFacts(SCOPE_ID, { layer: "static", activeOnly: true }),
      ).toBe(1);
      expect(
        profile.countFacts(SCOPE_ID, { layer: "static", activeOnly: false }),
      ).toBe(2);
    });
  });

  // ==========================================================================
  // Additional: Update operations
  // ==========================================================================

  describe("Update operations", () => {
    it("updateStaticFact updates content", async () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Original content.",
        confidence: 0.5,
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = profile.updateStaticFact(fact.id, SCOPE_ID, {
        content: "Updated content.",
        confidence: 0.9,
      });

      expect(updated).not.toBeNull();
      expect(updated!.fact.content).toBe("Updated content.");
      expect(updated!.fact.confidence).toBe(0.9);
      // updatedAt should be later than createdAt after an update
      expect(new Date(updated!.fact.updatedAt).getTime()).toBeGreaterThan(
        new Date(updated!.fact.createdAt).getTime(),
      );
    });

    it("updateStaticFact only modifies provided fields", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Original content.",
        sourceRef: "original-ref.md",
      });

      const updated = profile.updateStaticFact(fact.id, SCOPE_ID, {
        content: "Updated content.",
      });

      expect(updated!.fact.content).toBe("Updated content.");
      expect(updated!.fact.sourceRef).toBe("original-ref.md"); // unchanged
    });

    it("updateDynamicContext updates content", () => {
      const { fact } = profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Original context.",
      });

      const updated = profile.updateDynamicContext(fact.id, SCOPE_ID, {
        content: "Updated context.",
      });

      expect(updated).not.toBeNull();
      expect(updated!.fact.content).toBe("Updated context.");
    });

    it("update throws when crossing layers", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Static fact.",
      });

      expect(() => {
        profile.updateDynamicContext(fact.id, SCOPE_ID, {
          content: "Try to update as dynamic.",
        });
      }).toThrow(/Cannot update dynamic fact/);
    });

    it("update returns null for non-existent fact", () => {
      const result = profile.updateStaticFact("pf_nonexistent", SCOPE_ID, {
        content: "Nothing.",
      });
      expect(result).toBeNull();
    });

    it("update generates a receipt", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Will be updated.",
      });

      const updated = profile.updateStaticFact(fact.id, SCOPE_ID, {
        content: "Updated with receipt.",
      });

      expect(updated!.receiptId).toMatch(/^rcp_/);
      const receipt = receipts.get(updated!.receiptId);
      expect(receipt).not.toBeNull();
    });
  });

  // ==========================================================================
  // Additional: Query operations
  // ==========================================================================

  describe("Query operations", () => {
    it("getStaticFacts supports pagination with limit/offset", () => {
      for (let i = 0; i < 10; i++) {
        profile.writeStaticFact({
          scopeId: SCOPE_ID,
          content: `Static fact ${i}`,
        });
      }

      const page1 = profile.getStaticFacts(SCOPE_ID, { limit: 5, offset: 0 });
      expect(page1.items).toHaveLength(5);
      expect(page1.total).toBe(10);

      const page2 = profile.getStaticFacts(SCOPE_ID, { limit: 5, offset: 5 });
      expect(page2.items).toHaveLength(5);

      // No overlap
      const page1Ids = new Set(page1.items.map((f) => f.id));
      const page2Ids = new Set(page2.items.map((f) => f.id));
      const intersection = [...page1Ids].filter((id) => page2Ids.has(id));
      expect(intersection).toHaveLength(0);
    });

    it("getDynamicContext supports pagination", () => {
      for (let i = 0; i < 5; i++) {
        profile.writeDynamicContext({
          scopeId: SCOPE_ID,
          content: `Dynamic context ${i}`,
        });
      }

      const result = profile.getDynamicContext(SCOPE_ID, { limit: 3 });
      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(5);
    });

    it("getFact retrieves a single fact by id with scope validation", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Target fact.",
      });

      const retrieved = profile.getFact(fact.id, SCOPE_ID);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toBe("Target fact.");
    });

    it("getFact returns null for wrong scope", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Scoped fact.",
      });

      const retrieved = profile.getFact(fact.id, "wrong_scope");
      expect(retrieved).toBeNull();
    });

    it("deleteFact removes a fact and returns it with receipt", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "To be deleted.",
      });

      const deleted = profile.deleteFact(fact.id, SCOPE_ID);
      expect(deleted).not.toBeNull();
      expect(deleted!.fact.id).toBe(fact.id);
      expect(deleted!.receiptId).toMatch(/^rcp_/);

      // Verify it's gone
      const retrieved = profile.getFact(fact.id, SCOPE_ID);
      expect(retrieved).toBeNull();
    });

    it("deleteFact returns null for non-existent fact", () => {
      const result = profile.deleteFact("pf_nonexistent", SCOPE_ID);
      expect(result).toBeNull();
    });

    it("listFacts returns facts filtered by layer", () => {
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Static A",
      });
      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Static B",
      });
      profile.writeDynamicContext({
        scopeId: SCOPE_ID,
        content: "Dynamic A",
      });

      const allResult = profile.listFacts({ scopeId: SCOPE_ID });
      expect(allResult.total).toBe(3);

      const staticResult = profile.listFacts({
        scopeId: SCOPE_ID,
        layer: "static",
      });
      expect(staticResult.total).toBe(2);

      const dynamicResult = profile.listFacts({
        scopeId: SCOPE_ID,
        layer: "dynamic",
      });
      expect(dynamicResult.total).toBe(1);
    });
  });

  // ==========================================================================
  // Additional: Edge cases and scope isolation
  // ==========================================================================

  describe("Edge cases and scope isolation", () => {
    it("facts from different scopes are isolated", () => {
      ensureScope("scope_A");
      ensureScope("scope_B");

      profile.writeStaticFact({
        scopeId: "scope_A",
        content: "Fact in scope A",
      });
      profile.writeStaticFact({
        scopeId: "scope_B",
        content: "Fact in scope B",
      });

      const resultA = profile.getProfile("scope_A");
      const resultB = profile.getProfile("scope_B");

      expect(resultA.staticFacts).toHaveLength(1);
      expect(resultA.staticFacts[0]!.content).toBe("Fact in scope A");
      expect(resultB.staticFacts).toHaveLength(1);
      expect(resultB.staticFacts[0]!.content).toBe("Fact in scope B");
    });

    it("default confidence is 0.8", () => {
      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Default confidence check.",
      });

      expect(fact.confidence).toBe(0.8);
    });

    it("accepts expiresAt in the future", () => {
      const futureDate = new Date(Date.now() + 86400000 * 365).toISOString(); // 1 year

      const { fact } = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Long-lived fact.",
        expiresAt: futureDate,
      });

      expect(fact.expiresAt).toBe(futureDate);
    });

    it("does not accept expiresAt in the past for active-only queries", () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();

      profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Already expired fact.",
        expiresAt: pastDate,
      });

      const result = profile.getStaticFacts(SCOPE_ID, { activeOnly: true });
      expect(result.items).toHaveLength(0);
    });

    it("sourceRef is optional and preserved correctly", () => {
      const withRef = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Fact with ref.",
        sourceRef: "docs/README.md#section",
      });

      const withoutRef = profile.writeStaticFact({
        scopeId: SCOPE_ID,
        content: "Fact without ref.",
      });

      expect(withRef.fact.sourceRef).toBe("docs/README.md#section");
      expect(withoutRef.fact.sourceRef).toBeUndefined();
    });
  });
});
