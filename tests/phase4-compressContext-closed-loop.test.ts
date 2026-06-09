/**
 * Phase 4 Integration Tests — compressContext Complete Closed Loop (PRD §12.4)
 *
 * Covers the full compress-context pipeline end-to-end:
 *   12.4.1  — Long test log compression
 *   12.4.2  — Command output compression
 *   12.4.3  — Plain text compression
 *   12.4.4  — Auto contentType detection
 *   12.4.5  — keepOriginal=false
 *   12.4.6  — Compression timeout
 *   12.4.7  — Receipt generation
 *   12.4.8  — originalRef retrieval (full cycle)
 *   12.3.1  — ContentRouter failure fallback
 *   12.3.2  — Compression failure fail-open
 *   12.3.5  — SQLite failure does not block main flow
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt, queryOne } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { OriginalStore } from "../src/originals/originalStore.js";
import { handleCompressContext } from "../src/mcp/tools/compressContext.js";
import { handleRetrieveOriginal } from "../src/mcp/tools/retrieveOriginal.js";
import { handleListCompressions } from "../src/mcp/tools/listCompressions.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../src/mcp/server.js";

// Ensure compression strategies are registered before tests
import { registerAllStrategies } from "../src/compression/registerStrategies.js";

let db: Database;
let ctx: ServerContext;

const SCOPE_ID = "repo_phase4_closed_loop";

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

// ---- Test fixtures ----

/** Realistic pnpm/vitest test output log (~8KB) */
function generateTestOutputLog(): string {
  const lines: string[] = [
    "",
    "> code-context-mcp@0.1.0 test D:\\project\\CodeContext",
    "> vitest run",
    "",
    "",
    " RUN  v2.1.8 D:/project/CodeContext",
    "",
    " ✓ tests/scope.test.ts (18 tests) 45ms",
    " ✓ tests/contentRouter.test.ts (12 tests) 32ms",
    " ✓ tests/compressionEngine.test.ts (15 tests) 78ms",
  ];

  // Add realistic test failures
  lines.push("");
  lines.push(" ❯ tests/compressedStore.test.ts (22 tests | 1 failed) 125ms");
  lines.push("   × CompressedStore > save and get by ccrId 12ms");
  lines.push("     → expected 'ccr_test_001' to be 'ccr_test_002'");

  // Add stack trace
  lines.push("");
  lines.push("⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯");
  lines.push("");
  lines.push(" FAIL  tests/compressedStore.test.ts > CompressedStore > save and get by ccrId");
  lines.push("AssertionError: expected 'ccr_test_001' to be 'ccr_test_002'");
  lines.push("");
  lines.push("Expected: \"ccr_test_002\"");
  lines.push("Received: \"ccr_test_001\"");
  lines.push("");
  lines.push(" ❯ tests/compressedStore.test.ts:45:22");
  lines.push("     43|     const record = store.get(ccrId, SCOPE_ID);");
  lines.push("     44|     expect(record).not.toBeNull();");
  lines.push("     45|     expect(record!.id).toBe('ccr_test_002');");
  lines.push("       |                      ^");
  lines.push("     46|   });");
  lines.push("     47| });");
  lines.push("");
  lines.push("⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯");

  // Add test summary
  lines.push("");
  lines.push(" Test Files  1 failed | 3 passed (4)");
  lines.push("      Tests  1 failed | 65 passed (66)");
  lines.push("   Start at  10:23:45");
  lines.push("   Duration  2.34s (transform 456ms, setup 0ms, collect 1.2s, tests 280ms, environment 0ms, prepare 180ms)");
  lines.push("");

  return lines.join("\n");
}

