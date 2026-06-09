/**
 * Phase 1 Acceptance Tests
 *
 * Three criteria from PRD §23:
 *   1. MCP Server 可启动
 *   2. current_scope 可返回稳定 scopeId
 *   3. receipt 表可写入
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initAndMigrate, runMigrations } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt, queryAll, queryOne, persistDb } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { resolveScope } from "../src/scope/resolveScope.js";
import { handleCurrentScope } from "../src/mcp/tools/currentScope.js";
import { existsSync, unlinkSync } from "node:fs";
import type { Database } from "sql.js";

let db: Database;
let receipts: ReceiptService;

function ensureScope(scopeId: string) {
  runStmt(
    db,
    `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
     VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`,
    [scopeId, process.cwd()],
  );
}

beforeAll(async () => {
  db = await initAndMigrate();
  receipts = new ReceiptService(db);

  // Pre-insert scopes used by receipt tests
  ensureScope("repo_verify");
  ensureScope("repo_verify_fail");
  ensureScope("repo_alpha");
  ensureScope("repo_beta");
  ensureScope("repo_persist");
});

afterAll(() => {
  closeDb();
});

// ============================================================================
// Criterion 1: MCP Server 可启动
// ============================================================================
describe("Criterion 1: MCP Server startup & tool registration", () => {
  it("initializes database with all required tables", () => {
    const tables = queryAll(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );

    const names = (tables as { name: string }[]).map((t) => t.name);
    expect(names).toContain("scopes");
    expect(names).toContain("compressed_contexts");
    expect(names).toContain("original_contents");
    expect(names).toContain("memories");
    expect(names).toContain("profile_facts");
    expect(names).toContain("receipts");
    // FTS5 is intentionally skipped (sql.js default WASM doesn't include it)
    expect(names).not.toContain("memories_fts");
  });

  it("enforces foreign_keys pragma", () => {
    const row = queryOne(db, "PRAGMA foreign_keys", []);
    expect(row).toBeDefined();
    expect(row!["foreign_keys"]).toBe(1);
  });

  it("current_scope tool handler is directly callable", async () => {
    const ctx = { db, receipts };
    const result = await handleCurrentScope(ctx, {});

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    const text = result.content[0]!.text!;
    const parsed = JSON.parse(text);
    expect(parsed.scopeId).toMatch(/^repo_[a-f0-9]{8}$/);
    expect(parsed.gitRoot).toBeTruthy();
    expect(parsed.scopeStrategy).toBe("gitRemote+gitRoot");
  });

  it("loads server module without errors", async () => {
    // Verify the server entry point can be imported
    const mod = await import("../src/mcp/server.js");
    expect(mod.startServer).toBeInstanceOf(Function);
  });
});

// ============================================================================
// Criterion 2: current_scope 可返回稳定 scopeId
// ============================================================================
describe("Criterion 2: current_scope returns stable scopeId", () => {
  it("returns identical scopeId across repeated calls", () => {
    const a = resolveScope();
    const b = resolveScope();
    const c = resolveScope(process.cwd());

    expect(a.scopeId).toBe(b.scopeId);
    expect(a.scopeId).toBe(c.scopeId);
  });

  it("scopeId format: repo_<8 hex chars>", () => {
    const scope = resolveScope();
    expect(scope.scopeId).toMatch(/^repo_[a-f0-9]{8}$/);
  });

  it("strategy is gitRemote+gitRoot for this project", () => {
    const scope = resolveScope();
    expect(scope.scopeStrategy).toBe("gitRemote+gitRoot");
    expect(scope.gitRoot).toContain("CodeContext");
    expect(scope.remote).toBe("https://github.com/2cux/code-context-mcp");
    expect(scope.branch).toBeTruthy();
  });

  it("persists scope to the scopes table", () => {
    const scope = resolveScope();
    const row = queryOne(db, "SELECT * FROM scopes WHERE scope_id = ?", [
      scope.scopeId,
    ]);
    expect(row).toBeDefined();
    expect(row!["scope_id"]).toBe(scope.scopeId);
    expect(row!["scope_strategy"]).toBe("gitRemote+gitRoot");
  });
});

// ============================================================================
// Criterion 3: receipt 表可写入
// ============================================================================
describe("Criterion 3: receipt table is writable", () => {
  it("writes a compression receipt and reads it back verbatim", () => {
    const rec = receipts.create({
      operation: "compress",
      scopeId: "repo_verify",
      inputHash: "abc123def456",
      tokensBefore: 30000,
      tokensAfter: 1800,
      tokensSaved: 28200,
      compressionRatio: 0.94,
      compressed: true,
      ccrIds: ["ccr_test_001"],
      originalRefs: ["orig_test_001"],
    });

    expect(rec.id).toMatch(/^rcp_/);
    expect(rec.operation).toBe("compress");
    expect(rec.compressionRatio).toBe(0.94);

    const fetched = receipts.get(rec.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(rec.id);
    expect(fetched!.tokensBefore).toBe(30000);
    expect(fetched!.tokensAfter).toBe(1800);
    expect(fetched!.tokensSaved).toBe(28200);
    expect(fetched!.ccrIds).toEqual(["ccr_test_001"]);
    expect(fetched!.originalRefs).toEqual(["orig_test_001"]);
    expect(fetched!.compressed).toBe(true);
  });

  it("writes a remember receipt correctly", () => {
    const rec = receipts.create({
      operation: "remember",
      scopeId: "repo_verify",
      memoryIds: ["mem_pnpm_rule"],
      query: "package manager",
    });

    expect(rec.operation).toBe("remember");

    const fetched = receipts.get(rec.id);
    expect(fetched).toBeDefined();
    expect(fetched!.memoryIds).toEqual(["mem_pnpm_rule"]);
    expect(fetched!.query).toBe("package manager");
  });

  it("writes a failed compression receipt correctly", () => {
    const recFail = receipts.create({
      operation: "compress",
      scopeId: "repo_verify_fail",
      failed: true,
      errorReason: "compression_timeout",
      tokensBefore: 50000,
      tokensAfter: 50000,
      tokensSaved: 0,
      compressionRatio: 0,
      compressed: false,
    });

    const fetched = receipts.get(recFail.id);
    expect(fetched!.failed).toBe(true);
    expect(fetched!.errorReason).toBe("compression_timeout");
  });

  it("scope isolation: lists only receipts for the given scope", () => {
    receipts.create({ operation: "compress", scopeId: "repo_alpha", tokensSaved: 100 });
    receipts.create({ operation: "compress", scopeId: "repo_beta", tokensSaved: 200 });

    const alphaList = receipts.list("repo_alpha", { limit: 10 });
    for (const r of alphaList) {
      expect(r.scopeId).toBe("repo_alpha");
    }

    const betaList = receipts.list("repo_beta", { limit: 10 });
    for (const r of betaList) {
      expect(r.scopeId).toBe("repo_beta");
    }
  });

  it("persists receipts across close/reopen cycle", () => {
    // Write a receipt
    const marker = "persist_test_" + Date.now();
    const rec = receipts.create({
      operation: "recall",
      scopeId: "repo_persist",
      query: marker,
    });

    // Force write to disk
    persistDb();

    // Read back before close
    const before = receipts.get(rec.id);
    expect(before).toBeDefined();

    // Close (triggers persist) and reopen
    closeDb();

    // Re-initialize — this reopens the same file
    const freshInitPromise = (async () => {
      await initAndMigrate();
      return { db: getDb(), receipts: new ReceiptService(getDb()) };
    })();

    return freshInitPromise.then(({ receipts: r2 }) => {
      const after = r2.get(rec.id);
      expect(after).toBeDefined();
      expect(after!.id).toBe(rec.id);
      expect(after!.query).toBe(marker);
      expect(after!.operation).toBe("recall");
    });
  });
});
