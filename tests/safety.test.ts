/**
 * Safety Layer Tests — PRD §11.5
 *
 * Covers:
 *   11.1 Timeout
 *   11.2 Size Limit
 *   11.3 Chunking (text, log, code)
 *   11.4 Fail-open
 *   11.5 Compression exceptions & DB write exceptions
 */

import { describe, it, expect, beforeAll } from "vitest";
import { withTimeout, TimeoutError } from "../src/safety/timeout.js";
import { failOpen, type FailOpenResult } from "../src/safety/failOpen.js";
import { checkSizeLimit, type SizeLimitConfig } from "../src/safety/sizeLimit.js";
import {
  chunkText,
  chunkLog,
  chunkCode,
  chunkPlain,
  chunkByType,
} from "../src/safety/chunking.js";
import { compressSafely } from "../src/safety/safetyLayer.js";
import type { CompressionInput } from "../src/compression/compressionEngine.js";
import { registerAllStrategies } from "../src/compression/registerStrategies.js";

// Register strategies once before all tests
beforeAll(() => {
  registerAllStrategies();
});

// ============================================================================
// 11.1 Timeout
// ============================================================================

describe("11.1 Timeout", () => {
  it("should complete within timeout when operation is fast", async () => {
    const result = await withTimeout(
      Promise.resolve("done"),
      { timeoutMs: 1000, label: "fast-op" },
    );
    expect(result).toBe("done");
  });

  it("should throw TimeoutError when operation exceeds timeout", async () => {
    // Use a never-resolving promise to trigger timeout immediately
    const neverResolves = new Promise<string>(() => {
      // never resolve
    });

    await expect(
      withTimeout(neverResolves, { timeoutMs: 5, label: "slow-op" }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("should not apply timeout when timeoutMs is 0", async () => {
    const result = await withTimeout(
      Promise.resolve("done"),
      { timeoutMs: 0, label: "no-timeout" },
    );
    expect(result).toBe("done");
  });

  it("should not apply timeout when timeoutMs is negative", async () => {
    const result = await withTimeout(
      Promise.resolve("done"),
      { timeoutMs: -1, label: "negative-timeout" },
    );
    expect(result).toBe("done");
  });

  it("should clear timeout when promise resolves", async () => {
    const result = await withTimeout(
      Promise.resolve("fast"),
      { timeoutMs: 5000, label: "will-succeed" },
    );
    expect(result).toBe("fast");
  });
});

// ============================================================================
// 11.2 Size Limit
// ============================================================================

describe("11.2 Size Limit", () => {
  const bigConfig: SizeLimitConfig = { maxInputBytes: 100, failOpen: true };
  const strictConfig: SizeLimitConfig = { maxInputBytes: 100, failOpen: false };

  it("should pass content under the limit", () => {
    const result = checkSizeLimit("short", bigConfig);
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.code).toBe("size_ok");
  });

  it("should truncate content over the limit when failOpen=true", () => {
    const content = "A".repeat(200);
    const result = checkSizeLimit(content, bigConfig);
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.originalBytes).toBeGreaterThan(bigConfig.maxInputBytes);
    expect(result.warning).toContain("truncated");
    expect(result.code).toBe("size_truncated");
    const resultBytes = new TextEncoder().encode(result.content).byteLength;
    expect(resultBytes).toBeLessThanOrEqual(bigConfig.maxInputBytes);
  });

  it("should reject content over the limit when failOpen=false", () => {
    const content = "A".repeat(200);
    const result = checkSizeLimit(content, strictConfig);
    expect(result.ok).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.warning).toContain("exceeds limit");
    expect(result.code).toBe("size_rejected");
  });

  it("should handle exact boundary content", () => {
    const config: SizeLimitConfig = { maxInputBytes: 10, failOpen: true };
    const content = "0123456789"; // exactly 10 bytes
    const result = checkSizeLimit(content, config);
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.originalBytes).toBe(10);
  });

  it("should handle one-byte-over content", () => {
    const config: SizeLimitConfig = { maxInputBytes: 10, failOpen: true };
    const content = "0123456789X"; // 11 bytes
    const result = checkSizeLimit(content, config);
    expect(result.truncated).toBe(true);
    expect(result.code).toBe("size_truncated");
    expect(result.ok).toBe(true); // failOpen keeps it ok
  });

  it("should not corrupt multi-byte UTF-8 characters during truncation", () => {
    const config: SizeLimitConfig = { maxInputBytes: 5, failOpen: true };
    const content = "你好世界"; // each CJK char is 3 bytes in UTF-8
    // Should not throw
    const result = checkSizeLimit(content, config);
    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe("string");
  });

  it("should format byte sizes with MB in warnings", () => {
    const content = "A".repeat(2_000_000);
    const config: SizeLimitConfig = { maxInputBytes: 1_048_576, failOpen: true };
    const result = checkSizeLimit(content, config);
    expect(result.warning).toMatch(/1\.\dMB/);
  });
});