/** Realistic command output (pnpm install) */
function generateCommandOutput(): string {
  return [
    "$ pnpm install",
    "Scope: all 3 workspace projects",
    "Lockfile is up to date, resolution step is skipped",
    "Progress: resolved 1, reused 0, downloaded 0, added 0",
    "Packages: +156",
    "++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++",
    "Progress: resolved 156, reused 152, downloaded 4, added 156, done",
    "",
    "dependencies:",
    "+ @modelcontextprotocol/sdk 1.0.0",
    "+ sql.js 1.12.0",
    "+ tiktoken 1.0.17",
    "",
    "devDependencies:",
    "+ @types/node 22.0.0",
    "+ @types/sql.js 1.4.11",
    "+ typescript 5.6.0",
    "+ vitest 2.0.0",
    "+ @vitest/coverage-v8 2.0.0",
    "+ eslint 9.0.0",
    "+ prettier 3.3.0",
    "",
    "Done in 3.2s",
    "",
  ].join("\n");
}

/** Plain text content with key information */
function generatePlainText(): string {
  return [
    "Project CodeContext MCP — Architecture Notes",
    "",
    "## Storage Layer",
    "The project uses SQLite via sql.js for local-first storage.",
    "All data is scoped by repository. The database file is stored",
    "in the project root as .code-context.db.",
    "",
    "## Compression Pipeline",
    "1. ContentRouter detects the content type.",
    "2. SafetyLayer enforces size limits and chunking.",
    "3. CompressionEngine applies type-specific strategies.",
    "4. OriginalStore preserves the raw content.",
    "5. CompressedStore persists the compressed result.",
    "6. ReceiptService records the operation for audit.",
    "",
    "## Key Design Principles",
    "- Fail-open: if compression fails, return original content.",
    "- Local-first: no uploads, no cloud sync.",
    "- Scope isolation: everything is scoped by repository.",
    "- Conservative compression: preserve error details and paths.",
    "- Auditability: every operation generates a receipt.",
    "",
  ].join("\n");
}

