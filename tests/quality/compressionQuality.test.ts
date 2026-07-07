/**
 * Compression Quality Eval — Baseline
 *
 * Measures compression "key fact retention rate" and "token savings rate"
 * using fixed fixtures. No network, LLM, or embedding.
 *
 * Key fact retention: for each fixture, define the expected key facts
 * that MUST appear in the compressed output, then check they're present.
 * Token savings: (tokensBefore - tokensAfter) / tokensBefore
 *
 * This is a BASELINE measurement suite — it records current performance
 * without asserting specific quality thresholds. Use the reports to
 * track changes over time.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compress, type CompressionOutput } from "../../src/compression/compressionEngine.js";
import { registerAllStrategies } from "../../src/compression/registerStrategies.js";
import { countTokens } from "../../src/utils/tokenCount.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "../../fixtures/quality-eval/compression");

beforeAll(async () => {
  registerAllStrategies();
});

function loadFixture(name: string): { content: string; tokens: number } {
  const path = resolve(FIXTURE_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}`);
  }
  const content = readFileSync(path, "utf-8");
  const tokens = countTokens(content);
  return { content, tokens };
}

export interface KeyFactResult {
  fixture: string;
  tokensBefore: number;
  tokensAfter: number;
  saved: number;
  ratio: number;
  factsTotal: number;
  factsRetained: number;
  retentionRate: number;
  keyFacts: { fact: string; retained: boolean }[];
}

const results: KeyFactResult[] = [];

// ---------------------------------------------------------------------------
// Per-fixture test factory
// ---------------------------------------------------------------------------

interface FixtureConfig {
  name: string;
  contentType: string;
  keyFacts: string[];
  budgetRatio: number;
}

const FIXTURES: FixtureConfig[] = [
  {
    name: "code.ts",
    contentType: "code",
    keyFacts: [
      "PaymentRequest", "PaymentResponse", "PaymentError",
      "processPayment", "refundPayment", "getPaymentStatus", "validateCard",
      "Luhn", "RETRY_DELAY_MS", "processing_error", "invalid_amount",
      "FIXME: Add rate limiting", "src/services/paymentService.ts",
    ],
    budgetRatio: 0.4,
  },
  {
    name: "log.ts",
    contentType: "log",
    keyFacts: [
      "ERROR", "FATAL",
      "ConnectionRefusedError", "OutOfMemoryError", "QueryTimeoutError",
      "req_abc001", "/app/src/db/pool.ts", "/app/src/worker/reaper.ts",
      "All retries exhausted", "2026-07-07",
    ],
    budgetRatio: 0.3,
  },
  {
    name: "conversationHistory.txt",
    contentType: "conversation_history",
    keyFacts: [
      "rate limiting", "login endpoint", "express-rate-limit",
      "redis", "5 requests", "60 seconds", "Retry-After",
      "src/middleware/rateLimiter.ts", "src/routes/auth.ts",
    ],
    budgetRatio: 0.35,
  },
  {
    name: "commandOutput.txt",
    contentType: "command_output",
    keyFacts: [
      "typecheck", "TS2304", "TS2554", "TS2322",
      "src/services/userService.ts", "src/utils/format.ts",
      "Cannot find name", "Expected 2 arguments", "exit code 2",
    ],
    budgetRatio: 0.5,
  },
  {
    name: "testOutput.txt",
    contentType: "test_output",
    keyFacts: [
      "tests/unit/auth/session.test.ts", "tests/unit/payment/priceCalc.test.ts",
      "tests/functional/listEmpty.test.tsx",
      "should clear cookie on logout", "should apply bulk discount correctly",
      "should render empty state message",
      "AssertionError", "TypeError", "3 failed", "12 passed",
    ],
    budgetRatio: 0.4,
  },
  {
    name: "markdown.md",
    contentType: "markdown",
    keyFacts: [
      "CodeContext MCP", "Context Compression", "Project Memory",
      "Scope Isolation", "Content Router", "Compression Engine",
      "Memory Service", "SQLite",
      "compress_context", "retrieve_original", "remember_context", "recall_context",
      "MAX_TOKENS",
    ],
    budgetRatio: 0.5,
  },
  {
    name: "json.json",
    contentType: "json",
    keyFacts: [
      "RATE_LIMITED", "Too many requests", "retryAfter",
      "req_abc_001", "INVALID_FORMAT", "email",
    ],
    budgetRatio: 0.5,
  },
  {
    name: "ragChunk.json",
    contentType: "rag_chunk",
    keyFacts: [
      "JWT", "RS256", "HTTP-only cookie", "Redis",
      "docs/auth/architecture.md", "Token Management",
    ],
    budgetRatio: 0.5,
  },
];

for (const fixture of FIXTURES) {
  describe(`Compression Quality — ${fixture.name}`, () => {
    let result: CompressionOutput = null!;

    beforeAll(async () => {
      const { content, tokens } = loadFixture(fixture.name);
      const budget = Math.max(50, Math.floor(tokens * fixture.budgetRatio));
      result = await compress({
        scopeId: "quality-eval",
        content,
        contentType: fixture.contentType,
        keepOriginal: false,
        maxTokens: budget,
      });
    });

    it("compression does not error", () => {
      expect(result.failed).toBeFalsy();
    });

    it("records token statistics", () => {
      expect(result.tokensBefore).toBeGreaterThan(0);
      expect(typeof result.tokensSaved).toBe("number");
      expect(typeof result.compressionRatio).toBe("number");
    });

    it("records key fact retention", () => {
      const retained: string[] = [];
      const missing: string[] = [];

      for (const fact of fixture.keyFacts) {
        const searchIn =
          fixture.contentType === "conversation_history"
            ? result.compressedContent.toLowerCase()
            : result.compressedContent;
        const searchFor =
          fixture.contentType === "conversation_history"
            ? fact.toLowerCase()
            : fact;
        if (searchIn.includes(searchFor)) {
          retained.push(fact);
        } else {
          missing.push(fact);
        }
      }

      if (missing.length > 0) {
        console.warn(`  [${fixture.name}] Missing facts: ${missing.join(", ")}`);
      }

      results.push({
        fixture: fixture.name,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        saved: result.tokensSaved,
        ratio: result.compressionRatio,
        factsTotal: fixture.keyFacts.length,
        factsRetained: retained.length,
        retentionRate: retained.length / fixture.keyFacts.length,
        keyFacts: fixture.keyFacts.map((f) => ({
          fact: f,
          retained: retained.includes(f),
        })),
      });
    });
  });
}

// ============================================================================
// Overall summary — records baseline, doesn't fail the suite
// ============================================================================

describe("Compression Quality — Overall Baseline", () => {
  it("reports average retention rate", () => {
    if (results.length === 0) return; // no fixtures → skip metric
    const avg =
      results.reduce((s, r) => s + r.retentionRate, 0) / results.length;
    console.log(`  Average key fact retention: ${(avg * 100).toFixed(1)}%`);
  });

  it("reports average token savings", () => {
    if (results.length === 0) return;
    const avg = results.reduce((s, r) => s + r.ratio, 0) / results.length;
    console.log(`  Average token savings: ${(avg * 100).toFixed(1)}%`);
  });
});

export { results as compressionKeyFactResults };
