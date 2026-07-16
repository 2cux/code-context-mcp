import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import { closeDb, getDb, runStmt } from "../src/storage/db.js";
import { initAndMigrate } from "../src/storage/migrations.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import { handleRememberContext } from "../src/mcp/tools/rememberContext.js";
import { handleRecallContext } from "../src/mcp/tools/recallContext.js";
import { expandTechnicalQuery } from "../src/memory/queryExpansion.js";
import { MemoryFtsIndex, type FtsSearchOptions } from "../src/memory/memoryFts.js";
import { RecallEngine } from "../src/memory/recallEngine.js";
import type { MemoryRecord } from "../src/memory/types.js";
import type { ServerContext } from "../src/mcp/server.js";

const SCOPE_ID = "repo_query_expansion";
let db: Database;
let ctx: ServerContext;

function parseResult(result: Awaited<ReturnType<typeof handleRecallContext>>) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("missing recall result");
  return JSON.parse(text) as { memories: Array<Record<string, unknown>> };
}

async function remember(content: string, summary: string) {
  await handleRememberContext(ctx, {
    scopeId: SCOPE_ID,
    type: "project_rule",
    content,
    summary,
  });
}

describe("conservative Chinese-English query expansion", () => {
  beforeAll(async () => {
    await initAndMigrate(":memory:");
    db = getDb();
    ctx = { db, receipts: new ReceiptService(db) };
  });

  afterAll(() => closeDb());

  beforeEach(() => {
    try { db.exec("DELETE FROM memories_fts"); } catch { /* FTS5 is optional */ }
    db.exec("DELETE FROM receipts");
    db.exec("DELETE FROM memories");
    runStmt(
      db,
      `INSERT OR IGNORE INTO scopes
       (scope_id, cwd, scope_strategy, created_at, updated_at)
       VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`,
      [SCOPE_ID, process.cwd()],
    );
  });

  it("keeps API paths, headers, class names, filenames, and numbers unchanged", () => {
    const result = expandTechnicalQuery(
      "接口 /api/v1/orders 请求头 Idempotency-Key OrderService timeout.ts 30",
    );

    expect(result.expandedQuery).toContain("/api/v1/orders");
    expect(result.expandedQuery).toContain("Idempotency-Key");
    expect(result.expandedQuery).toContain("OrderService");
    expect(result.expandedQuery).toContain("timeout.ts");
    expect(result.expandedQuery).toContain("30");
    expect(result.expandedTerms).toEqual(expect.arrayContaining(["API", "endpoint", "header"]));
  });

  const cases = [
    {
      label: "API",
      query: "接口 /api/orders",
      content: "The API endpoint is POST /api/orders.",
      term: "API",
    },
    {
      label: "Idempotency-Key",
      query: "幂等请求头 Idempotency-Key",
      content: "Send the Idempotency-Key header to guarantee idempotency.",
      term: "Idempotency-Key",
    },
    {
      label: "timeout",
      query: "请求超时",
      content: "The client timeout is 30 seconds.",
      term: "timeout",
    },
    {
      label: "pnpm",
      query: "包管理器 pnpm",
      content: "Use pnpm as the package manager for this repository.",
      term: "pnpm",
    },
    {
      label: "local-first",
      query: "本地优先",
      content: "The product follows a local-first architecture.",
      term: "local-first",
    },
  ] as const;

  for (const testCase of cases) {
    it(`recalls the ${testCase.label} scenario and returns match metadata`, async () => {
      await remember(testCase.content, testCase.label);

      const data = parseResult(await handleRecallContext(ctx, {
        scopeId: SCOPE_ID,
        query: testCase.query,
        includeProfile: false,
      }));

      expect(data.memories).toHaveLength(1);
      expect(data.memories[0]!.content).toBe(testCase.content);
      expect(["expanded", "original+expanded"]).toContain(data.memories[0]!.matchMethod);
      expect(data.memories[0]!.matchedTerms).toContain(testCase.term);
    });
  }

  it("deduplicates a memory returned by both original and expanded queries", async () => {
    await remember("Use pnpm as the package manager.", "pnpm package manager");

    const data = parseResult(await handleRecallContext(ctx, {
      scopeId: SCOPE_ID,
      query: "包管理器 pnpm",
      includeProfile: false,
    }));

    expect(data.memories).toHaveLength(1);
    expect(data.memories[0]!.matchMethod).toBe("original+expanded");
  });

  it("falls back to the original BM25/LIKE result when expanded search fails", () => {
    const memory: MemoryRecord = {
      id: "mem_fallback",
      scopeId: SCOPE_ID,
      type: "project_rule",
      content: "本地优先配置",
      confidence: 1,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    class FailingExpandedSearch extends MemoryFtsIndex {
      private calls = 0;
      override search(_opts: FtsSearchOptions) {
        this.calls += 1;
        if (this.calls > 1) throw new Error("expanded search failed");
        return [{ memory, score: 1, rank: 1 }];
      }
    }

    const results = new RecallEngine(db, new FailingExpandedSearch(db)).searchEnhanced({
      scopeId: SCOPE_ID,
      query: "本地优先",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.memory.id).toBe(memory.id);
    expect(results[0]!.matchMethod).toBe("original");
  });
});
