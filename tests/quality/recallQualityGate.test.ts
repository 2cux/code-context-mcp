/**
 * Memory Recall Quality Gate
 *
 * Comprehensive evaluation of the memory recall pipeline against fixed targets.
 *
 * Metrics evaluated:
 *   1. Recall@1      — proportion of precision queries where target is rank 1
 *   2. Recall@3      — proportion of broader queries where target is top-3
 *   3. False recall  — negative queries returning results (lower is better)
 *   4. Cross-scope   — scope A queries matching scope B content
 *   5. Non-active leak — default recall returning superseded/forgotten/expired
 *   6. Duplicate IDs — duplicate memory IDs in a single result set
 *
 * Target thresholds (no embedding, no external model):
 *   - Recall@1              >= 80%
 *   - Recall@3              >= 95%
 *   - Cross-scope hits       = 0
 *   - Non-active leak hits   = 0
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Database } from "sql.js";
import { MemoryService } from "../../src/memory/memoryService.js";
import { RecallEngine } from "../../src/memory/recallEngine.js";
import { DEFAULT_SCORER_CONFIG } from "../../src/memory/recallScorer.js";
import { ReceiptService } from "../../src/receipts/receiptService.js";
import { MemoryFtsIndex } from "../../src/memory/memoryFts.js";
import { initAndMigrate } from "../../src/storage/migrations.js";
import { getDb, closeDb, runStmt } from "../../src/storage/db.js";
import {
  QG_SCOPE_A,
  QG_SCOPE_B,
  QG_SCOPE_C,
  QG_RECALL_1_QUERIES,
  QG_RECALL_3_QUERIES,
  QG_NEGATIVE_QUERIES,
  QG_CROSS_SCOPE_QUERIES,
  QG_NON_ACTIVE_MEMORIES,
  QG_ACTIVE_MEMORIES,
  QG_SCOPE_B_MEMORIES,
} from "../../fixtures/quality-eval/memory/qualityGateFixtures.js";

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

interface RecallMetric {
  query: string;
  targetContent: string;
  label: string;
  rankFound: number;
  inTop1: boolean;
  inTop3: boolean;
  totalResults: number;
}

interface LeakMetric {
  query: string;
  label: string;
  resultCount: number;
  leaked: boolean;
  leakedIds: string[];
}

interface QualityGateReport {
  timestamp: string;
  scorerConfig: typeof DEFAULT_SCORER_CONFIG;

  // Recall@1
  recall1: {
    tests: RecallMetric[];
    total: number;
    hitsTop1: number;
    hitsTop3: number;
    recallAt1: number;
    recallAt3: number;
  };

  // Recall@3 (separate query set)
  recall3: {
    tests: RecallMetric[];
    total: number;
    hitsTop3: number;
    recallAt3: number;
  };

  // False recall
  falseRecall: {
    tests: LeakMetric[];
    total: number;
    leaking: number;
    falseRecallRate: number;
  };

  // Cross-scope leakage
  crossScope: {
    tests: LeakMetric[];
    total: number;
    leaked: number;
    crossScopeHits: number;
  };

  // Non-active leakage
  nonActiveLeak: {
    tests: LeakMetric[];
    total: number;
    leaked: number;
    leakedIds: string[];
  };

  // Duplicate IDs check
  duplicateIds: {
    checked: number;
    duplicatesFound: number;
  };

  // Threshold results
  thresholds: {
    recallAt1Pass: boolean;
    recallAt3Pass: boolean;
    crossScopePass: boolean;
    nonActiveLeakPass: boolean;
    overallPass: boolean;
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let db: Database;
let memoryService: MemoryService;
let recallEngine: RecallEngine;

// Track IDs for leakage detection
const seededActiveIds: Set<string> = new Set();
const seededNonActiveInfo: Map<string, string> = new Map(); // content → id
const seededScopeAIds: Set<string> = new Set();

beforeAll(async () => {
  await initAndMigrate(":memory:");
  db = getDb();

  // Create scope records first (FK constraint)
  for (const sid of [QG_SCOPE_A, QG_SCOPE_B, QG_SCOPE_C]) {
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

  // Seed all active memories and track their IDs
  for (const mem of QG_ACTIVE_MEMORIES) {
    const result = memoryService.remember(mem);
    seededActiveIds.add(result.memoryId);
    if (mem.scopeId === QG_SCOPE_A) {
      seededScopeAIds.add(result.memoryId);
    }
  }

  // Seed non-active memories with non-active status
  // We use remember() then immediately update status
  for (const mem of QG_NON_ACTIVE_MEMORIES) {
    const result = memoryService.remember(mem);

    // Determine target status based on the memory content
    // (we use content markers since the fixture types define the intent)
    let targetStatus: "superseded" | "forgotten" | "expired" = "forgotten";
    if (mem.content.includes("superseded")) {
      targetStatus = "superseded";
    } else if (mem.content.includes("forgotten")) {
      targetStatus = "forgotten";
    } else if (mem.content.includes("expired") || mem.content.includes("Expired")) {
      targetStatus = "expired";
    }

    // Track the non-active memory content→id mapping for leakage testing
    seededNonActiveInfo.set(mem.content.slice(0, 50), result.memoryId);

    // Force status update (bypass lifecycle validation for seeding)
    try {
      runStmt(
        db,
        `UPDATE memories SET status = ? WHERE id = ? AND scope_id = ?`,
        [targetStatus, result.memoryId, QG_SCOPE_A],
      );
      // Sync updated record to FTS
      const updated = memoryService.get(result.memoryId, QG_SCOPE_A);
      if (updated) {
        ftsIndex.update(updated);
      }
    } catch {
      // Best-effort
    }
  }

  // Seed Scope B distractor memories
  for (const mem of QG_SCOPE_B_MEMORIES) {
    memoryService.remember(mem);
  }
});

afterAll(() => {
  closeDb();
});

// ---------------------------------------------------------------------------
// Quality Gate Evaluation
// ---------------------------------------------------------------------------

const gateReport: QualityGateReport = {
  timestamp: new Date().toISOString(),
  scorerConfig: DEFAULT_SCORER_CONFIG,
  recall1: { tests: [], total: 0, hitsTop1: 0, hitsTop3: 0, recallAt1: 0, recallAt3: 0 },
  recall3: { tests: [], total: 0, hitsTop3: 0, recallAt3: 0 },
  falseRecall: { tests: [], total: 0, leaking: 0, falseRecallRate: 0 },
  crossScope: { tests: [], total: 0, leaked: 0, crossScopeHits: 0 },
  nonActiveLeak: { tests: [], total: 0, leaked: 0, leakedIds: [] },
  duplicateIds: { checked: 0, duplicatesFound: 0 },
  thresholds: {
    recallAt1Pass: false,
    recallAt3Pass: false,
    crossScopePass: false,
    nonActiveLeakPass: false,
    overallPass: false,
  },
};

// ==========================================================================
// Metric 1: Recall@1 (precision queries → target must be rank 1)
// ==========================================================================

describe("Quality Gate — Recall@1", () => {
  for (const t of QG_RECALL_1_QUERIES) {
    it(`"${t.label}" — recall@1`, () => {
      const results = recallEngine.searchEnhanced({
        scopeId: QG_SCOPE_A,
        query: t.query,
        limit: 10,
      });

      let rankFound = -1;
      for (let i = 0; i < results.length; i++) {
        if (results[i]!.memory.content.includes(t.targetContent)) {
          rankFound = results[i]!.rank;
          break;
        }
      }

      const metric: RecallMetric = {
        query: t.query,
        targetContent: t.targetContent,
        label: t.label,
        rankFound,
        inTop1: rankFound === 1,
        inTop3: rankFound >= 1 && rankFound <= 3,
        totalResults: results.length,
      };
      gateReport.recall1.tests.push(metric);

      expect(rankFound).toBeGreaterThanOrEqual(1);
    });
  }

  it("Recall@1 aggregate", () => {
    const tests = gateReport.recall1.tests;
    gateReport.recall1.total = tests.length;
    gateReport.recall1.hitsTop1 = tests.filter((t) => t.inTop1).length;
    gateReport.recall1.hitsTop3 = tests.filter((t) => t.inTop3).length;
    gateReport.recall1.recallAt1 =
      tests.length > 0 ? gateReport.recall1.hitsTop1 / tests.length : 0;
    gateReport.recall1.recallAt3 =
      tests.length > 0 ? gateReport.recall1.hitsTop3 / tests.length : 0;

    console.log(
      `\n  Recall@1: ${gateReport.recall1.hitsTop1}/${gateReport.recall1.total} = ${(gateReport.recall1.recallAt1 * 100).toFixed(1)}%`,
    );
    console.log(
      `  Recall@3 (precision set): ${gateReport.recall1.hitsTop3}/${gateReport.recall1.total} = ${(gateReport.recall1.recallAt3 * 100).toFixed(1)}%`,
    );

    // Log per-query detail
    for (const t of tests) {
      if (!t.inTop1) {
        console.log(`    FAIL Recall@1 "${t.label}" → rank=${t.rankFound}/${t.totalResults}`);
      }
    }

    // Threshold: Recall@1 must be >= 80%
    gateReport.thresholds.recallAt1Pass = gateReport.recall1.recallAt1 >= 0.80;
    expect(gateReport.recall1.recallAt1).toBeGreaterThanOrEqual(0.80);
  });
});

// ==========================================================================
// Metric 2: Recall@3 (broader queries → target must be in top 3)
// ==========================================================================

describe("Quality Gate — Recall@3", () => {
  for (const t of QG_RECALL_3_QUERIES) {
    it(`"${t.label}" — recall@3`, () => {
      const results = recallEngine.searchEnhanced({
        scopeId: QG_SCOPE_A,
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

      const metric: RecallMetric = {
        query: t.query,
        targetContent: t.targetContent,
        label: t.label,
        rankFound,
        inTop1: rankFound === 1,
        inTop3: rankFound >= 1 && rankFound <= 3,
        totalResults: results.length,
      };
      gateReport.recall3.tests.push(metric);

      expect(rankFound).toBeGreaterThanOrEqual(1);
      expect(rankFound).toBeLessThanOrEqual(3);
    });
  }

  it("Recall@3 aggregate", () => {
    const tests = gateReport.recall3.tests;
    gateReport.recall3.total = tests.length;
    gateReport.recall3.hitsTop3 = tests.filter((t) => t.inTop3).length;
    gateReport.recall3.recallAt3 =
      tests.length > 0 ? gateReport.recall3.hitsTop3 / tests.length : 0;

    console.log(
      `\n  Recall@3: ${gateReport.recall3.hitsTop3}/${gateReport.recall3.total} = ${(gateReport.recall3.recallAt3 * 100).toFixed(1)}%`,
    );

    for (const t of tests) {
      if (!t.inTop3) {
        console.log(`    FAIL Recall@3 "${t.label}" → rank=${t.rankFound}/${t.totalResults}`);
      }
    }

    // Threshold: Recall@3 must be >= 95%
    gateReport.thresholds.recallAt3Pass = gateReport.recall3.recallAt3 >= 0.95;
    expect(gateReport.recall3.recallAt3).toBeGreaterThanOrEqual(0.95);
  });
});

// ==========================================================================
// Metric 3: False recall rate (negative queries → zero results expected)
// ==========================================================================

describe("Quality Gate — False Recall Rate", () => {
  for (const t of QG_NEGATIVE_QUERIES) {
    it(`"${t.label}" — should return empty`, () => {
      const results = recallEngine.searchEnhanced({
        scopeId: QG_SCOPE_A,
        query: t.query,
        limit: 10,
      });

      const metric: LeakMetric = {
        query: t.query,
        label: t.label,
        resultCount: results.length,
        leaked: results.length > 0,
        leakedIds: results.map((r) => r.memory.id),
      };
      gateReport.falseRecall.tests.push(metric);

      // Individual assertions: each negative query should return 0
      expect(results.length).toBe(0);
    });
  }

  it("False recall aggregate", () => {
    const tests = gateReport.falseRecall.tests;
    gateReport.falseRecall.total = tests.length;
    gateReport.falseRecall.leaking = tests.filter((t) => t.leaked).length;
    gateReport.falseRecall.falseRecallRate =
      tests.length > 0 ? gateReport.falseRecall.leaking / tests.length : 0;

    console.log(
      `\n  False recall rate: ${gateReport.falseRecall.leaking}/${gateReport.falseRecall.total} = ${(gateReport.falseRecall.falseRecallRate * 100).toFixed(1)}%`,
    );

    for (const t of tests) {
      if (t.leaked) {
        console.log(`    LEAK "${t.label}" → ${t.resultCount} results`);
      }
    }

    // Report the rate but don't hard-fail — 0% leaking is ideal, but some
    // false recall can be acceptable depending on FTS scoring
  });
});

// ==========================================================================
// Metric 4: Cross-scope leakage (Scope A search must NOT return Scope B memories)
// ==========================================================================

describe("Quality Gate — Cross-Scope Leakage", () => {
  for (const t of QG_CROSS_SCOPE_QUERIES) {
    it(`"${t.label}" — zero cross-scope hits`, () => {
      const results = recallEngine.searchEnhanced({
        scopeId: QG_SCOPE_A,
        query: t.query,
        limit: 10,
      });

      // Check if any result contains Scope B's content
      const leakedResults = results.filter((r) =>
        r.memory.content.includes(t.scopeBContent),
      );

      const metric: LeakMetric = {
        query: t.query,
        label: t.label,
        resultCount: results.length,
        leaked: leakedResults.length > 0,
        leakedIds: leakedResults.map((r) => r.memory.id),
      };
      gateReport.crossScope.tests.push(metric);

      expect(leakedResults.length).toBe(0);
    });
  }

  it("Cross-scope aggregate", () => {
    const tests = gateReport.crossScope.tests;
    gateReport.crossScope.total = tests.length;
    gateReport.crossScope.leaked = tests.filter((t) => t.leaked).length;
    gateReport.crossScope.crossScopeHits = tests.reduce(
      (sum, t) => sum + t.leakedIds.length,
      0,
    );

    console.log(
      `\n  Cross-scope leakage: ${gateReport.crossScope.leaked}/${gateReport.crossScope.total} queries leaked, ${gateReport.crossScope.crossScopeHits} total leaked results`,
    );

    for (const t of tests) {
      if (t.leaked) {
        console.log(`    CROSS-SCOPE LEAK "${t.label}" → ${t.leakedIds.length} results`);
      }
    }

    // Threshold: 0 cross-scope hits
    gateReport.thresholds.crossScopePass = gateReport.crossScope.crossScopeHits === 0;
    expect(gateReport.crossScope.crossScopeHits).toBe(0);
  });
});

// ==========================================================================
// Metric 5: Non-active memory leakage
// (Default recall (active-only) must NOT return superseded/forgotten/expired)
// ==========================================================================

describe("Quality Gate — Non-Active Memory Leakage", () => {
  // Search for content that matches non-active memories — they should NOT appear
  const NON_ACTIVE_LEAK_TESTS = [
    {
      query: "npm package manager lock file",
      label: "superseded: old npm rule (should NOT appear)",
      // The old pnpm rule was superseded — searching for "npm" should not hit it
    },
    {
      query: "React Router v5",
      label: "superseded: old React Router v5 (should NOT appear)",
    },
    {
      query: "user registration email verification",
      label: "forgotten: registration flow (should NOT appear)",
    },
    {
      query: "console.log spam production",
      label: "forgotten: console spam bug (should NOT appear)",
    },
    {
      query: "webpack bundler migrate Vite",
      label: "expired: webpack dependency (should NOT appear)",
    },
  ];

  for (const t of NON_ACTIVE_LEAK_TESTS) {
    it(`"${t.label}" — zero non-active hits`, () => {
      const results = recallEngine.searchEnhanced({
        scopeId: QG_SCOPE_A,
        query: t.query,
        limit: 10,
        // Default: status=undefined → only active memories
      });

      // All returned memories must have status = "active"
      const nonActiveResults = results.filter(
        (r) => r.memory.status !== "active",
      );

      const metric: LeakMetric = {
        query: t.query,
        label: t.label,
        resultCount: results.length,
        leaked: nonActiveResults.length > 0,
        leakedIds: nonActiveResults.map((r) => r.memory.id),
      };
      gateReport.nonActiveLeak.tests.push(metric);

      expect(nonActiveResults.length).toBe(0);
    });
  }

  // Also: broad queries across all types to detect any accidental non-active leakage
  it("broad scan: no non-active memories leak into default recall", () => {
    const broadQueries = [
      "package",
      "React",
      "API",
      "test",
      "bug",
      "task",
      "dependency",
    ];

    const allLeakedIds: Set<string> = new Set();
    for (const q of broadQueries) {
      const results = recallEngine.searchEnhanced({
        scopeId: QG_SCOPE_A,
        query: q,
        limit: 20,
      });

      for (const r of results) {
        if (r.memory.status !== "active") {
          allLeakedIds.add(r.memory.id);
        }
      }
    }

    // Record the broad scan results
    const leakedArr = [...allLeakedIds];
    for (const id of leakedArr) {
      if (!gateReport.nonActiveLeak.leakedIds.includes(id)) {
        gateReport.nonActiveLeak.leakedIds.push(id);
      }
    }

    if (leakedArr.length > 0) {
      console.log(`  Broad scan found ${leakedArr.length} non-active leaked IDs: ${leakedArr.join(", ")}`);
    }

    // All results from broad queries should be active only
    for (const q of broadQueries) {
      const results = recallEngine.searchEnhanced({
        scopeId: QG_SCOPE_A,
        query: q,
        limit: 20,
      });
      for (const r of results) {
        expect(r.memory.status).toBe("active");
      }
    }
  });

  it("Non-active leakage aggregate", () => {
    const tests = gateReport.nonActiveLeak.tests;
    gateReport.nonActiveLeak.total = tests.length;
    gateReport.nonActiveLeak.leaked = tests.filter((t) => t.leaked).length;

    console.log(
      `\n  Non-active leak: ${gateReport.nonActiveLeak.leaked}/${gateReport.nonActiveLeak.total} targeted queries leaked, ${gateReport.nonActiveLeak.leakedIds.length} unique leaked IDs`,
    );

    for (const t of tests) {
      if (t.leaked) {
        console.log(`    NON-ACTIVE LEAK "${t.label}" → IDs: ${t.leakedIds.join(", ")}`);
      }
    }

    // Threshold: 0 non-active leaks
    gateReport.thresholds.nonActiveLeakPass =
      gateReport.nonActiveLeak.leaked === 0 &&
      gateReport.nonActiveLeak.leakedIds.length === 0;
    expect(gateReport.nonActiveLeak.leaked).toBe(0);
  });
});

// ==========================================================================
// Metric 6: Duplicate result IDs
// ==========================================================================

describe("Quality Gate — Duplicate Result IDs", () => {
  it("no duplicate memory IDs in any result set", () => {
    const testQueries = [
      ...QG_RECALL_1_QUERIES.map((t) => t.query),
      ...QG_RECALL_3_QUERIES.map((t) => t.query),
      "project package manager",
      "test failure",
      "bug",
    ];

    let totalChecked = 0;
    let totalDuplicates = 0;

    for (const query of testQueries) {
      const results = recallEngine.searchEnhanced({
        scopeId: QG_SCOPE_A,
        query,
        limit: 20,
      });

      totalChecked++;
      const ids = results.map((r) => r.memory.id);
      const uniqueIds = new Set(ids);

      if (uniqueIds.size !== ids.length) {
        totalDuplicates++;
        const idCounts = new Map<string, number>();
        for (const id of ids) {
          idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
        }
        const duplicates = [...idCounts.entries()].filter(([, c]) => c > 1);
        console.log(
          `  DUPLICATE IDs in query "${query}": ${duplicates.map(([id, c]) => `${id}×${c}`).join(", ")}`,
        );
      }

      expect(uniqueIds.size).toBe(ids.length);
    }

    gateReport.duplicateIds.checked = totalChecked;
    gateReport.duplicateIds.duplicatesFound = totalDuplicates;
  });
});

// ==========================================================================
// Overall Quality Gate Verdict
// ==========================================================================

describe("Quality Gate — Overall Verdict", () => {
  it("all thresholds pass", () => {
    const { thresholds } = gateReport;

    thresholds.overallPass =
      thresholds.recallAt1Pass &&
      thresholds.recallAt3Pass &&
      thresholds.crossScopePass &&
      thresholds.nonActiveLeakPass;

    console.log("\n" + "=".repeat(70));
    console.log("  MEMORY RECALL QUALITY GATE — VERDICT");
    console.log("=".repeat(70));
    console.log(`  Scorer config: base=${DEFAULT_SCORER_CONFIG.confidenceBase}, weight=${DEFAULT_SCORER_CONFIG.confidenceWeight}, decay=${DEFAULT_SCORER_CONFIG.recencyDecayDays}d, boost=${DEFAULT_SCORER_CONFIG.recencyMaxBoost}`);
    console.log("");
    console.log(`  Recall@1:        ${(gateReport.recall1.recallAt1 * 100).toFixed(1)}%  ${thresholds.recallAt1Pass ? "✓" : "✗"} (target ≥ 80%)`);
    console.log(`  Recall@3:        ${(gateReport.recall3.recallAt3 * 100).toFixed(1)}%  ${thresholds.recallAt3Pass ? "✓" : "✗"} (target ≥ 95%)`);
    console.log(`  Cross-scope:     ${gateReport.crossScope.crossScopeHits} hits  ${thresholds.crossScopePass ? "✓" : "✗"} (target = 0)`);
    console.log(`  Non-active leak: ${gateReport.nonActiveLeak.leakedIds.length} IDs   ${thresholds.nonActiveLeakPass ? "✓" : "✗"} (target = 0)`);
    console.log(`  Duplicate IDs:   ${gateReport.duplicateIds.duplicatesFound} sets  (informational)`);
    console.log("=".repeat(70));
    console.log(`  OVERALL:         ${thresholds.overallPass ? "✓ PASS" : "✗ FAIL"}`);
    console.log("=".repeat(70) + "\n");

    // Log failing queries for debugging
    if (!thresholds.recallAt1Pass) {
      const failing = gateReport.recall1.tests.filter((t) => !t.inTop1);
      console.log("  Failing Recall@1 queries:");
      for (const f of failing) {
        console.log(`    - "${f.label}" → rank ${f.rankFound}/${f.totalResults}`);
      }
    }
    if (!thresholds.recallAt3Pass) {
      const failing = gateReport.recall3.tests.filter((t) => !t.inTop3);
      console.log("  Failing Recall@3 queries:");
      for (const f of failing) {
        console.log(`    - "${f.label}" → rank ${f.rankFound}/${f.totalResults}`);
      }
    }

    expect(thresholds.overallPass).toBe(true);
  });
});

// ==========================================================================
// Export report for external consumption
// ==========================================================================

export { gateReport as qualityGateReport };
