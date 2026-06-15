/**
 * ReceiptService Unit Tests — PRD §11.4
 *
 * Covers:
 *   - create: all operation types, with/without optional fields, unique IDs
 *   - get: by id, non-existent, all fields round-trip
 *   - list: scope filter, operation filter, pagination (limit/offset)
 *   - JSON serialization: memoryIds, ccrIds, originalRefs, resultIds
 *   - Corrupt JSON handling in rowToRecord (fail-open)
 *   - Scope isolation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt, execRaw, queryOne } from "../src/storage/db.js";
import { ReceiptService, type ReceiptRecord } from "../src/receipts/receiptService.js";
import type { Database } from "sql.js";

let db: Database;
let receipts: ReceiptService;

const SCOPE_A = "repo_rcp_a";
const SCOPE_B = "repo_rcp_b";

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

describe("ReceiptService", () => {
  beforeAll(async () => {
    await initAndMigrate(":memory:");
    db = getDb();
    receipts = new ReceiptService(db);
    ensureScope(SCOPE_A);
    ensureScope(SCOPE_B);
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    db.exec("DELETE FROM receipts");
    ensureScope(SCOPE_A);
    ensureScope(SCOPE_B);
  });

  // ==========================================================================
  // create
  // ==========================================================================

  describe("create", () => {
    it("creates a compress receipt with all compression fields", () => {
      const rec = receipts.create({
        operation: "compress",
        scopeId: SCOPE_A,
        inputHash: "abc123def456",
        tokensBefore: 30000,
        tokensAfter: 1800,
        tokensSaved: 28200,
        compressionRatio: 0.94,
        compressed: true,
        ccrIds: ["ccr_test_001"],
        originalRefs: ["orig_test_001"],
      });

      expect(rec.id).toMatch(/^rcp_[a-z0-9]+_[a-f0-9]+_\d{6}$/);
      expect(rec.operation).toBe("compress");
      expect(rec.scopeId).toBe(SCOPE_A);
      expect(rec.inputHash).toBe("abc123def456");
      expect(rec.tokensBefore).toBe(30000);
      expect(rec.tokensAfter).toBe(1800);
      expect(rec.tokensSaved).toBe(28200);
      expect(rec.compressionRatio).toBe(0.94);
      expect(rec.compressed).toBe(true);
      expect(rec.ccrIds).toEqual(["ccr_test_001"]);
      expect(rec.originalRefs).toEqual(["orig_test_001"]);
      expect(rec.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("creates a remember receipt", () => {
      const rec = receipts.create({
        operation: "remember",
        scopeId: SCOPE_A,
        memoryIds: ["mem_001", "mem_002"],
        query: "package manager",
      });

      expect(rec.operation).toBe("remember");
      expect(rec.memoryIds).toEqual(["mem_001", "mem_002"]);
      expect(rec.query).toBe("package manager");
    });

    it("creates a recall receipt", () => {
      const rec = receipts.create({
        operation: "recall",
        scopeId: SCOPE_A,
        query: "login bug fix",
        resultIds: ["mem_003", "mem_004"],
        memoryIds: ["mem_003", "mem_004"],
      });

      expect(rec.operation).toBe("recall");
      expect(rec.query).toBe("login bug fix");
      expect(rec.resultIds).toEqual(["mem_003", "mem_004"]);
    });

    it("creates a forget receipt", () => {
      const rec = receipts.create({
        operation: "forget",
        scopeId: SCOPE_A,
        memoryIds: ["mem_old"],
        errorReason: "No longer relevant",
      });

      expect(rec.operation).toBe("forget");
      expect(rec.memoryIds).toEqual(["mem_old"]);
      expect(rec.errorReason).toBe("No longer relevant");
    });

    it("creates a failed compress receipt", () => {
      const rec = receipts.create({
        operation: "compress",
        scopeId: SCOPE_A,
        failed: true,
        errorReason: "compression_timeout",
        tokensBefore: 50000,
        tokensAfter: 50000,
        tokensSaved: 0,
        compressionRatio: 0,
        compressed: false,
      });

      expect(rec.failed).toBe(true);
      expect(rec.errorReason).toBe("compression_timeout");
      expect(rec.tokensSaved).toBe(0);
      expect(rec.compressionRatio).toBe(0);
      expect(rec.compressed).toBe(false);
    });

    it("creates a retrieve_original receipt", () => {
      const rec = receipts.create({
        operation: "retrieve_original",
        scopeId: SCOPE_A,
        originalRefs: ["orig_abc"],
        retrievedOriginal: true,
      });

      expect(rec.operation).toBe("retrieve_original");
      expect(rec.retrievedOriginal).toBe(true);
      expect(rec.originalRefs).toEqual(["orig_abc"]);
    });

    it("creates a list receipt", () => {
      const rec = receipts.create({
        operation: "list",
        scopeId: SCOPE_A,
      });

      expect(rec.operation).toBe("list");
      expect(rec.failed).toBeUndefined();
    });

    it("creates a cleanup_originals receipt", () => {
      const rec = receipts.create({
        operation: "cleanup_originals",
        scopeId: SCOPE_A,
        ccrIds: ["ccr_a", "ccr_b"],
      });

      expect(rec.operation).toBe("cleanup_originals");
      expect(rec.ccrIds).toEqual(["ccr_a", "ccr_b"]);
    });

    it("generates unique IDs for each receipt", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const rec = receipts.create({
          operation: "compress",
          scopeId: SCOPE_A,
        });
        ids.add(rec.id);
      }
      expect(ids.size).toBe(20);
    });

    it("persists receipt to the database", () => {
      const rec = receipts.create({
        operation: "remember",
        scopeId: SCOPE_A,
        memoryIds: ["mem_persist_test"],
      });

      const row = queryOne(db, "SELECT * FROM receipts WHERE id = ?", [rec.id]);
      expect(row).not.toBeNull();
      expect(row!["operation"]).toBe("remember");
      expect(row!["scope_id"]).toBe(SCOPE_A);
    });
  });

  // ==========================================================================
  // get
  // ==========================================================================

  describe("get", () => {
    it("retrieves a receipt by id", () => {
      const created = receipts.create({
        operation: "compress",
        scopeId: SCOPE_A,
        tokensBefore: 1000,
        tokensAfter: 200,
        tokensSaved: 800,
        compressionRatio: 0.8,
      });

      const fetched = receipts.get(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.operation).toBe("compress");
      expect(fetched!.scopeId).toBe(SCOPE_A);
      expect(fetched!.tokensBefore).toBe(1000);
      expect(fetched!.tokensAfter).toBe(200);
      expect(fetched!.tokensSaved).toBe(800);
      expect(fetched!.compressionRatio).toBe(0.8);
    });

    it("returns null for non-existent id", () => {
      expect(receipts.get("rcp_nonexistent_abc123")).toBeNull();
    });

    it("retrieves a receipt with array fields intact", () => {
      const created = receipts.create({
        operation: "compress",
        scopeId: SCOPE_A,
        ccrIds: ["ccr_1", "ccr_2", "ccr_3"],
        originalRefs: ["orig_1", "orig_2"],
      });

      const fetched = receipts.get(created.id);
      expect(fetched!.ccrIds).toEqual(["ccr_1", "ccr_2", "ccr_3"]);
      expect(fetched!.originalRefs).toEqual(["orig_1", "orig_2"]);
    });

    it("retrieves a receipt with memoryIds and resultIds", () => {
      const created = receipts.create({
        operation: "recall",
        scopeId: SCOPE_A,
        query: "search term",
        memoryIds: ["mem_a", "mem_b"],
        resultIds: ["mem_a"],
      });

      const fetched = receipts.get(created.id);
      expect(fetched!.memoryIds).toEqual(["mem_a", "mem_b"]);
      expect(fetched!.resultIds).toEqual(["mem_a"]);
      expect(fetched!.query).toBe("search term");
    });

    it("retrieves a failed receipt correctly", () => {
      const created = receipts.create({
        operation: "compress",
        scopeId: SCOPE_A,
        failed: true,
        errorReason: "test failure reason",
      });

      const fetched = receipts.get(created.id);
      expect(fetched!.failed).toBe(true);
      expect(fetched!.errorReason).toBe("test failure reason");
    });

    it("optional fields are undefined when not provided", () => {
      const created = receipts.create({
        operation: "list",
        scopeId: SCOPE_A,
      });

      const fetched = receipts.get(created.id)!;
      expect(fetched.inputHash).toBeUndefined();
      expect(fetched.query).toBeUndefined();
      expect(fetched.resultIds).toBeUndefined();
      expect(fetched.memoryIds).toBeUndefined();
      expect(fetched.ccrIds).toBeUndefined();
      expect(fetched.originalRefs).toBeUndefined();
      expect(fetched.errorReason).toBeUndefined();
    });

    it("survives corrupt JSON in result_ids (fail-open)", () => {
      execRaw(
        db,
        `INSERT INTO receipts (id, operation, scope_id, result_ids, timestamp)
         VALUES ('rcp_corrupt_test', 'recall', '${SCOPE_A}', '{bad json', '2026-01-01T00:00:00Z')`,
      );

      // Should NOT throw — fail-open returns undefined for corrupt JSON
      const fetched = receipts.get("rcp_corrupt_test");
      expect(fetched).not.toBeNull();
      expect(fetched!.resultIds).toBeUndefined();
    });

    it("survives corrupt JSON in memory_ids (fail-open)", () => {
      execRaw(
        db,
        `INSERT INTO receipts (id, operation, scope_id, memory_ids, timestamp)
         VALUES ('rcp_corrupt_mem', 'remember', '${SCOPE_A}', 'not-json]]]', '2026-01-01T00:00:00Z')`,
      );

      const fetched = receipts.get("rcp_corrupt_mem");
      expect(fetched).not.toBeNull();
      expect(fetched!.memoryIds).toBeUndefined();
    });
  });

  // ==========================================================================
  // list
  // ==========================================================================

  describe("list", () => {
    it("lists receipts for a given scope", () => {
      receipts.create({ operation: "compress", scopeId: SCOPE_A });
      receipts.create({ operation: "compress", scopeId: SCOPE_A });
      receipts.create({ operation: "compress", scopeId: SCOPE_B });

      const listA = receipts.list(SCOPE_A);
      expect(listA.length).toBe(2);
      for (const r of listA) {
        expect(r.scopeId).toBe(SCOPE_A);
      }

      const listB = receipts.list(SCOPE_B);
      expect(listB.length).toBe(1);
      expect(listB[0]!.scopeId).toBe(SCOPE_B);
    });

    it("filters by operation", () => {
      receipts.create({ operation: "compress", scopeId: SCOPE_A });
      receipts.create({ operation: "remember", scopeId: SCOPE_A });
      receipts.create({ operation: "recall", scopeId: SCOPE_A });

      const compressList = receipts.list(SCOPE_A, { operation: "compress" });
      expect(compressList.length).toBe(1);
      expect(compressList[0]!.operation).toBe("compress");

      const rememberList = receipts.list(SCOPE_A, { operation: "remember" });
      expect(rememberList.length).toBe(1);
      expect(rememberList[0]!.operation).toBe("remember");
    });

    it("sorts by timestamp DESC (most recent first)", () => {
      // Create receipts with short delays
      receipts.create({ operation: "compress", scopeId: SCOPE_A });
      receipts.create({ operation: "remember", scopeId: SCOPE_A });
      receipts.create({ operation: "recall", scopeId: SCOPE_A });

      const list = receipts.list(SCOPE_A);
      for (let i = 1; i < list.length; i++) {
        expect(list[i - 1]!.timestamp >= list[i]!.timestamp).toBe(true);
      }
    });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        receipts.create({ operation: "compress", scopeId: SCOPE_A });
      }

      const list = receipts.list(SCOPE_A, { limit: 3 });
      expect(list.length).toBe(3);
    });

    it("respects offset", () => {
      for (let i = 0; i < 10; i++) {
        receipts.create({ operation: "compress", scopeId: SCOPE_A });
      }

      const all = receipts.list(SCOPE_A, { limit: 10 });
      const page1 = receipts.list(SCOPE_A, { limit: 5, offset: 0 });
      const page2 = receipts.list(SCOPE_A, { limit: 5, offset: 5 });

      expect(page1.length).toBe(5);
      expect(page2.length).toBe(5);

      const page1Ids = new Set(page1.map((r) => r.id));
      const page2Ids = new Set(page2.map((r) => r.id));
      for (const id of page1Ids) {
        expect(page2Ids.has(id)).toBe(false);
      }
    });

    it("defaults to limit=20, offset=0", () => {
      for (let i = 0; i < 25; i++) {
        receipts.create({ operation: "compress", scopeId: SCOPE_A });
      }

      const list = receipts.list(SCOPE_A);
      expect(list.length).toBeLessThanOrEqual(20);
    });

    it("returns empty array for scope with no receipts", () => {
      const list = receipts.list("repo_nonexistent_scope");
      expect(list).toEqual([]);
    });

    it("combines operation filter with pagination", () => {
      for (let i = 0; i < 5; i++) {
        receipts.create({ operation: "compress", scopeId: SCOPE_A });
        receipts.create({ operation: "remember", scopeId: SCOPE_A });
      }

      const result = receipts.list(SCOPE_A, {
        operation: "remember",
        limit: 2,
        offset: 1,
      });
      expect(result.length).toBeLessThanOrEqual(2);
      for (const r of result) {
        expect(r.operation).toBe("remember");
      }
    });
  });

  // ==========================================================================
  // Scope isolation
  // ==========================================================================

  describe("scope isolation", () => {
    it("receipts from different scopes are isolated", () => {
      const a1 = receipts.create({ operation: "compress", scopeId: SCOPE_A });
      const a2 = receipts.create({ operation: "compress", scopeId: SCOPE_A });
      const b1 = receipts.create({ operation: "compress", scopeId: SCOPE_B });

      // Can get A's receipts
      expect(receipts.get(a1.id)).not.toBeNull();
      expect(receipts.get(a2.id)).not.toBeNull();
      expect(receipts.get(b1.id)).not.toBeNull();

      // List A only returns A's
      const listA = receipts.list(SCOPE_A);
      const idsA = listA.map((r) => r.id);
      expect(idsA).toContain(a1.id);
      expect(idsA).toContain(a2.id);
      expect(idsA).not.toContain(b1.id);

      // List B only returns B's
      const listB = receipts.list(SCOPE_B);
      const idsB = listB.map((r) => r.id);
      expect(idsB).toContain(b1.id);
      expect(idsB).not.toContain(a1.id);
    });
  });

  // ==========================================================================
  // All operations coverage
  // ==========================================================================

  describe("all operation types", () => {
    const ALL_OPS: ReceiptRecord["operation"][] = [
      "compress",
      "retrieve_original",
      "delete_original",
      "cleanup_originals",
      "remember",
      "recall",
      "forget",
      "list",
      "harness_run",
      "harness_phase",
      "harness_checkpoint",
      "harness_check",
      "harness_artifact",
    ];

    it("creates receipts for all operation types", () => {
      for (const op of ALL_OPS) {
        const rec = receipts.create({
          operation: op,
          scopeId: SCOPE_A,
          ...(op === "compress" || op === "retrieve_original" || op === "delete_original" || op === "cleanup_originals"
            ? { tokensBefore: 100, tokensAfter: 100, tokensSaved: 0, compressionRatio: 0 }
            : {}),
          ...(op === "recall" || op === "remember" ? { query: "test" } : {}),
          ...(op === "harness_run"
            ? { runId: "run_test_001", moduleId: "compression-flow", coveredTools: ["compress_context"] }
            : {}),
          ...(op === "harness_phase"
            ? { runId: "run_test_001", parentRunId: "run_test_001", phase: "compress" }
            : {}),
          ...(op === "harness_checkpoint"
            ? { runId: "run_test_001", phase: "compress", checkpointName: "compress:code" }
            : {}),
          ...(op === "harness_check"
            ? { runId: "run_test_001", phase: "check", checkpointName: "run:check" }
            : {}),
          ...(op === "harness_artifact"
            ? { runId: "run_test_001", artifactPaths: ["run_test_001/artifacts/output.log"] }
            : {}),
        });
        expect(rec.operation).toBe(op);
        expect(rec.id).toMatch(/^rcp_/);

        // Verify persistence
        const fetched = receipts.get(rec.id);
        expect(fetched).not.toBeNull();
        expect(fetched!.operation).toBe(op);
      }
    });

    it("lists can filter by each operation type", () => {
      for (const op of ALL_OPS) {
        receipts.create({
          operation: op,
          scopeId: SCOPE_A,
          ...(op === "recall" ? { query: "test" } : {}),
        });
      }

      for (const op of ALL_OPS) {
        const list = receipts.list(SCOPE_A, { operation: op });
        expect(list.length).toBeGreaterThanOrEqual(1);
        expect(list[0]!.operation).toBe(op);
      }
    });
  });

  // ==========================================================================
  // Run receipt fields (§34)
  // ==========================================================================

  describe("run receipt fields", () => {
    it("creates a harness_run receipt with all run fields", () => {
      const rec = receipts.create({
        operation: "harness_run",
        scopeId: SCOPE_A,
        runId: "run_20260615_abc123_001",
        moduleId: "compression-flow",
        phase: "compress",
        eventType: "run:started",
        coveredTools: ["compress_context", "retrieve_original", "get_receipt"],
        artifactPaths: [
          "run_20260615_abc123_001/artifacts/output.log",
          "run_20260615_abc123_001/artifacts/summary.md",
        ],
      });

      expect(rec.operation).toBe("harness_run");
      expect(rec.runId).toBe("run_20260615_abc123_001");
      expect(rec.moduleId).toBe("compression-flow");
      expect(rec.phase).toBe("compress");
      expect(rec.eventType).toBe("run:started");
      expect(rec.coveredTools).toEqual(["compress_context", "retrieve_original", "get_receipt"]);
      expect(rec.artifactPaths).toEqual([
        "run_20260615_abc123_001/artifacts/output.log",
        "run_20260615_abc123_001/artifacts/summary.md",
      ]);
    });

    it("creates a harness_checkpoint receipt", () => {
      const rec = receipts.create({
        operation: "harness_checkpoint",
        scopeId: SCOPE_A,
        runId: "run_20260615_abc123_001",
        phase: "compress",
        checkpointName: "compress:code",
        eventType: "checkpoint",
      });

      expect(rec.operation).toBe("harness_checkpoint");
      expect(rec.runId).toBe("run_20260615_abc123_001");
      expect(rec.phase).toBe("compress");
      expect(rec.checkpointName).toBe("compress:code");
      expect(rec.eventType).toBe("checkpoint");
    });

    it("creates a harness_artifact receipt", () => {
      const rec = receipts.create({
        operation: "harness_artifact",
        scopeId: SCOPE_A,
        runId: "run_test_art_001",
        artifactPaths: ["run_test_art_001/artifacts/roundtrip-diff.md"],
      });

      expect(rec.artifactPaths).toEqual(["run_test_art_001/artifacts/roundtrip-diff.md"]);
    });

    it("round-trips run receipt fields through get", () => {
      const created = receipts.create({
        operation: "harness_run",
        scopeId: SCOPE_A,
        runId: "run_roundtrip_001",
        moduleId: "memory-flow",
        coveredTools: ["remember_context", "recall_context"],
        artifactPaths: ["run_roundtrip_001/artifacts/result.json"],
      });

      const fetched = receipts.get(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.runId).toBe("run_roundtrip_001");
      expect(fetched!.moduleId).toBe("memory-flow");
      expect(fetched!.coveredTools).toEqual(["remember_context", "recall_context"]);
      expect(fetched!.artifactPaths).toEqual(["run_roundtrip_001/artifacts/result.json"]);
    });

    it("run fields are undefined when not provided", () => {
      const rec = receipts.create({
        operation: "compress",
        scopeId: SCOPE_A,
        tokensBefore: 100,
        tokensAfter: 50,
        tokensSaved: 50,
        compressionRatio: 0.5,
      });

      expect(rec.runId).toBeUndefined();
      expect(rec.moduleId).toBeUndefined();
      expect(rec.parentRunId).toBeUndefined();
      expect(rec.phase).toBeUndefined();
      expect(rec.eventType).toBeUndefined();
      expect(rec.checkpointName).toBeUndefined();
      expect(rec.artifactPaths).toBeUndefined();
      expect(rec.coveredTools).toBeUndefined();
    });

    it("child receipt links to parent run via runId", () => {
      // Create the main harness run receipt
      const runReceipt = receipts.create({
        operation: "harness_run",
        scopeId: SCOPE_A,
        runId: "run_parent_001",
        moduleId: "compression-flow",
        coveredTools: ["compress_context"],
      });

      // Create a child compress receipt referencing the run
      const childReceipt = receipts.create({
        operation: "compress",
        scopeId: SCOPE_A,
        runId: "run_parent_001",
        tokensBefore: 1000,
        tokensAfter: 200,
        tokensSaved: 800,
        compressionRatio: 0.8,
        compressed: true,
        ccrIds: ["ccr_child_001"],
      });

      expect(childReceipt.runId).toBe("run_parent_001");

      // getByRunId should return both receipts
      const byRun = receipts.getByRunId("run_parent_001");
      expect(byRun.length).toBe(2);
      expect(byRun.map((r) => r.id)).toContain(runReceipt.id);
      expect(byRun.map((r) => r.id)).toContain(childReceipt.id);
    });

    it("getByRunId returns empty array for unknown runId", () => {
      const results = receipts.getByRunId("run_nonexistent");
      expect(results).toEqual([]);
    });

    it("list can filter by runId", () => {
      receipts.create({
        operation: "harness_run",
        scopeId: SCOPE_A,
        runId: "run_list_filter_001",
      });
      receipts.create({
        operation: "harness_phase",
        scopeId: SCOPE_A,
        runId: "run_list_filter_001",
        phase: "compress",
      });
      receipts.create({
        operation: "compress",
        scopeId: SCOPE_A,
        runId: "run_list_filter_002",
        tokensBefore: 100,
        tokensAfter: 100,
        tokensSaved: 0,
        compressionRatio: 0,
      });

      const filtered = receipts.list(SCOPE_A, { runId: "run_list_filter_001" });
      expect(filtered.length).toBe(2);
      for (const r of filtered) {
        expect(r.runId).toBe("run_list_filter_001");
      }
    });

    it("list can filter by eventType", () => {
      receipts.create({
        operation: "harness_run",
        scopeId: SCOPE_A,
        runId: "run_evt_001",
        eventType: "run:started",
      });
      receipts.create({
        operation: "harness_checkpoint",
        scopeId: SCOPE_A,
        runId: "run_evt_001",
        eventType: "checkpoint",
        checkpointName: "compress:log",
      });

      const started = receipts.list(SCOPE_A, { eventType: "run:started" });
      expect(started.length).toBe(1);
      expect(started[0]!.eventType).toBe("run:started");

      const cps = receipts.list(SCOPE_A, { eventType: "checkpoint" });
      expect(cps.length).toBe(1);
      expect(cps[0]!.checkpointName).toBe("compress:log");
    });

    it("harness_phase receipt with parentRunId references parent run", () => {
      const parentRunId = "run_phase_parent_001";
      const phaseRec = receipts.create({
        operation: "harness_phase",
        scopeId: SCOPE_A,
        runId: parentRunId,
        parentRunId: parentRunId,
        phase: "verify",
      });

      expect(phaseRec.parentRunId).toBe(parentRunId);
      expect(phaseRec.phase).toBe("verify");

      // Verify round-trip
      const fetched = receipts.get(phaseRec.id);
      expect(fetched!.parentRunId).toBe(parentRunId);
      expect(fetched!.phase).toBe("verify");
    });
  });
});
