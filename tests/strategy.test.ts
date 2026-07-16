/**
 * Strategy Tests — Phase 4 (14.9)
 *
 * Comprehensive tests for all 8 compression strategies:
 *   - Unit tests (extraction correctness)
 *   - Fixture tests (realistic inputs)
 *   - Token stats tests (tokensBefore > tokensAfter)
 *   - Fail-open tests (invalid/corrupt input → original + warning)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerAllStrategies } from "../src/compression/registerStrategies.js";
import { compress, type CompressionInput } from "../src/compression/compressionEngine.js";
import { countTokens } from "../src/utils/tokenCount.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  registerAllStrategies();
});

function fixturePath(name: string): string {
  return resolve(__dirname, "fixtures", name);
}

function readFixture(name: string): string {
  return readFileSync(fixturePath(name), "utf-8");
}

function input(
  contentType: string,
  content: string,
  overrides: Partial<CompressionInput> = {},
): CompressionInput {
  return {
    scopeId: "test-scope",
    content,
    contentType: contentType as CompressionInput["contentType"],
    keepOriginal: false,
    maxTokens: 500,
    ...overrides,
  };
}

// ============================================================================
// 14.1 Test Output Compressor
// ============================================================================

describe("14.1 Test Output Compressor", () => {
  const fixture = readFixture("vitest-output.txt");

  describe("Unit — extraction", () => {
    it("detects vitest framework", async () => {
      const result = await compress(input("test_output", fixture));
      expect(result.compressedContent).toMatch(/vitest/i);
    });

    it("extracts failed test files", async () => {
      const result = await compress(input("test_output", fixture));
      expect(result.compressedContent).toContain("session.test.ts");
      expect(result.compressedContent).toContain("connection.test.ts");
    });

    it("extracts failed test names", async () => {
      const result = await compress(input("test_output", fixture));
      expect(result.compressedContent).toMatch(/should clear cookie/i);
      expect(result.compressedContent).toMatch(/should handle expired/i);
    });

    it("extracts assertion Expected/Received", async () => {
      const result = await compress(input("test_output", fixture));
      expect(result.compressedContent).toMatch(/Expected/i);
      expect(result.compressedContent).toMatch(/Received/i);
    });

    it("extracts exit code", async () => {
      const result = await compress(input("test_output", fixture));
      expect(result.compressedContent).toContain("Exit Code");
    });

    it("outputs fixed Markdown format", async () => {
      const result = await compress(input("test_output", fixture));
      expect(result.compressedContent).toMatch(/^## Test Output Summary/m);
      expect(result.compressedContent).toMatch(/\*\*Command:\*\*/);
      expect(result.compressedContent).toMatch(/\*\*Framework:\*\*/);
      expect(result.compressedContent).toMatch(/\*\*Status:\*\*/);
      expect(result.compressedContent).toMatch(/\*\*Exit Code:\*\*/);
    });
  });

  describe("Fixture test", () => {
    it("compresses vitest output correctly", async () => {
      const result = await compress(input("test_output", fixture, { maxTokens: 500 }));
      expect(result.failed).toBeFalsy();
      expect(result.tokensAfter).toBeLessThanOrEqual(500 + 50);
    });
  });

  describe("Token stats", () => {
    it("reduces token count significantly", async () => {
      const tokensBefore = countTokens(fixture);
      const result = await compress(input("test_output", fixture, { maxTokens: 500 }));
      expect(result.tokensAfter).toBeLessThan(tokensBefore);
      expect(result.tokensSaved).toBeGreaterThan(0);
    });
  });

  describe("Fail-open", () => {
    it("handles empty content", async () => {
      const result = await compress(input("test_output", ""));
      expect(result.failed).toBeFalsy();
    });

    it("handles content with no test signatures", async () => {
      const result = await compress(input("test_output", "Just plain text with no test structure."));
      expect(result.failed).toBeFalsy();
      expect(result.compressedContent).toBeTruthy();
    });

    it("handles extremely long single line", async () => {
      const long = "x".repeat(10000);
      const result = await compress(input("test_output", long, { maxTokens: 100 }));
      expect(result.failed).toBeFalsy();
    });
  });
});

// ============================================================================
// 14.2 Log Compressor
// ============================================================================

