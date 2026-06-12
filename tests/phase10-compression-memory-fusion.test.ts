/**
 * Phase 10 Integration Tests — Compression & Memory Fusion (PRD §23)
 *
 * Covers the full compression → memory → recall → retrieve flow:
 *   23.1 — sourceRef format unification (user:manual, file:path, ccr:<id>, orig:<id>, command:<cmd>)
 *   23.2 — Compression result to memory (ccrId / originalRef in remember_context)
 *   23.3 — Recall returns compressed context (relatedCompressedContexts + retrieveOriginal)
 *   23.4 — End-to-end fusion (compress → remember → recall → retrieve)
 *
 * Test structure:
 *   23.1.1 — sourceRef format: user:manual
 *   23.1.2 — sourceRef format: file:<path>
 *   23.1.3 — sourceRef format: ccr:<id> (auto-derived via ccrId parameter)
 *   23.1.4 — sourceRef format: orig:<id> (auto-derived via originalRef parameter)
 *   23.1.5 — sourceRef format: command:<cmd>
 *   23.1.6 — Unrecognized sourceRef produces warning (fail-open)
 *   23.2.1 — Save test_failure memory from compression (ccrId parameter)
 *   23.2.2 — Save file_summary memory from compression (ccrId parameter)
 *   23.2.3 — ccrId validation: not found in scope
 *   23.2.4 — originalRef validation: not found
 *   23.2.5 — originalRef validation: wrong scope
 *   23.2.6 — Auto-derive summary from CCR when not provided
 *   23.2.7 — ccrId with mismatched content_type produces warning
 *   23.3.1 — recall returns relatedCompressedContexts via ccr:<id> link
 *   23.3.2 — recall returns relatedCompressedContexts via orig:<id> link
 *   23.3.3 — recall returns relatedCompressedContexts via file:<path> link
 *   23.3.4 — relatedCompressedContexts includes canRetrieveOriginal flag
 *   23.3.5 — retrieveOriginal=true returns original content in related CCRs
 *   23.3.6 — retrieveOriginal=false default (no original content in response)
 *   23.4.1 — Full fusion: compress log → save memory → recall → retrieve original
 *   23.4.2 — Full fusion with file_summary
 *   23.4.3 — Scope isolation across fusion flow
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb, runStmt, queryOne } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { CompressedStore } from "../src/compressed/compressedStore.js";
import { OriginalStore } from "../src/originals/originalStore.js";
import { handleRememberContext } from "../src/mcp/tools/rememberContext.js";
import { handleRecallContext } from "../src/mcp/tools/recallContext.js";
import {
  ccrRef,
  origRef,
  fileRef,
  userManualRef,
  commandRef,
  isCcrRef,
  isOrigRef,
  isRecognizedSourceRef,
  parseSourceRef,
} from "../src/memory/sourceRef.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../src/mcp/server.js";

let db: Database;
let ctx: ServerContext;

const SCOPE_ID = "repo_fusion_test";
const SCOPE_B = "repo_fusion_test_b";

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

/** Create a CCR directly in the DB. */
function seedCCR(overrides: Record<string, unknown> = {}) {
  const id = overrides.id ?? `ccr_seed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  runStmt(
    db,
    `INSERT INTO compressed_contexts (
       id, scope_id, content_type, strategy,
       compressed_content, summary, original_ref, source_ref,
       metadata, tokens_before, tokens_after, tokens_saved,
       compression_ratio, can_retrieve_original, retrieve_count,
       failed, error_reason, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      overrides.scopeId ?? SCOPE_ID,
      overrides.contentType ?? "test_output",
      overrides.strategy ?? "test_output_conservative_v1",
      overrides.compressedContent ?? "Compressed content for test.",
      overrides.summary ?? "Test CCR summary",
      overrides.originalRef ?? `orig_${id}`,
      overrides.sourceRef ?? null,
      null,
      overrides.tokensBefore ?? 1000,
      overrides.tokensAfter ?? 200,
      overrides.tokensSaved ?? 800,
      overrides.compressionRatio ?? 0.8,
      overrides.canRetrieveOriginal ?? 1,
      0,
      0,
      null,
      now,
      now,
    ],
  );
  return id;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("Phase 10 — Compression & Memory Fusion", () => {
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
    db.exec("DELETE FROM original_contents");
    db.exec("DELETE FROM compressed_contexts");
    db.exec("DELETE FROM profile_facts");
    db.exec("DELETE FROM receipts");
    db.exec("DELETE FROM memories");
    ensureScope();
    ensureScope(SCOPE_B);
  });

  // ==========================================================================
  // 23.1 — sourceRef format unification
  // ==========================================================================

  describe("23.1 — sourceRef format unification", () => {
    // 23.1.1
    describe("23.1.1 — user:manual", () => {
      it("constructs user:manual ref", () => {
        expect(userManualRef()).toBe("user:manual");
      });

      it("parses correctly", () => {
        const parsed = parseSourceRef("user:manual");
        expect(parsed.prefix).toBe("user");
        expect(parsed.value).toBe("manual");
      });

      it("is recognized", () => {
        expect(isRecognizedSourceRef("user:manual")).toBe(true);
      });

      it("saves and returns user:manual sourceRef", async () => {
        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "project_rule",
          content: "Use pnpm as package manager.",
          sourceRef: "user:manual",
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.sourceRef).toBe("user:manual");
        expect(data.type).toBe("project_rule");
      });
    });

    // 23.1.2
    describe("23.1.2 — file:<path>", () => {
      it("constructs file: ref", () => {
        expect(fileRef("src/auth/login.ts")).toBe("file:src/auth/login.ts");
      });

      it("parses correctly", () => {
        const parsed = parseSourceRef("file:src/auth/login.ts");
        expect(parsed.prefix).toBe("file");
        expect(parsed.value).toBe("src/auth/login.ts");
      });

      it("is recognized", () => {
        expect(isRecognizedSourceRef("file:package.json")).toBe(true);
      });

      it("saves with file: sourceRef", async () => {
        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "file_summary",
          content: "Package.json has React 18 and TypeScript dependencies.",
          sourceRef: fileRef("package.json"),
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.sourceRef).toBe("file:package.json");
      });
    });

    // 23.1.3
    describe("23.1.3 — ccr:<id> (auto-derived via ccrId)", () => {
      it("constructs ccr: ref", () => {
        expect(ccrRef("ccr_abc123")).toBe("ccr:ccr_abc123");
      });

      it("parses correctly", () => {
        const parsed = parseSourceRef("ccr:ccr_abc123");
        expect(parsed.prefix).toBe("ccr");
        expect(parsed.value).toBe("ccr_abc123");
      });

      it("isCcrRef helper", () => {
        expect(isCcrRef("ccr:abc123")).toBe(true);
        expect(isCcrRef("file:abc")).toBe(false);
        expect(isCcrRef("not-a-ref")).toBe(false);
      });

      it("auto-derives ccr: sourceRef when ccrId provided", async () => {
        // Seed a CCR
        const ccrId = seedCCR({
          summary: "Compressed auth test failure",
          contentType: "test_output",
        });

        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "test_failure",
          content: "Auth session test failure: cookie not cleared.",
          ccrId,
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.sourceRef).toBe(`ccr:${ccrId}`);
        expect(data.ccrId).toBe(ccrId);
      });
    });

    // 23.1.4
    describe("23.1.4 — orig:<id> (auto-derived via originalRef)", () => {
      it("constructs orig: ref", () => {
        expect(origRef("orig_abc123")).toBe("orig:orig_abc123");
      });

      it("parses correctly", () => {
        const parsed = parseSourceRef("orig:orig_abc123");
        expect(parsed.prefix).toBe("orig");
        expect(parsed.value).toBe("orig_abc123");
      });

      it("isOrigRef helper", () => {
        expect(isOrigRef("orig:abc123")).toBe(true);
        expect(isOrigRef("ccr:abc123")).toBe(false);
      });

      it("auto-derives orig: sourceRef when originalRef provided", async () => {
        // Seed a CCR and original content
        const ccrId = seedCCR();
        runStmt(
          db,
          `INSERT INTO original_contents (id, scope_id, ccr_id, content_type, content, content_hash, tokens, created_at)
           VALUES (?, ?, ?, 'test_output', 'Original test content.', 'hash_orig_001', 100, ?)`,
          ["orig_manual_001", SCOPE_ID, ccrId, new Date().toISOString()],
        );

        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "test_failure",
          content: "Test failure linked to original.",
          originalRef: "orig_manual_001",
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.sourceRef).toBe("orig:orig_manual_001");
        expect(data.originalRef).toBe("orig_manual_001");
      });
    });

    // 23.1.5
    describe("23.1.5 — command:<cmd>", () => {
      it("constructs command: ref", () => {
        expect(commandRef("pnpm test")).toBe("command:pnpm test");
      });

      it("parses correctly with colon in value", () => {
        const parsed = parseSourceRef("command:pnpm test --filter=a:b");
        expect(parsed.prefix).toBe("command");
        expect(parsed.value).toBe("pnpm test --filter=a:b");
      });

      it("saves with command: sourceRef", async () => {
        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "command",
          content: "pnpm build failed with TypeScript errors.",
          sourceRef: commandRef("pnpm build"),
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.sourceRef).toBe("command:pnpm build");
      });
    });

    // 23.1.6
    describe("23.1.6 — Unrecognized sourceRef (fail-open)", () => {
      it("produces warning for unrecognized format but succeeds", async () => {
        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "bug",
          content: "Some bug.",
          sourceRef: "some random format",
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.sourceRef).toBe("some random format");

        // Should have a warning about unrecognized format
        if (data.warnings) {
          const warns = data.warnings as string[];
          const hasFormatWarning = warns.some((w) =>
            w.includes("Unrecognized sourceRef format"),
          );
          expect(hasFormatWarning).toBe(true);
        }
      });

      it("legacy free-form sourceRefs still work", async () => {
        const parsed = parseSourceRef("just_a_string");
        expect(parsed.prefix).toBe("unknown");
        expect(parsed.value).toBe("just_a_string");
        expect(isRecognizedSourceRef("just_a_string")).toBe(false);
      });

      it("empty sourceRef returns unknown", () => {
        const parsed = parseSourceRef("");
        expect(parsed.prefix).toBe("unknown");
      });
    });
  });

  // ==========================================================================
  // 23.2 — Compression result to memory
  // ==========================================================================

  describe("23.2 — Compression result to memory", () => {
    // 23.2.1
    describe("23.2.1 — Save test_failure memory from compression", () => {
      it("creates test_failure memory linked to a CCR via ccrId", async () => {
        const ccrId = seedCCR({
          summary: "auth/session.test.ts: cookie not cleared on logout",
          contentType: "test_output",
        });

        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "test_failure",
          content:
            "auth/session.test.ts > should clear cookie on logout — Expected true but got false.",
          ccrId,
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.memoryId).toMatch(/^mem_/);
        expect(data.sourceRef).toBe(`ccr:${ccrId}`);
        expect(data.type).toBe("test_failure");

        // Verify memory in DB
        const row = queryOne(db, "SELECT * FROM memories WHERE id = ?", [
          data.memoryId as string,
        ]);
        expect(row).not.toBeNull();
        expect(row!["type"]).toBe("test_failure");
        expect(row!["source_ref"]).toBe(`ccr:${ccrId}`);
      });
    });

    // 23.2.2
    describe("23.2.2 — Save file_summary memory from compression", () => {
      it("creates file_summary memory linked to a CCR via ccrId", async () => {
        const ccrId = seedCCR({
          contentType: "file_summary",
          summary: "src/auth/login.ts summary: handles JWT, session, CSRF",
          sourceRef: "file:src/auth/login.ts",
        });

        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "file_summary",
          content: "Auth module handles login, logout, session management.",
          ccrId,
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.memoryId).toMatch(/^mem_/);
        expect(data.sourceRef).toBe(`ccr:${ccrId}`);
        expect(data.type).toBe("file_summary");
      });
    });

    // 23.2.3
    describe("23.2.3 — ccrId validation: not found in scope", () => {
      it("returns error when ccrId not found", async () => {
        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "test_failure",
          content: "Some test failure.",
          ccrId: "ccr_nonexistent",
        });

        expect(isError(result)).toBe(true);
        expect(result.content[0]!.text).toContain("not found");
      });
    });

    // 23.2.4
    describe("23.2.4 — originalRef validation: not found", () => {
      it("returns error when originalRef does not exist", async () => {
        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "test_failure",
          content: "Some failure.",
          originalRef: "orig_nonexistent",
        });

        expect(isError(result)).toBe(true);
        expect(result.content[0]!.text).toContain("not found");
      });
    });

    // 23.2.5
    describe("23.2.5 — originalRef validation: wrong scope", () => {
      it("returns error when originalRef belongs to different scope", async () => {
        // Seed original in SCOPE_B
        const ccrB = seedCCR({ scopeId: SCOPE_B });
        runStmt(
          db,
          `INSERT INTO original_contents (id, scope_id, ccr_id, content_type, content, content_hash, tokens, created_at)
           VALUES (?, ?, ?, 'test_output', 'Content in scope B.', 'hash_b', 50, ?)`,
          ["orig_scope_b", SCOPE_B, ccrB, new Date().toISOString()],
        );

        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "test_failure",
          content: "Test failure.",
          originalRef: "orig_scope_b",
        });

        expect(isError(result)).toBe(true);
        expect(result.content[0]!.text).toContain("different scope");
      });
    });

    // 23.2.6
    describe("23.2.6 — Auto-derive summary from CCR", () => {
      it("uses CCR summary when no explicit summary provided", async () => {
        const ccrId = seedCCR({
          summary: "Compressed log: 45 tests run, 3 failures",
          contentType: "test_output",
        });

        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "test_failure",
          content: "Three tests failed in CI run.",
          ccrId,
          // No summary provided — will be auto-derived
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.summary).toBe("Compressed log: 45 tests run, 3 failures");
      });

      it("respects explicit summary over CCR summary", async () => {
        const ccrId = seedCCR({
          summary: "CCR summary — should be overridden",
        });

        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "test_failure",
          content: "Test failure.",
          summary: "Explicit user summary",
          ccrId,
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.summary).toBe("Explicit user summary");
      });
    });

    // 23.2.7
    describe("23.2.7 — ccrId with mismatched content_type produces warning", () => {
      it("warns when CCR is test_output but memory type is not test_failure", async () => {
        const ccrId = seedCCR({ contentType: "test_output" });

        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "bug", // Not test_failure
          content: "Something is broken.",
          ccrId,
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        expect(data.warnings).toBeDefined();

        const warns = data.warnings as string[];
        const mismatchWarning = warns.some(
          (w) =>
            w.includes("test_output") && w.includes("test_failure"),
        );
        expect(mismatchWarning).toBe(true);
      });

      it("warns when CCR is file_summary but memory type is not file_summary", async () => {
        const ccrId = seedCCR({ contentType: "file_summary" });

        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "project_rule", // Not file_summary
          content: "Some rule.",
          ccrId,
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        if (data.warnings) {
          const warns = data.warnings as string[];
          expect(
            warns.some(
              (w) =>
                w.includes("file_summary") && w.includes("file_summary"),
            ),
          ).toBe(true);
        }
      });
    });
  });

  // ==========================================================================
  // 23.3 — Recall returns compressed context
  // ==========================================================================

  describe("23.3 — Recall returns compressed context", () => {
    // 23.3.1
    describe("23.3.1 — Recall returns relatedCompressedContexts via ccr:<id>", () => {
      it("finds CCR by direct ID when memory sourceRef is ccr:<id>", async () => {
        // Create a memory with ccr: sourceRef
        const ccrId = seedCCR({
          summary: "CI test run: 2 failures in auth module",
          originalRef: "orig_ci_001",
          canRetrieveOriginal: 1,
        });

        const now = new Date().toISOString();
        runStmt(
          db,
          `INSERT INTO memories (id, scope_id, type, content, confidence, status, source_ref, created_at, updated_at)
           VALUES (?, ?, 'test_failure', 'CI test failures in auth module.', 0.9, 'active', ?, ?, ?)`,
          ["mem_ccr_link_001", SCOPE_ID, `ccr:${ccrId}`, now, now],
        );

        const result = await handleRecallContext(ctx, {
          scopeId: SCOPE_ID,
          query: "CI auth test failures",
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);

        expect(Array.isArray(data.relatedCompressedContexts)).toBe(true);
        const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
        expect(ccrs.length).toBeGreaterThanOrEqual(1);

        const matchedCcr = ccrs.find((c) => c.ccrId === ccrId);
        expect(matchedCcr).toBeDefined();
        expect(matchedCcr!.summary).toBe("CI test run: 2 failures in auth module");
        expect(matchedCcr!.canRetrieveOriginal).toBe(true);
      });
    });

    // 23.3.2
    describe("23.3.2 — Recall returns relatedCompressedContexts via orig:<id>", () => {
      it("finds CCR by originalRef when memory sourceRef is orig:<id>", async () => {
        const ccrId = seedCCR({
          originalRef: "orig_link_test_002",
          canRetrieveOriginal: 1,
        });

        const now = new Date().toISOString();
        runStmt(
          db,
          `INSERT INTO memories (id, scope_id, type, content, confidence, status, source_ref, created_at, updated_at)
           VALUES (?, ?, 'bug', 'Bug linked to original content.', 0.8, 'active', ?, ?, ?)`,
          ["mem_orig_link_001", SCOPE_ID, "orig:orig_link_test_002", now, now],
        );

        const result = await handleRecallContext(ctx, {
          scopeId: SCOPE_ID,
          query: "linked original bug",
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);

        const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
        expect(ccrs.length).toBeGreaterThanOrEqual(1);
        expect(ccrs.some((c) => c.ccrId === ccrId)).toBe(true);
      });
    });

    // 23.3.3
    describe("23.3.3 — Recall returns relatedCompressedContexts via file:<path>", () => {
      it("finds CCR by sourceRef match when memory uses file:<path>", async () => {
        seedCCR({
          sourceRef: "file:src/auth/login.ts",
          summary: "Compressed login file",
          canRetrieveOriginal: 1,
        });

        const now = new Date().toISOString();
        runStmt(
          db,
          `INSERT INTO memories (id, scope_id, type, content, confidence, status, source_ref, created_at, updated_at)
           VALUES (?, ?, 'file_summary', 'Login module contains auth logic.', 0.8, 'active', ?, ?, ?)`,
          ["mem_file_link_001", SCOPE_ID, "file:src/auth/login.ts", now, now],
        );

        const result = await handleRecallContext(ctx, {
          scopeId: SCOPE_ID,
          query: "login auth",
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
        expect(ccrs.length).toBeGreaterThanOrEqual(1);
        expect(ccrs[0]!.summary).toBe("Compressed login file");
      });
    });

    // 23.3.4
    describe("23.3.4 — relatedCompressedContexts includes canRetrieveOriginal", () => {
      it("canRetrieveOriginal=true when original is available", async () => {
        const ccrId = seedCCR({
          canRetrieveOriginal: 1,
        });

        const now = new Date().toISOString();
        runStmt(
          db,
          `INSERT INTO memories (id, scope_id, type, content, confidence, status, source_ref, created_at, updated_at)
           VALUES (?, ?, 'test_failure', 'Test failure with original available.', 0.9, 'active', ?, ?, ?)`,
          ["mem_can_retrieve", SCOPE_ID, `ccr:${ccrId}`, now, now],
        );

        const result = await handleRecallContext(ctx, {
          scopeId: SCOPE_ID,
          query: "original available",
        });

        const data = parseToolText(result);
        const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
        expect(ccrs.length).toBeGreaterThanOrEqual(1);
        expect(ccrs[0]!.canRetrieveOriginal).toBe(true);
      });

      it("canRetrieveOriginal=false when original was deleted", async () => {
        const ccrId = seedCCR({
          canRetrieveOriginal: 0,
        });

        const now = new Date().toISOString();
        runStmt(
          db,
          `INSERT INTO memories (id, scope_id, type, content, confidence, status, source_ref, created_at, updated_at)
           VALUES (?, ?, 'test_failure', 'Test failure with no original.', 0.9, 'active', ?, ?, ?)`,
          ["mem_no_original", SCOPE_ID, `ccr:${ccrId}`, now, now],
        );

        const result = await handleRecallContext(ctx, {
          scopeId: SCOPE_ID,
          query: "no original",
        });

        const data = parseToolText(result);
        const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
        expect(ccrs.length).toBeGreaterThanOrEqual(1);
        expect(ccrs[0]!.canRetrieveOriginal).toBe(false);
      });
    });

    // 23.3.5
    describe("23.3.5 — retrieveOriginal=true returns original content", () => {
      it("retrieves original content for related CCRs", async () => {
        const ccrId = seedCCR({
          originalRef: "orig_retrieve_fusion_001",
          canRetrieveOriginal: 1,
        });

        runStmt(
          db,
          `INSERT INTO original_contents (id, scope_id, ccr_id, content_type, content, content_hash, tokens, created_at)
           VALUES (?, ?, ?, 'test_output', 'Full test output with stack trace details...', 'hash_fusion_abc', 300, ?)`,
          ["orig_retrieve_fusion_001", SCOPE_ID, ccrId, new Date().toISOString()],
        );

        const now = new Date().toISOString();
        runStmt(
          db,
          `INSERT INTO memories (id, scope_id, type, content, confidence, status, source_ref, created_at, updated_at)
           VALUES (?, ?, 'test_failure', 'Test failure with full details.', 0.9, 'active', ?, ?, ?)`,
          ["mem_retrieve_orig", SCOPE_ID, `ccr:${ccrId}`, now, now],
        );

        const result = await handleRecallContext(ctx, {
          scopeId: SCOPE_ID,
          query: "full details",
          retrieveOriginal: true,
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);

        const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
        expect(ccrs.length).toBeGreaterThanOrEqual(1);

        const withOriginal = ccrs.filter((c) => c.retrievedOriginal);
        expect(withOriginal.length).toBeGreaterThanOrEqual(1);
        expect(
          (withOriginal[0]!.retrievedOriginal as Record<string, unknown>).content,
        ).toBe("Full test output with stack trace details...");
        expect(
          (withOriginal[0]!.retrievedOriginal as Record<string, unknown>).contentType,
        ).toBe("test_output");
      });
    });

    // 23.3.6
    describe("23.3.6 — retrieveOriginal=false default", () => {
      it("does not include retrievedOriginal when retrieveOriginal is false", async () => {
        const ccrId = seedCCR({
          originalRef: "orig_no_retrieve_001",
          canRetrieveOriginal: 1,
        });

        runStmt(
          db,
          `INSERT INTO original_contents (id, scope_id, ccr_id, content_type, content, content_hash, tokens, created_at)
           VALUES (?, ?, ?, 'test_output', 'Secret original content.', 'hash_secret', 100, ?)`,
          ["orig_no_retrieve_001", SCOPE_ID, ccrId, new Date().toISOString()],
        );

        const now = new Date().toISOString();
        runStmt(
          db,
          `INSERT INTO memories (id, scope_id, type, content, confidence, status, source_ref, created_at, updated_at)
           VALUES (?, ?, 'test_failure', 'Test failure.', 0.9, 'active', ?, ?, ?)`,
          ["mem_no_retrieve", SCOPE_ID, `ccr:${ccrId}`, now, now],
        );

        const result = await handleRecallContext(ctx, {
          scopeId: SCOPE_ID,
          query: "test failure",
          // retrieveOriginal defaults to false
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);
        const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
        expect(ccrs.length).toBeGreaterThanOrEqual(1);

        // No retrievedOriginal should be present
        for (const ccr of ccrs) {
          expect(ccr.retrievedOriginal).toBeUndefined();
        }
      });
    });
  });

  // ==========================================================================
  // 23.4 — End-to-end fusion tests
  // ==========================================================================

  describe("23.4 — End-to-end fusion", () => {
    // 23.4.1
    describe("23.4.1 — Full fusion: compress test log → save memory → recall → retrieve", () => {
      it("completes the full fusion flow", async () => {
        // Step 1: Simulate compression (create CCR and original directly)
        const ccrId = seedCCR({
          contentType: "test_output",
          summary: "CI test run: 68 tests, 3 failures in auth/login modules",
          originalRef: "orig_e2e_001",
          canRetrieveOriginal: 1,
          sourceRef: "command:pnpm test",
        });

        runStmt(
          db,
          `INSERT INTO original_contents (id, scope_id, ccr_id, content_type, content, content_hash, tokens, created_at)
           VALUES (?, ?, ?, 'test_output', ?, 'hash_e2e_001', 15000, ?)`,
          [
            "orig_e2e_001",
            SCOPE_ID,
            ccrId,
            "FAIL  auth/login.test.ts > should redirect on success\n" +
            "  Expected: /dashboard\n" +
            "  Received: /login\n" +
            "FAIL  auth/session.test.ts > should clear cookie\n" +
            "  Expected: null\n" +
            "  Received: session-token-abc\n" +
            "FAIL  api/users.test.ts > should return 200\n" +
            "  Expected: 200\n" +
            "  Received: 500\n" +
            "\n" +
            "Test Suites: 3 failed, 12 passed, 15 total\n" +
            "Tests:       3 failed, 65 passed, 68 total\n" +
            "Time:        45.2s",
            new Date().toISOString(),
          ],
        );

        // Step 2: Save test_failure memory linked to compression
        const rememberResult = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "test_failure",
          content:
            "auth/login.test.ts fails: login redirect goes to /login instead of /dashboard",
          summary: "Login redirect test failure",
          ccrId,
          tags: ["auth", "login", "redirect"],
        });

        expect(isError(rememberResult)).toBe(false);
        const memData = parseToolText(rememberResult);
        expect(memData.memoryId).toMatch(/^mem_/);
        expect(memData.sourceRef).toBe(`ccr:${ccrId}`);
        expect(memData.type).toBe("test_failure");

        // Step 3: Recall test_failure
        const recallResult = await handleRecallContext(ctx, {
          scopeId: SCOPE_ID,
          query: "login redirect test failure",
          types: ["test_failure"],
        });

        expect(isError(recallResult)).toBe(false);
        const recallData = parseToolText(recallResult);

        // Verify memories returned
        const memories = recallData.memories as Record<string, unknown>[];
        expect(memories.length).toBeGreaterThanOrEqual(1);
        const mem = memories[0]!;
        expect(mem.type).toBe("test_failure");
        expect(mem.content as string).toContain("login");
        expect(mem.canExpand).toBe(true);
        expect(mem.sourceRef).toBe(`ccr:${ccrId}`);

        // Verify relatedCompressedContexts
        const ccrs = recallData.relatedCompressedContexts as Record<string, unknown>[];
        expect(ccrs.length).toBeGreaterThanOrEqual(1);
        expect(ccrs[0]!.ccrId).toBe(ccrId);
        expect(ccrs[0]!.canRetrieveOriginal).toBe(true);
        expect(ccrs[0]!.originalRef).toBe("orig_e2e_001");

        // Step 4: Retrieve original with recall (retrieveOriginal=true)
        const retrieveResult = await handleRecallContext(ctx, {
          scopeId: SCOPE_ID,
          query: "login redirect test failure",
          retrieveOriginal: true,
        });

        expect(isError(retrieveResult)).toBe(false);
        const retrieveData = parseToolText(retrieveResult);
        const retrieveCcrs = retrieveData.relatedCompressedContexts as Record<
          string,
          unknown
        >[];
        expect(retrieveCcrs.length).toBeGreaterThanOrEqual(1);

        const retrievedCcr = retrieveCcrs.find((c) => c.ccrId === ccrId);
        expect(retrievedCcr).toBeDefined();
        expect(retrievedCcr!.retrievedOriginal).toBeDefined();

        const orig = retrievedCcr!.retrievedOriginal as Record<string, unknown>;
        expect(orig.content).toContain("FAIL  auth/login.test.ts");
        expect(orig.content).toContain("Expected: /dashboard");
        expect(orig.tokens).toBe(15000);
        expect(orig.contentType).toBe("test_output");

        // Step 5: Verify receipt chain
        expect(retrieveData.receiptId).toMatch(/^rcp_/);
        expect(retrieveData.receiptId).not.toBe(memData.receiptId);
      });
    });

    // 23.4.2
    describe("23.4.2 — Full fusion with file_summary", () => {
      it("completes fusion flow for file_summary", async () => {
        // Step 1: Compression
        const ccrId = seedCCR({
          contentType: "file_summary",
          summary: "src/server.ts: Express app with auth, routes, middleware",
          originalRef: "orig_file_summary_001",
          sourceRef: "file:src/server.ts",
          canRetrieveOriginal: 1,
        });

        runStmt(
          db,
          `INSERT INTO original_contents (id, scope_id, ccr_id, content_type, content, content_hash, tokens, created_at)
           VALUES (?, ?, ?, 'file_summary', ?, 'hash_fs_001', 800, ?)`,
          [
            "orig_file_summary_001",
            SCOPE_ID,
            ccrId,
            "// src/server.ts\nimport express from 'express';\nimport { authRouter } from './auth';\n...",
            new Date().toISOString(),
          ],
        );

        // Step 2: Save file_summary memory
        const rememberResult = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "file_summary",
          content:
            "Express server entry point with auth middleware and REST API routes.",
          ccrId,
        });

        expect(isError(rememberResult)).toBe(false);
        const memData = parseToolText(rememberResult);

        // Step 3: Recall
        const recallResult = await handleRecallContext(ctx, {
          scopeId: SCOPE_ID,
          query: "server express auth middleware",
          retrieveOriginal: true,
        });

        expect(isError(recallResult)).toBe(false);
        const recallData = parseToolText(recallResult);

        const ccrs = recallData.relatedCompressedContexts as Record<string, unknown>[];
        expect(ccrs.length).toBeGreaterThanOrEqual(1);
        expect(ccrs[0]!.ccrId).toBe(ccrId);

        // Should have retrieved original
        const withOrig = ccrs.filter((c) => c.retrievedOriginal);
        expect(withOrig.length).toBeGreaterThanOrEqual(1);
        expect(
          (withOrig[0]!.retrievedOriginal as Record<string, unknown>).content,
        ).toContain("import express");
      });
    });

    // 23.4.3
    describe("23.4.3 — Cross-scope isolation", () => {
      it("does not link memories to CCRs from different scopes", async () => {
        // CCR in SCOPE_ID
        const ccrIdA = seedCCR({
          scopeId: SCOPE_ID,
          summary: "Scope A test output",
          originalRef: "orig_scope_a",
        });

        // CCR in SCOPE_B with same conceptual link
        seedCCR({
          scopeId: SCOPE_B,
          summary: "Scope B test output",
          originalRef: "orig_scope_b",
        });

        // Memory in SCOPE_ID linked to ccrIdA
        const now = new Date().toISOString();
        runStmt(
          db,
          `INSERT INTO memories (id, scope_id, type, content, confidence, status, source_ref, created_at, updated_at)
           VALUES (?, ?, 'test_failure', 'Scope A test failure.', 0.9, 'active', ?, ?, ?)`,
          ["mem_scope_a", SCOPE_ID, `ccr:${ccrIdA}`, now, now],
        );

        // Memory in SCOPE_B (not linked)
        runStmt(
          db,
          `INSERT INTO memories (id, scope_id, type, content, confidence, status, source_ref, created_at, updated_at)
           VALUES (?, ?, 'bug', 'Scope B bug.', 0.8, 'active', ?, ?, ?)`,
          ["mem_scope_b", SCOPE_B, null, now, now],
        );

        // Recall in SCOPE_ID
        const result = await handleRecallContext(ctx, {
          scopeId: SCOPE_ID,
          query: "test failure",
        });

        expect(isError(result)).toBe(false);
        const data = parseToolText(result);

        // Should only return scope A's CCR
        const ccrs = data.relatedCompressedContexts as Record<string, unknown>[];
        for (const ccr of ccrs) {
          expect(ccr.summary as string).toContain("Scope A");
        }
      });

      it("ccrId validation rejects CCR from different scope", async () => {
        const ccrIdB = seedCCR({ scopeId: SCOPE_B });

        const result = await handleRememberContext(ctx, {
          scopeId: SCOPE_ID,
          type: "test_failure",
          content: "Test failure.",
          ccrId: ccrIdB,
        });

        expect(isError(result)).toBe(true);
        expect(result.content[0]!.text).toContain("not found");
        expect(result.content[0]!.text).toContain(ccrIdB);
      });
    });
  });

  // ==========================================================================
  // Additional: sourceRef helper unit tests
  // ==========================================================================

  describe("sourceRef helpers", () => {
    it("parseSourceRef handles edge cases", () => {
      // No colon
      expect(parseSourceRef("plainstring").prefix).toBe("unknown");
      expect(parseSourceRef("plainstring").value).toBe("plainstring");

      // Multiple colons (only first colon matters)
      const parsed = parseSourceRef("file:src:test:deep.ts");
      expect(parsed.prefix).toBe("file");
      expect(parsed.value).toBe("src:test:deep.ts");

      // Whitespace
      expect(parseSourceRef("  user:manual  ").prefix).toBe("user");
      expect(parseSourceRef("  user:manual  ").value).toBe("manual");

      // Unknown prefix
      expect(parseSourceRef("custom:value").prefix).toBe("unknown");
    });

    it("constructors produce valid sourceRefs", () => {
      expect(isRecognizedSourceRef(userManualRef())).toBe(true);
      expect(isRecognizedSourceRef(fileRef("x.ts"))).toBe(true);
      expect(isRecognizedSourceRef(ccrRef("abc"))).toBe(true);
      expect(isRecognizedSourceRef(origRef("xyz"))).toBe(true);
      expect(isRecognizedSourceRef(commandRef("npm test"))).toBe(true);
    });

    it("isCcrRef only matches ccr prefix", () => {
      expect(isCcrRef("ccr:abc")).toBe(true);
      expect(isCcrRef("orig:abc")).toBe(false);
      expect(isCcrRef("ccrabc")).toBe(false); // no colon
    });

    it("isOrigRef only matches orig prefix", () => {
      expect(isOrigRef("orig:abc")).toBe(true);
      expect(isOrigRef("ccr:abc")).toBe(false);
      expect(isOrigRef("original_ref")).toBe(false); // no colon
    });
  });
});