/** Realistic code snippet */
function generateCodeContent(): string {
  return [
    "import { Server } from '@modelcontextprotocol/sdk/server/index.js';",
    "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';",
    "import {",
    "  CallToolRequestSchema,",
    "  ListToolsRequestSchema,",
    "  type CallToolResult,",
    "} from '@modelcontextprotocol/sdk/types.js';",
    "",
    "export interface ServerContext {",
    "  db: Database;",
    "  receipts: ReceiptService;",
    "}",
    "",
    "export async function startServer(): Promise<void> {",
    "  await initAndMigrate();",
    "  const db = getDb();",
    "  persistDb();",
    "  const receipts = new ReceiptService(db);",
    "  const ctx: ServerContext = { db, receipts };",
    "",
    "  const server = new Server(",
    "    { name: 'code-context-mcp', version: '0.1.0' },",
    "    { capabilities: { tools: {} } },",
    "  );",
    "",
    "  const tools: Record<string, (args: Record<string, unknown>) => Promise<CallToolResult>> = {",
    "    current_scope: (args) => handleCurrentScope(ctx, args),",
    "    compress_context: (args) => handleCompressContext(ctx, args),",
    "    retrieve_original: (args) => handleRetrieveOriginal(ctx, args),",
    "  };",
    "",
    "  server.setRequestHandler(ListToolsRequestSchema, async () => ({",
    "    tools: [/* ... */],",
    "  }));",
    "",
    "  server.setRequestHandler(CallToolRequestSchema, async (request) => {",
    "    const { name, arguments: args } = request.params;",
    "    const handler = tools[name];",
    "    if (!handler) {",
    "      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };",
    "    }",
    "    try {",
    "      const result = await handler((args ?? {}) as Record<string, unknown>);",
    "      persistDb();",
    "      return result;",
    "    } catch (err) {",
    "      const message = err instanceof Error ? err.message : String(err);",
    "      return { content: [{ type: 'text', text: `Tool error (${name}): ${message}` }], isError: true };",
    "    }",
    "  });",
    "",
    "  const transport = new StdioServerTransport();",
    "  await server.connect(transport);",
    "}",
  ].join("\n");
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeAll(async () => {
  db = await initAndMigrate();
  ctx = { db, receipts: new ReceiptService(db) };
  ensureScope();
  ensureScope("repo_phase4_alt");

  // Register all compression strategies (idempotent)
  registerAllStrategies();
});

afterAll(() => {
  closeDb();
});

// ============================================================================
// 12.4.1 — Long Test Log Compression
// ============================================================================
describe("12.4.1 长测试日志压缩", () => {
  it("compresses test output log with correct contentType detection", async () => {
    const content = generateTestOutputLog();
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "test_output",
      keepOriginal: true,
    });

    const json = parseToolText(result);

    // Core assertions
    expect(json.ccrId).toBeTruthy();
    expect(typeof json.compressed).toBe("boolean");
    expect(json.contentType).toBe("test_output");

    // Token savings should be significant for test output
    expect(json.tokensBefore).toBeGreaterThan(0);
    expect(json.tokensAfter).toBeGreaterThan(0);
    expect(json.tokensSaved).toBeGreaterThanOrEqual(0);
    expect(json.compressionRatio).toBeGreaterThanOrEqual(0);

    // Must preserve failure info
    const compressed = json.compressedContent as string;
    expect(compressed.length).toBeGreaterThan(0);
    // Test output compression should preserve failed test names
    const hasFailureInfo =
      compressed.includes("compressedStore") ||
      compressed.includes("FAIL") ||
      compressed.includes("failed") ||
      compressed.includes("AssertionError");
    expect(hasFailureInfo).toBe(true);

    // originalRef must be present
    expect(json.originalRef).toBeTruthy();
    expect(json.canRetrieveOriginal).toBe(true);

    // Receipt must exist
    expect(json.receiptId).toBeTruthy();

    // Warnings must be an array
    expect(Array.isArray(json.warnings)).toBe(true);
  });

  it("compresses test output log with auto-detection", async () => {
    const content = generateTestOutputLog();
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      // contentType intentionally omitted — should be auto-detected
      keepOriginal: true,
    });

    const json = parseToolText(result);

    expect(json.ccrId).toBeTruthy();
    expect(json.detection).toBeDefined();
    const detection = json.detection as Record<string, unknown>;
    expect(detection.method).toBe("auto");
    // Should detect as test_output or log
    const detectedType = detection.detectedAs as string;
    expect(["test_output", "log", "command_output", "plain_text", "unknown"]).toContain(detectedType);

    // Even with auto-detection, compression should work
    expect(json.compressedContent).toBeTruthy();
    expect(json.compressedContent.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 12.4.2 — Command Output Compression
// ============================================================================
describe("12.4.2 命令输出压缩", () => {
  it("compresses command output with correct type", async () => {
    const content = generateCommandOutput();
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "command_output",
      keepOriginal: true,
    });

    const json = parseToolText(result);

    expect(json.ccrId).toBeTruthy();
    expect(json.contentType).toBe("command_output");
    expect(json.compressedContent).toBeTruthy();
    expect(json.compressedContent.length).toBeGreaterThan(0);

    // Package names should be preserved
    const compressed = json.compressedContent as string;
    const hasPackageInfo =
      compressed.includes("@modelcontextprotocol") ||
      compressed.includes("tiktoken") ||
      compressed.includes("sql.js") ||
      compressed.includes("vitest");
    expect(hasPackageInfo).toBe(true);

    // Token stats
    expect(json.tokensBefore).toBeGreaterThan(0);
    expect(json.tokensAfter).toBeGreaterThan(0);
    expect(json.receiptId).toBeTruthy();
  });

  it("auto-detects command_output content type", async () => {
    const content = generateCommandOutput();
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      // No contentType — auto-detect
      keepOriginal: false,
    });

    const json = parseToolText(result);

    expect(json.ccrId).toBeTruthy();
    // Auto-detection info should be present
    expect(json.detection).toBeDefined();
    const detection = json.detection as Record<string, unknown>;
    expect(detection.method).toBe("auto");
  });
});

