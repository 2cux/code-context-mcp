/**
 * ContentRouter Tests — Phase 2 (7.4)
 *
 * Covers:
 *   - Test output recognition (Vitest / Jest)
 *   - Log recognition
 *   - Command output recognition
 *   - TypeScript code recognition
 *   - JSON recognition
 *   - Markdown recognition
 *   - RAG chunk recognition
 *   - Unknown fallback
 *   - Router integration (confidence ordering, tie-breaking, edge-cases)
 */

import { describe, it, expect } from "vitest";
import { detectContentType } from "../src/router/contentRouter.js";
import { detectTestOutput } from "../src/router/detectors/testOutputDetector.js";
import { detectLog } from "../src/router/detectors/logDetector.js";
import { detectCommandOutput } from "../src/router/detectors/commandOutputDetector.js";
import { detectCode } from "../src/router/detectors/codeDetector.js";
import { detectJson } from "../src/router/detectors/jsonDetector.js";
import { detectMarkdown } from "../src/router/detectors/markdownDetector.js";
import { detectRagChunk } from "../src/router/detectors/ragChunkDetector.js";
import { detectConversationHistory } from "../src/router/detectors/conversationHistoryDetector.js";
import type { DetectionResult } from "../src/router/contentRouter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert a result is non-null and matches `expectedType`. */
function assertDetection(
  result: DetectionResult | null,
  expectedType: string,
  minConfidence = 0.2,
): asserts result is DetectionResult {
  if (!result) {
    expect.fail(`Expected ${expectedType} detection but got null`);
  }
  expect(result.contentType).toBe(expectedType);
  expect(result.confidence).toBeGreaterThanOrEqual(minConfidence);
  expect(result.confidence).toBeLessThanOrEqual(0.95);
  expect(result.signals.length).toBeGreaterThan(0);
}

// ============================================================================
// 7.4.1 — Test Output Recognition
// ============================================================================

