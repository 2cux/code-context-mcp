/**
 * Generate Quality Baseline Reports
 *
 * Runs the compression and memory quality evals and produces:
 *   - reports/quality/context-quality.md   (human-readable)
 *   - reports/quality/context-quality.json (machine-readable)
 *
 * Usage: npx tsx tests/quality/generateBaseline.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, "../../reports/quality");

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

// ---------------------------------------------------------------------------
// Compression results loader
// ---------------------------------------------------------------------------

/**
 * We re-run the compression via the same engine directly so we don't
 * depend on vitest internals. Import the engine and fixtures.
 */
import { compress, type CompressionOutput } from "../../src/compression/compressionEngine.js";
import { registerAllStrategies } from "../../src/compression/registerStrategies.js";
import { countTokens } from "../../src/utils/tokenCount.js";

interface KeyFactCheck {
  fact: string;
  retained: boolean;
}

interface FixtureResult {
  fixture: string;
  contentType: string;
  tokensBefore: number;
  tokensAfter: number;
  saved: number;
  ratio: number;
  factsTotal: number;
  factsRetained: number;
  retentionRate: number;
  keyFacts: KeyFactCheck[];
}

const FIXTURE_DIR = resolve(__dirname, "../../fixtures/quality-eval/compression");

interface FixtureDef {
  name: string;
  contentType: string;
  keyFacts: string[];
  budgetRatio: number;
}