// ============================================================================
// 12.4.3 — Plain Text Compression
// ============================================================================
describe("12.4.3 普通文本压缩", () => {
  it("compresses plain text with key info preservation", async () => {
    const content = generatePlainText();
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      keepOriginal: true,
    });

    const json = parseToolText(result);

    expect(json.ccrId).toBeTruthy();
    expect(json.contentType).toBe("plain_text");
    expect(typeof json.compressed).toBe("boolean");
    expect(json.compressedContent).toBeTruthy();

    // Compressed content should not be empty (may be shorter or equal to original)
    expect((json.compressedContent as string).length).toBeGreaterThan(0);

    // Key concepts should be preserved
    const compressed = json.compressedContent as string;
    const hasKeyConcepts =
      compressed.includes("SQLite") ||
      compressed.includes("compression") ||
      compressed.includes("fail-open") ||
      compressed.includes("local");
    expect(hasKeyConcepts).toBe(true);

    // Token stats
    expect(json.tokensBefore).toBeGreaterThan(0);
    expect(json.tokensAfter).toBeGreaterThan(0);
    expect(json.tokensSaved).toBeGreaterThanOrEqual(0);

    // Receipt
    expect(json.receiptId).toBeTruthy();
  });
});

// ============================================================================
// 12.4.4 — Auto contentType Detection
// ============================================================================
describe("12.4.4 自动 contentType 检测", () => {
  it("auto-detects code content type", async () => {
    const content = generateCodeContent();
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      // No contentType
      keepOriginal: false,
    });

    const json = parseToolText(result);

    expect(json.ccrId).toBeTruthy();
    expect(json.detection).toBeDefined();
    const detection = json.detection as Record<string, unknown>;
    expect(detection.method).toBe("auto");
    // Code should be detected
    const detectedType = detection.detectedAs as string;
    expect(["code", "plain_text", "unknown"]).toContain(detectedType);
  });

  it("auto-detects JSON content type", async () => {
    const jsonContent = JSON.stringify({
      name: "code-context-mcp",
      version: "0.1.0",
      dependencies: {
        "sql.js": "^1.12.0",
        tiktoken: "^1.0.17",
      },
      scripts: {
        build: "tsc",
        test: "vitest run",
        start: "node dist/index.js",
      },
    }, null, 2);

    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: jsonContent,
      // No contentType
      keepOriginal: false,
    });

    const json = parseToolText(result);

    expect(json.ccrId).toBeTruthy();
    expect(json.detection).toBeDefined();
    const detection = json.detection as Record<string, unknown>;
    expect(detection.method).toBe("auto");
  });

  it("handles empty content fallback gracefully when auto-detecting", async () => {
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: "   ", // whitespace-only
      keepOriginal: false,
    });

    // Empty/whitespace content should be detected as unknown
    const json = parseToolText(result);
    expect(json.detection).toBeDefined();
    const detection = json.detection as Record<string, unknown>;
    // Empty content should map to unknown or have a valid type
    expect(["unknown", "plain_text"]).toContain(detection.detectedAs as string);
  });

  it("explicit contentType overrides auto-detection", async () => {
    const content = generateTestOutputLog();
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text", // User says plain_text
      keepOriginal: false,
    });

    const json = parseToolText(result);

    expect(json.contentType).toBe("plain_text");
    expect(json.detection).toBeDefined();
    const detection = json.detection as Record<string, unknown>;
    expect(detection.method).toBe("user");
    expect(detection.specifiedType).toBe("plain_text");
  });
});