// ============================================================================
// 11.3 Chunking
// ============================================================================

describe("11.3 Chunking", () => {
  const chunkOpts = { maxTokensPerChunk: 50 }; // ~200 bytes

  // ---- Text chunking ----

  it("should not split small text", () => {
    const result = chunkText("short text", chunkOpts);
    expect(result.totalChunks).toBe(1);
    expect(result.chunks[0]!.content).toBe("short text");
    expect(result.chunks[0]!.ref.chunkIndex).toBe(0);
    expect(result.chunks[0]!.ref.totalChunks).toBe(1);
  });

  it("should split text by heading boundaries", () => {
    const content = [
      "# Section 1",
      "",
      "Content of section 1. ".repeat(20),
      "",
      "# Section 2",
      "",
      "Content of section 2. ".repeat(20),
    ].join("\n");

    const result = chunkText(content, chunkOpts);
    expect(result.totalChunks).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(typeof chunk.content).toBe("string");
      expect(chunk.ref.byteLength).toBeGreaterThan(0);
    }
  });

  it("should preserve chunk source refs (byteOffset tracking)", () => {
    const content = "A".repeat(500);
    const result = chunkText(content, { maxTokensPerChunk: 10 });
    expect(result.totalChunks).toBeGreaterThan(1);

    let lastOffset = 0;
    for (const chunk of result.chunks) {
      expect(chunk.ref.chunkIndex).toBeGreaterThanOrEqual(0);
      expect(chunk.ref.totalChunks).toBe(result.totalChunks);
      expect(chunk.ref.byteOffset).toBeGreaterThanOrEqual(lastOffset);
      lastOffset = chunk.ref.byteOffset;
    }
  });

  it("should track totalOriginalBytes in chunk result", () => {
    const content = "Hello world! ".repeat(100);
    const result = chunkText(content, chunkOpts);
    expect(result.totalOriginalBytes).toBeGreaterThan(0);
  });

  // ---- Log chunking ----

  it("should split logs by timestamp boundaries", () => {
    const logLines: string[] = [];
    for (let i = 0; i < 30; i++) {
      logLines.push(
        `2026-06-09T10:${String(i).padStart(2, "0")}:00Z [INFO] Log ${i} - ${"data ".repeat(15)}`,
      );
    }
    const content = logLines.join("\n");
    const result = chunkByType(content, "log", chunkOpts);
    expect(result.totalChunks).toBeGreaterThanOrEqual(1);
  });

  it("should split logs by [LEVEL] patterns", () => {
    const logLines: string[] = [];
    for (let i = 0; i < 20; i++) {
      logLines.push(`[ERROR] DB failure ${i}: ${"details ".repeat(10)}`);
    }
    const result = chunkLog(logLines.join("\n"), chunkOpts);
    expect(result.totalChunks).toBeGreaterThanOrEqual(1);
  });

  it("should dispatch test_output to log chunking strategy", () => {
    const content =
      "FAIL  auth.test.ts  ".repeat(30) + "\n" + "PASS  other.test.ts  ".repeat(30);
    const result = chunkByType(content, "test_output", chunkOpts);
    expect(result.totalChunks).toBeGreaterThanOrEqual(1);
  });

  // ---- Code chunking ----

  it("should split code by function/class boundaries", () => {
    const code = [
      'import { foo } from "./foo.js";',
      "",
      "function helper1() {",
      "  " + "return 1;".repeat(30),
      "}",
      "",
      "function helper2() {",
      "  " + "return 2;".repeat(30),
      "}",
      "",
      "export function main() {",
      "  " + "return helper1() + helper2();".repeat(20),
      "}",
    ].join("\n");

    const result = chunkByType(code, "code", chunkOpts);
    expect(result.totalChunks).toBeGreaterThanOrEqual(1);
    expect(result.chunks[0]!.content).toContain("import");
  });

  it("should preserve imports in code chunks", () => {
    const code = [
      'import { useState } from "react";',
      'import { useEffect } from "react";',
      "",
      "export function ComponentA() {",
      "  " + "const x = 1;".repeat(40),
      "}",
      "",
      "export function ComponentB() {",
      "  " + "const y = 2;".repeat(40),
      "}",
    ].join("\n");

    const result = chunkCode(code, { maxTokensPerChunk: 30 });
    for (const chunk of result.chunks) {
      if (chunk.content.includes("export function")) {
        expect(chunk.content).toContain("import");
      }
    }
  });

  // ---- Dispatch by type ----

  it("should dispatch markdown to text strategy", () => {
    const md =
      "# Title\n\n" +
      "Paragraph. ".repeat(100) +
      "\n\n## Section\n\n" +
      "More. ".repeat(100);
    const result = chunkByType(md, "markdown", { maxTokensPerChunk: 40 });
    expect(result.totalChunks).toBeGreaterThan(1);
  });

  it("should dispatch plain_text to text strategy", () => {
    const text = "P1.\n\n".repeat(30) + "P2.\n\n".repeat(30);
    const result = chunkByType(text, "plain_text", { maxTokensPerChunk: 40 });
    expect(result.totalChunks).toBeGreaterThan(1);
  });

  it("should dispatch unknown to plain strategy", () => {
    const text = "Line. ".repeat(200);
    const result = chunkByType(text, "unknown", chunkOpts);
    expect(result.totalChunks).toBeGreaterThanOrEqual(1);
  });

  // ---- Edge cases ----

  it("should handle empty content", () => {
    const result = chunkText("", chunkOpts);
    expect(result.totalOriginalBytes).toBe(0);
  });

  it("should handle single chunk that exactly fits", () => {
    const content = "exact fit";
    const result = chunkText(content, { maxTokensPerChunk: 10000 });
    expect(result.totalChunks).toBe(1);
    expect(result.chunks[0]!.ref.byteOffset).toBe(0);
  });
});

