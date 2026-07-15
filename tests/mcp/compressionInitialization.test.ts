import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import { runMigrations } from "../../src/storage/migrations.js";
import { ReceiptService } from "../../src/receipts/receiptService.js";
import { initializeCompression } from "../../src/compression/initialize.js";
import {
  getStrategy,
  listRegisteredTypes,
} from "../../src/compression/compressionEngine.js";
import { createToolHandlers } from "../../src/mcp/toolRegistry.js";
import { getAllowedTools } from "../../src/mcp/toolMode.js";

function parseToolResult(result: Awaited<ReturnType<ReturnType<typeof createToolHandlers>[string]>>) {
  const text = result.content[0];
  if (!text || text.type !== "text") {
    throw new Error("Expected a text MCP tool result");
  }
  return JSON.parse(text.text) as Record<string, unknown>;
}

function longTestOutput(): string {
  const passing = Array.from(
    { length: 240 },
    (_, index) => ` ✓ tests/unit/example-${index}.test.ts > returns expected value (${index + 1}ms)`,
  );
  return [
    " RUN  v2.1.0 D:/project/CodeContext",
    ...passing,
    " ❌ tests/unit/compress.test.ts > preserves registered strategies",
    "AssertionError: expected false to be true",
    "    at tests/unit/compress.test.ts:42:17",
    " Test Files  1 failed | 240 passed (241)",
    " Tests  1 failed | 240 passed (241)",
  ].join("\n");
}

describe("shared compression initialization", () => {
  let db: Database;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("is idempotent and keeps one binding per strategy type", () => {
    initializeCompression();
    const firstTypes = listRegisteredTypes().sort();
    const firstStrategies = firstTypes.map((type) => getStrategy(type));

    expect(() => initializeCompression()).not.toThrow();
    expect(listRegisteredTypes().sort()).toEqual(firstTypes);
    expect(firstTypes.map((type) => getStrategy(type))).toEqual(firstStrategies);
  });

  it("compresses through the real MCP handler and preserves a retrievable original", async () => {
    initializeCompression();
    const handlers = createToolHandlers({ db, receipts: new ReceiptService(db) });
    const content = longTestOutput();

    const compressed = parseToolResult(await handlers.compress_context!({
      content,
      contentType: "test_output",
      keepOriginal: true,
      maxTokens: 180,
    }));

    expect(compressed.compressed).toBe(true);
    expect(compressed.tokensSaved).toBeGreaterThan(0);
    expect(compressed.failed).toBe(false);
    expect(typeof compressed.originalRef).toBe("string");
    expect((compressed.originalRef as string).length).toBeGreaterThan(0);

    const retrieved = parseToolResult(await handlers.retrieve_original!({
      scopeId: compressed.scopeId,
      originalRef: compressed.originalRef,
      limit: content.length,
    }));
    expect(retrieved.content).toBe(content);
  });

  it("keeps the agent MCP surface at exactly seven tools", () => {
    expect([...getAllowedTools("agent")].sort()).toEqual([
      "compress_context",
      "current_scope",
      "forget_context",
      "recall_context",
      "remember_context",
      "retrieve_original",
      "run_context_flow",
    ]);
  });

  it("treats an unregistered concrete strategy as a fail-open failure", async () => {
    vi.resetModules();
    const freshEngine = await import("../../src/compression/compressionEngine.js");
    const result = await freshEngine.compress({
      scopeId: "unregistered-strategy-test",
      content: "A log line that must be returned unchanged.",
      contentType: "log",
      keepOriginal: true,
    });

    expect(result.compressed).toBe(false);
    expect(result.failed).toBe(true);
    expect(result.tokensSaved).toBe(0);
    expect(result.errorReason).toContain("not registered");
    expect(result.compressedContent).toBe("A log line that must be returned unchanged.");
  });
});