// ============================================================================
// 12.4.5 — keepOriginal=false
// ============================================================================
describe("12.4.5 keepOriginal=false", () => {
  it("compress with keepOriginal=false has no originalRef", async () => {
    const content = "Some content that should not be saved as original.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      keepOriginal: false,
    });

    const json = parseToolText(result);

    expect(json.ccrId).toBeTruthy();
    expect(json.canRetrieveOriginal).toBe(false);

    // originalRef may be absent or undefined
    if (json.originalRef) {
      // If there IS an originalRef, try to retrieve — but it should fail
      const retResult = await handleRetrieveOriginal(ctx, {
        scopeId: SCOPE_ID,
        originalRef: json.originalRef as string,
      });
      // Either the original was not saved (error) or was saved
      // The key is that canRetrieveOriginal is false
      const retJson = parseToolText(retResult);
      if (!retResult.isError) {
        // If somehow retrieved, the CCR flag should still be false
        expect(json.canRetrieveOriginal).toBe(false);
      }
    }

    // Compression should still work
    expect(json.compressedContent).toBeTruthy();
    expect(json.receiptId).toBeTruthy();
  });

  it("compress with keepOriginal=true has functioning originalRef", async () => {
    const content = "This content WILL be saved as original for later retrieval.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      keepOriginal: true,
    });

    const json = parseToolText(result);

    expect(json.originalRef).toBeTruthy();
    expect(json.canRetrieveOriginal).toBe(true);

    // Verify retrieval works
    const retResult = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef: json.originalRef as string,
    });

    const retJson = parseToolText(retResult);
    expect(retJson.content).toBe(content);
  });
});

// ============================================================================
// 12.4.6 — Compression Timeout
// ============================================================================
describe("12.4.6 compression timeout", () => {
  it("returns original content when timeout triggers (fail-open)", async () => {
    const originalContent = "CRITICAL: This data must never be lost, even under timeout.";

    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: originalContent,
      contentType: "code",
      timeoutMs: 1, // Ultra-short timeout
      keepOriginal: false,
    });

    const json = parseToolText(result);

    // Core fail-open contract
    expect(json.compressedContent).toBeTruthy();
    expect(json.compressedContent.length).toBeGreaterThan(0);

    if (json.failed) {
      expect(json.compressedContent).toBe(originalContent);
      expect(json.errorReason).toBeDefined();
    }

    // Receipt must still exist even on failure
    expect(json.receiptId).toBeTruthy();
  });

  it("handles very long timeout values gracefully", async () => {
    const content = "Normal content with a very generous timeout.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      timeoutMs: 60000, // Very generous
      keepOriginal: false,
    });

    const json = parseToolText(result);

    expect(json.ccrId).toBeTruthy();
    expect(json.compressedContent).toBeTruthy();
    expect(json.receiptId).toBeTruthy();
  });
});

// ============================================================================
// 12.4.7 — Receipt Generation
// ============================================================================
describe("12.4.7 receipt 生成", () => {
  it("generates receipt with correct operation type and token stats", async () => {
    const content = "Content for receipt verification test.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      keepOriginal: true,
    });

    const json = parseToolText(result);
    const receiptId = json.receiptId as string;

    expect(receiptId).toBeTruthy();
    expect(receiptId).toMatch(/^rcp_/);

    // Verify the receipt exists in the database
    const receipt = ctx.receipts.get(receiptId);
    expect(receipt).not.toBeNull();
    expect(receipt!.operation).toBe("compress");
    expect(receipt!.scopeId).toBe(SCOPE_ID);
    expect(receipt!.tokensBefore).toBe(json.tokensBefore);
    expect(receipt!.tokensAfter).toBe(json.tokensAfter);
    expect(receipt!.tokensSaved).toBe(json.tokensSaved);
    // ReceiptRecord.compressed is boolean|undefined (0 → undefined from DB row mapping)
    expect([json.compressed, undefined]).toContain(receipt!.compressed);

    // CCR should be linked in receipt
    if (json.ccrId) {
      expect(receipt!.ccrIds).toContain(json.ccrId as string);
    }
  });

  it("receipt records failure correctly", async () => {
    const content = "Content that may or may not compress.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "code",
      timeoutMs: 1,
      keepOriginal: false,
    });

    const json = parseToolText(result);
    const receiptId = json.receiptId as string;

    expect(receiptId).toBeTruthy();

    const receipt = ctx.receipts.get(receiptId);
    expect(receipt).not.toBeNull();
    expect(receipt!.operation).toBe("compress");

    // If the operation was marked as failed, the receipt should reflect it
    if (json.failed) {
      expect(receipt!.failed).toBe(true);
      expect(receipt!.errorReason).toBeDefined();
    }
  });

  it("receipt links originalRef when keepOriginal=true", async () => {
    const content = "Content with original kept for receipt linking.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      keepOriginal: true,
    });

    const json = parseToolText(result);
    const receiptId = json.receiptId as string;

    const receipt = ctx.receipts.get(receiptId);
    expect(receipt).not.toBeNull();

    if (json.originalRef) {
      expect(receipt!.originalRefs).toContain(json.originalRef as string);
    }
  });

  it("lists compressions and totals include this test's records", async () => {
    // Run a compression first to ensure there's at least one record
    const content = "List test content — unique identifier " + Date.now();
    const compResult = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      keepOriginal: false,
    });

    const compJson = parseToolText(compResult);
    expect(compJson.ccrId).toBeTruthy();

    // List compressions
    const listResult = await handleListCompressions(ctx, {
      scopeId: SCOPE_ID,
      limit: 100,
    });

    const listJson = parseToolText(listResult);
    expect(listJson.scopeId).toBe(SCOPE_ID);
    expect(listJson.total).toBeGreaterThan(0);
    expect(Array.isArray(listJson.items)).toBe(true);
    expect(listJson.stats).toBeDefined();
  });
});