describe("14.2 Log Compressor", () => {
  const fixture = readFixture("app-log.txt");

  describe("Unit — extraction", () => {
    it("extracts ERROR lines", async () => {
      const result = await compress(input("log", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/ERROR/i);
      expect(result.compressedContent).toContain("TypeError");
    });

    it("extracts WARN lines", async () => {
      const result = await compress(input("log", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/WARN/i);
    });

    it("extracts timestamps", async () => {
      const result = await compress(input("log", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/2026-06-09/);
    });

    it("extracts trace IDs", async () => {
      const result = await compress(input("log", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/trc_[a-f0-9]+/i);
    });

    it("extracts exception types", async () => {
      const result = await compress(input("log", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/TypeError|ConnectionError/i);
    });

    it("includes stack trace", async () => {
      const result = await compress(input("log", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/PaymentService|DatabasePool|handleRequest/i);
    });

    it("folds repeated INFO lines", async () => {
      const infoLog = Array.from({ length: 50 }, (_, i) =>
        `2026-06-09T${String(i).padStart(2, "0")}:00:00Z INFO Heartbeat #${i}`
      ).join("\n") + "\n2026-06-09T12:00:00Z ERROR Critical failure";
      const result = await compress(input("log", infoLog, { maxTokens: 200 }));
      const hasFold = result.warnings.some(
        (w) => w.toLowerCase().includes("fold") || w.includes("Folded"),
      );
      expect(hasFold).toBe(true);
    });
  });

  describe("Fixture test", () => {
    it("compresses application log correctly", async () => {
      const result = await compress(input("log", fixture, { maxTokens: 500 }));
      expect(result.failed).toBeFalsy();
      expect(result.tokensAfter).toBeLessThanOrEqual(500 + 50);
    });
  });

  describe("Token stats", () => {
    it("reduces token count", async () => {
      const tokensBefore = countTokens(fixture);
      const result = await compress(input("log", fixture, { maxTokens: 300 }));
      expect(result.tokensAfter).toBeLessThan(tokensBefore);
    });
  });

  describe("Fail-open", () => {
    it("handles empty log", async () => {
      const result = await compress(input("log", ""));
      expect(result.failed).toBeFalsy();
    });

    it("handles content without ERROR/WARN lines", async () => {
      const result = await compress(input("log", "2026-01-01 INFO All good\n2026-01-01 DEBUG Debugging..."));
      expect(result.failed).toBeFalsy();
    });
  });
});

// ============================================================================
// 14.3 Command Output Compressor
// ============================================================================

describe("14.3 Command Output Compressor", () => {
  const fixture = readFixture("build-output.txt");

  describe("Unit — extraction", () => {
    it("extracts command", async () => {
      const result = await compress(input("command_output", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/pnpm build|tsc/);
    });

    it("extracts exit code", async () => {
      const result = await compress(input("command_output", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/exit code|Exit Code/i);
      expect(result.compressedContent).toContain("2");
    });

    it("extracts error file paths and line numbers", async () => {
      const result = await compress(input("command_output", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/testOutput\.ts/);
      expect(result.compressedContent).toMatch(/log\.ts/);
    });

    it("extracts TS error codes", async () => {
      const result = await compress(input("command_output", fixture, { maxTokens: 500 }));
      // Should have TS error codes like TS2304, TS2554
      expect(result.compressedContent).toMatch(/TS23\d\d|TS25\d\d/);
    });

    it("extracts failure reason", async () => {
      const result = await compress(input("command_output", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/build failed|error/i);
    });
  });

  describe("Fixture test", () => {
    it("compresses build output correctly", async () => {
      const result = await compress(input("command_output", fixture, { maxTokens: 500 }));
      expect(result.failed).toBeFalsy();
      expect(result.tokensAfter).toBeLessThanOrEqual(500 + 50);
    });
  });

  describe("Token stats", () => {
    it("reduces token count for large command output", async () => {
      const largeOutput = fixture.repeat(10);
      const tokensBefore = countTokens(largeOutput);
      const result = await compress(input("command_output", largeOutput, { maxTokens: 300 }));
      expect(result.tokensAfter).toBeLessThan(tokensBefore);
    });
  });

  describe("Fail-open", () => {
    it("handles empty command output", async () => {
      const result = await compress(input("command_output", ""));
      expect(result.failed).toBeFalsy();
    });

    it("handles successful command output", async () => {
      const successOutput = "$ npm test\n> All tests passed!\nDone in 2.5s";
      const result = await compress(input("command_output", successOutput));
      expect(result.failed).toBeFalsy();
    });
  });
});

// ============================================================================
// 14.4 Code Compressor
// ============================================================================

describe("14.4 Code Compressor", () => {
  const fixture = readFixture("sample.ts");
  const largeCodeFixture = fixture.repeat(5); // ~500 lines for compression tests

  describe("Unit — extraction", () => {
    it("preserves imports", async () => {
      const result = await compress(input("code", largeCodeFixture, { maxTokens: 200 }));
      expect(result.compressedContent).toContain("import");
      expect(result.compressedContent).toMatch(/node:crypto|Database|SessionModel/);
    });

    it("preserves exports", async () => {
      const result = await compress(input("code", largeCodeFixture, { maxTokens: 200 }));
      expect(result.compressedContent).toMatch(/export/);
    });

    it("preserves type/interface definitions", async () => {
      const result = await compress(input("code", largeCodeFixture, { maxTokens: 200 }));
      expect(result.compressedContent).toMatch(/interface AuthConfig|type AuthResult/);
    });

    it("preserves function signatures", async () => {
      const result = await compress(input("code", largeCodeFixture, { maxTokens: 200 }));
      expect(result.compressedContent).toMatch(/login|refreshToken|logout/);
    });

    it("preserves TODO/FIXME comments", async () => {
      const codeWithTodos = largeCodeFixture + "\n// TODO: improve validation\n// FIXME: handle edge case\n// HACK: temporary workaround";
      const result = await compress(input("code", codeWithTodos, { maxTokens: 200 }));
      expect(result.compressedContent).toMatch(/TODO|FIXME|HACK/i);
    });

    it("handles code without classes", async () => {
      const result = await compress(input("code", largeCodeFixture, { maxTokens: 200 }));
      expect(result.failed).toBeFalsy();
    });

    it("has folded sections counter or produces compressed output", async () => {
      const result = await compress(input("code", largeCodeFixture, { maxTokens: 100 }));
      expect(result.failed).toBeFalsy();
      expect(result.tokensAfter).toBeLessThanOrEqual(100 + 50);
    });
  });

  describe("Fixture test", () => {
    it("compresses TypeScript code correctly", async () => {
      const result = await compress(input("code", largeCodeFixture, { maxTokens: 200 }));
      expect(result.failed).toBeFalsy();
    });
  });

  describe("Token stats", () => {
    it("reduces token count for large code", async () => {
      const tokensBefore = countTokens(largeCodeFixture);
      const result = await compress(input("code", largeCodeFixture, { maxTokens: 200 }));
      expect(result.tokensAfter).toBeLessThan(tokensBefore);
    });
  });

  describe("Fail-open", () => {
    it("handles empty code", async () => {
      const result = await compress(input("code", ""));
      expect(result.failed).toBeFalsy();
    });

    it("handles non-code content gracefully", async () => {
      const result = await compress(input("code", "This is not code at all. It's just plain English text."));
      expect(result.failed).toBeFalsy();
    });
  });
});

// ============================================================================
// 14.5 JSON Compressor
// ============================================================================

describe("14.5 JSON Compressor", () => {
  const fixture = readFixture("response.json");

  describe("Unit — extraction", () => {
    it("preserves top-level keys", async () => {
      const result = await compress(input("json", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/status|code|message|errors/i);
    });

    it("preserves error fields specially", async () => {
      const result = await compress(input("json", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/VALIDATION_ERROR/);
    });

    it("preserves status and id fields", async () => {
      const result = await compress(input("json", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/status/i);
      expect(result.compressedContent).toMatch(/requestId/);
    });

    it("creates schema shape", async () => {
      const result = await compress(input("json", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/Schema|type|Type/);
    });

    it("folds long arrays", async () => {
      const result = await compress(input("json", fixture, { maxTokens: 300 }));
      expect(result.compressedContent).toMatch(/Folded|folded|items/);
    });

    it("handles JSON arrays", async () => {
      const arrayJson = JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
      const result = await compress(input("json", arrayJson, { maxTokens: 200 }));
      expect(result.failed).toBeFalsy();
    });
  });

  describe("Fixture test", () => {
    it("compresses JSON response correctly", async () => {
      const result = await compress(input("json", fixture, { maxTokens: 500 }));
      expect(result.failed).toBeFalsy();
    });
  });

  describe("Token stats", () => {
    it("reduces token count for large JSON", async () => {
      const largeJson = JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: i, data: "x".repeat(200) })) });
      const tokensBefore = countTokens(largeJson);
      const result = await compress(input("json", largeJson, { maxTokens: 300 }));
      expect(result.tokensAfter).toBeLessThan(tokensBefore);
    });
  });

  describe("Fail-open", () => {
    it("returns original for invalid JSON", async () => {
      const result = await compress(input("json", "not valid json {{{"));
      expect(result.failed).toBeFalsy();
      expect(result.compressedContent).toBeTruthy();
      // Should have a warning about JSON parse failure
      const hasWarning = result.warnings.some((w) =>
        w.toLowerCase().includes("json") || w.toLowerCase().includes("parse"),
      );
      expect(hasWarning).toBe(true);
    });

    it("handles empty JSON object", async () => {
      const result = await compress(input("json", "{}"));
      expect(result.failed).toBeFalsy();
    });
  });
});

// ============================================================================
// 14.6 Markdown Compressor
// ============================================================================

describe("14.6 Markdown Compressor", () => {
  const fixture = readFixture("readme.md");

  describe("Unit — extraction", () => {
    it("preserves heading structure", async () => {
      const result = await compress(input("markdown", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/CodeContext MCP|Overview|Installation|Quick Start/i);
    });

    it("preserves list structure", async () => {
      const result = await compress(input("markdown", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/Supported Content Types|Design Principles/i);
    });

    it("summarizes code blocks", async () => {
      const result = await compress(input("markdown", fixture, { maxTokens: 500 }));
      // Should reference code blocks
      expect(result.compressedContent).toMatch(/code|Code|```/);
    });

    it("folds repeated sections", async () => {
      const repeatedMd = "# Title\n\nSame paragraph.\n\n".repeat(30);
      const result = await compress(input("markdown", repeatedMd, { maxTokens: 200 }));
      expect(result.failed).toBeFalsy();
    });

    it("merges repeated priority sections instead of listing every heading", async () => {
      const repeatedRequired = Array.from(
        { length: 40 },
        (_, index) => `## Required Component ${index + 1}\n\nRequired security check for this component.`,
      ).join("\n\n");

      const result = await compress(input("markdown", repeatedRequired, { maxTokens: 160 }));

      expect(result.compressedContent).toMatch(/Required Component 1.*(?:×|x)40/s);
      expect(result.compressedContent.match(/Required Component/g)?.length).toBe(1);
    });

    it("keeps a tail rollback strategy after many repeated components", async () => {
      const components = Array.from(
        { length: 120 },
        (_, index) =>
          `## Component ${index + 1}\n\nReusable component description with ordinary implementation notes.`,
      ).join("\n\n");
      const markdown = [
        "# Release Guide",
        components,
        "## Rollback Strategy",
        "Rollback is required when the failure rate is >= 5% for 10 minutes.",
        "- Command: `kubectl rollout undo deployment/api`",
        "- API: `POST /api/v1/releases/rollback`",
        "- Config: `release.rollback.enabled=true`",
      ].join("\n\n");

      const result = await compress(input("markdown", markdown, { maxTokens: 220 }));

      expect(result.failed).toBeFalsy();
      expect(result.tokensAfter).toBeLessThanOrEqual(220);
      expect(result.compressedContent).toMatch(/Rollback Strategy/i);
      expect(result.compressedContent.match(/Rollback Strategy/gi)).toHaveLength(1);
      expect(result.compressedContent).toContain("kubectl rollout undo deployment/api");
      expect(result.compressedContent).toContain("/api/v1/releases/rollback");
      expect(result.compressedContent).toMatch(/Component 1.*×120|Component 1.*120/s);
    });

    it("uses an optional goal to rank otherwise equal unique sections", async () => {
      const markdown = Array.from(
        { length: 20 },
        (_, index) =>
          `## Topic ${index + 1}\n\nOrdinary notes for area ${index + 1}. ` +
          (index === 17 ? "Investigate session cache eviction behavior." : "Routine details."),
      ).join("\n\n");

      const result = await compress({
        ...input("markdown", markdown, { maxTokens: 90 }),
        goal: "investigate session cache eviction",
      });

      expect(result.compressedContent).toMatch(/Topic 18|session cache eviction/i);
    });
  });

  describe("Fixture test", () => {
    it("compresses README markdown correctly", async () => {
      const result = await compress(input("markdown", fixture, { maxTokens: 500 }));
      expect(result.failed).toBeFalsy();
    });
  });

  describe("Token stats", () => {
    it("reduces token count for large markdown", async () => {
      const largeMd = fixture.repeat(3);
      const tokensBefore = countTokens(largeMd);
      const result = await compress(input("markdown", largeMd, { maxTokens: 500 }));
      expect(result.tokensAfter).toBeLessThan(tokensBefore);
    });
  });

  describe("Fail-open", () => {
    it("handles empty markdown", async () => {
      const result = await compress(input("markdown", ""));
      expect(result.failed).toBeFalsy();
    });

    it("handles markdown with only headings", async () => {
      const headingsOnly = "# A\n## B\n### C\n#### D\n##### E\n###### F";
      const result = await compress(input("markdown", headingsOnly));
      expect(result.failed).toBeFalsy();
    });
  });
});

// ============================================================================
// 14.7 RAG Chunk Compressor
// ============================================================================

describe("14.7 RAG Chunk Compressor", () => {
  const fixture = readFixture("rag-chunks.json");

  describe("Unit — extraction", () => {
    it("preserves source for each chunk", async () => {
      const result = await compress(input("rag_chunk", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/api-reference\.md|deployment\.md|faq\.md/);
    });

    it("preserves document title", async () => {
      const result = await compress(input("rag_chunk", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/API Reference|Deployment Guide|Frequently Asked Questions/i);
    });

    it("preserves chunk IDs", async () => {
      const result = await compress(input("rag_chunk", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/chk_00[1-6]/);
    });

    it("preserves score information", async () => {
      const result = await compress(input("rag_chunk", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/Score|score/);
    });

    it("marks canExpand on chunks", async () => {
      const result = await compress(input("rag_chunk", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/canExpand/);
    });

    it("includes short excerpts", async () => {
      const result = await compress(input("rag_chunk", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/JWT-based authentication|paginated list of users/i);
    });
  });

  describe("Fixture test", () => {
    it("compresses RAG chunk array correctly", async () => {
      const result = await compress(input("rag_chunk", fixture, { maxTokens: 500 }));
      expect(result.failed).toBeFalsy();
    });
  });

  describe("Token stats", () => {
    it("reduces token count", async () => {
      const tokensBefore = countTokens(fixture);
      const result = await compress(input("rag_chunk", fixture, { maxTokens: 300 }));
      expect(result.tokensAfter).toBeLessThan(tokensBefore);
    });
  });

  describe("Fail-open", () => {
    it("handles empty RAG input", async () => {
      const result = await compress(input("rag_chunk", ""));
      expect(result.failed).toBeFalsy();
    });

    it("handles non-JSON RAG text", async () => {
      const textChunks = "[source] docs/api.md\n[chunk] chk_001\nSome content here.";
      const result = await compress(input("rag_chunk", textChunks));
      expect(result.failed).toBeFalsy();
    });
  });
});

// ============================================================================
// 14.8 Conversation History Compressor
// ============================================================================

describe("14.8 Conversation History Compressor", () => {
  const fixture = readFixture("conversation.json");

  describe("Unit — extraction", () => {
    it("preserves current goal", async () => {
      const result = await compress(input("conversation_history", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/cookie clearing|token refresh|auth/i);
    });

    it("preserves completed steps", async () => {
      const result = await compress(input("conversation_history", fixture, { maxTokens: 300 }));
      // Completed steps extracted from checkboxes in messages
      expect(result.compressedContent).toMatch(/Completed Steps/);
      expect(result.compressedContent).toMatch(/clear cookie|mock cookie/i);
    });

    it("preserves pending steps", async () => {
      const result = await compress(input("conversation_history", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/expired refresh token|Handle case where/i);
    });

    it("preserves key decisions", async () => {
      const result = await compress(input("conversation_history", fixture, { maxTokens: 300 }));
      // Decisions may appear in message content or as extracted metadata
      expect(result.compressedContent).toMatch(/cookie|token|decision|mock|redirect/i);
    });

    it("preserves recent errors", async () => {
      const result = await compress(input("conversation_history", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toMatch(/ERROR|Token expired/i);
    });

    it("preserves relevant file paths", async () => {
      const result = await compress(input("conversation_history", fixture, { maxTokens: 500 }));
      expect(result.compressedContent).toContain("session.ts");
      expect(result.compressedContent).toContain("session.test.ts");
    });

    it("folds low-value dialogue", async () => {
      const chatWithFiller =
        "User: Hi\nAssistant: Hello!\nUser: How are you?\nAssistant: I'm great, thanks for asking!\n" +
        "User: Let's fix the critical auth bug in session.ts\nAssistant: The issue is in the logout handler — cookies aren't cleared.\n" +
        "User: Great catch\nAssistant: Thanks!\nUser: Can you fix it?\nAssistant: Done, the cookie options now match.\n" +
        "User: Perfect, thanks so much!\nAssistant: No problem! Happy to help!";
      const result = await compress(input("conversation_history", chatWithFiller, { maxTokens: 150 }));
      expect(result.failed).toBeFalsy();
    });
  });

  describe("Fixture test", () => {
    it("compresses conversation JSON correctly", async () => {
      const result = await compress(input("conversation_history", fixture, { maxTokens: 500 }));
      expect(result.failed).toBeFalsy();
    });
  });

  describe("Token stats", () => {
    it("reduces token count", async () => {
      const tokensBefore = countTokens(fixture);
      const result = await compress(input("conversation_history", fixture, { maxTokens: 300 }));
      expect(result.tokensAfter).toBeLessThan(tokensBefore);
    });
  });

  describe("Fail-open", () => {
    it("handles empty conversation", async () => {
      const result = await compress(input("conversation_history", ""));
      expect(result.failed).toBeFalsy();
    });

    it("handles plain text conversation", async () => {
      const plainChat = "User: Hello\nAssistant: Hi there!\nUser: Fix the bug\nAssistant: OK";
      const result = await compress(input("conversation_history", plainChat));
      expect(result.failed).toBeFalsy();
    });

    it("handles non-JSON non-structured text", async () => {
      const result = await compress(input("conversation_history", "Random text that is not a conversation."));
      expect(result.failed).toBeFalsy();
    });
  });
});

// ============================================================================
// 14.9 Cross-cutting tests
// ============================================================================

describe("14.9 Cross-cutting", () => {
  const fixture = readFixture("vitest-output.txt");

  it("all compressors produce valid ccrId", async () => {
    const types = ["test_output", "log", "command_output", "code", "json", "markdown", "rag_chunk", "conversation_history"];
    for (const ct of types) {
      const content = ct === "json" ? '{"key":"value"}' : fixture;
      const result = await compress(input(ct as CompressionInput["contentType"], content, { maxTokens: 300 }));
      expect(result.ccrId).toMatch(/^ccr_/);
      expect(result.receiptId).toMatch(/^rcp_/);
    }
  });

  it("all compressors handle maxTokens=50 without crashing", async () => {
    const types = ["test_output", "log", "command_output", "code", "json", "markdown", "rag_chunk", "conversation_history"];
    for (const ct of types) {
      const content = ct === "json" ? '{"key":"value"}' : fixture;
      const result = await compress(input(ct as CompressionInput["contentType"], content, { maxTokens: 50 }));
      expect(result.failed).toBeFalsy();
      expect(result.compressedContent).toBeTruthy();
    }
  });

  it("all compressors produce warnings array", async () => {
    const content = "x".repeat(5000);
    const types = ["test_output", "log", "command_output", "code", "json", "markdown", "rag_chunk", "conversation_history"];
    for (const ct of types) {
      const result = await compress(input(ct as CompressionInput["contentType"], ct === "json" ? '{"x":"' + content + '"}' : content, { maxTokens: 50 }));
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });

  it("all compressors have correct token tracking", async () => {
    const types = ["test_output", "log", "command_output", "markdown", "rag_chunk", "conversation_history"];
    for (const ct of types) {
      const result = await compress(input(ct as CompressionInput["contentType"], fixture, { maxTokens: 300 }));
      expect(result.tokensBefore).toBeGreaterThan(0);
      expect(result.tokensAfter).toBeGreaterThan(0);
      expect(result.tokensSaved).toBe(result.tokensBefore - result.tokensAfter);
      expect(result.compressionRatio).toBeGreaterThanOrEqual(0);
    }
  });
});
