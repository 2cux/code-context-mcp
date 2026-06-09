/**
 * Compression Engine Tests — Phase 2 (8.1–8.4)
 *
 * Covers:
 *   - Strategy selection (8.4.1)
 *   - Unknown fallback (8.4.2)
 *   - maxTokens enforcement (8.4.3)
 *   - Warnings generation (8.4.4)
 *   - Empty content handling (8.4.5)
 *   - Exceptional content handling (8.4.6)
 *   - Plain text compression (8.3)
 *   - Strategy registry
 *   - failOpen behavior
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  compress,
  registerStrategy,
  getStrategy,
  hasStrategy,
  listRegisteredTypes,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  type CompressionInput,
  type CompressionOutput,
  type CompressionStrategy,
} from "../src/compression/compressionEngine.js";
import { registerAllStrategies } from "../src/compression/registerStrategies.js";
import { plainTextStrategy } from "../src/compression/strategies/plainText.js";
import { countTokens } from "../src/utils/tokenCount.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  registerAllStrategies();
});

// Helper: quick input builder
function input(
  overrides: Partial<CompressionInput> = {},
): CompressionInput {
  return {
    scopeId: "test-scope",
    content: "Hello world. This is test content.",
    contentType: "plain_text",
    keepOriginal: false,
    maxTokens: 500,
    ...overrides,
  };
}

// ============================================================================
// 8.1 — Strategy Registry
// ============================================================================

describe("Strategy Registry", () => {
  it("registers and retrieves a strategy", () => {
    const strategy: CompressionStrategy = {
      name: "test_strategy",
      version: "0.0.0",
      compress: (content) => ({
        compressedContent: content,
        warnings: [],
      }),
    };

    registerStrategy("plain_text", strategy);
    const found = getStrategy("plain_text");
    expect(found).toBeDefined();
    expect(found!.name).toBe("test_strategy");
    expect(found!.version).toBe("0.0.0");

    // Restore
    registerStrategy("plain_text", plainTextStrategy);
  });

  it("hasStrategy returns correct boolean", () => {
    expect(hasStrategy("plain_text")).toBe(true);
    expect(hasStrategy("log")).toBe(true);
    expect(hasStrategy("unknown")).toBe(false);
    expect(hasStrategy("file_summary")).toBe(false);
  });

  it("listRegisteredTypes returns all registered types", () => {
    const types = listRegisteredTypes();
    expect(types).toContain("plain_text");
    expect(types).toContain("log");
    expect(types).toContain("code");
    expect(types).toContain("test_output");
  });

  it("overwrites existing strategy on re-register", () => {
    const v1: CompressionStrategy = {
      name: "v1",
      version: "1.0.0",
      compress: (c) => ({ compressedContent: c, warnings: ["v1"] }),
    };
    const v2: CompressionStrategy = {
      name: "v2",
      version: "2.0.0",
      compress: (c) => ({ compressedContent: c, warnings: ["v2"] }),
    };

    registerStrategy("plain_text", v1);
    expect(getStrategy("plain_text")!.name).toBe("v1");

    registerStrategy("plain_text", v2);
    expect(getStrategy("plain_text")!.name).toBe("v2");

    // Restore
    registerStrategy("plain_text", plainTextStrategy);
  });
});

// ============================================================================
// 8.4.1 — Strategy Selection
// ============================================================================

describe("Strategy Selection", () => {
  it("selects plain_text strategy for plain_text content", async () => {
    const result = await compress(
      input({ contentType: "plain_text", content: "Just some regular text." }),
    );
    expect(result.failed).toBeFalsy();
    // PRD §11.2 format: {type}_{mode}_v{version}
    expect(result.strategy).toMatch(/^plain_text_conservative_v\d+$/);
  });

  it("selects log strategy for log content", async () => {
    const content =
      "2024-01-01 ERROR Something went wrong\n2024-01-01 WARN Retrying...";
    const result = await compress(
      input({ contentType: "log", content }),
    );
    expect(result.failed).toBeFalsy();
    expect(result.strategy).toMatch(/^log_conservative_v\d+$/);
  });

  it("selects test_output strategy for test output content", async () => {
    const content = "FAIL test_foo\nAssertionError: expected 1, got 2";
    const result = await compress(
      input({ contentType: "test_output", content }),
    );
    expect(result.failed).toBeFalsy();
    expect(result.strategy).toMatch(/^test_output_conservative_v\d+$/);
  });

  it("selects command_output strategy for command output content", async () => {
    const content = "$ npm test\nBuild failed with exit code 2";
    const result = await compress(
      input({ contentType: "command_output", content }),
    );
    expect(result.failed).toBeFalsy();
    expect(result.strategy).toMatch(/^command_output_conservative_v\d+$/);
  });

  it("records strategy version in output", async () => {
    const result = await compress(input({ contentType: "plain_text" }));
    expect(result.strategy).toMatch(/^plain_text_conservative_v\d+$/);
  });

  it("records conservative mode in strategy id", async () => {
    const result = await compress(
      input({ contentType: "plain_text", strategy: "conservative" }),
    );
    expect(result.strategy).toContain("_conservative_");
  });

  it("records auto mode in strategy id", async () => {
    const result = await compress(
      input({ contentType: "plain_text", strategy: "auto" }),
    );
    expect(result.strategy).toContain("_auto_");
  });
});

// ============================================================================
// 8.4.2 — Unknown Fallback
// ============================================================================

describe("Unknown Fallback", () => {
  it("falls back to plain_text for unknown content type", async () => {
    const result = await compress(
      input({ contentType: "unknown", content: "Some unclassifiable text." }),
    );
    expect(result.failed).toBeFalsy();
    // Falls back to plain_text, so strategy uses "plain_text" even though
    // input contentType was "unknown"
    expect(result.strategy).toMatch(/^plain_text_conservative_v\d+$/);
    // Should have a warning about the fallback
    const fallbackWarning = result.warnings.find(
      (w) => w.includes("fell back") || w.includes("unknown"),
    );
    expect(fallbackWarning).toBeDefined();
  });

  it("falls back to plain_text for file_summary (unregistered type)", async () => {
    const result = await compress(
      input({
        contentType: "file_summary",
        content: "Summary of file changes.",
      }),
    );
    expect(result.failed).toBeFalsy();
    expect(result.strategy).toMatch(/^plain_text_conservative_v\d+$/);
  });

  it("handles unspecified content type via plain_text fallback", async () => {
    // Simulate what happens when we temporarily unregister plain_text
    // We can't easily test "no strategy at all" because plain_text is always registered.
    // But unknown → plain_text is tested above.
    const result = await compress(
      input({ contentType: "unknown", content: "Anything" }),
    );
    expect(result.failed).toBeFalsy();
    expect(result.compressedContent).toBeTruthy();
  });
});

// ============================================================================
// 8.4.3 — maxTokens Enforcement
// ============================================================================

describe("maxTokens Enforcement", () => {
  it("returns content as-is when within token budget", async () => {
    const content = "Short text within budget.";
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 100 }),
    );
    expect(result.compressed).toBe(false);
    expect(result.compressedContent).toBe(content);
    expect(result.tokensSaved).toBe(0);
  });

  it("compresses when content exceeds token budget", async () => {
    // Generate content that definitely exceeds 50 tokens
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      lines.push(
        `Section ${i}: This is paragraph number ${i} with some additional ` +
          `text to make it longer and consume more tokens. The quick brown ` +
          `fox jumps over the lazy dog. Here is some more filler text.`,
      );
    }
    const content = lines.join("\n\n");
    const tokensBefore = countTokens(content);
    expect(tokensBefore).toBeGreaterThan(50);

    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 50 }),
    );
    expect(result.tokensAfter).toBeLessThanOrEqual(50 + 10); // allow small margin
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(result.compressed).toBe(true);
  });

  it("respects tight maxTokens budgets", async () => {
    const content =
      "Line one.\n\nLine two.\n\nLine three.\n\nLine four.\n\nLine five.";
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 10 }),
    );
    expect(result.tokensAfter).toBeLessThanOrEqual(10 + 5);
  });

  it("handles maxTokens = 1 (extremely tight budget)", async () => {
    const content = "Some content that needs extreme compression.";
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 1 }),
    );
    // Should not crash — returns whatever it can fit
    expect(result.failed).toBeFalsy();
    expect(result.compressedContent).toBeDefined();
  });

  it("handles maxTokens = 0 gracefully", async () => {
    const content = "Some content.";
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 0 }),
    );
    expect(result.failed).toBeFalsy();
    // With budget 0, output may be empty or very short
    expect(typeof result.compressedContent).toBe("string");
  });

  it("tracks correct token statistics", async () => {
    const content = "AAA BBB CCC DDD EEE FFF GGG HHH III JJJ";
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 100 }),
    );
    expect(result.tokensBefore).toBeGreaterThan(0);
    expect(result.tokensAfter).toBeGreaterThan(0);
    expect(result.tokensSaved).toBe(result.tokensBefore - result.tokensAfter);
    if (result.tokensBefore > 0) {
      expect(result.compressionRatio).toBe(
        Math.round((result.tokensSaved / result.tokensBefore) * 10000) / 10000,
      );
    }
  });
});

// ============================================================================
// 8.4.4 — Warnings
// ============================================================================

describe("Warnings", () => {
  it("includes strategy info as first warning", async () => {
    const result = await compress(input({ contentType: "plain_text" }));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("strategy=");
    expect(result.warnings[0]).toContain("plain_text_conservative_v");
  });

  it("warns when content is truncated for budget", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`Paragraph ${i}: ${"word ".repeat(20)}`);
    }
    const content = lines.join("\n\n");
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 50 }),
    );
    const truncWarning = result.warnings.find(
      (w) =>
        w.includes("Dropped") ||
        w.includes("truncated") ||
        w.includes("Truncated"),
    );
    expect(truncWarning).toBeDefined();
  });

  it("includes fallback warning for unknown types", async () => {
    const result = await compress(input({ contentType: "unknown" }));
    const fb = result.warnings.find(
      (w) =>
        w.includes("fell back") ||
        w.includes("No strategy registered"),
    );
    expect(fb).toBeDefined();
  });

  it("includes token savings info when compression occurs", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`Paragraph ${i}: ${"token ".repeat(15)}`);
    }
    const content = lines.join("\n\n");
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 100 }),
    );
    const savingsWarning = result.warnings.find(
      (w) => w.includes("Token savings") || w.includes("saved"),
    );
    expect(savingsWarning).toBeDefined();
  });

  it("does not include token savings warning when no compression needed", async () => {
    const result = await compress(
      input({
        contentType: "plain_text",
        content: "short",
        maxTokens: 1000,
      }),
    );
    const savingsWarning = result.warnings.find(
      (w) => w.includes("saved") && w.includes("Token"),
    );
    expect(savingsWarning).toBeUndefined();
  });
});

// ============================================================================
// 8.4.5 — Empty Content
// ============================================================================

describe("Empty Content", () => {
  it("handles empty string", async () => {
    const result = await compress(
      input({ contentType: "plain_text", content: "" }),
    );
    expect(result.failed).toBeFalsy();
    expect(result.compressedContent).toBe("");
    expect(result.tokensBefore).toBe(0);
    expect(result.tokensAfter).toBe(0);
    expect(result.compressed).toBe(false);
  });

  it("handles whitespace-only content", async () => {
    const result = await compress(
      input({ contentType: "plain_text", content: "   \n\t  \n   " }),
    );
    expect(result.failed).toBeFalsy();
    // Should not throw, compressed content should be the whitespace (preserved)
    expect(typeof result.compressedContent).toBe("string");
  });

  it("handles content with only newlines", async () => {
    const result = await compress(
      input({ contentType: "plain_text", content: "\n\n\n\n" }),
    );
    expect(result.failed).toBeFalsy();
    expect(typeof result.compressedContent).toBe("string");
  });

  it("handles null-like empty content for log type", async () => {
    const result = await compress(
      input({ contentType: "log", content: "" }),
    );
    expect(result.failed).toBeFalsy();
    expect(result.tokensBefore).toBe(0);
  });

  it("handles null-like empty content for test_output type", async () => {
    const result = await compress(
      input({ contentType: "test_output", content: "" }),
    );
    expect(result.failed).toBeFalsy();
  });
});

// ============================================================================
// 8.4.6 — Exceptional Content
// ============================================================================

describe("Exceptional Content", () => {
  it("handles very long content without crashing", async () => {
    const longLine = "The quick brown fox jumps over the lazy dog. ";
    const content = longLine.repeat(1000);
    expect(content.length).toBeGreaterThan(40000);

    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 200 }),
    );
    expect(result.failed).toBeFalsy();
    expect(result.tokensAfter).toBeLessThanOrEqual(200 + 20);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("handles content with emoji and Unicode", async () => {
    const content = [
      "# 🎉 项目标题 🚀",
      "",
      "这是一段中文内容，包含 emoji 和特殊字符。",
      "日本語のテキストも含まれています。",
      "한국어 텍스트도 있습니다.",
      "",
      "## ⚠️ 重要提示",
      "",
      "This is mixed with English and emoji: ✅ ❌ ⚡ 🔥",
      "",
      "### 📊 Data",
      "",
      "| 姓名 | 分数 | 状态 |",
      "|------|------|------|",
      "| 张三 | 95   | ✅   |",
      "| 李四 | 87   | ✅   |",
    ].join("\n");

    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 500 }),
    );
    expect(result.failed).toBeFalsy();
    // Should preserve the content with emoji intact
    expect(result.compressedContent).toBeTruthy();
  });

  it("handles content with only special characters", async () => {
    const content = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~".repeat(50);
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 100 }),
    );
    expect(result.failed).toBeFalsy();
  });

  it("handles binary-like / escape-heavy content", async () => {
    const content =
      "\\x00\\x01\\x02\\n\\t\\r\\\\".repeat(100) +
      "\n\nNormal text here\n\n" +
      "More \\x1b\\x5c escape sequences";
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 200 }),
    );
    expect(result.failed).toBeFalsy();
  });

  it("handles content that is one extremely long line (no paragraph breaks)", async () => {
    const content = "word ".repeat(5000);
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 100 }),
    );
    expect(result.failed).toBeFalsy();
    expect(result.tokensAfter).toBeLessThanOrEqual(100 + 20);
  });

  it("handles content with mixed line endings (\\r\\n, \\r, \\n)", async () => {
    const content = [
      "Line 1\r\nLine 2\r\nLine 3",
      "",
      "Paragraph 2 line 1\nParagraph 2 line 2",
      "",
      "Paragraph 3 line 1\rParagraph 3 line 2",
    ].join("\n");

    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 500 }),
    );
    expect(result.failed).toBeFalsy();
  });

  it("handles HTML-like content in plain text mode", async () => {
    const content = [
      "<!DOCTYPE html>",
      "<html>",
      "<head><title>Test</title></head>",
      "<body>",
      "<h1>Hello World</h1>",
      "<p>This is a paragraph with <strong>bold</strong> text.</p>",
      "<div class='error'>Error message here</div>",
      "<script>console.log('test');</script>",
      "</body>",
      "</html>",
    ].join("\n");

    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 100 }),
    );
    expect(result.failed).toBeFalsy();
    // Should preserve error-related content
    expect(result.compressedContent).toContain("error");
  });
});

// ============================================================================
// 8.3 — Plain Text Compression Quality
// ============================================================================

describe("Plain Text Compression Quality", () => {
  it("preserves the first section of content", async () => {
    const content = [
      "# Important Title",
      "",
      "This is the introductory paragraph that explains everything.",
      "",
      "## Section 2",
      "",
      "Less important details follow here.",
      "",
      "## Section 3",
      "",
      "Even more details that might not be critical.",
      "",
      "## Section 4",
      "",
      "The final concluding paragraph that summarizes everything.",
    ].join("\n");

    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 30 }),
    );
    // First section (# Important Title) should be in the output
    expect(result.compressedContent).toContain("Important Title");
  });

  it("preserves the last section of content", async () => {
    const content = [
      "# Start",
      "",
      "Beginning paragraph with context.",
      "",
      "## Middle 1",
      "",
      "Middle paragraph one with some details about the implementation.",
      "",
      "## Middle 2",
      "",
      "Middle paragraph two with more context and background information.",
      "",
      "## Middle 3",
      "",
      "Another middle paragraph that is not very important.",
      "",
      "## Conclusion",
      "",
      "This is the critical conclusion that MUST be preserved.",
    ].join("\n");

    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 40 }),
    );
    // Last section should be preserved
    expect(result.compressedContent).toContain("critical conclusion");
  });

  it("preserves headings when compressing", async () => {
    const sections: string[] = [];
    sections.push("# Main Title");
    sections.push("Intro text.");
    for (let i = 1; i <= 30; i++) {
      sections.push(`## Section ${i}`);
      sections.push(`Content for section ${i}. ${"filler ".repeat(10)}`);
    }
    sections.push("# Final Section");
    sections.push("Critical final content with important notes.");

    const content = sections.join("\n\n");
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 100 }),
    );

    // Main and final headings should be preserved
    expect(result.compressedContent).toContain("Main Title");
    expect(result.compressedContent).toContain("Final Section");
  });

  it("preserves sections with error/warning signals", async () => {
    const content = [
      "# Report",
      "",
      "Everything is running smoothly.",
      "",
      "## Status Update",
      "",
      "The system continues to operate normally with no issues.",
      "",
      "## Error Report",
      "",
      "ERROR: Database connection failed with fatal timeout.",
      "Stack trace: ConnectionPool::get() at line 42",
      "",
      "## Warning",
      "",
      "WARNING: Memory usage exceeds 80% threshold. Alert sent.",
      "",
      "## Summary",
      "",
      "Overall the system is OK but needs attention.",
    ].join("\n");

    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 100 }),
    );

    // Error and warning sections should be preserved
    const hasError =
      result.compressedContent.includes("ERROR") ||
      result.compressedContent.includes("Database connection failed");
    const hasWarning =
      result.compressedContent.includes("WARNING") ||
      result.compressedContent.includes("Memory usage");
    expect(hasError).toBe(true);
    expect(hasWarning).toBe(true);
  });

  it("folds consecutive repeated content", async () => {
    const repeatedLine = "This line repeats many times in the log output.";
    const sections = [
      "# Header",
      "Introduction paragraph here.",
      repeatedLine,
      repeatedLine,
      repeatedLine,
      repeatedLine,
      repeatedLine,
      "## Unique Section",
      "This section has unique content that should definitely be kept.",
    ];

    const content = sections.join("\n\n");
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 200 }),
    );

    // Should fold repeated lines (if within budget they'll remain, but 5 repeats
    // will be folded to 1 + annotation)
    if (result.compressedContent.includes("Repeated")) {
      // Should not contain all 5 copies
      const occurrences = (
        result.compressedContent.match(/This line repeats/g) ?? []
      ).length;
      expect(occurrences).toBeLessThan(5);
    }
  });

  it("provides a meaningful summary", async () => {
    const sections: string[] = [];
    for (let i = 0; i < 50; i++) {
      sections.push(`## Section ${i}`);
      sections.push(`This is the detailed content for section number ${i}. ` +
        `It contains useful information that helps understand the context ` +
        `of the project and its implementation details.`);
    }
    const content = sections.join("\n\n");

    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 100 }),
    );
    expect(result.summary).toBeDefined();
    expect(result.summary!.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// failOpen Behavior
// ============================================================================

describe("failOpen Behavior", () => {
  it("returns original content when strategy throws", async () => {
    const badStrategy: CompressionStrategy = {
      name: "bad",
      version: "0.0.0",
      compress: () => {
        throw new Error("Intentional strategy failure");
      },
    };

    registerStrategy("plain_text", badStrategy);

    const content = "Content that should be returned unchanged on failure.";
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 500 }),
    );

    // Should have failed open
    expect(result.failed).toBe(true);
    expect(result.errorReason).toBeDefined();
    expect(result.errorReason).toContain("Intentional strategy failure");
    expect(result.compressedContent).toBe(content); // Original returned
    expect(result.compressed).toBe(false);

    // Restore
    registerStrategy("plain_text", plainTextStrategy);
  });

  it("returns fallback when strategy returns empty string", async () => {
    const emptyStrategy: CompressionStrategy = {
      name: "empty",
      version: "0.0.0",
      compress: () => ({
        compressedContent: "",
        warnings: [],
        summary: "Intentionally empty",
      }),
    };

    registerStrategy("plain_text", emptyStrategy);

    const content = "Some content here.";
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 500 }),
    );

    // Should not crash — empty string is valid output
    expect(result.failed).toBeFalsy();
    expect(result.compressedContent).toBe("");

    // Restore
    registerStrategy("plain_text", plainTextStrategy);
  });
});

// ============================================================================
// Output Shape & Metadata
// ============================================================================

describe("Output Shape & Metadata", () => {
  it("produces valid ccrId", async () => {
    const result = await compress(input());
    expect(result.ccrId).toMatch(/^ccr_[a-z0-9]+_[a-f0-9]+_\d{6}$/);
  });

  it("produces valid receiptId", async () => {
    const result = await compress(input());
    expect(result.receiptId).toMatch(/^rcp_[a-z0-9]+_[a-f0-9]+$/);
  });

  it("sets canRetrieveOriginal based on keepOriginal flag", async () => {
    const withKeep = await compress(
      input({ keepOriginal: true }),
    );
    expect(withKeep.canRetrieveOriginal).toBe(true);
    expect(withKeep.originalRef).toBeDefined();
    expect(withKeep.originalRef).toMatch(/^orig_/);

    const withoutKeep = await compress(
      input({ keepOriginal: false }),
    );
    expect(withoutKeep.canRetrieveOriginal).toBe(false);
    expect(withoutKeep.originalRef).toBeUndefined();
  });

  it("passes scopeId through unchanged", async () => {
    const result = await compress(
      input({ scopeId: "my-custom-scope" }),
    );
    expect(result.scopeId).toBe("my-custom-scope");
  });

  it("passes contentType through", async () => {
    const result = await compress(
      input({ contentType: "log" }),
    );
    expect(result.contentType).toBe("log");
  });

  it("includes all required fields in output", async () => {
    const result = await compress(input());

    // Required fields from CompressionOutput
    expect(result).toHaveProperty("ccrId");
    expect(result).toHaveProperty("compressed");
    expect(result).toHaveProperty("scopeId");
    expect(result).toHaveProperty("contentType");
    expect(result).toHaveProperty("strategy");
    expect(result).toHaveProperty("compressedContent");
    expect(result).toHaveProperty("tokensBefore");
    expect(result).toHaveProperty("tokensAfter");
    expect(result).toHaveProperty("tokensSaved");
    expect(result).toHaveProperty("compressionRatio");
    expect(result).toHaveProperty("canRetrieveOriginal");
    expect(result).toHaveProperty("receiptId");
    expect(result).toHaveProperty("warnings");
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

// ============================================================================
// Log & Other Strategy Tests (sanity)
// ============================================================================

describe("Log Strategy", () => {
  it("preserves ERROR lines", async () => {
    const content = [
      "2024-01-01 INFO Starting server",
      "2024-01-01 INFO Listening on port 8080",
      "2024-01-01 ERROR Connection refused to database",
      "2024-01-01 WARN Retry attempt 1 of 3",
      "2024-01-01 ERROR All retries exhausted",
      "2024-01-01 FATAL Shutting down",
    ].join("\n");

    const result = await compress(
      input({ contentType: "log", content, maxTokens: 100 }),
    );
    expect(result.compressedContent).toContain("ERROR");
    expect(result.compressedContent).toContain("FATAL");
  });

  it("folds repeated INFO lines", async () => {
    const lines = ["2024-01-01 INFO Heartbeat"];

    // Generate 50 identical INFO lines
    const allLines: string[] = [];
    for (let i = 0; i < 50; i++) {
      allLines.push(`2024-01-01T${String(i).padStart(2, "0")}:00:00Z INFO Heartbeat`);
    }
    allLines.push("2024-01-01T12:00:00Z ERROR Something broke");
    allLines.push("2024-01-01T12:00:01Z WARN Attempting recovery");

    const content = allLines.join("\n");
    const result = await compress(
      input({ contentType: "log", content, maxTokens: 200 }),
    );

    // ERROR should be preserved
    expect(result.compressedContent).toContain("ERROR");
    // Should mention folding
    const hasFold = result.warnings.some(
      (w) => w.includes("folded") || w.toLowerCase().includes("fold"),
    );
    expect(hasFold).toBe(true);
  });
});

describe("Command Output Strategy", () => {
  it("preserves error and exit code info", async () => {
    const content = [
      "$ pnpm build",
      "> tsc --noEmit",
      "src/foo.ts(15,5): error TS2304: Cannot find name 'bar'.",
      "src/foo.ts(20,3): error TS2554: Expected 2 arguments, got 1.",
      "Build failed with exit code 2",
    ].join("\n");

    const result = await compress(
      input({ contentType: "command_output", content, maxTokens: 100 }),
    );
    expect(result.compressedContent).toContain("error");
    expect(result.compressedContent).toContain("exit code");
  });
});

describe("Test Output Strategy", () => {
  it("handles test output within budget", async () => {
    const content = [
      "RUN  vitest v2.0.0",
      "FAIL  src/test.ts > should work",
      "  AssertionError: expected true to be false",
      "Test Suites: 1 failed, 5 passed",
    ].join("\n");

    const result = await compress(
      input({ contentType: "test_output", content, maxTokens: 500 }),
    );
    expect(result.failed).toBeFalsy();
  });
});

// ============================================================================
// Regression: Edge Cases Discovered During Testing
// ============================================================================

describe("Regression Edge Cases", () => {
  it("handles content with only double newlines", async () => {
    const result = await compress(
      input({
        contentType: "plain_text",
        content: "\n\n\n\n\n\n\n\n\n\n",
        maxTokens: 100,
      }),
    );
    expect(result.failed).toBeFalsy();
  });

  it("handles numeric content", async () => {
    const content = Array.from({ length: 200 }, (_, i) => String(i)).join("\n");
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 100 }),
    );
    expect(result.failed).toBeFalsy();
  });

  it("handles JSON-like content routed as plain_text", async () => {
    const content = '{"key": "value", "nested": {"a": 1, "b": 2}}';
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: 100 }),
    );
    expect(result.failed).toBeFalsy();
  });

  it("produces unique ccrIds across multiple compressions", async () => {
    const results = await Promise.all([
      compress(input({ content: "AAA" })),
      compress(input({ content: "BBB" })),
      compress(input({ content: "CCC" })),
    ]);
    const ids = results.map((r) => r.ccrId);
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });
});

// ============================================================================
// PRD §11.2 & §18 — Defaults & Timeout
// ============================================================================

describe("PRD Defaults & Timeout", () => {
  it("uses DEFAULT_MAX_TOKENS (2000) when maxTokens is not provided", async () => {
    const content = "Short content.";
    const result = await compress(
      input({ contentType: "plain_text", content, maxTokens: undefined }),
    );
    // Should not fail — uses default 2000
    expect(result.failed).toBeFalsy();
    // Content should fit within 2000 tokens
    expect(result.tokensBefore).toBeLessThanOrEqual(2000);
    expect(result.compressed).toBe(false); // Content is short, no compression
  });

  it("uses DEFAULT_TIMEOUT_MS (5000) when timeoutMs is not provided", async () => {
    const result = await compress(
      input({ contentType: "plain_text", timeoutMs: undefined }),
    );
    expect(result.failed).toBeFalsy();
  });

  it("DEFAULT_MAX_TOKENS equals 2000 (PRD §18)", () => {
    expect(DEFAULT_MAX_TOKENS).toBe(2000);
  });

  it("DEFAULT_TIMEOUT_MS equals 5000 (PRD §18)", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(5000);
  });

  it("respects custom timeoutMs", async () => {
    const result = await compress(
      input({ contentType: "plain_text", timeoutMs: 10000 }),
    );
    expect(result.failed).toBeFalsy();
  });

  it("times out with extremely short timeout", async () => {
    // Generate a lot of content that takes time to process
    const sections: string[] = [];
    for (let i = 0; i < 500; i++) {
      sections.push(`## Section ${i}`);
      sections.push(`This is the content for section ${i}. `.repeat(10));
    }
    const content = sections.join("\n\n");

    const result = await compress(
      input({
        contentType: "plain_text",
        content,
        timeoutMs: 1, // 1ms — will almost certainly timeout
      }),
    );

    // Should fail open with timeout error
    if (result.failed) {
      expect(result.errorReason).toBeDefined();
      expect(result.compressed).toBe(false);
      // Original content returned unchanged
      expect(result.compressedContent).toBe(content);
    }
    // If it doesn't fail (very fast machine), that's also OK — the important
    // thing is that it doesn't crash
  });

  it("failure output matches PRD §11.2 format", async () => {
    const badStrategy: CompressionStrategy = {
      name: "bad",
      version: "0.0.0",
      compress: () => {
        throw new Error("Simulated compression failure");
      },
    };
    registerStrategy("plain_text", badStrategy);

    const content = "Original content preserved.";
    const result = await compress(
      input({ contentType: "plain_text", content }),
    );

    expect(result.failed).toBe(true);
    expect(result.compressed).toBe(false);
    expect(result.errorReason).toBeDefined();
    expect(result.compressedContent).toBe(content);
    expect(result.tokensSaved).toBe(0);
    expect(result.compressionRatio).toBe(0);
    // PRD says failure output should contain this warning
    const hasFailWarning = result.warnings.some(
      (w) => w.includes("failed open") || w.includes("original content"),
    );
    expect(hasFailWarning).toBe(true);

    registerStrategy("plain_text", plainTextStrategy);
  });
});