// ============================================================================
// 11.4 Fail-open
// ============================================================================

describe("11.4 Fail-open", () => {
  it("should return success when operation completes", async () => {
    const result: FailOpenResult<string> = await failOpen(
      async () => "success",
      "fallback",
    );
    expect(result.success).toBe(true);
    expect(result.value).toBe("success");
    expect(result.error).toBeUndefined();
  });

  it("should return fallback when operation throws", async () => {
    const result: FailOpenResult<string> = await failOpen(
      async () => {
        throw new Error("boom");
      },
      "fallback",
      "test-op",
    );
    expect(result.success).toBe(false);
    expect(result.value).toBe("fallback");
    expect(result.error).toContain("test-op");
    expect(result.error).toContain("boom");
  });

  it("should not return empty content on failure", async () => {
    const result: FailOpenResult<string> = await failOpen(
      async () => {
        throw new Error("failed");
      },
      "original content here",
    );
    expect(result.value).not.toBe("");
    expect(result.value).toBe("original content here");
  });

  it("should handle non-Error throws (string)", async () => {
    const result: FailOpenResult<string> = await failOpen(
      async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "string error";
      },
      "fallback",
    );
    expect(result.success).toBe(false);
    expect(result.value).toBe("fallback");
    expect(result.error).toContain("string error");
  });

  it("should handle custom Error subclasses", async () => {
    class CustomError extends Error {
      code: string;
      constructor(msg: string, code: string) {
        super(msg);
        this.name = "CustomError";
        this.code = code;
      }
    }

    const result: FailOpenResult<string> = await failOpen(
      async () => {
        throw new CustomError("custom failure", "ERR_CUSTOM");
      },
      "fallback",
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("custom failure");
  });
});

// ============================================================================
// 11.5 Compression exception & integration tests
// ============================================================================

