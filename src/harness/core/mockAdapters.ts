/**
 * Mock Adapters for Harness Check Runtime
 *
 * Provides stub adapters so flows can execute during check runs
 * without requiring real services (database, MCP server, CLI binary).
 *
 * Each mock returns sensible defaults that let the flow complete
 * its full execution path, producing state.json, output.json,
 * logs.jsonl, and artifact files.
 *
 * PRD §12.1: runtime check 需要 mock adapter。
 */

import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import type { CodeContextAdapter, CompressResult } from "../adapters/codeContextAdapter.js";
import type { McpAdapter } from "../adapters/mcpAdapter.js";
import type { CliAdapter } from "../adapters/cliAdapter.js";
import { execRaw, runStmt } from "../../storage/db.js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Schema Loading ─────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the path to schema.sql for mock database initialization.
 */
function findSchemaPath(): string {
  const candidates = [
    join(__dirname, "..", "..", "storage", "schema.sql"),
    join(__dirname, "..", "..", "..", "src", "storage", "schema.sql"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Fallback: try relative to cwd
  const cwdCandidates = [
    join(process.cwd(), "src", "storage", "schema.sql"),
    join(process.cwd(), "dist", "storage", "schema.sql"),
  ];
  for (const p of cwdCandidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "Cannot find schema.sql for mock database initialization. " +
      "Searched: " + [...candidates, ...cwdCandidates].join(", "),
  );
}

// ── In-Memory Database Factory ─────────────────────────────────────────────────

let _mockDbCache: Database | null = null;
let _mockDbInit = false;

/**
 * Create or retrieve a cached in-memory sql.js database
 * with the full CodeContext schema for mock adapter use.
 */
export async function getMockDatabase(): Promise<Database> {
  if (_mockDbInit && _mockDbCache) return _mockDbCache;

  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Run migrations
  let schemaOk = false;
  try {
    const schemaPath = findSchemaPath();
    const schemaSql = readFileSync(schemaPath, "utf-8");
    execRaw(db, schemaSql);
    db.run("PRAGMA foreign_keys = ON");
    schemaOk = true;
  } catch (err) {
    // Best-effort: if schema loading fails, the mock adapter
    // will still work but some operations may behave oddly.
    console.warn(`[mockAdapters] Schema loading failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Ensure the "harness" scope exists so receipt creation doesn't fail FK constraints
  try {
    runStmt(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES ('harness', '/harness', 'cwdFallback', datetime('now'), datetime('now'))`,
    );
  } catch {
    // Best-effort
  }

  // Only cache if schema loaded successfully — otherwise, return uncached
  // so future calls can retry (e.g. after project structure changes).
  if (schemaOk) {
    _mockDbCache = db;
    _mockDbInit = true;
  } else {
    // Don't cache a broken DB, but mark init so we don't infinite-loop
    _mockDbInit = true;
  }
  return db;
}

/** Reset the mock database cache (useful between test runs). */
export function resetMockDatabase(): void {
  if (_mockDbCache) {
    _mockDbCache.close();
    _mockDbCache = null;
  }
  _mockDbInit = false;
  // Also reset the adapter-level cache so getAdapterDb() doesn't return
  // a reference to the now-closed DB.
  if (_mockAdapterDb) {
    _mockAdapterDb = null;
  }
  mockIdCounter = 0;
}

// ── Mock CodeContext Adapter ───────────────────────────────────────────────────

let _mockAdapterDb: Database | null = null;

async function getAdapterDb(): Promise<Database> {
  if (!_mockAdapterDb) {
    _mockAdapterDb = await getMockDatabase();
  }
  return _mockAdapterDb;
}

/** Counter for generating unique mock IDs. */
let mockIdCounter = 0;
function mockId(prefix: string): string {
  return `${prefix}_mock_${Date.now()}_${mockIdCounter++}`;
}

/**
 * Create a mock CodeContextAdapter backed by an in-memory sql.js database.
 *
 * Each method returns sensible stub values that allow flows to execute
 * without real services. The adapter does NOT call real compression,
 * memory, or original storage logic — it returns pre-computed results.
 */
export async function createMockCodeContextAdapter(): Promise<CodeContextAdapter> {
  const db = await getAdapterDb();

  // Track created resources for cleanup
  const createdCcrIds: string[] = [];
  const createdMemoryIds: string[] = [];

  const adapter: CodeContextAdapter = {
    db,

    // ── Scope ───────────────────────────────────────────────────────────────

    runCurrentScope() {
      return {
        scopeId: "mock_scope",
        cwd: "/mock/project",
        gitRoot: "/mock/project",
        remote: "https://github.com/mock/repo.git",
        branch: "main",
        scopeStrategy: "gitRootOnly" as const,
      };
    },

    // ── Compression ─────────────────────────────────────────────────────────

    async runCompressContext(content, opts = {}) {
      const ccrId = mockId("ccr");
      const receiptId = mockId("receipt");
      const originalRef = mockId("orig");
      const tokensBefore = Math.ceil(content.length / 4);
      const compressedLen = Math.ceil(content.length * 0.6);
      const tokensAfter = Math.ceil(compressedLen / 4);
      const tokensSaved = tokensBefore - tokensAfter;

      createdCcrIds.push(ccrId);

      // Try to persist a minimal CCR record for retrieval to work
      try {
        runStmt(
          db,
          `INSERT OR IGNORE INTO compressed_contexts
           (id, scope_id, content_type, strategy, compressed_content,
            summary, source_ref, original_ref, tokens_before, tokens_after,
            tokens_saved, compression_ratio, can_retrieve_original, retrieve_count,
            failed, error_reason, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            ccrId, "mock_scope", opts.contentType ?? "plain_text",
            opts.strategy ?? "conservative", content.slice(0, compressedLen),
            "mock summary", (opts.metadata?.source as string) ?? null,
            originalRef, tokensBefore, tokensAfter,
            tokensSaved, tokensSaved / Math.max(1, tokensBefore),
            1, 0, null, "{}",
          ],
        );
      } catch {
        // Best-effort: persistence failure shouldn't block mock
      }

      // Try to persist original content for retrieval
      // Schema: id, scope_id, ccr_id, content_type, content, content_hash,
      //         tokens, metadata, created_at, expires_at
      try {
        const contentHash = String(content.length); // mock hash
        runStmt(
          db,
          `INSERT OR IGNORE INTO original_contents
           (id, scope_id, ccr_id, content_type, content, content_hash,
            tokens, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            originalRef, "mock_scope", ccrId, opts.contentType ?? "plain_text",
            content, contentHash, tokensBefore, "{}",
          ],
        );
      } catch {
        // Best-effort
      }

      const result: CompressResult = {
        ccrId,
        compressed: true,
        scopeId: "mock_scope",
        contentType: opts.contentType ?? "plain_text",
        strategy: opts.strategy ?? "conservative",
        compressedContent: content.slice(0, compressedLen),
        summary: "mock summary",
        originalRef,
        tokensBefore,
        tokensAfter,
        tokensSaved,
        compressionRatio: tokensSaved / Math.max(1, tokensBefore),
        canRetrieveOriginal: true,
        receiptId,
        failed: false,
        warnings: [],
        detection: opts.contentType
          ? { method: "user", specifiedType: opts.contentType }
          : { method: "auto", detectedAs: "plain_text", confidence: 0.8 },
      };
      return result;
    },

    // ── Retrieve Original ─────────────────────────────────────────────────

    async runRetrieveOriginal(ccrId) {
      // Try real lookup first
      try {
        const rows = db.exec(
          "SELECT content, content_type FROM original_contents WHERE ccr_id = ? LIMIT 1",
          [ccrId],
        );
        if (rows.length > 0 && rows[0] && rows[0].values.length > 0) {
          const row = rows[0].values[0];
          if (row) {
            return {
              content: String(row[0]),
              contentType: String(row[1]),
            };
          }
        }
      } catch {
        // Fall through to mock
      }
      return null;
    },

    // ── Delete Original ───────────────────────────────────────────────────

    async runDeleteOriginal(_ccrId) {
      return true;
    },

    // ── Remember ──────────────────────────────────────────────────────────

    runRememberContext(content, type, tags) {
      const memoryId = mockId("mem");
      createdMemoryIds.push(memoryId);

      try {
        runStmt(
          db,
          `INSERT OR IGNORE INTO memories
           (id, scope_id, type, content, status, confidence, tags,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            memoryId, "mock_scope", type, content, "active", 0.8,
            tags ? JSON.stringify(tags) : "[]",
          ],
        );
      } catch {
        // Best-effort
      }

      return {
        memoryId,
        scopeId: "mock_scope",
        type: type as import("../../memory/types.js").MemoryType,
        status: "active" as import("../../memory/types.js").MemoryStatus,
        receiptId: mockId("receipt"),
      };
    },

    // ── Recall ────────────────────────────────────────────────────────────

    runRecallContext(_query, _limit?) {
      return {
        items: createdMemoryIds.map((id, i) => ({
          id,
          content: `Mock memory content ${i}`,
          type: "project_rule" as import("../../memory/types.js").MemoryType,
          status: "active" as import("../../memory/types.js").MemoryStatus,
          score: 0.9 - i * 0.1,
          confidence: 0.8,
          rank: i + 1,
          canExpand: false,
        })),
        total: createdMemoryIds.length,
      };
    },

    // ── Forget ────────────────────────────────────────────────────────────

    runForgetContext(id, mode) {
      if (!createdMemoryIds.includes(id)) return null;
      return {
        memoryId: id,
        previousStatus: "active" as import("../../memory/types.js").MemoryStatus,
        newStatus: (mode === "hard_delete" ? "forgotten" : "superseded") as import("../../memory/types.js").MemoryStatus,
        receiptId: mockId("receipt"),
      };
    },

    // ── List ──────────────────────────────────────────────────────────────

    runListContext(_status?, _limit?, _offset?) {
      return {
        scopeId: "mock_scope",
        items: createdMemoryIds.map((id) => ({
          id,
          scopeId: "mock_scope",
          type: "project_rule" as import("../../memory/types.js").MemoryType,
          content: "Mock memory",
          status: "active" as import("../../memory/types.js").MemoryStatus,
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
        total: createdMemoryIds.length,
        limit: _limit ?? 50,
        offset: _offset ?? 0,
      };
    },

    // ── Analyze ───────────────────────────────────────────────────────────

    runAnalyzeContext(_content, _query?) {
      return {
        shouldCompress: { value: true, confidence: 0.8, reasons: ["content is long enough for compression"] },
        shouldRecall: { value: false, confidence: 0.5, reasons: ["no relevant query context"] },
        shouldSaveMemory: { value: false, confidence: 0.5, reasons: ["mock analysis"] },
        shouldRetrieveOriginal: { value: false, confidence: 0.5, reasons: ["mock analysis"] },
        reasons: ["mock analysis"],
        suggestedTools: [],
        stats: {
          contentLength: _content.length,
          estimatedTokens: Math.ceil(_content.length / 4),
          contentType: "unknown",
          errorDensity: 0,
          repetitionRatio: 0,
          lineCount: _content.split("\n").length,
        },
      };
    },

    // ── Failure Stats ─────────────────────────────────────────────────────

    runFailureStats() {
      return {
        scopeId: "mock_scope",
        totalEvents: 0,
        byEventType: {},
        byOperation: {},
        recentEvents: 0,
        topCcrIds: [],
      };
    },

    // ── Cleanup Originals ─────────────────────────────────────────────────

    runCleanupOriginals() {
      return { deleted: 0, affectedCcrIds: [] };
    },
  };

  return adapter;
}

// ── Mock MCP Adapter ───────────────────────────────────────────────────────────

/**
 * Create a mock MCP adapter that returns stub results.
 *
 * Each callTool returns a success result with placeholder content.
 * This lets the MCP smoke flow execute without a real MCP server.
 */
export function createMockMcpAdapter(): McpAdapter {
  return {
    async callTool(toolName, _args) {
      return {
        toolName,
        content: [{ type: "text", text: `mock result for ${toolName}` }],
        isError: false,
      };
    },
  };
}

// ── Mock CLI Adapter ───────────────────────────────────────────────────────────

/**
 * Create a mock CLI adapter that returns stub results.
 *
 * Each run returns exit code 0 with placeholder stdout.
 * This lets the CLI smoke flow execute without a real binary.
 */
export function createMockCliAdapter(): CliAdapter {
  return {
    async run(args) {
      return {
        stdout: `mock stdout for: code-context ${args.join(" ")}`,
        stderr: "",
        exitCode: 0,
      };
    },
  };
}