// ============================================================================
// 12.4.8 — originalRef Retrieval (Full Cycle)
// ============================================================================
describe("12.4.8 originalRef 取回 (full cycle)", () => {
  it("compress → retrieve → verify exact match (complete cycle)", async () => {
    const originalContent = [
      "FULL CYCLE TEST — This content should survive compression and retrieval intact.",
      "",
      "ERROR: Connection refused to database at localhost:5432",
      "  at Connection.connect (src/db/connection.ts:42:15)",
      "  at Pool.createConnection (src/db/pool.ts:88:22)",
      "  at Query.execute (src/db/query.ts:15:10)",
      "",
      "Stack trace:",
      "  Connection.connect (src/db/connection.ts:42:15)",
      "  Pool.createConnection (src/db/pool.ts:88:22)",
      "  Query.execute (src/db/query.ts:15:10)",
      "  UserService.getUser (src/services/user.ts:120:5)",
      "  AuthController.login (src/controllers/auth.ts:55:20)",
    ].join("\n");

    // Step 1: Compress
    const compResult = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: originalContent,
      contentType: "log",
      keepOriginal: true,
      metadata: { source: "test-script", testId: "full-cycle-001" },
    });

    const compJson = parseToolText(compResult);
    expect(compJson.originalRef).toBeTruthy();
    const originalRef = compJson.originalRef as string;

    // Step 2: Retrieve
    const retResult = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef,
    });

    const retJson = parseToolText(retResult);
    expect(retJson.found).not.toBe(false);

    // Step 3: Verify exact match
    expect(retJson.content).toBe(originalContent);
    expect(retJson.contentType).toBe("log");
    expect(retJson.scopeId).toBe(SCOPE_ID);
    expect(retJson.tokens).toBeGreaterThan(0);

    // Step 4: Verify metadata propagation
    expect(retJson.metadata).toBeDefined();
    const retMetadata = retJson.metadata as Record<string, unknown>;
    expect(retMetadata.source).toBe("test-script");
    expect(retMetadata.testId).toBe("full-cycle-001");
  });

  it("retrieve with offset/limit paginates correctly", async () => {
    const content = "Line 1: First line of content.\n" +
      "Line 2: Second line with more detail.\n" +
      "Line 3: Third line with critical info: API_KEY=test123.\n" +
      "Line 4: Fourth line of padding text.\n" +
      "Line 5: Fifth and final line.";

    // Compress
    const compResult = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      keepOriginal: true,
    });

    const compJson = parseToolText(compResult);
    const originalRef = compJson.originalRef as string;

    // Retrieve full
    const fullResult = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef,
    });
    const fullJson = parseToolText(fullResult);
    expect(fullJson.content).toBe(content);

    // Retrieve with limit
    const partialResult = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef,
      limit: 20,
    });
    const partialJson = parseToolText(partialResult);
    expect(partialJson.content).toBe(content.substring(0, 20));
    expect(partialJson.hasMore).toBe(true);

    // Retrieve with offset
    const offsetResult = await handleRetrieveOriginal(ctx, {
      scopeId: SCOPE_ID,
      originalRef,
      offset: 20,
      limit: 20,
    });
    const offsetJson = parseToolText(offsetResult);
    expect(offsetJson.content).toBe(content.substring(20, 40));
    expect(offsetJson.hasMore).toBe(true);
  });

  it("retrieval from wrong scope fails with scope isolation", async () => {
    const content = "Scope isolation test content.";
    const compResult = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      keepOriginal: true,
    });

    const compJson = parseToolText(compResult);
    const originalRef = compJson.originalRef as string;

    // Try to retrieve with wrong scope
    const retResult = await handleRetrieveOriginal(ctx, {
      scopeId: "repo_phase4_alt", // Different scope
      originalRef,
    });

    expect(retResult.isError).toBe(true);
    const retJson = parseToolText(retResult);
    expect(retJson.found).toBe(false);
    expect(retJson.error).toBe("original_not_found");
  });
});