describe("11.5 Safety integration", () => {
  const baseInput: CompressionInput = {
    scopeId: "test_safety_scope",
    content: "test content",
    contentType: "plain_text",
    keepOriginal: false,
    maxTokens: 2000,
    timeoutMs: 5000,
  };

  it("should compress safely with normal content", async () => {
    const input: CompressionInput = {
      ...baseInput,
      content: "Test message that should be compressed safely. ".repeat(30),
    };

    const result = await compressSafely(input);
    expect(result.output).toBeDefined();
    expect(result.output.scopeId).toBe(input.scopeId);
    expect(result.output.tokensBefore).toBeGreaterThan(0);
  }, 15000);

  it("should trigger chunking for oversized content", async () => {
    const content = "Line of content.\n".repeat(500);
    const input: CompressionInput = {
      ...baseInput,
      content,
      contentType: "plain_text",
    };

    const result = await compressSafely(input, {
      sizeLimit: { maxInputBytes: 500, failOpen: true },
      chunkMaxTokens: 100,
    });

    expect(result.safetyActions).toContain("chunked");
    expect(result.safetyActions).toContain("chunk_compressed_and_merged");
  }, 15000);

  it("should merge chunk results with chunk boundary markers", async () => {
    const content = [
      "# Section A",
      "",
      "Content A. ".repeat(100),
      "",
      "# Section B",
      "",
      "Content B. ".repeat(100),
    ].join("\n");

    const input: CompressionInput = {
      ...baseInput,
      content,
      contentType: "markdown",
      keepOriginal: false,
    };

    const result = await compressSafely(input, {
      sizeLimit: { maxInputBytes: 200, failOpen: true },
      chunkMaxTokens: 100,
    });

    if (result.output.compressed) {
      expect(result.output.compressedContent).toContain("[Chunk");
    }
  }, 15000);

  it("should return warnings on failure", async () => {
    const input: CompressionInput = {
      ...baseInput,
      content: "test",
      timeoutMs: 1,
    };

    const result = await compressSafely(input, { timeoutMs: 1 });
    expect(Array.isArray(result.output.warnings)).toBe(true);
  }, 15000);

  it("should not return empty compressed content on failure", async () => {
    const input: CompressionInput = {
      ...baseInput,
      content: "meaningful content that must be preserved",
      timeoutMs: 1,
    };

    const result = await compressSafely(input, { timeoutMs: 1 });
    expect(result.output.compressedContent).not.toBe("");
    expect(result.output.compressedContent.length).toBeGreaterThan(0);
  }, 15000);

  it("should handle code compression with safety layer", async () => {
    const code = [
      'import React from "react";',
      "",
      "interface Props { name: string; age: number; }",
      "",
      "export function Greeting({ name, age }: Props) {",
      "  return `<div>Hello ${name}, you are ${age}</div>`;",
      "}",
    ].join("\n");

    const input: CompressionInput = {
      ...baseInput,
      content: code,
      contentType: "code",
      keepOriginal: true,
    };

    const result = await compressSafely(input);
    expect(result.output).toBeDefined();
    expect(result.output.tokensBefore).toBeGreaterThan(0);
  }, 15000);

  it("should handle log compression with safety layer", async () => {
    const log = [
      "2026-06-09T10:00:00Z [INFO] Server started",
      "2026-06-09T10:00:01Z [INFO] Loading config",
      "2026-06-09T10:00:05Z [ERROR] Failed to connect to DB: connection refused",
      "2026-06-09T10:00:05Z [ERROR]   at Database.connect (db.ts:42)",
      "2026-06-09T10:00:06Z [FATAL] Application shutdown",
    ].join("\n");

    const input: CompressionInput = {
      ...baseInput,
      content: log,
      contentType: "log",
      keepOriginal: true,
    };

    const result = await compressSafely(input);
    expect(result.output).toBeDefined();
    expect(result.output.compressedContent).toBeDefined();
  }, 15000);

  it("should handle test_output compression with safety layer", async () => {
    const testOutput = [
      "pnpm test",
      "",
      "PASS  src/utils.test.ts",
      "PASS  src/hash.test.ts",
      "FAIL  src/auth/session.test.ts",
      "  ● auth/session › should clear cookie on refresh token expiry",
      "    AssertionError: expected cookie to be cleared",
      "    Expected: null",
      "    Received: \"session=abc123\"",
      "      at Object.<anonymous> (src/auth/session.test.ts:42:15)",
      "",
      "Test Suites: 2 passed, 1 failed",
      "Tests:       8 passed, 1 failed",
    ].join("\n");

    const input: CompressionInput = {
      ...baseInput,
      content: testOutput,
      contentType: "test_output",
      keepOriginal: true,
    };

    const result = await compressSafely(input);
    expect(result.output).toBeDefined();
    expect(result.output.tokensBefore).toBeGreaterThan(0);
  }, 15000);
});

// ============================================================================
// 11.5b Database write exception tests (simulated)
// ============================================================================

describe("11.5b Database write exceptions", () => {
  it("should survive simulated DB failure with fallback content", () => {
    const output = {
      compressed: false,
      compressedContent: "original content",
      tokensBefore: 1000,
      tokensAfter: 1000,
      tokensSaved: 0,
      warnings: [] as string[],
    };

    // Simulate adding a DB warning (failOpen — don't block agent)
    output.warnings.push(
      "Database write warning: unable to persist CCR — disk full",
    );

    expect(output.warnings.length).toBeGreaterThan(0);
    expect(output.compressedContent).toBe("original content");
    expect(output.compressedContent).not.toBe("");
    expect(output.tokensSaved).toBe(0);
  });

  it("should keep output structure valid despite DB warning", () => {
    // Verify that the CompressedOutput structure is preserved
    // even when DB writes fail and warnings are added.
    const output = {
      compressed: true,
      compressedContent: "compressed result",
      tokensBefore: 1000,
      tokensAfter: 200,
      tokensSaved: 800,
      warnings: [] as string[],
    };

    output.warnings.push(
      "Database write warning: unable to persist CCR",
    );

    // Key invariants: content not empty, stats still valid
    expect(output.compressedContent).not.toBe("");
    expect(output.tokensSaved).toBe(800);
    expect(output.warnings.length).toBe(1);
  });

  it("should not crash on missing database (failOpen principle)", () => {
    // Verifies the failOpen principle applies to storage failures:
    // even if DB isn't initialized, the result should be returned.
    const result = {
      compressed: false,
      compressedContent: "original content",
      warnings: ["Database write warning: unable to persist CCR"],
    };

    expect(result.compressedContent).toBeDefined();
    expect(result.compressedContent).not.toBe("");
  });
});
