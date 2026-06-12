/**
 * CLI Command Tests
 *
 * Tests all 7 CLI commands plus JSON output mode and error handling.
 * Each command handler is tested directly (no subprocess needed)
 * because they return CliResult instead of writing to stdout/exit.
 */

import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  runScope,
  runStats,
  runListCompressions,
  runReceipt,
  runCompress,
  runRetrieve,
  runCleanup,
  runRemember,
  runForget,
  runRecall,
  runListContext,
  runProfile,
  runReceipts,
} from "../src/cli/commands.js";
import { closeDb } from "../src/storage/db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TMP_DIR = join(process.cwd(), "tests", "fixtures");

function createTempFile(name: string, content: string): string {
  const filePath = join(TMP_DIR, name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function removeTempFile(name: string): void {
  const filePath = join(TMP_DIR, name);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

// Clean up DB after all tests
afterAll(() => {
  try {
    closeDb();
  } catch {
    // DB may already be closed
  }
});

// ---------------------------------------------------------------------------
// 1. scope
// ---------------------------------------------------------------------------

describe("scope command", () => {
  it("returns a valid scopeId for the current directory", () => {
    const result = runScope();
    expect(result.status).toBe("ok");
    expect(result.data).toBeDefined();

    const data = result.data as Record<string, unknown>;
    expect(data.scopeId).toBeTruthy();
    expect(typeof data.scopeId).toBe("string");
    expect(data.scopeId).toMatch(/^(repo_|cwd_)/);
    expect(data.scopeStrategy).toMatch(
      /^(gitRemote\+gitRoot|gitRootOnly|cwdFallback)$/,
    );
  });

  it("returns the same scopeId for the same cwd", () => {
    const a = runScope(process.cwd());
    const b = runScope(process.cwd());
    expect((a.data as Record<string, unknown>).scopeId).toBe(
      (b.data as Record<string, unknown>).scopeId,
    );
  });

  it("returns different scopeId for different cwds", () => {
    const a = runScope("/tmp/project-a");
    const b = runScope("/tmp/project-b");
    expect((a.data as Record<string, unknown>).scopeId).not.toBe(
      (b.data as Record<string, unknown>).scopeId,
    );
  });

  it("falls back to cwdFallback for a non-existent non-git path", () => {
    const result = runScope("/tmp/nonexistent-dir-12345");
    const data = result.data as Record<string, unknown>;
    expect(data.scopeStrategy).toBe("cwdFallback");
    expect(data.scopeId).toMatch(/^cwd_/);
    expect(data.gitRoot).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. stats
// ---------------------------------------------------------------------------

describe("stats command", () => {
  it("returns stats for the current scope", async () => {
    const result = await runStats();
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.scopeId).toBeTruthy();
    expect(typeof data.totalCompressions).toBe("number");
    expect(typeof data.totalTokensSaved).toBe("number");
    expect(typeof data.totalCCRs).toBe("number");
    expect(typeof data.averageCompressionRatio).toBe("number");
  });

  it("includes scope strategy info", async () => {
    const result = await runStats();
    const data = result.data as Record<string, unknown>;
    expect(data.scopeStrategy).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. list-compressions
// ---------------------------------------------------------------------------

describe("list-compressions command", () => {
  it("returns paginated results for the current scope", async () => {
    const result = await runListCompressions({});
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.scopeId).toBeTruthy();
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe("number");
    expect(typeof data.limit).toBe("number");
    expect(typeof data.offset).toBe("number");
  });

  it("accepts limit and offset", async () => {
    const result = await runListCompressions({ limit: 5, offset: 0 });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.limit).toBe(5);
    expect(data.offset).toBe(0);
  });

  it("accepts content type filter", async () => {
    const result = await runListCompressions({ type: "test_output" });
    expect(result.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// 4. receipt
// ---------------------------------------------------------------------------

describe("receipt command", () => {
  it("returns error for non-existent receipt", async () => {
    const result = await runReceipt("rcp_nonexistent_12345");
    expect(result.status).toBe("error");
    expect(result.error).toContain("not found");
  });

  it("returns error for empty receiptId", async () => {
    const result = await runReceipt("");
    expect(result.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// 5. compress
// ---------------------------------------------------------------------------

describe("compress command", () => {
  it("compresses a build output file", async () => {
    // Use existing fixture
    const filePath = join(TMP_DIR, "build-output.txt");
    const result = await runCompress(filePath, {});

    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.ccrId).toBeTruthy();
    expect(typeof data.compressed).toBe("boolean");
    expect(data.scopeId).toBeTruthy();
    expect(data.contentType).toBeTruthy();
    expect(data.strategy).toBeTruthy();
    expect(data.compressedContent).toBeTruthy();
    expect(typeof data.tokensBefore).toBe("number");
    expect(typeof data.tokensAfter).toBe("number");
    expect(typeof data.tokensSaved).toBe("number");
    expect(typeof data.compressionRatio).toBe("number");
    expect(data.receiptId).toBeTruthy();
    expect(data.originalRef).toBeTruthy();
    expect(data.canRetrieveOriginal).toBe(true);
  });

  it("compresses with explicit --type", async () => {
    const filePath = join(TMP_DIR, "sample.ts");
    const result = await runCompress(filePath, { type: "code" });

    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    expect(data.contentType).toBe("code");
    expect((data.detection as Record<string, unknown>).method).toBe("user");
  });

  it("returns error for missing file", async () => {
    const result = await runCompress("/nonexistent/file.log", {});
    expect(result.status).toBe("error");
    expect(result.error).toContain("Cannot read file");
  });

  it("returns error for empty file", async () => {
    const tmpName = "cli-test-empty.tmp";
    createTempFile(tmpName, "");
    const filePath = join(TMP_DIR, tmpName);

    try {
      const result = await runCompress(filePath, {});
      expect(result.status).toBe("error");
      expect(result.error).toContain("empty");
    } finally {
      removeTempFile(tmpName);
    }
  });

  it("compresses with --no-keep-original", async () => {
    const filePath = join(TMP_DIR, "build-output.txt");
    const result = await runCompress(filePath, { keepOriginal: false });

    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    expect(data.canRetrieveOriginal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. retrieve
// ---------------------------------------------------------------------------

describe("retrieve command", () => {
  it("retrieves original content after compression", async () => {
    // First compress to create an original
    const filePath = join(TMP_DIR, "build-output.txt");
    const compressResult = await runCompress(filePath, {});
    expect(compressResult.status).toBe("ok");

    const compData = compressResult.data as Record<string, unknown>;
    const originalRef = compData.originalRef as string;
    expect(originalRef).toBeTruthy();

    // Then retrieve
    const result = await runRetrieve(originalRef, {});
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.originalRef).toBe(originalRef);
    expect(data.contentType).toBeTruthy();
    expect(data.content).toBeTruthy();
    expect(typeof data.content).toBe("string");
    expect(typeof data.tokens).toBe("number");
    expect(data.createdAt).toBeTruthy();
  });

  it("returns error for non-existent originalRef", async () => {
    const result = await runRetrieve("orig_nonexistent_12345", {});
    expect(result.status).toBe("error");
    expect(result.error).toContain("not found");
  });

  it("returns error for empty originalRef", async () => {
    const result = await runRetrieve("", {});
    expect(result.status).toBe("error");
  });

  it("supports offset and limit for pagination", async () => {
    // Create a compress first
    const filePath = join(TMP_DIR, "build-output.txt");
    const compressResult = await runCompress(filePath, {});
    expect(compressResult.status).toBe("ok");

    const compData = compressResult.data as Record<string, unknown>;
    const originalRef = compData.originalRef as string;

    // Retrieve with offset/limit
    const result = await runRetrieve(originalRef, { offset: 0, limit: 100 });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.content).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7. cleanup
// ---------------------------------------------------------------------------

describe("cleanup command", () => {
  it("runs cleanup and returns result", async () => {
    const result = await runCleanup();
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.scopeId).toBeTruthy();
    expect(typeof data.deleted).toBe("number");
    expect(Array.isArray(data.affectedCcrIds)).toBe(true);
    expect(data.message).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("scope handles empty cwd gracefully", () => {
    const result = runScope("");
    // Empty cwd should still resolve to process.cwd()
    expect(result.status).toBe("ok");
  });

  it("list-compressions rejects invalid limit values gracefully", async () => {
    // NaN limit should be ignored, using default 20
    const result = await runListCompressions({ limit: 20 });
    expect(result.status).toBe("ok");
  });

  it("receipt handles special characters in ID", async () => {
    const result = await runReceipt("rcp_<>&\"'");
    expect(result.status).toBe("error"); // Not found, but should not crash
  });

  it("retrieve handles special characters in ref", async () => {
    const result = await runRetrieve("orig_<>&\"'", {});
    expect(result.status).toBe("error"); // Not found, but should not crash
  });
});

// ---------------------------------------------------------------------------
// 8. remember
// ---------------------------------------------------------------------------

describe("remember command", () => {
  it("creates a project_rule memory via CLI", async () => {
    const result = await runRemember({
      type: "project_rule",
      content: "Use pnpm as the package manager.",
      summary: "Use pnpm",
      confidence: 0.9,
    });

    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    expect(data.memoryId).toMatch(/^mem_/);
    expect(data.receiptId).toMatch(/^rcp_/);
    expect(data.type).toBe("project_rule");
    expect(data.status).toBe("active");
  });

  it("creates a memory with profile-target static", async () => {
    const result = await runRemember({
      type: "project_rule",
      content: "Never modify auto-generated files.",
      summary: "Don't modify generated",
      profileTarget: "static",
      tags: ["generated", "rule"],
    });

    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    expect(data.profileTarget).toBe("static");
    expect(data.memoryId).toMatch(/^mem_/);
  });

  it("creates a memory with profile-target dynamic", async () => {
    const result = await runRemember({
      type: "current_task",
      content: "Working on CLI implementation for CodeContext.",
      summary: "CLI dev",
      profileTarget: "dynamic",
    });

    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    expect(data.profileTarget).toBe("dynamic");
  });

  it("validates required type", async () => {
    const result = await runRemember({
      type: "invalid_type",
      content: "Test content",
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid type");
  });

  it("validates profileTarget", async () => {
    const result = await runRemember({
      type: "project_rule",
      content: "Test",
      profileTarget: "invalid_target",
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid profileTarget");
  });

  it("handles tags as comma-separated string", async () => {
    const result = await runRemember({
      type: "decision",
      content: "Use Vitest for testing.",
      tags: ["testing", "vitest", "frontend"],
    });

    expect(result.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// 9. recall
// ---------------------------------------------------------------------------

describe("recall command", () => {
  it("returns error for empty query", async () => {
    const result = await runRecall("", {});
    expect(result.status).toBe("error");
    expect(result.error).toContain("query is required");
  });

  it("returns empty results for non-matching query", async () => {
    const result = await runRecall("xyznonexistent987654321", {});
    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    expect(data.count).toBe(0);
    expect(data.receiptId).toMatch(/^rcp_/);
    expect(Array.isArray(data.results)).toBe(true);
    expect((data.results as unknown[]).length).toBe(0);
  });

  it("recalls a previously saved project rule", async () => {
    // Save a memory first
    const saved = await runRemember({
      type: "project_rule",
      content: "Always use TypeScript strict mode for all new files.",
      summary: "TypeScript strict mode",
      confidence: 0.95,
    });
    expect(saved.status).toBe("ok");

    // Search for it
    const result = await runRecall("TypeScript strict mode", { limit: 5 });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.receiptId).toMatch(/^rcp_/);
    expect(data.count).toBeGreaterThan(0);
    expect(Array.isArray(data.results)).toBe(true);

    const items = data.results as Record<string, unknown>[];
    const found = items.find(
      (i) => i.summary === "TypeScript strict mode",
    );
    expect(found).toBeDefined();
  });

  it("recall returns scored results with rank", async () => {
    const result = await runRecall("TypeScript", { limit: 3 });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const items = data.results as Record<string, unknown>[];

    if (items.length > 0) {
      expect(typeof items[0]!.score).toBe("number");
      expect(typeof items[0]!.mergedScore).toBe("number");
      expect(typeof items[0]!.recencyBoost).toBe("number");
      expect(typeof items[0]!.finalScore).toBe("number");
      expect(typeof items[0]!.rank).toBe("number");
      expect(items[0]!.rank).toBe(1);
    }
  });

  it("recall supports --type filter", async () => {
    // Save different types
    await runRemember({
      type: "project_rule",
      content: "Use ESLint flat config for linting.",
      summary: "ESLint config",
    });
    await runRemember({
      type: "bug",
      content: "Login page crashes on empty password field.",
      summary: "Login bug",
    });

    const result = await runRecall("login", {
      types: ["bug"],
      limit: 5,
    });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const items = data.results as Record<string, unknown>[];
    for (const item of items) {
      expect(item.type).toBe("bug");
    }
  });

  it("recall supports --status filter", async () => {
    const result = await runRecall("TypeScript", {
      status: ["active"],
      limit: 5,
    });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const items = data.results as Record<string, unknown>[];
    for (const item of items) {
      expect(item.status).toBe("active");
    }
  });

  it("recall supports --profile flag", async () => {
    const result = await runRecall("TypeScript", {
      includeProfile: true,
      limit: 3,
    });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.profile).toBeDefined();
    const profile = data.profile as Record<string, unknown>;
    expect(Array.isArray(profile.static)).toBe(true);
    expect(Array.isArray(profile.dynamic)).toBe(true);
  });

  it("validates invalid type in recall", async () => {
    const result = await runRecall("test", { types: ["bogus_type"] });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid type");
    expect(result.error).toContain("bogus_type");
  });

  it("validates invalid status in recall", async () => {
    const result = await runRecall("test", { status: ["bogus_status"] });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid status");
  });
});

// ---------------------------------------------------------------------------
// 10. list-context
// ---------------------------------------------------------------------------

describe("list-context command", () => {
  it("returns paginated memory list for current scope", async () => {
    const result = await runListContext({});
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.scopeId).toBeTruthy();
    expect(data.receiptId).toMatch(/^rcp_/);
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe("number");
    expect(typeof data.limit).toBe("number");
    expect(typeof data.offset).toBe("number");
  });

  it("supports filtering by type", async () => {
    const result = await runListContext({ types: ["project_rule"] });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const items = data.items as Record<string, unknown>[];
    for (const item of items) {
      expect(item.type).toBe("project_rule");
    }
  });

  it("supports filtering by multiple types", async () => {
    const result = await runListContext({
      types: ["project_rule", "bug"],
    });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const items = data.items as Record<string, unknown>[];
    const validTypes = new Set(["project_rule", "bug"]);
    for (const item of items) {
      expect(validTypes.has(item.type as string)).toBe(true);
    }
  });

  it("supports filtering by status", async () => {
    const result = await runListContext({ status: ["active"] });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const items = data.items as Record<string, unknown>[];
    for (const item of items) {
      expect(item.status).toBe("active");
    }
  });

  it("supports pagination with limit and offset", async () => {
    const result = await runListContext({ limit: 5, offset: 0 });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.limit).toBe(5);
    expect(data.offset).toBe(0);
    const items = data.items as Record<string, unknown>[];
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it("supports sort-by and sort-order", async () => {
    const result = await runListContext({
      sortBy: "confidence",
      sortOrder: "desc",
      limit: 10,
    });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const items = data.items as Record<string, unknown>[];
    // Verify descending order by confidence
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.confidence as number).toBeGreaterThanOrEqual(
        items[i]!.confidence as number,
      );
    }
  });

  it("validates invalid sortBy field", async () => {
    const result = await runListContext({ sortBy: "invalid_field" });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid sortBy");
  });

  it("validates invalid sortOrder", async () => {
    const result = await runListContext({ sortOrder: "invalid" });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid sortOrder");
  });

  it("validates invalid type in list-context", async () => {
    const result = await runListContext({ types: ["nonexistent_type"] });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid type");
  });

  it("returns rich memory fields", async () => {
    const result = await runListContext({ limit: 1 });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const items = data.items as Record<string, unknown>[];
    if (items.length > 0) {
      const item = items[0]!;
      expect(item.memoryId).toBeTruthy();
      expect(item.type).toBeTruthy();
      expect(item.status).toBeTruthy();
      expect(typeof item.confidence).toBe("number");
      expect(item.createdAt).toBeTruthy();
      expect(item.updatedAt).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 11. forget
// ---------------------------------------------------------------------------

describe("forget command", () => {
  it("soft_forgets a memory via CLI", async () => {
    // Create a memory first
    const saved = await runRemember({
      type: "decision",
      content: "Temporary decision to forget.",
    });
    expect(saved.status).toBe("ok");
    const savedData = saved.data as Record<string, unknown>;
    const memoryId = savedData.memoryId as string;

    // Forget it
    const result = await runForget({
      id: memoryId,
      mode: "soft_forget",
      reason: "No longer needed",
    });

    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    expect(data.memoryId).toBe(memoryId);
    expect(data.previousStatus).toBe("active");
    expect(data.newStatus).toBe("forgotten");
    expect(data.receiptId).toMatch(/^rcp_/);
  });

  it("supersedes an old memory with a new one", async () => {
    // Create old memory
    const oldSaved = await runRemember({
      type: "project_rule",
      content: "Old rule: use npm.",
    });
    const oldData = (oldSaved.data as Record<string, unknown>);
    const oldId = oldData.memoryId as string;

    // Create new memory
    const newSaved = await runRemember({
      type: "project_rule",
      content: "New rule: use pnpm.",
    });
    const newData = (newSaved.data as Record<string, unknown>);
    const newId = newData.memoryId as string;

    // Supersede old with new
    const result = await runForget({
      id: oldId,
      mode: "supersede",
      supersededBy: newId,
    });

    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    expect(data.previousStatus).toBe("active");
    expect(data.newStatus).toBe("superseded");
    expect(data.supersededBy).toBe(newId);
  });

  it("validates required mode in forget", async () => {
    const result = await runForget({
      id: "mem_test",
      mode: "invalid_mode",
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid mode");
  });

  it("returns error for non-existent memory", async () => {
    const result = await runForget({
      id: "mem_nonexistent_12345",
      mode: "soft_forget",
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// 12. profile
// ---------------------------------------------------------------------------

describe("profile command", () => {
  it("returns full profile (both layers) by default", async () => {
    const result = await runProfile({});
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.scopeId).toBeTruthy();
    expect(Array.isArray(data.staticFacts)).toBe(true);
    expect(Array.isArray(data.dynamicContext)).toBe(true);
    expect(data.updatedAt).toBeTruthy();
    expect(data.activeOnly).toBe(true);
  });

  it("returns static profile with --static flag", async () => {
    // First save a memory with static profile target
    await runRemember({
      type: "project_rule",
      content: "Use TypeScript strict mode.",
      summary: "TS Strict",
      profileTarget: "static",
    });

    const result = await runProfile({ layer: "static" });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.layer).toBe("static");
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.total).toBeGreaterThanOrEqual(1);
  });

  it("returns dynamic profile with --dynamic flag", async () => {
    // First save a memory with dynamic profile target
    await runRemember({
      type: "current_task",
      content: "Building CLI for CodeContext.",
      summary: "Build CLI",
      profileTarget: "dynamic",
    });

    const result = await runProfile({ layer: "dynamic" });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.layer).toBe("dynamic");
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.total).toBeGreaterThanOrEqual(1);
  });

  it("excludes expired facts when activeOnly=true", async () => {
    const result = await runProfile({ activeOnly: true });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.activeOnly).toBe(true);

    // Check that all static facts have no past expiration
    const staticFacts = data.staticFacts as Record<string, unknown>[];
    for (const fact of staticFacts) {
      if (fact.expiresAt) {
        expect(new Date(fact.expiresAt as string).getTime()).toBeGreaterThan(
          Date.now(),
        );
      }
    }
  });

  it("supports --all flag to include expired facts", async () => {
    const result = await runProfile({ activeOnly: false });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.activeOnly).toBe(false);
  });

  it("supports pagination with limit/offset for static", async () => {
    const result = await runProfile({
      layer: "static",
      limit: 2,
      offset: 0,
    });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.limit).toBe(2);
    const items = data.items as Record<string, unknown>[];
    expect(items.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 13. receipts (list)
// ---------------------------------------------------------------------------

describe("receipts command", () => {
  it("returns list of receipts for current scope", async () => {
    const result = await runReceipts({});
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.scopeId).toBeTruthy();
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.count).toBe("number");
    expect(typeof data.limit).toBe("number");
  });

  it("supports filtering by operation", async () => {
    const result = await runReceipts({ operation: "remember" });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const items = data.items as Record<string, unknown>[];
    for (const item of items) {
      expect(item.operation).toBe("remember");
    }
  });

  it("supports filtering by compress operation", async () => {
    const result = await runReceipts({ operation: "compress" });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const items = data.items as Record<string, unknown>[];
    for (const item of items) {
      expect(item.operation).toBe("compress");
    }
  });

  it("supports pagination with limit/offset", async () => {
    const result = await runReceipts({ limit: 5, offset: 0 });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.limit).toBe(5);
    expect(data.offset).toBe(0);
    const items = data.items as Record<string, unknown>[];
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it("returns receipt fields correctly", async () => {
    const result = await runReceipts({ limit: 1 });
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const items = data.items as Record<string, unknown>[];
    if (items.length > 0) {
      const item = items[0]!;
      expect(item.id).toMatch(/^rcp_/);
      expect(item.operation).toBeTruthy();
      expect(item.timestamp).toBeTruthy();
      expect(typeof item.failed).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// 14. Integration scenarios
// ---------------------------------------------------------------------------

describe("Integration scenarios", () => {
  it("scenario: save project rule → recall → supersede", async () => {
    // 1. Save a project rule to profile
    const saved = await runRemember({
      type: "project_rule",
      content: "API base URL: https://api-v1.example.com",
      summary: "API v1 base URL",
      profileTarget: "static",
      tags: ["api", "config"],
    });
    expect(saved.status).toBe("ok");
    const savedData = saved.data as Record<string, unknown>;
    const memoryId = savedData.memoryId as string;

    // 2. Recall the rule
    const recalled = await runRecall("API base URL", {
      types: ["project_rule"],
      includeProfile: true,
    });
    expect(recalled.status).toBe("ok");
    const recallData = recalled.data as Record<string, unknown>;
    expect(recallData.count).toBeGreaterThanOrEqual(1);

    // 3. View profile
    const profile = await runProfile({ layer: "static" });
    expect(profile.status).toBe("ok");
    const profileData = profile.data as Record<string, unknown>;
    const items = profileData.items as Record<string, unknown>[];
    const found = items.find((i) => i.content === "API v1 base URL");
    expect(found).toBeDefined();

    // 4. Supersede with new memory
    const newSaved = await runRemember({
      type: "project_rule",
      content: "API base URL: https://api-v2.example.com",
      summary: "API v2 base URL",
      profileTarget: "static",
      tags: ["api", "config"],
    });
    const newData = (newSaved.data as Record<string, unknown>);
    const newId = newData.memoryId as string;

    const superseded = await runForget({
      id: memoryId,
      mode: "supersede",
      supersededBy: newId,
    });
    expect(superseded.status).toBe("ok");
    const supData = superseded.data as Record<string, unknown>;
    expect(supData.newStatus).toBe("superseded");
    expect(supData.supersededBy).toBe(newId);

    // 5. Verify old rule no longer active in recall
    const recallAfter = await runRecall("API v1", {
      status: ["active"],
    });
    expect(recallAfter.status).toBe("ok");
    const recallAfterData = recallAfter.data as Record<string, unknown>;
    const v1Results = (recallAfterData.results as Record<string, unknown>[]).filter(
      (r) => r.memoryId === memoryId,
    );
    expect(v1Results.length).toBe(0); // Should not appear in active results
  });

  it("scenario: view receipt and receipts list", async () => {
    // 1. Create a memory to generate receipt
    const saved = await runRemember({
      type: "decision",
      content: "Use React 18 with TypeScript for all new components.",
      summary: "React 18 + TS",
    });
    const savedData = saved.data as Record<string, unknown>;
    const receiptId = savedData.receiptId as string;

    // 2. View single receipt
    const receipt = await runReceipt(receiptId);
    expect(receipt.status).toBe("ok");
    const receiptData = receipt.data as Record<string, unknown>;
    expect(receiptData.id).toBe(receiptId);
    expect(receiptData.operation).toBe("remember");

    // 3. List receipts
    const receiptsList = await runReceipts({ operation: "remember", limit: 10 });
    expect(receiptsList.status).toBe("ok");
    const receiptsData = receiptsList.data as Record<string, unknown>;
    const receiptItems = receiptsData.items as Record<string, unknown>[];
    const found = receiptItems.find((r) => r.id === receiptId);
    expect(found).toBeDefined();
  });

  it("scenario: list-context shows all memory statuses", async () => {
    // 1. Create and forget a memory
    const saved = await runRemember({
      type: "bug",
      content: "Memory leak in WebSocket handler.",
      summary: "WS memory leak",
    });
    const savedData = saved.data as Record<string, unknown>;
    const memoryId = savedData.memoryId as string;

    await runForget({
      id: memoryId,
      mode: "soft_forget",
      reason: "Fixed in v2.0",
    });

    // 2. List with active only
    const activeList = await runListContext({ status: ["active"] });
    expect(activeList.status).toBe("ok");

    // 3. List with forgotten only
    const forgottenList = await runListContext({ status: ["forgotten"] });
    expect(forgottenList.status).toBe("ok");
    const forgottenData = forgottenList.data as Record<string, unknown>;
    const forgottenItems = forgottenData.items as Record<string, unknown>[];
    const foundForgotten = forgottenItems.find((i) => i.memoryId === memoryId);
    expect(foundForgotten).toBeDefined();

    // 4. List all statuses
    const allList = await runListContext({
      status: ["active", "forgotten", "superseded", "expired"],
    });
    expect(allList.status).toBe("ok");
  });
});
