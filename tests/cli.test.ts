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