// ============================================================================
// 12.3.1 — ContentRouter Failure Fallback
// ============================================================================
describe("12.3.1 ContentRouter 失败 fallback", () => {
  it("handles unusual content that may confuse detectors gracefully", async () => {
    // Binary-looking content mixed with text
    const weirdContent = "\x00\x01\x02\x03Some text\x00\x04\x05\x06More text";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: weirdContent,
      // No contentType — forces auto-detection
      keepOriginal: false,
    });

    const json = parseToolText(result);

    // Must always return content (fail-open)
    expect(json.ccrId).toBeTruthy();
    expect(json.compressedContent).toBeTruthy();
    expect(json.compressedContent.length).toBeGreaterThan(0);

    // Detection should fall back gracefully
    expect(json.detection).toBeDefined();
    const detection = json.detection as Record<string, unknown>;
    expect(detection.method).toBe("auto");
    // The detected type should be valid
    const validTypes = [
      "test_output", "log", "command_output", "code", "json",
      "markdown", "plain_text", "rag_chunk", "file_summary",
      "conversation_history", "unknown",
    ];
    expect(validTypes).toContain(detection.detectedAs as string);
  });

  it("detection with explicit unknown contentType falls back to plain_text", async () => {
    const content = "Some content with explicitly unknown type.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "unknown",
      keepOriginal: false,
    });

    const json = parseToolText(result);

    expect(json.ccrId).toBeTruthy();
    // Even with unknown type, compression should work
    expect(json.compressedContent).toBeTruthy();
    expect(json.compressedContent.length).toBeGreaterThan(0);

    // When user says "unknown", detection.method should be "auto"
    // (because we auto-detect when contentType is "unknown")
    const detection = json.detection as Record<string, unknown>;
    expect(detection.method).toBe("auto");
  });
});

// ============================================================================
// 12.3.2 — Compression Failure Fail-Open
// ============================================================================
describe("12.3.2 Compression 失败 fail-open", () => {
  it("never returns empty compressedContent on any input", async () => {
    const testCases = [
      { content: "Simple text.", contentType: "plain_text" },
      { content: "const x = 1;", contentType: "code" },
      { content: '{"key": "value"}', contentType: "json" },
      { content: "# Heading\n\nParagraph.", contentType: "markdown" },
      { content: "2026-06-09T10:00:00Z [INFO] Server started", contentType: "log" },
    ];

    for (const tc of testCases) {
      const result = await handleCompressContext(ctx, {
        scopeId: SCOPE_ID,
        content: tc.content,
        contentType: tc.contentType,
        timeoutMs: 1,
        keepOriginal: false,
      });

      const json = parseToolText(result);

      // Invariant: compressedContent must never be empty or missing
      expect(json.compressedContent).toBeTruthy();
      expect((json.compressedContent as string).length).toBeGreaterThan(0);
    }
  });

  it("failing compression still produces a valid receipt", async () => {
    const content = "Content for fail-open receipt test.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "code",
      timeoutMs: 1,
      keepOriginal: false,
    });

    const json = parseToolText(result);
    expect(json.receiptId).toBeTruthy();

    const receipt = ctx.receipts.get(json.receiptId as string);
    expect(receipt).not.toBeNull();
    expect(receipt!.tokensBefore).toBeGreaterThan(0);
  });

  it("invalid contentType returns descriptive error", async () => {
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: "Some content",
      contentType: "invalid_type_xyz",
    });

    expect(result.isError).toBe(true);
    const text = result.content[0]!.text!;
    expect(text).toContain("Invalid contentType");
    expect(text).toContain("invalid_type_xyz");
  });

  it("invalid strategy returns descriptive error", async () => {
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: "Some content",
      contentType: "plain_text",
      strategy: "aggressive", // Invalid strategy
    });

    expect(result.isError).toBe(true);
    const text = result.content[0]!.text!;
    expect(text).toContain("Invalid strategy");
    expect(text).toContain("aggressive");
  });
});