describe("testOutputDetector", () => {
  it("detects Vitest output", () => {
    const content = `
 RUN  vitest v2.0.0

 ✓ src/utils.test.ts > should add numbers
 ✗ src/router.test.ts > should detect type FAIL
   → AssertionError: expected 'unknown' to be 'test_output'
   Expected: "test_output"
   Received: "unknown"

 Test Suites: 1 failed, 5 passed
 Tests:       1 failed, 42 passed
`;
    const result = detectTestOutput(content);
    assertDetection(result, "test_output");
    expect(result.signals).toContain("FAIL");
    expect(result.signals).toContain("vitest");
    expect(result.signals).toContain("AssertionError");
    expect(result.signals).toContain("Expected");
    expect(result.signals).toContain("Received");
    expect(result.signals).toContain("Test Suites");
    expect(result.signals).toContain("test failed");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("detects Jest output", () => {
    const content = `
 PASS  src/utils.test.ts
 FAIL  src/components/App.test.tsx
  ● App › renders correctly

    expect(received).toBe(expected)

    Expected: true
    Received: false

      15 |   it('renders correctly', () => {
      16 |     const { getByText } = render(<App />);
    > 17 |     expect(getByText('Hello')).toBe(true);
         |                                ^
      18 |   });

 Test Suites: 1 failed, 3 passed, 4 total
 Tests:       1 failed, 15 passed, 16 total
`;
    const result = detectTestOutput(content);
    assertDetection(result, "test_output");
    expect(result.signals).toContain("FAIL");
    expect(result.signals).toContain("test failed");
    expect(result.signals).toContain("Expected");
    expect(result.signals).toContain("Received");
    expect(result.signals).toContain("Test Suites");
  });

  it("detects pytest output", () => {
    const content = `
============================= test session starts =============================
platform linux -- Python 3.11.0, pytest-7.4.0

FAILED tests/test_api.py::test_create_user - AssertionError: expected 201, got 500
FAILED tests/test_db.py::test_migration - Exception: table not found

=========================== short test summary info ===========================
FAILED tests/test_api.py::test_create_user
FAILED tests/test_db.py::test_migration
======================== 2 failed, 8 passed in 2.34s =========================
`;
    const result = detectTestOutput(content);
    assertDetection(result, "test_output");
    expect(result.signals).toContain("pytest");
    expect(result.signals).toContain("FAIL");
    expect(result.signals).toContain("test failed");
    expect(result.signals).toContain("AssertionError");
  });

  it("returns null for non-test content", () => {
    const content = "This is a regular text without any test signals.";
    const result = detectTestOutput(content);
    expect(result).toBeNull();
  });

  it("returns null for content with only one weak signal", () => {
    // "failed" alone is not enough — needs 2+ signals
    const content = "The operation failed due to network timeout.";
    const result = detectTestOutput(content);
    expect(result).toBeNull();
  });
});

// ============================================================================
// 7.4.2 — Log Recognition
// ============================================================================

describe("logDetector", () => {
  it("detects application error logs", () => {
    const content = `
2024-06-15T10:30:00Z ERROR [request-id=abc123] Database connection failed
2024-06-15T10:30:01Z WARN  [request-id=abc123] Retrying connection (1/3)
2024-06-15T10:30:02Z ERROR [request-id=abc123] All retries exhausted
java.lang.Exception: Connection refused
    at com.example.db.ConnectionPool.get(ConnectionPool.java:42)
    at com.example.service.UserService.find(UserService.java:15)
`;
    const result = detectLog(content);
    assertDetection(result, "log");
    expect(result.signals).toContain("ERROR");
    expect(result.signals).toContain("WARN");
    expect(result.signals).toContain("Exception");
    expect(result.signals).toContain("timestamp");
    expect(result.signals).toContain("request id");
  });

  it("detects Python traceback logs", () => {
    const content = `
Traceback (most recent call last):
  File "/app/main.py", line 42, in <module>
    process()
  File "/app/main.py", line 15, in process
    raise ValueError("Invalid input")
ValueError: Invalid input
`;
    const result = detectLog(content);
    assertDetection(result, "log");
    expect(result.signals).toContain("Traceback");
    expect(result.signals).toContain("error class");
    expect(result.signals).toContain("traceback file");
  });

  it("detects INFO-level structured logs", () => {
    const content = `
2024-06-15 INFO  Server started on port 8080
2024-06-15 INFO  Database connected
2024-06-15 INFO  Initialization complete
`;
    const result = detectLog(content);
    assertDetection(result, "log");
    expect(result.signals).toContain("INFO");
    expect(result.signals).toContain("timestamp");
  });

  it("returns null for non-log content", () => {
    const content = "Hello world! This has no log patterns.";
    const result = detectLog(content);
    expect(result).toBeNull();
  });
});

// ============================================================================
// 7.4.3 — Command Output Recognition
// ============================================================================

describe("commandOutputDetector", () => {
  it("detects build failure output", () => {
    const content = `
$ pnpm build
> code-context-mcp@0.1.0 build
> tsc

src/router.ts(15,5): error TS2304: Cannot find name 'foo'.
Build failed with exit code 2
Command: tsc --noEmit
`;
    const result = detectCommandOutput(content);
    assertDetection(result, "command_output");
    expect(result.signals).toContain("exit code");
    expect(result.signals).toContain("build failed");
    expect(result.signals).toContain("command prompt");
    expect(result.signals).toContain("command");
  });

  it("detects shell command with stderr", () => {
    const content = `
$ npm test

stderr:
Error: Cannot find module './missing'

exit status 1
`;
    const result = detectCommandOutput(content);
    assertDetection(result, "command_output");
    expect(result.signals).toContain("stderr");
    expect(result.signals).toContain("exit code");
    expect(result.signals).toContain("command prompt");
  });

  it("detects path-style prompts", () => {
    const content = `
stdout:
C:\\project\\src> dir
D:\\project\\CodeContext> pnpm test

exit code: 0
`;
    const result = detectCommandOutput(content);
    assertDetection(result, "command_output");
    expect(result.signals).toContain("path prompt");
    expect(result.signals).toContain("stdout");
  });

  it("returns null for non-command content", () => {
    const content = "This is just a regular paragraph.";
    const result = detectCommandOutput(content);
    expect(result).toBeNull();
  });
});

// ============================================================================
// 7.4.4 — TypeScript Code Recognition
// ============================================================================

describe("codeDetector", () => {
  it("detects TypeScript code", () => {
    const content = `
import { describe, it, expect } from "vitest";
import type { User } from "./types.js";

export interface Config {
  port: number;
  host: string;
}

export class Server {
  private config: Config;

  public constructor(config: Config) {
    this.config = config;
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      console.log("Starting...");
      resolve();
    });
  }
}

export const createServer = (config: Config): Server => {
  const server = new Server(config);
  return server;
};
`;
    const result = detectCode(content);
    assertDetection(result, "code", 0.25);
    expect(result.signals).toContain("import");
    expect(result.signals).toContain("export");
    expect(result.signals).toContain("interface");
    expect(result.signals).toContain("class");
    expect(result.signals).toContain("type");
    expect(result.signals).toContain("const");
    expect(result.signals).toContain("public");
    expect(result.signals).toContain("private");
    expect(result.signals).toContain("async");
    expect(result.signals).toContain("return");
  });

  it("detects Python code", () => {
    const content = `
import os
from typing import Optional

def process_file(path: str) -> Optional[str]:
    """Process a file and return its content."""
    if not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        return f.read()

class FileProcessor:
    def __init__(self, root: str):
        self.root = root

    def process_all(self) -> list[str]:
        results = []
        for name in os.listdir(self.root):
            full = os.path.join(self.root, name)
            content = process_file(full)
            if content is not None:
                results.append(content)
        return results
`;
    const result = detectCode(content);
    assertDetection(result, "code", 0.25);
    expect(result.signals).toContain("import");
    expect(result.signals).toContain("def");
    expect(result.signals).toContain("class");
    expect(result.signals).toContain("return");
  });

  it("returns null for plain English text with a keyword", () => {
    // "return" alone shouldn't trigger code detection
    const content =
      "Please return the documents to the office. This is an important function of the team.";
    const result = detectCode(content);
    expect(result).toBeNull();
  });

  it("returns null for content with only 1-2 code keywords", () => {
    const content = "The class will start at 9am. A function is needed here.";
    const result = detectCode(content);
    // "class" and "function" appear in natural English too — need 3+ signals
    expect(result).toBeNull();
  });
});

// ============================================================================
// 7.4.5 — JSON Recognition
// ============================================================================

describe("jsonDetector", () => {
  it("detects a JSON object", () => {
    const content = JSON.stringify(
      {
        name: "code-context-mcp",
        version: "0.1.0",
        dependencies: { vitest: "^2.0.0" },
      },
      null,
      2,
    );
    const result = detectJson(content);
    assertDetection(result, "json", 0.8);
    expect(result.signals).toContain("starts with {");
    expect(result.signals).toContain("JSON.parse success");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detects a JSON array", () => {
    const content = JSON.stringify([1, 2, 3, 4, 5], null, 2);
    const result = detectJson(content);
    assertDetection(result, "json", 0.8);
    expect(result.signals).toContain("starts with [");
    expect(result.signals).toContain("JSON.parse success");
  });

  it("detects malformed JSON with key-value structure", () => {
    const content = `{
  "name": "test",
  "value": 123,
  "nested": {
    "key": "val"
  }
  // missing closing brace — unparseable but JSON-like
`;
    const result = detectJson(content);
    assertDetection(result, "json", 0.3);
    expect(result.signals).toContain("starts with {");
    expect(result.signals).toContain("key-value pairs");
  });

  it("returns null for non-JSON content", () => {
    const content = "This is not JSON at all.";
    const result = detectJson(content);
    expect(result).toBeNull();
  });

  it("returns null when confidence is too low", () => {
    // Single { with no key-value pairs
    const content = "{just a single brace}";
    const result = detectJson(content);
    expect(result).toBeNull();
  });
});

// ============================================================================
// 7.4.6 — Markdown Recognition
// ============================================================================

describe("markdownDetector", () => {
  it("detects a markdown document with headings and lists", () => {
    const content = `
# Project Title

## Getting Started

- Install with \`npm install\`
- Run with \`npm start\`

### Configuration

1. Copy \`.env.example\` to \`.env\`
2. Set your **API key**
3. Run the server

> **Note:** This is important.

| Option | Default | Description |
|--------|---------|-------------|
| port   | 8080    | Server port |
`;
    const result = detectMarkdown(content);
    assertDetection(result, "markdown");
    expect(result.signals).toContain("heading");
    expect(result.signals).toContain("unordered list");
    expect(result.signals).toContain("ordered list");
    expect(result.signals).toContain("bold");
    expect(result.signals).toContain("table");
    expect(result.signals).toContain("blockquote");
  });

  it("detects markdown with code blocks", () => {
    const content = `
# Example

Here is some code:

\`\`\`typescript
import { foo } from "bar";
foo();
\`\`\`

[Learn more](https://example.com)
`;
    const result = detectMarkdown(content);
    assertDetection(result, "markdown");
    expect(result.signals).toContain("heading");
    expect(result.signals).toContain("code block");
    expect(result.signals).toContain("link");
  });

  it("returns null for non-markdown content", () => {
    const content = "Plain text with no markdown formatting at all.";
    const result = detectMarkdown(content);
    expect(result).toBeNull();
  });
});

// ============================================================================
// 7.4.7 — RAG Chunk Recognition
// ============================================================================

describe("ragChunkDetector", () => {
  it("detects RAG chunk JSON output", () => {
    const content = `
{
  "chunk_id": "doc_001_chunk_03",
  "document_id": "doc_001",
  "source": "https://docs.example.com/api",
  "score": 0.87,
  "metadata": {
    "title": "API Reference",
    "section": "Authentication"
  },
  "excerpt": "To authenticate, include a Bearer token..."
}
`;
    const result = detectRagChunk(content);
    assertDetection(result, "rag_chunk");
    expect(result.signals).toContain("source");
    expect(result.signals).toContain("chunk");
    expect(result.signals).toContain("document");
    expect(result.signals).toContain("metadata");
    expect(result.signals).toContain("score");
    expect(result.signals).toContain("chunk_id");
    expect(result.signals).toContain("document_id");
    expect(result.signals).toContain("excerpt");
  });

  it("detects RAG results with relevance score", () => {
    const content = `
Relevance: 0.92
Document: user-guide.pdf
Chunk: Section 3.2 — Configuration Options
Source: /docs/user-guide.pdf

This section describes all available configuration options...
`;
    const result = detectRagChunk(content);
    assertDetection(result, "rag_chunk");
    expect(result.signals).toContain("document");
    expect(result.signals).toContain("chunk");
    expect(result.signals).toContain("source");
    expect(result.signals).toContain("relevance");
  });

  it("returns null for non-RAG content", () => {
    const content = "This is a regular document with no RAG-related fields.";
    const result = detectRagChunk(content);
    expect(result).toBeNull();
  });
});

// ============================================================================
// 7.4.7b — Conversation History Recognition
// ============================================================================

describe("conversationHistoryDetector", () => {
  it("detects JSON chat format (OpenAI/Anthropic style)", () => {
    const content = `
{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello, how are you?"},
    {"role": "assistant", "content": "I'm doing well, thank you!"}
  ]
}
`;
    const result = detectConversationHistory(content);
    assertDetection(result, "conversation_history");
    expect(result.signals).toContain("role field");
    expect(result.signals).toContain("content field");
    expect(result.signals).toContain("messages array");
  });

  it("detects Human/Assistant text format (LangChain style)", () => {
    const content = `
Human: What is the capital of France?

Assistant: The capital of France is Paris.

Human: Thanks!

Assistant: You're welcome! Is there anything else I can help with?
`;
    const result = detectConversationHistory(content);
    assertDetection(result, "conversation_history");
    expect(result.signals).toContain("human:");
    expect(result.signals).toContain("assistant:");
  });

  it("detects user/assistant text format", () => {
    const content = `
user: explain the code

assistant: Here's the explanation...

user: can you simplify?

assistant: Sure! In simple terms...
`;
    const result = detectConversationHistory(content);
    assertDetection(result, "conversation_history");
    expect(result.signals).toContain("user:");
    expect(result.signals).toContain("assistant:");
  });

  it("returns null for non-conversation content", () => {
    const content = "A single message with no conversation structure.";
    const result = detectConversationHistory(content);
    expect(result).toBeNull();
  });
});

// ============================================================================
// 7.4.8 — Unknown Fallback
// ============================================================================

describe("unknown fallback", () => {
  it("returns unknown for empty content", () => {
    const result = detectContentType("");
    expect(result.contentType).toBe("unknown");
    expect(result.confidence).toBe(1.0);
    expect(result.signals).toEqual([]);
    expect(result.allResults).toEqual([]);
  });

  it("returns unknown for whitespace-only content", () => {
    const result = detectContentType("   \n\t  ");
    expect(result.contentType).toBe("unknown");
  });

  it("returns unknown for content with no recognizable signals", () => {
    const content = [
      "The quick brown fox jumps over the lazy dog.",
      "This is a random piece of text that does not match any detector.",
      "There are no code keywords, no log patterns, no test output signals.",
      "Just plain human-readable text without any special formatting.",
    ].join("\n");
    const result = detectContentType(content);
    expect(result.contentType).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  it("returns unknown for gibberish / unclassifiable content", () => {
    const content = "asdfghjkl qwertyuiop zxcvbnm";
    const result = detectContentType(content);
    expect(result.contentType).toBe("unknown");
    expect(result.confidence).toBe(0);
  });
});

// ============================================================================
// 7.3 — ContentRouter Integration Tests
// ============================================================================

describe("ContentRouter integration (detectContentType)", () => {
  it("routes Vitest output → test_output with high confidence", () => {
    const content = `
 RUN  vitest v2.0.0
 FAIL  src/router.test.ts > should route correctly
   AssertionError: expected 'unknown' to be 'code'
   Expected: "code"
   Received: "unknown"

 Test Suites: 1 failed, 10 passed
`;
    const result = detectContentType(content);
    expect(result.contentType).toBe("test_output");
    expect(result.confidence).toBeGreaterThan(0.3);
    expect(result.signals.length).toBeGreaterThan(0);
    // Verify it was ranked highest
    expect(result.allResults.length).toBeGreaterThan(0);
    expect(result.allResults[0]!.contentType).toBe("test_output");
  });

  it("routes JSON content → json with high confidence", () => {
    const content = JSON.stringify({ key: "value", nested: { a: 1 } });
    const result = detectContentType(content);
    expect(result.contentType).toBe("json");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("routes code content → code", () => {
    const content = `
import fs from "node:fs";
export function read(path: string): string {
  return fs.readFileSync(path, "utf-8");
}
`;
    const result = detectContentType(content);
    expect(result.contentType).toBe("code");
    expect(result.confidence).toBeGreaterThan(0.25);
    expect(result.signals).toContain("import");
    expect(result.signals).toContain("export");
    expect(result.signals).toContain("function");
  });

  it("orders allResults by confidence descending", () => {
    const content = `
 FAIL  test
 ERROR log line
 import { foo } from "bar";
 export function main() { return 1; }
`;
    const result = detectContentType(content);
    for (let i = 1; i < result.allResults.length; i++) {
      expect(result.allResults[i - 1]!.confidence).toBeGreaterThanOrEqual(
        result.allResults[i]!.confidence,
      );
    }
  });

  it("returns unknown when no detector reaches minimum confidence", () => {
    const content = "This is a simple sentence. Nothing special here.";
    const result = detectContentType(content);
    expect(result.contentType).toBe("unknown");
    expect(result.allResults).toHaveLength(0);
  });

  it("handles large content without errors", () => {
    // Generate a large code file
    const lines: string[] = [];
    lines.push("import React from 'react';");
    lines.push("import { Button } from './Button';");
    lines.push("");
    lines.push("export interface Props {");
    lines.push("  title: string;");
    lines.push("  count: number;");
    lines.push("}");
    lines.push("");
    lines.push("export const Component: React.FC<Props> = ({ title, count }) => {");
    for (let i = 0; i < 500; i++) {
      lines.push(`  const item${i} = \`value-\${${i}}\`;`);
    }
    lines.push("  return <div>{title}: {count}</div>;");
    lines.push("};");

    const content = lines.join("\n");
    const result = detectContentType(content);
    expect(result.contentType).toBe("code");
    expect(result.confidence).toBeGreaterThan(0.25);
  });

  it("prefers more specific type when multiple detectors match", () => {
    // Content that looks like test output but ALSO contains
    // log-like patterns — test_output should win because it's more specific
    const content = `
 FAIL  src/test.ts
   ERROR during test execution
   Exception in test
   AssertionError: expected 1, got 2
   Expected: 1
   Received: 2
 Test Suites: 1 failed, 0 passed
`;
    const result = detectContentType(content);
    // test_output has more matching signals (FAIL, AssertionError, Expected,
    // Received, Test Suites, test failed) vs log (ERROR, Exception)
    expect(result.contentType).toBe("test_output");
  });
});

// ============================================================================
// Edge Cases & Robustness
// ============================================================================

describe("edge cases", () => {
  it("handles single-line content", () => {
    const result = detectContentType('{"key":"value"}');
    expect(result.contentType).toBe("json");
  });

  it("handles very short content (no match)", () => {
    const result = detectContentType("hi");
    expect(result.contentType).toBe("unknown");
  });

  it("handles content with only newlines", () => {
    const result = detectContentType("\n\n\n");
    expect(result.contentType).toBe("unknown");
  });

  it("handles non-ASCII / Unicode content", () => {
    const content = `
# タイトル

- リスト項目
- もう一つの項目

これは**太字**です。
`;
    const result = detectContentType(content);
    expect(result.contentType).toBe("markdown");
    expect(result.signals).toContain("heading");
    expect(result.signals).toContain("unordered list");
    expect(result.signals).toContain("bold");
  });

  it("handles mixed content with markdown wrapping code", () => {
    const content = `
# README

\`\`\`ts
import { foo } from "bar";
export const baz = () => foo();
\`\`\`

- item 1
- item 2
`;
    const result = detectContentType(content);
    // Both markdown and code detectors may fire — let the router decide
    // Markdown should win for a wrapper document
    expect(result.contentType).toBe("markdown");
  });
});
