/**
 * Phase 11 Integration Tests — runContextFlow Tool Handler
 *
 * Covers the complete run_context_flow MCP tool:
 *   - Input validation (missing flow, invalid flow, missing content, invalid contentType)
 *   - Compression flow (basic, +saveMemory, +includeRecall, no keepOriginal, auto scope)
 *   - Memory flow (remember only, recall only, remember+recall, missing content+query)
 *   - Full flow (complete chain, without query, with goal)
 *   - Error resilience (compression fail-open, ContentRouter fallback)
 *   - Receipt audit (compression receipt, full flow nested receipts)
 *   - Response structure (required fields, runId format, status values)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import {
  getDb,
  closeDb,
  queryAll,
  queryOne,
  runStmt,
} from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { handleRunContextFlow } from "../src/mcp/tools/runContextFlow.js";
import { registerAllStrategies } from "../src/compression/registerStrategies.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../src/mcp/server.js";

let db: Database;
let ctx: ServerContext;

const SCOPE_ID = "repo_flow_test";

function ensureScope(scopeId?: string) {
  const id = scopeId ?? SCOPE_ID;
  runStmt(
    db,
    `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
     VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`,
    [id, process.cwd()],
  );
}

function parseToolText(result: {
  content: { type: string; text?: string }[];
}): Record<string, unknown> {
  const text = result.content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

function isError(result: {
  content: { type: string; text?: string }[];
  isError?: boolean;
}): boolean {
  return result.isError === true;
}

// Reusable test content with enough tokens to trigger compression
const SAMPLE_LOG_CONTENT = [
  "FAIL  tests/auth.test.ts > login > should refresh token on expiry",
  "Error: Expected 200 but got 401",
  "  at AuthService.refreshToken (src/auth/service.ts:42:15)",
  "  at processLogin (src/auth/login.ts:18:3)",
  "  at runTest (tests/auth.test.ts:156:7)",
  "",
  "FAIL  tests/auth.test.ts > logout > should clear session cookie",
  "Error: Expected cookie 'session' to be cleared",
  "  at AuthService.logout (src/auth/service.ts:78:10)",
  "  at runTest (tests/auth.test.ts:204:7)",
  "",
  "FAIL  tests/api.test.ts > rate limit > should return 429 after threshold",
  "Error: Expected 429 but got 200",
  "  at RateLimiter.check (src/middleware/rateLimit.ts:33:12)",
  "  at runTest (tests/api.test.ts:89:7)",
  "",
].join("\n");

const SAMPLE_LONG_CONTENT = (SAMPLE_LOG_CONTENT + "\n").repeat(20); // ~3KB, enough for compression

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("run_context_flow Tool Handler", () => {
  beforeAll(async () => {
    await initAndMigrate(":memory:");
    db = getDb();
    ctx = { db, receipts: new ReceiptService(db) };
    ensureScope();
    // Register compression strategies
    registerAllStrategies();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    // Clean tables in FK-safe order
    try {
      db.exec("DELETE FROM memories_fts");
    } catch {
      /* may not exist */
    }
    db.exec("DELETE FROM profile_facts");
    db.exec("DELETE FROM receipts");
    db.exec("DELETE FROM memories");
    db.exec("DELETE FROM original_contents");
    db.exec("DELETE FROM compressed_contexts");
    db.exec("DELETE FROM failure_events");
    // Re-seed scope
    ensureScope();
  });

  // ==========================================================================
  // 1. Input Validation
  // ==========================================================================

  describe("Input Validation", () => {
    it("rejects missing flow", async () => {
      const result = await handleRunContextFlow(ctx, {});
      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("flow is required");
    });

    it("rejects invalid flow", async () => {
      const result = await handleRunContextFlow(ctx, { flow: "invalid" });
      expect(isError(result)).toBe(true);
      const text = result.content[0]!.text!;
      expect(text).toContain("Invalid flow");
      expect(text).toContain("compression");
      expect(text).toContain("memory");
      expect(text).toContain("full");
    });

    it("rejects compression without content", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("content is required");
    });

    it("rejects full without content", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "full",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("content is required");
    });

    it("rejects invalid contentType", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: "test",
        contentType: "invalid_type",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("Invalid contentType");
    });

    it("rejects memory without content or query", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        scopeId: SCOPE_ID,
      });
      expect(isError(result)).toBe(true);
      expect(result.content[0]!.text!).toContain("content");
      expect(result.content[0]!.text!).toContain("query");
    });
  });

  // ==========================================================================
  // 2. Compression Flow
  // ==========================================================================

  describe("Compression Flow", () => {
    it("compresses content successfully", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.flow).toBe("compression");
      expect(data.status).toBe("ok");
      expect(typeof data.runId).toBe("string");
      expect(data.runId).toMatch(/^flow_/);
      expect(typeof data.summary).toBe("string");
      expect(data.ccrId).toBeDefined();
      expect(data.compressedContent).toBeDefined();
      expect(data.originalRef).toBeDefined();
      expect(typeof data.tokensBefore).toBe("number");
      expect(typeof data.tokensAfter).toBe("number");
      expect(typeof data.tokensSaved).toBe("number");
      expect(typeof data.compressionRatio).toBe("number");
      expect(data.receiptId).toBeDefined();
      expect(Array.isArray(data.warnings)).toBe(true);
    });

    it("returns the existing CCR for identical compression input", async () => {
      const request = {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        options: { keepOriginal: false, maxTokens: 700 },
      };

      const first = parseToolText(await handleRunContextFlow(ctx, request));
      const second = parseToolText(await handleRunContextFlow(ctx, request));

      expect(second.ccrId).toBe(first.ccrId);
      expect(second.warnings).toContainEqual(
        expect.stringContaining("cacheHit=true"),
      );

      const row = queryOne(
        db,
        `SELECT COUNT(*) AS count, MIN(cache_key) AS cache_key
         FROM compressed_contexts WHERE scope_id = ?`,
        [SCOPE_ID],
      );
      expect(Number(row?.count)).toBe(1);
      expect(typeof row?.cache_key).toBe("string");
      expect(row?.cache_key).not.toBe("");
    });

    it("separates cache keys by content, scope, content type, and strategy parameters", async () => {
      const otherScope = `${SCOPE_ID}_other`;
      ensureScope(otherScope);
      const base = {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        options: { keepOriginal: false, maxTokens: 700 },
      };

      await handleRunContextFlow(ctx, base);
      await handleRunContextFlow(ctx, {
        ...base,
        content: `${SAMPLE_LONG_CONTENT}\ndifferent`,
      });
      await handleRunContextFlow(ctx, { ...base, scopeId: otherScope });
      await handleRunContextFlow(ctx, { ...base, contentType: "log" });
      await handleRunContextFlow(ctx, {
        ...base,
        options: { keepOriginal: false, maxTokens: 701 },
      });
      await handleRunContextFlow(ctx, {
        ...base,
        options: { keepOriginal: true, maxTokens: 700 },
      });

      const rows = queryAll(
        db,
        `SELECT cache_key FROM compressed_contexts
         WHERE scope_id IN (?, ?)`,
        [SCOPE_ID, otherScope],
      );
      const keys = rows.map((row) => row.cache_key);
      expect(keys).toHaveLength(6);
      expect(
        keys.every((key) => typeof key === "string" && key.length > 0),
      ).toBe(true);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("converges concurrent retries on one CCR without UNIQUE warnings", async () => {
      const request = {
        flow: "compression",
        content: `${SAMPLE_LONG_CONTENT}\nconcurrent-cache-test`,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        options: { keepOriginal: false, maxTokens: 900 },
      };

      const results = await Promise.all(
        Array.from({ length: 6 }, () => handleRunContextFlow(ctx, request)),
      );
      const parsed = results.map(parseToolText);
      const ids = parsed.map((result) => result.ccrId);

      expect(new Set(ids).size).toBe(1);
      expect(
        parsed
          .flatMap((result) => result.warnings as string[])
          .some((warning) => warning.includes("UNIQUE constraint")),
      ).toBe(false);
      expect(
        Number(
          queryOne(
            db,
            `SELECT COUNT(*) AS count FROM compressed_contexts WHERE scope_id = ?`,
            [SCOPE_ID],
          )?.count,
        ),
      ).toBe(1);
    });

    it("saves memory when saveMemory is true", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        options: { saveMemory: true },
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.memories).toBeDefined();
      const mems = data.memories as Record<string, unknown>[];
      expect(mems.length).toBeGreaterThanOrEqual(1);
      // First memory should be the saved one
      const saved = mems.find((m) => !m.score);
      expect(saved).toBeDefined();
      expect(saved!.id).toMatch(/^mem_/);
    });

    it("runs recall when includeRecall is true with query", async () => {
      // First, save a memory so recall has something to find
      await handleRunContextFlow(ctx, {
        flow: "memory",
        content:
          "Project uses pnpm as package manager. Always use pnpm install.",
        scopeId: SCOPE_ID,
      });

      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        query: "package manager",
        options: { includeRecall: true },
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.status).toBe("ok");
      expect(data.profile).toBeDefined();
      expect(data.memories).toBeDefined();
      // May include both the recall results and the saved memory
    });

    it("does not save original when keepOriginal is false", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        options: { keepOriginal: false },
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.originalRef).toBeUndefined();
    });

    it("auto-resolves scope when scopeId is omitted", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        // no scopeId — should auto-resolve
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.status).toBe("ok");
    });
  });

  // ==========================================================================
  // 3. Memory Flow
  // ==========================================================================

  describe("Memory Flow", () => {
    it("remembers content when only content is provided", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "Always use tabs for indentation in this project.",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.flow).toBe("memory");
      expect(data.status).toBe("ok");
      expect(data.runId).toMatch(/^flow_/);
      expect(data.memories).toBeDefined();
      const mems = data.memories as Record<string, unknown>[];
      expect(mems.length).toBeGreaterThanOrEqual(1);
      expect(mems[0]!.id).toMatch(/^mem_/);
      expect(mems[0]!.type).toBe("file_summary");
      expect(mems[0]!.status).toBe("active");
      expect(data.receiptId).toBeDefined();
    });

    it("recalls when only query is provided (may return empty)", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        query: "indentation tabs",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.flow).toBe("memory");
      expect(data.status).toBe("ok");
      expect(data.profile).toBeDefined();
    });

    it("remembers and then recalls when both content and query provided", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "Project uses ESLint with strict TypeScript rules.",
        query: "ESLint TypeScript",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.status).toBe("ok");
      expect(data.memories).toBeDefined();
      // Should have at least the saved memory; may also have recall matches
      const mems = data.memories as Record<string, unknown>[];
      expect(mems.length).toBeGreaterThanOrEqual(1);
    });

    it("correctly recalls previously saved memory", async () => {
      // Save a memory first
      await handleRunContextFlow(ctx, {
        flow: "memory",
        content:
          "The database connection string is in .env.local — never commit it.",
        scopeId: SCOPE_ID,
      });

      // Now recall
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        query: "database connection string",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      const mems = data.memories as Record<string, unknown>[];
      const found = mems.filter(
        (m) =>
          typeof m.content === "string" &&
          m.content.includes("connection string"),
      );
      expect(found.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // 4. Full Flow
  // ==========================================================================

  describe("Full Flow", () => {
    it("runs full flow twice without UNIQUE constraint warnings", async () => {
      const request = {
        flow: "full",
        content: `${SAMPLE_LONG_CONTENT}\nsequential-full-flow-reliability`,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        query: "auth failure",
        memorySummary: {
          facts: ["Three test cases failed."],
          verificationStatus: "VERIFIED",
        },
      };

      const first = parseToolText(await handleRunContextFlow(ctx, request));
      const second = parseToolText(await handleRunContextFlow(ctx, request));
      const output = JSON.stringify([first, second]);

      expect(first.status).toBe("ok");
      expect(second.status).toBe("ok");
      expect(second.ccrId).toBe(first.ccrId);
      expect(output).not.toContain("UNIQUE constraint");
      expect(output).not.toContain("ccr:undefined");
    });

    it("skips auto-memory when verificationStatus is UNKNOWN", async () => {
      const data = parseToolText(
        await handleRunContextFlow(ctx, {
          flow: "full",
          content: SAMPLE_LONG_CONTENT,
          contentType: "test_output",
          scopeId: SCOPE_ID,
        }),
      );

      expect(data.memory).toMatchObject({
        status: "skipped",
        reason: "verificationStatus is UNKNOWN",
      });
      expect(
        queryOne<{ count: number }>(
          db,
          "SELECT COUNT(*) AS count FROM memories",
        )?.count,
      ).toBe(0);
    });

    it("skips contradictory summaries", async () => {
      const data = parseToolText(
        await handleRunContextFlow(ctx, {
          flow: "full",
          content: "# Architecture\nThe service uses SQLite.",
          contentType: "markdown",
          scopeId: SCOPE_ID,
          memorySummary: {
            facts: ["The service uses SQLite."],
            inferences: [],
            verificationStatus: "CONTRADICTORY",
          },
        }),
      );

      expect(data.memory).toMatchObject({
        status: "skipped",
        reason: "summary is contradictory",
      });
      expect(
        queryOne<{ count: number }>(
          db,
          "SELECT COUNT(*) AS count FROM memories",
        )?.count,
      ).toBe(0);
    });

    it("honors saveMemory=false", async () => {
      const data = parseToolText(
        await handleRunContextFlow(ctx, {
          flow: "full",
          content: "# Architecture\nThe service uses SQLite.",
          contentType: "markdown",
          scopeId: SCOPE_ID,
          memorySummary: {
            facts: ["The service uses SQLite."],
            verificationStatus: "VERIFIED",
          },
          options: { saveMemory: false },
        }),
      );

      expect(data.memory).toMatchObject({
        status: "skipped",
        reason: "not requested",
      });
      expect(
        queryOne<{ count: number }>(
          db,
          "SELECT COUNT(*) AS count FROM memories",
        )?.count,
      ).toBe(0);
    });

    it("stores only verified facts and originalRef for test output", async () => {
      const data = parseToolText(
        await handleRunContextFlow(ctx, {
          flow: "full",
          content: SAMPLE_LONG_CONTENT,
          contentType: "test_output",
          scopeId: SCOPE_ID,
          memorySummary: {
            facts: ["Three test cases failed."],
            inferences: ["The auth module may be broadly broken."],
            verificationStatus: "VERIFIED",
          },
        }),
      );

      expect(data.memory).toMatchObject({ status: "ok" });
      const saved = (data.memories as Record<string, unknown>[])[0]!;
      expect(saved).toMatchObject({
        facts: ["Three test cases failed."],
        inferences: [],
        verificationStatus: "VERIFIED",
        originalRef: data.originalRef,
      });
      const row = queryOne<{ content: string; source_ref: string }>(
        db,
        "SELECT content, source_ref FROM memories LIMIT 1",
      );
      expect(JSON.parse(row!.content)).toEqual({
        facts: ["Three test cases failed."],
        inferences: [],
        verificationStatus: "VERIFIED",
        originalRef: data.originalRef,
      });
      expect(row!.source_ref).toBe(`ccr:${data.ccrId}`);
    });

    it("requires originalRef for test, build, and security evidence", async () => {
      const data = parseToolText(
        await handleRunContextFlow(ctx, {
          flow: "full",
          content: SAMPLE_LONG_CONTENT,
          contentType: "test_output",
          scopeId: SCOPE_ID,
          memorySummary: {
            facts: ["Three test cases failed."],
            verificationStatus: "VERIFIED",
          },
          options: { keepOriginal: false },
        }),
      );

      expect(data.memory).toMatchObject({
        status: "skipped",
        reason: "verifiable output requires a persisted originalRef",
      });
      expect(
        queryOne<{ count: number }>(
          db,
          "SELECT COUNT(*) AS count FROM memories",
        )?.count,
      ).toBe(0);
    });

    it("filters inferences from build and security-scan memories", async () => {
      const cases = [
        {
          contentType: "command_output",
          content:
            "$ npm run build\nexit code: 0\nBuild completed successfully.",
          fact: "The build command exited with code 0.",
        },
        {
          contentType: "log",
          content: "Security scan completed: 0 critical vulnerabilities.",
          fact: "The security scan reported 0 critical vulnerabilities.",
        },
      ];

      for (const item of cases) {
        const data = parseToolText(
          await handleRunContextFlow(ctx, {
            flow: "full",
            content: item.content,
            contentType: item.contentType,
            scopeId: SCOPE_ID,
            memorySummary: {
              facts: [item.fact],
              inferences: ["The project is probably ready to release."],
              verificationStatus: "VERIFIED",
            },
          }),
        );

        expect(data.memory).toMatchObject({ status: "ok" });
        expect((data.memories as Record<string, unknown>[])[0]).toMatchObject({
          facts: [item.fact],
          inferences: [],
          verificationStatus: "VERIFIED",
          originalRef: data.originalRef,
        });
      }
    });

    it("allows explicitly unverified non-evidence summaries only when configured", async () => {
      const request = {
        flow: "full",
        content: "# Design note\nSQLite is a possible local storage choice.",
        contentType: "markdown",
        scopeId: SCOPE_ID,
        memorySummary: {
          facts: [],
          inferences: ["SQLite may be suitable for local storage."],
          verificationStatus: "UNVERIFIED",
        },
      };

      const rejected = parseToolText(await handleRunContextFlow(ctx, request));
      expect(rejected.memory).toMatchObject({
        status: "skipped",
        reason: "verified summary is required",
      });

      const admitted = parseToolText(
        await handleRunContextFlow(ctx, {
          ...request,
          options: { requireVerifiedSummary: false },
        }),
      );
      expect(admitted.memory).toMatchObject({ status: "ok" });
      expect((admitted.memories as Record<string, unknown>[])[0]).toMatchObject(
        {
          facts: [],
          inferences: ["SQLite may be suitable for local storage."],
          verificationStatus: "UNVERIFIED",
        },
      );
    });
    it("executes compress → remember → recall complete chain", async () => {
      // Pre-seed a memory for recall to find
      await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "Auth module uses JWT with RS256 algorithm for token signing.",
        scopeId: SCOPE_ID,
      });

      const result = await handleRunContextFlow(ctx, {
        flow: "full",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        query: "auth token JWT",
        goal: "Compress test failure log and find related auth context",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.flow).toBe("full");
      expect(data.status).toBe("ok");
      expect(data.runId).toMatch(/^flow_/);

      // Compression results
      expect(data.ccrId).toBeDefined();
      expect(data.compressedContent).toBeDefined();
      expect(data.originalRef).toBeDefined();
      expect(typeof data.tokensBefore).toBe("number");
      expect(typeof data.tokensAfter).toBe("number");
      expect(typeof data.tokensSaved).toBe("number");

      // Memory results
      expect(data.memories).toBeDefined();
      const mems = data.memories as Record<string, unknown>[];
      expect(mems.length).toBeGreaterThanOrEqual(1);

      // Profile
      expect(data.profile).toBeDefined();

      // Audit
      expect(data.receiptId).toBeDefined();

      // Goal echoed
      expect(data.goal).toBe(
        "Compress test failure log and find related auth context",
      );
    });

    it("handles full flow without query gracefully", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "full",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        // no query — recall is skipped
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.flow).toBe("full");
      // Should still compress and remember
      expect(data.ccrId).toBeDefined();
      // Status should be ok (recall skipped is not a failure)
      expect(data.status).toBe("ok");
    });

    it("uses goal as query fallback in full flow", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "full",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        goal: "debug session cookie refresh failure",
        // no explicit query — goal is used as query
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.goal).toBe("debug session cookie refresh failure");
      expect(data.status).toBe("ok");
    });
  });

  // ==========================================================================
  // 5. Error Resilience (Fail-Open)
  // ==========================================================================

  describe("Error Resilience", () => {
    it("returns failed when the only requested step fails", async () => {
      db.exec(`
        CREATE TRIGGER force_memory_failure
        BEFORE INSERT ON memories
        BEGIN
          SELECT RAISE(ABORT, 'forced memory failure');
        END
      `);

      try {
        const result = await handleRunContextFlow(ctx, {
          flow: "memory",
          content: "Remember this project rule.",
          scopeId: SCOPE_ID,
        });

        const data = parseToolText(result);
        expect(data.status).toBe("failed");
        expect(data.memory).toMatchObject({ status: "failed" });
        expect(["ok", "partial", "failed"]).toContain(data.status);
      } finally {
        db.exec("DROP TRIGGER IF EXISTS force_memory_failure");
      }
    });

    it("skips CCR-dependent memory when CCR persistence fails", async () => {
      db.exec(`
        CREATE TRIGGER force_ccr_persistence_failure
        BEFORE INSERT ON compressed_contexts
        BEGIN
          SELECT RAISE(ABORT, 'forced CCR persistence failure');
        END
      `);

      try {
        const result = await handleRunContextFlow(ctx, {
          flow: "full",
          content: SAMPLE_LONG_CONTENT,
          contentType: "test_output",
          scopeId: SCOPE_ID,
          query: "auth failure",
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.status).toBe("partial");
        expect(data.ccrId).toBeUndefined();
        expect(data.ccrPersistence).toMatchObject({ status: "failed" });
        expect(data.originalPersistence).toMatchObject({
          status: "skipped",
          reason: "CCR persistence failed",
        });
        expect(data.memory).toMatchObject({
          status: "skipped",
          reason: "CCR persistence failed",
        });
        expect(JSON.stringify(data)).not.toContain("ccr:undefined");
        expect(
          queryOne<{ count: number }>(
            db,
            "SELECT COUNT(*) AS count FROM memories",
          )?.count,
        ).toBe(0);
      } finally {
        db.exec("DROP TRIGGER IF EXISTS force_ccr_persistence_failure");
      }
    });

    it("handles compression of empty-like content gracefully", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: "short",
        contentType: "unknown",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      // Very short content may not compress much, but should still succeed
      expect(data.status).toBeDefined();
      expect(data.compressedContent).toBeDefined();
    });

    it("falls back on ContentRouter failure by using unknown type", async () => {
      // Content that's just random bytes as string — ContentRouter should handle or fallback
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x02]).toString("binary"),
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);
      expect(data.status).toBeDefined();
    });
  });

  // ==========================================================================
  // 6. Receipt Audit
  // ==========================================================================

  describe("Receipt Audit", () => {
    it("generates receipt for compression flow", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.receiptId).toBeDefined();
      expect(data.receiptId).toMatch(/^rcp_/);
    });

    it("generates receipts for multiple operations in full flow", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "full",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        query: "test",
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      expect(data.receiptId).toBeDefined();
      // Verify receipts exist in DB
      const row = db.exec(
        "SELECT COUNT(*) as cnt FROM receipts WHERE scope_id = ?",
        [SCOPE_ID],
      );
      if (row.length > 0 && row[0].values.length > 0) {
        const cnt = Number(row[0].values[0][0]);
        // Full flow should create at least 2 receipts (compress + recall)
        // May also include memory receipt
        expect(cnt).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ==========================================================================
  // 7. Response Structure
  // ==========================================================================

  describe("Response Structure", () => {
    it("includes all required output fields", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
      });

      expect(isError(result)).toBe(false);
      const data = parseToolText(result);

      // All responses must have these fields
      expect(data.flow).toBeDefined();
      expect(data.status).toBeDefined();
      expect(data.summary).toBeDefined();
      expect(data.runId).toBeDefined();
      expect(data.warnings).toBeDefined();

      for (const stepName of [
        "compression",
        "ccrPersistence",
        "originalPersistence",
        "memory",
        "recall",
      ]) {
        const step = data[stepName] as Record<string, unknown>;
        expect(["ok", "failed", "skipped"]).toContain(step.status);
        expect(typeof step.durationMs).toBe("number");
        expect(step.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("has valid runId format", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "test",
        scopeId: SCOPE_ID,
      });

      const data = parseToolText(result);
      expect(data.runId).toMatch(/^flow_[a-z0-9]+_[a-f0-9]+$/);
    });

    it("returns unique runId per invocation", async () => {
      const r1 = await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "test a",
        scopeId: SCOPE_ID,
      });
      const r2 = await handleRunContextFlow(ctx, {
        flow: "memory",
        content: "test b",
        scopeId: SCOPE_ID,
      });

      const d1 = parseToolText(r1);
      const d2 = parseToolText(r2);
      expect(d1.runId).not.toBe(d2.runId);
    });

    it("status is one of ok, partial, failed", async () => {
      const result = await handleRunContextFlow(ctx, {
        flow: "compression",
        content: SAMPLE_LONG_CONTENT,
        contentType: "test_output",
        scopeId: SCOPE_ID,
      });

      const data = parseToolText(result);
      expect(["ok", "partial", "failed"]).toContain(data.status);
    });
  });
});