const FIXTURES: FixtureDef[] = [
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

async function runCompressionBaseline(): Promise<FixtureResult[]> {
  registerAllStrategies();
  const results: FixtureResult[] = [];

  for (const fixture of FIXTURES) {
    const path = resolve(FIXTURE_DIR, fixture.name);
    if (!existsSync(path)) {
      console.warn(`  [WARN] Fixture not found: ${path}`);
      continue;
    }
    const content = readFileSync(path, "utf-8");
    const tokensBefore = countTokens(content);
    const budget = Math.max(50, Math.floor(tokensBefore * fixture.budgetRatio));

    const result = await compress({
      scopeId: "quality-eval",
      content,
      contentType: fixture.contentType,
      keepOriginal: false,
      maxTokens: budget,
    });

    const retained: string[] = [];
    const keyFacts: KeyFactCheck[] = [];

    for (const fact of fixture.keyFacts) {
      const searchIn =
        fixture.contentType === "conversation_history"
          ? result.compressedContent.toLowerCase()
          : result.compressedContent;
      const searchFor =
        fixture.contentType === "conversation_history"
          ? fact.toLowerCase()
          : fact;
      const kept = searchIn.includes(searchFor);
      keyFacts.push({ fact, retained: kept });
      if (kept) retained.push(fact);
    }

    results.push({
      fixture: fixture.name,
      contentType: fixture.contentType,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      saved: result.tokensSaved,
      ratio: result.compressionRatio,
      factsTotal: fixture.keyFacts.length,
      factsRetained: retained.length,
      retentionRate: retained.length / fixture.keyFacts.length,
      keyFacts,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Memory results loader
// ---------------------------------------------------------------------------

import { Database } from "sql.js";
import { MemoryService } from "../../src/memory/memoryService.js";
import { RecallEngine } from "../../src/memory/recallEngine.js";
import { ReceiptService } from "../../src/receipts/receiptService.js";
import { MemoryFtsIndex } from "../../src/memory/memoryFts.js";
import { initAndMigrate } from "../../src/storage/migrations.js";
import { runStmt, closeDb, getDb } from "../../src/storage/db.js";
import { SCOPE_A, SCOPE_B, SCOPE_C, SEED_MEMORIES } from "../../fixtures/quality-eval/memory/memoryFixtures.js";

interface RecallMetric {
  query: string;
  targetContent: string;
  rankFound: number;
  inTop1: boolean;
  inTop3: boolean;
  totalResults: number;
}

interface IsolationMetric {
  scope: string;
  count: number;
  isolated: boolean;
}

async function runMemoryBaseline(): Promise<{
  recall1: RecallMetric[];
  recall3: RecallMetric[];
  isolation: IsolationMetric[];
}> {
  await initAndMigrate(":memory:");
  const db = getDb();

  for (const sid of [SCOPE_A, SCOPE_B, SCOPE_C]) {
    runStmt(
      db,
      `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`,
      [sid, process.cwd()],
    );
  }

  const receipts = new ReceiptService(db);
  const ftsIndex = new MemoryFtsIndex(db);
  const memoryService = new MemoryService(db, { receipts, ftsIndex });
  const recallEngine = new RecallEngine(db, ftsIndex);

  for (const mem of SEED_MEMORIES) {
    memoryService.remember(mem);
  }

  // Recall@1 tests
  const recall1: RecallMetric[] = [];
  const r1Tests = [
    { query: "pnpm package manager", target: "Always use pnpm" },
    { query: "TypeScript strict mode tsconfig", target: "Enable TypeScript strict mode" },
    { query: "React Router decision routing", target: "React Router v6" },
    { query: "WebSocket memory leak cleanup ChatWindow", target: "WebSocket connections not being cleaned up" },
    { query: "session logout cookie test failure", target: "should clear cookie on logout" },
    { query: "Vitest testing framework", target: "vitest v2.0.0" },
  ];

  for (const t of r1Tests) {
    const results = recallEngine.searchEnhanced({ scopeId: SCOPE_A, query: t.query, limit: 5 });
    let rankFound = -1;
    for (let i = 0; i < results.length; i++) {
      if (results[i]!.memory.content.includes(t.target)) {
        rankFound = results[i]!.rank;
        break;
      }
    }
    recall1.push({
      query: t.query,
      targetContent: t.target,
      rankFound,
      inTop1: rankFound === 1,
      inTop3: rankFound >= 1 && rankFound <= 3,
      totalResults: results.length,
    });
  }

  // Recall@3 tests
  const recall3: RecallMetric[] = [];
  const r3Tests = [
    { query: "package manager pnpm npm", target: "Always use pnpm" },
    { query: "frontend routing framework", target: "React Router v6" },
    { query: "test failure assertion auth", target: "should clear cookie on logout" },
    { query: "build compilation type error", target: "pnpm typecheck" },
  ];

  for (const t of r3Tests) {
    const results = recallEngine.searchEnhanced({ scopeId: SCOPE_A, query: t.query, limit: 5 });
    let rankFound = -1;
    for (let i = 0; i < results.length; i++) {
      if (results[i]!.memory.content.includes(t.target)) {
        rankFound = results[i]!.rank;
        break;
      }
    }
    recall3.push({
      query: t.query,
      targetContent: t.target,
      rankFound,
      inTop1: rankFound === 1,
      inTop3: rankFound >= 1 && rankFound <= 3,
      totalResults: results.length,
    });
  }

  // Isolation tests
  const c1 = recallEngine.searchEnhanced({ scopeId: SCOPE_C, query: "package manager", limit: 10 });
  const aVue = recallEngine.searchEnhanced({ scopeId: SCOPE_A, query: "Vue Pinia state management", limit: 10 });
  const bPnpm = recallEngine.searchEnhanced({ scopeId: SCOPE_B, query: "pnpm package manager", limit: 10 });
  const aRules = recallEngine.searchEnhanced({ scopeId: SCOPE_A, query: "package manager", types: ["project_rule"], limit: 10 });

  const isolation: IsolationMetric[] = [
    { scope: SCOPE_C, count: c1.length, isolated: c1.length === 0 },
    { scope: SCOPE_A, count: aVue.filter(r => r.memory.scopeId === SCOPE_B).length, isolated: aVue.every(r => r.memory.scopeId === SCOPE_A) },
    { scope: SCOPE_B, count: bPnpm.filter(r => r.memory.scopeId === SCOPE_A).length, isolated: bPnpm.every(r => r.memory.scopeId === SCOPE_B) },
    { scope: SCOPE_A + " filtered", count: aRules.filter(r => r.memory.type !== "project_rule").length, isolated: aRules.every(r => r.memory.scopeId === SCOPE_A && r.memory.type === "project_rule") },
  ];

  closeDb();
  return { recall1, recall3, isolation };
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

async function main() {
  ensureDir(REPORTS_DIR);
  console.log("Running compression baseline...");
  const compressionResults = await runCompressionBaseline();
  console.log("Running memory baseline...");
  const memoryResults = await runMemoryBaseline();

  // Compute aggregates
  const avgRetention = compressionResults.length > 0
    ? compressionResults.reduce((s, r) => s + r.retentionRate, 0) / compressionResults.length
    : 0;
  const avgSavings = compressionResults.length > 0
    ? compressionResults.reduce((s, r) => s + r.ratio, 0) / compressionResults.length
    : 0;
  const recall1Hits = memoryResults.recall1.filter(r => r.inTop1).length;
  const recall1Total = memoryResults.recall1.length;
  const recall3Hits = memoryResults.recall3.filter(r => r.inTop3).length;
  const recall3Total = memoryResults.recall3.length;
  const isolationAll = memoryResults.isolation.every(r => r.isolated);

  // ---- JSON report ----
  const jsonReport = {
    meta: {
      generatedAt: new Date().toISOString(),
      projectVersion: "1.0.0",
      description: "CodeContext MCP — Offline Quality Baseline",
    },
    compression: {
      averageKeyFactRetention: Number((avgRetention * 100).toFixed(1)),
      averageTokenSavings: Number((avgSavings * 100).toFixed(1)),
      fixtures: compressionResults,
    },
    memory: {
      recallAt1: {
        hits: recall1Hits,
        total: recall1Total,
        rate: Number(((recall1Hits / recall1Total) * 100).toFixed(1)),
        tests: memoryResults.recall1,
      },
      recallAt3: {
        hits: recall3Hits,
        total: recall3Total,
        rate: Number(((recall3Hits / recall3Total) * 100).toFixed(1)),
        tests: memoryResults.recall3,
      },
      scopeIsolation: {
        allIsolated: isolationAll,
        checks: memoryResults.isolation,
      },
    },
  };

  writeFileSync(
    resolve(REPORTS_DIR, "context-quality.json"),
    JSON.stringify(jsonReport, null, 2),
    "utf-8",
  );
  console.log("  wrote context-quality.json");

  // ---- Markdown report ----
  const lines: string[] = [];

  lines.push("# CodeContext MCP — Context Quality Baseline");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 1. Compression Quality");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Average Key Fact Retention | ${jsonReport.compression.averageKeyFactRetention}% |`);
  lines.push(`| Average Token Savings | ${jsonReport.compression.averageTokenSavings}% |`);
  lines.push(`| Fixture Count | ${compressionResults.length} |`);
  lines.push("");
  lines.push("### Per-Fixture");
  lines.push("");
  lines.push("| Fixture | Content Type | Before | After | Saved | Ratio | Facts | Retained | Retention |");
  lines.push("|---------|-------------|--------|-------|-------|-------|-------|----------|-----------|");
  for (const r of compressionResults) {
    lines.push(
      `| ${r.fixture} | ${r.contentType} | ${r.tokensBefore} | ${r.tokensAfter} | ${r.saved} | ${(r.ratio * 100).toFixed(1)}% | ${r.factsTotal} | ${r.factsRetained} | ${(r.retentionRate * 100).toFixed(1)}% |`,
    );
  }
  lines.push("");

  lines.push("### Retained Facts Detail");
  lines.push("");
  lines.push("<details>");
  lines.push("<summary>Click to expand</summary>");
  lines.push("");
  for (const r of compressionResults) {
    lines.push(`**${r.fixture}**`);
    lines.push("");
    for (const kf of r.keyFacts) {
      lines.push(`- ${kf.retained ? "✅" : "❌"} \`${kf.fact}\``);
    }
    lines.push("");
  }
  lines.push("</details>");
  lines.push("");

  lines.push("## 2. Memory Recall Quality");
  lines.push("");
  lines.push("### Recall@1");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Hits | ${recall1Hits}/${recall1Total} |`);
  lines.push(`| Rate | ${jsonReport.memory.recallAt1.rate}% |`);
  lines.push("");
  lines.push("| Query | Target | Rank | In Top 1 | Total Results |");
  lines.push("|-------|--------|------|----------|---------------|");
  for (const r of memoryResults.recall1) {
    lines.push(`| ${r.query} | ${r.targetContent} | ${r.rankFound} | ${r.inTop1 ? "✅" : "❌"} | ${r.totalResults} |`);
  }
  lines.push("");

  lines.push("### Recall@3");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Hits | ${recall3Hits}/${recall3Total} |`);
  lines.push(`| Rate | ${jsonReport.memory.recallAt3.rate}% |`);
  lines.push("");
  lines.push("| Query | Target | Rank | In Top 3 | Total Results |");
  lines.push("|-------|--------|------|----------|---------------|");
  for (const r of memoryResults.recall3) {
    lines.push(`| ${r.query} | ${r.targetContent} | ${r.rankFound} | ${r.inTop3 ? "✅" : "❌"} | ${r.totalResults} |`);
  }
  lines.push("");

  lines.push("### Scope Isolation");
  lines.push("");
  lines.push(`All isolated: ${isolationAll ? "✅" : "❌"}`);
  lines.push("");
  lines.push("| Check | Result |");
  lines.push("|-------|--------|");
  for (const r of memoryResults.isolation) {
    lines.push(`| Scope ${r.scope} isolated | ${r.isolated ? "✅" : "❌"} |`);
  }
  lines.push("");

  lines.push("## 3. Summary");
  lines.push("");
  lines.push("### Compression");
  lines.push(`- Average key fact retention: ${jsonReport.compression.averageKeyFactRetention}%`);
  lines.push(`- Average token savings: ${jsonReport.compression.averageTokenSavings}%`);
  lines.push(`- Work remaining: Improve code/markdown/json/rag_chunk retention rates`);
  lines.push("");
  lines.push("### Memory");
  lines.push(`- Recall@1: ${jsonReport.memory.recallAt1.rate}% (${recall1Hits}/${recall1Total})`);
  lines.push(`- Recall@3: ${jsonReport.memory.recallAt3.rate}% (${recall3Hits}/${recall3Total})`);
  lines.push(`- Scope isolation: ${isolationAll ? "All checks pass" : "Issues detected"}`);
  lines.push("");
  lines.push("---");
  lines.push("_Baseline generated by tests/quality/generateBaseline.ts_");

  writeFileSync(resolve(REPORTS_DIR, "context-quality.md"), lines.join("\n"), "utf-8");
  console.log("  wrote context-quality.md");

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Baseline generation failed:", err);
  process.exit(1);
});