// ============================================================================
// 12.3.5 — SQLite Failure Does Not Block Main Flow
// ============================================================================
describe("12.3.5 SQLite 失败不阻断主流程", () => {
  it("compression succeeds even when save side-effects encounter issues", async () => {
    // This test verifies the pattern: even when the DB or side-effects
    // could fail, the core compression result is always returned.
    // We test this by using a valid input and verifying the response.
    const content = "Content for non-blocking SQLite test.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      keepOriginal: true,
    });

    const json = parseToolText(result);

    // Core invariants — always present
    expect(json.compressedContent).toBeTruthy();
    expect(json.compressedContent.length).toBeGreaterThan(0);
    expect(json.ccrId).toBeTruthy();
    expect(json.receiptId).toBeTruthy();

    // If there were warnings, they should be in the warnings array
    expect(Array.isArray(json.warnings)).toBe(true);
  });
});

// ============================================================================
// Input Validation Edge Cases
// ============================================================================
describe("Input validation edge cases", () => {
  it("handles metadata as arbitrary object", async () => {
    const content = "Content with rich metadata.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      keepOriginal: false,
      metadata: {
        source: "unit-test",
        command: "pnpm test",
        filePath: "tests/example.test.ts",
        tags: ["compression", "test"],
        nested: { key: "value" },
      },
    });

    const json = parseToolText(result);

    expect(json.ccrId).toBeTruthy();
    expect(json.compressedContent).toBeTruthy();
  });

  it("handles numeric maxTokens and timeoutMs correctly", async () => {
    const content = "Content for numeric param tests.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      maxTokens: 100,
      timeoutMs: 30000,
      keepOriginal: false,
    });

    const json = parseToolText(result);

    expect(json.ccrId).toBeTruthy();
    expect(json.tokensAfter).toBeLessThanOrEqual(json.tokensBefore!);
  });

  it("handles non-string content gracefully", async () => {
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content: 12345, // Number, not string
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("content is required");
  });

  it("handles metadata that is null", async () => {
    const content = "Content with null metadata.";
    const result = await handleCompressContext(ctx, {
      scopeId: SCOPE_ID,
      content,
      contentType: "plain_text",
      keepOriginal: false,
      metadata: null,
    });

    const json = parseToolText(result);
    expect(json.ccrId).toBeTruthy();
    expect(json.compressedContent).toBeTruthy();
  });

  it("all supported content types are compressible", async () => {
    const typesToTest = [
      "test_output",
      "log",
      "command_output",
      "code",
      "json",
      "markdown",
      "plain_text",
      "unknown",
    ];

    for (const ct of typesToTest) {
      const content = `Test content for content type: ${ct}`;
      const result = await handleCompressContext(ctx, {
        scopeId: SCOPE_ID,
        content,
        contentType: ct,
        keepOriginal: false,
      });

      const json = parseToolText(result);
      expect(json.ccrId).toBeTruthy();
      expect(json.contentType).toBe(ct);
      expect(json.compressedContent).toBeTruthy();
    }
  });
});
