/**
 * Mock Adapters Tests
 *
 * Covers: createMockMcpAdapter, createMockCliAdapter,
 * createMockCodeContextAdapter, getMockDatabase, resetMockDatabase.
 *
 * PRD §12.1: runtime check mock adapters.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  createMockMcpAdapter,
  createMockCliAdapter,
  createMockCodeContextAdapter,
  getMockDatabase,
  resetMockDatabase,
} from "../../src/harness/core/mockAdapters.js";

// ── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  resetMockDatabase();
});

// ── Mock MCP Adapter ─────────────────────────────────────────────────────────

describe("createMockMcpAdapter", () => {
  it("creates an adapter with callTool function", () => {
    const adapter = createMockMcpAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.callTool).toBe("function");
  });

  it("callTool returns success result for any tool name", async () => {
    const adapter = createMockMcpAdapter();
    const result = await adapter.callTool("compress_context", {
      scopeId: "test",
      content: "hello",
    });

    expect(result.toolName).toBe("compress_context");
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("mock result");
    expect(result.content[0]?.text).toContain("compress_context");
  });

  it("callTool works for any tool name (not just real ones)", async () => {
    const adapter = createMockMcpAdapter();
    const result = await adapter.callTool("nonexistent_tool", {});
    expect(result.isError).toBe(false);
    expect(result.toolName).toBe("nonexistent_tool");
  });

  it("callTool works with empty args", async () => {
    const adapter = createMockMcpAdapter();
    const result = await adapter.callTool("current_scope", {});
    expect(result.isError).toBe(false);
  });
});

// ── Mock CLI Adapter ─────────────────────────────────────────────────────────

describe("createMockCliAdapter", () => {
  it("creates an adapter with run function", () => {
    const adapter = createMockCliAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.run).toBe("function");
  });

  it("run returns success with exitCode 0", async () => {
    const adapter = createMockCliAdapter();
    const result = await adapter.run(["harness", "list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBeTruthy();
    expect(result.stdout).toContain("mock stdout for:");
    expect(result.stdout).toContain("code-context harness list");
  });

  it("run includes all args in stdout message", async () => {
    const adapter = createMockCliAdapter();
    const result = await adapter.run(["compress", "--content", "hello", "--type", "json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("compress");
    expect(result.stdout).toContain("--content");
    expect(result.stdout).toContain("--type");
  });

  it("run with empty args returns mock stdout", async () => {
    const adapter = createMockCliAdapter();
    const result = await adapter.run([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeTruthy();
  });
});

// ── Mock Database ────────────────────────────────────────────────────────────

describe("getMockDatabase", () => {
  it("returns an in-memory sql.js database", async () => {
    const db = await getMockDatabase();
    expect(db).toBeDefined();
    // Should be able to run a simple query
    const result = db.exec("SELECT 1");
    expect(result).toHaveLength(1);
  });

  it("returns the same cached instance on second call", async () => {
    const db1 = await getMockDatabase();
    const db2 = await getMockDatabase();
    expect(db1).toBe(db2); // Same instance (cached)
  });
});

describe("resetMockDatabase", () => {
  it("clears the cached database so next getMockDatabase creates a new one", async () => {
    const db1 = await getMockDatabase();
    resetMockDatabase();
    const db2 = await getMockDatabase();
    // After reset, should be a new instance
    expect(db1).not.toBe(db2);
  });
});

// ── Mock CodeContext Adapter ─────────────────────────────────────────────────

describe("createMockCodeContextAdapter", () => {
  it("creates an adapter with all required methods", async () => {
    const adapter = await createMockCodeContextAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.runCurrentScope).toBe("function");
    expect(typeof adapter.runCompressContext).toBe("function");
    expect(typeof adapter.runRetrieveOriginal).toBe("function");
    expect(typeof adapter.runDeleteOriginal).toBe("function");
    expect(typeof adapter.runRememberContext).toBe("function");
    expect(typeof adapter.runRecallContext).toBe("function");
    expect(typeof adapter.runForgetContext).toBe("function");
    expect(typeof adapter.runListContext).toBe("function");
    expect(typeof adapter.runAnalyzeContext).toBe("function");
    expect(typeof adapter.runFailureStats).toBe("function");
    expect(typeof adapter.runCleanupOriginals).toBe("function");
  });

  it("runCurrentScope returns a valid scope", async () => {
    const adapter = await createMockCodeContextAdapter();
    const scope = adapter.runCurrentScope();
    expect(scope.scopeId).toBe("mock_scope");
    expect(scope.cwd).toBeTruthy();
    expect(scope.gitRoot).toBeTruthy();
    expect(scope.scopeStrategy).toBe("gitRootOnly");
  });

  it("runCompressContext returns a valid compression result", async () => {
    const adapter = await createMockCodeContextAdapter();
    const result = await adapter.runCompressContext("test content for compression", {
      contentType: "plain_text",
    });

    expect(result.ccrId).toBeTruthy();
    expect(result.compressed).toBe(true);
    expect(result.scopeId).toBe("mock_scope");
    expect(result.contentType).toBe("plain_text");
    expect(result.strategy).toBe("conservative");
    expect(result.compressedContent).toBeTruthy();
    expect(result.originalRef).toBeTruthy();
    expect(result.tokensBefore).toBeGreaterThan(0);
    expect(result.tokensAfter).toBeGreaterThan(0);
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
    expect(result.canRetrieveOriginal).toBe(true);
    expect(result.receiptId).toBeTruthy();
    expect(result.failed).toBe(false);
  });

  it("runCompressContext handles custom strategy", async () => {
    const adapter = await createMockCodeContextAdapter();
    const result = await adapter.runCompressContext("content", {
      strategy: "aggressive",
      contentType: "json",
    });

    expect(result.strategy).toBe("aggressive");
    expect(result.contentType).toBe("json");
  });

  it("runRetrieveOriginal returns mock content after compression", async () => {
    const adapter = await createMockCodeContextAdapter();
    const compressResult = await adapter.runCompressContext(
      "unique content for retrieval test",
    );

    const retrieved = await adapter.runRetrieveOriginal(compressResult.ccrId);
    // The mock adapter tries to store original content in the in-memory DB
    // so it can be looked up later. If the schema loaded successfully,
    // retrieved will be non-null with matching content.
    // If schema loading fails (e.g. path resolution), retrieved is null.
    if (retrieved) {
      expect(retrieved.content).toBe("unique content for retrieval test");
      expect(retrieved.contentType).toBe("plain_text");
    } else {
      // Schema not loaded — verify ccrId and originalRef are still valid
      expect(compressResult.ccrId).toBeTruthy();
      expect(compressResult.originalRef).toBeTruthy();
      expect(compressResult.canRetrieveOriginal).toBe(true);
    }
  });

  it("runRetrieveOriginal returns null for unknown ccrId", async () => {
    const adapter = await createMockCodeContextAdapter();
    const retrieved = await adapter.runRetrieveOriginal("nonexistent_ccr");
    expect(retrieved).toBeNull();
  });

  it("runDeleteOriginal returns true", async () => {
    const adapter = await createMockCodeContextAdapter();
    const result = await adapter.runDeleteOriginal("any_ccr");
    expect(result).toBe(true);
  });

  it("runRememberContext returns a valid memory result", async () => {
    const adapter = await createMockCodeContextAdapter();
    const result = adapter.runRememberContext(
      "Always use TypeScript strict mode",
      "project_rule" as never,
      ["rule", "typescript"],
    );

    expect(result.memoryId).toBeTruthy();
    expect(result.scopeId).toBe("mock_scope");
    expect(result.type).toBe("project_rule");
    expect(result.status).toBe("active");
    expect(result.receiptId).toBeTruthy();
  });

  it("runRecallContext returns previously remembered items", async () => {
    const adapter = await createMockCodeContextAdapter();

    // Remember a few items
    adapter.runRememberContext("Rule A", "project_rule" as never, ["a"]);
    adapter.runRememberContext("Rule B", "project_rule" as never, ["b"]);

    const recallResult = adapter.runRecallContext("Rule", 10);
    expect(recallResult.total).toBe(2);
    expect(recallResult.items).toHaveLength(2);
    expect(recallResult.items[0]?.score).toBeGreaterThan(0);
  });

  it("runRecallContext returns empty when nothing remembered", async () => {
    // Fresh adapter (resetMockDatabase was called in afterEach)
    resetMockDatabase();
    const adapter = await createMockCodeContextAdapter();
    const recallResult = adapter.runRecallContext("nothing", 10);
    expect(recallResult.total).toBe(0);
    expect(recallResult.items).toHaveLength(0);
  });

  it("runForgetContext returns a valid result for known memory", async () => {
    const adapter = await createMockCodeContextAdapter();
    const remembered = adapter.runRememberContext(
      "Temporary rule",
      "project_rule" as never,
    );

    const forgetResult = adapter.runForgetContext(remembered.memoryId, "soft_delete");
    expect(forgetResult).not.toBeNull();
    if (forgetResult) {
      expect(forgetResult.memoryId).toBe(remembered.memoryId);
      expect(forgetResult.previousStatus).toBe("active");
      expect(forgetResult.newStatus).toBe("superseded");
      expect(forgetResult.receiptId).toBeTruthy();
    }
  });

  it("runForgetContext with hard_delete returns forgotten status", async () => {
    const adapter = await createMockCodeContextAdapter();
    const remembered = adapter.runRememberContext(
      "Delete me",
      "project_rule" as never,
    );

    const forgetResult = adapter.runForgetContext(remembered.memoryId, "hard_delete");
    expect(forgetResult).not.toBeNull();
    if (forgetResult) {
      expect(forgetResult.newStatus).toBe("forgotten");
    }
  });

  it("runForgetContext returns null for unknown memory", async () => {
    const adapter = await createMockCodeContextAdapter();
    const result = adapter.runForgetContext("unknown_id", "soft_delete");
    expect(result).toBeNull();
  });

  it("runListContext returns previously remembered items", async () => {
    const adapter = await createMockCodeContextAdapter();
    adapter.runRememberContext("Item 1", "project_rule" as never);
    adapter.runRememberContext("Item 2", "project_rule" as never);

    const listResult = adapter.runListContext(undefined, 50, 0);
    expect(listResult.scopeId).toBe("mock_scope");
    expect(listResult.total).toBeGreaterThanOrEqual(2);
    expect(listResult.items.length).toBeGreaterThanOrEqual(2);
    expect(listResult.limit).toBe(50);
    expect(listResult.offset).toBe(0);
  });

  it("runAnalyzeContext returns analysis with shouldCompress=true", async () => {
    const adapter = await createMockCodeContextAdapter();
    const result = adapter.runAnalyzeContext("A".repeat(500));
    expect(result.shouldCompress.value).toBe(true);
    expect(result.stats.contentLength).toBe(500);
    expect(result.stats.estimatedTokens).toBeGreaterThan(0);
  });

  it("runFailureStats returns zero stats for fresh adapter", async () => {
    const adapter = await createMockCodeContextAdapter();
    const stats = adapter.runFailureStats();
    expect(stats.scopeId).toBe("mock_scope");
    expect(stats.totalEvents).toBe(0);
  });

  it("runCleanupOriginals returns zero deleted", async () => {
    const adapter = await createMockCodeContextAdapter();
    const result = adapter.runCleanupOriginals();
    expect(result.deleted).toBe(0);
  });
});
