/**
 * Memory Quality Eval — Baseline
 *
 * Measures Recall@1, Recall@3, and scope isolation for the memory recall
 * system using fixed fixtures. No network, LLM, or embedding.
 *
 * Recall metrics:
 *   - Recall@1: is the best-matching memory ranked #1 for a targeted query?
 *   - Recall@3: is the target in the top 3 for a broader query?
 *   - Scope isolation: does scope A see only scope A's memories?
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Database } from "sql.js";
import { MemoryService } from "../../src/memory/memoryService.js";
import { RecallEngine } from "../../src/memory/recallEngine.js";
import { ReceiptService } from "../../src/receipts/receiptService.js";
import { MemoryFtsIndex } from "../../src/memory/memoryFts.js";
import { initAndMigrate } from "../../src/storage/migrations.js";
import { getDb, closeDb, runStmt } from "../../src/storage/db.js";
import {
  SCOPE_A,
  SCOPE_B,
  SCOPE_C,
  SEED_MEMORIES,
} from "../../fixtures/quality-eval/memory/memoryFixtures.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecallTestResult {
  query: string;
  targetContent: string;
  targetScope: string;
  rankFound: number;
  inTop1: boolean;
  inTop3: boolean;
  totalResults: number;
}

export interface IsolationTestResult {
  scope: string;
  count: number;
  isolated: boolean;
}

const recallResults: RecallTestResult[] = [];
const isolationResults: IsolationTestResult[] = [];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let db: Database;
let memoryService: MemoryService;
let recallEngine: RecallEngine;

beforeAll(async () => {
  await initAndMigrate(":memory:");
  db = getDb();

  // Create scopes first (FK constraint on scopes table)
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
  memoryService = new MemoryService(db, { receipts, ftsIndex });
  recallEngine = new RecallEngine(db, ftsIndex);

  // Seed all fixtures
  for (const mem of SEED_MEMORIES) {
    memoryService.remember(mem);
  }
});

afterAll(() => {
  closeDb();
});

// ---------------------------------------------------------------------------
// Recall@1 — Precision queries
// ---------------------------------------------------------------------------

describe("Memory Recall Quality — Recall@1", () => {
  const TESTS: { query: string; targetContent: string; label: string }[] = [
    {
      query: "pnpm package manager",
      targetContent: "Always use pnpm",
      label: "project_rule: pnpm",
    },
    {
      query: "TypeScript strict mode tsconfig",
      targetContent: "Enable TypeScript strict mode",
      label: "project_rule: TS strict",
    },
    {
      query: "React Router decision routing",
      targetContent: "React Router v6",
      label: "decision: React Router",
    },
    {
      query: "WebSocket memory leak cleanup ChatWindow",
      targetContent: "WebSocket connections not being cleaned up",
      label: "bug: WebSocket leak",
    },
    {
      query: "session logout cookie test failure",
      targetContent: "should clear cookie on logout",
      label: "test_failure: session logout",
    },
    {
      query: "Vitest testing framework",
      targetContent: "vitest v2.0.0",
      label: "dependency: vitest",
    },
  ];

  for (const t of TESTS) {
    it(`Recall@1: "${t.label}"`, () => {
      const results = recallEngine.searchEnhanced({
        scopeId: SCOPE_A,
        query: t.query,
        limit: 5,
      });

      let rankFound = -1;
      for (let i = 0; i < results.length; i++) {
        if (results[i]!.memory.content.includes(t.targetContent)) {
          rankFound = results[i]!.rank;
          break;
        }
      }

      recallResults.push({
        query: t.query,
        targetContent: t.targetContent,
        targetScope: SCOPE_A,
        rankFound,
        inTop1: rankFound === 1,
        inTop3: rankFound >= 1 && rankFound <= 3,
        totalResults: results.length,
      });

      expect(rankFound).toBeGreaterThanOrEqual(1);
    });
  }
});

// ---------------------------------------------------------------------------
// Recall@3 — Broader queries
// ---------------------------------------------------------------------------

describe("Memory Recall Quality — Recall@3", () => {
  const TESTS: { query: string; targetContent: string; label: string }[] = [
    {
      query: "package manager pnpm npm",
      targetContent: "Always use pnpm",
      label: "broad: package manager",
    },
    {
      query: "frontend routing framework",
      targetContent: "React Router v6",
      label: "broad: frontend routing",
    },
    {
      query: "test failure assertion auth",
      targetContent: "should clear cookie on logout",
      label: "broad: auth test failures",
    },
    {
      query: "build compilation type error",
      targetContent: "pnpm typecheck",
      label: "broad: build errors",
    },
  ];

  for (const t of TESTS) {
    it(`Recall@3: "${t.label}"`, () => {
      const results = recallEngine.searchEnhanced({
        scopeId: SCOPE_A,
        query: t.query,
        limit: 5,
      });

      let rankFound = -1;
      for (let i = 0; i < results.length; i++) {
        if (results[i]!.memory.content.includes(t.targetContent)) {
          rankFound = results[i]!.rank;
          break;
        }
      }

      recallResults.push({
        query: t.query,
        targetContent: t.targetContent,
        targetScope: SCOPE_A,
        rankFound,
        inTop1: rankFound === 1,
        inTop3: rankFound >= 1 && rankFound <= 3,
        totalResults: results.length,
      });

      expect(rankFound).toBeGreaterThanOrEqual(1);
      expect(rankFound).toBeLessThanOrEqual(3);
    });
  }
});

// ---------------------------------------------------------------------------
// Scope isolation
// ---------------------------------------------------------------------------

describe("Memory Recall Quality — Scope Isolation", () => {
  it("scope C (empty) returns no memories", () => {
    const results = recallEngine.searchEnhanced({
      scopeId: SCOPE_C,
      query: "package manager",
      limit: 10,
    });
    isolationResults.push({ scope: SCOPE_C, count: results.length, isolated: results.length === 0 });
    expect(results.length).toBe(0);
  });

  it("scope A does not return scope B's memories", () => {
    const results = recallEngine.searchEnhanced({
      scopeId: SCOPE_A,
      query: "Vue Pinia state management",
      limit: 10,
    });
    for (const r of results) {
      expect(r.memory.scopeId).toBe(SCOPE_A);
    }
  });

  it("scope B does not return scope A's memories", () => {
    const results = recallEngine.searchEnhanced({
      scopeId: SCOPE_B,
      query: "pnpm package manager",
      limit: 10,
    });
    for (const r of results) {
      expect(r.memory.scopeId).toBe(SCOPE_B);
    }
  });

  it("scope A returns only its own project_rules", () => {
    const results = recallEngine.searchEnhanced({
      scopeId: SCOPE_A,
      query: "package manager",
      types: ["project_rule"],
      limit: 10,
    });
    for (const r of results) {
      expect(r.memory.scopeId).toBe(SCOPE_A);
      expect(r.memory.type).toBe("project_rule");
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Memory Recall Quality — Edge Cases", () => {
  it("empty query returns no results", () => {
    const results = recallEngine.searchEnhanced({
      scopeId: SCOPE_A,
      query: "",
      limit: 10,
    });
    expect(results.length).toBe(0);
  });

  it("whitespace-only query returns no results", () => {
    const results = recallEngine.searchEnhanced({
      scopeId: SCOPE_A,
      query: "   ",
      limit: 10,
    });
    expect(results.length).toBe(0);
  });

  it("nonsense query returns no results", () => {
    const results = recallEngine.searchEnhanced({
      scopeId: SCOPE_A,
      query: "xyzzy_nonexistent_abc_001",
      limit: 10,
    });
    expect(results.length).toBe(0);
  });

  it("type filter returns only matching types", () => {
    const results = recallEngine.searchEnhanced({
      scopeId: SCOPE_A,
      query: "test",
      types: ["test_failure"],
      limit: 10,
    });
    for (const r of results) {
      expect(r.memory.type).toBe("test_failure");
    }
  });
});
