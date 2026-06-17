/**
 * Performance: cache warm/cold analysis
 * Run: PERF_TEST=1 npx vitest run tests/performance/cache-warm.perf.test.ts
 *
 * Measures:
 *   - cold cache (first compress, populates cache)
 *   - warm cache same-process (second call, SQLite hit)
 *   - new-process persistent hit (separate DB, simulates restart)
 *   - Per-step latency: contentHash, computeCacheKey, findByCacheKey, compress, save
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { initAndMigrate } from "../../src/storage/migrations.js";
import { getDb, closeDb, runStmt } from "../../src/storage/db.js";
import { ReceiptService } from "../../src/receipts/receiptService.js";
import { registerAllStrategies } from "../../src/compression/registerStrategies.js";
import { handleCompressContext } from "../../src/mcp/tools/compressContext.js";
import { CompressedStore } from "../../src/compressed/compressedStore.js";
import { contentHash } from "../../src/utils/hash.js";
import { computeCacheKey, canCache } from "../../src/cache/cacheService.js";
import { getStrategy } from "../../src/compression/compressionEngine.js";
import type { ServerContext } from "../../src/mcp/server.js";
import type { Database } from "sql.js";

const PERF_ENABLED = process.env.PERF_TEST === "1";
const perfDescribe = PERF_ENABLED ? describe : describe.skip;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/rc-hardening/cache-warm");

interface CacheWarmMetric {
  scenario: string;
  step: string;
  latencyMs: number;
  cacheHit: boolean;
  status: string;
  timestamp: string;
}

function loadFixture(rel: string): string {
  return fs.readFileSync(path.join(FIXTURES_ROOT, rel), "utf-8");
}

function parseToolText(result: { content: { type: string; text?: string }[] }): Record<string, unknown> {
  const text = result.content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content");
  return JSON.parse(text);
}

async function timeIt<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

function timeItSync<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  return { result, ms: Math.round(performance.now() - start) };
}

const collected: CacheWarmMetric[] = [];

function record(m: CacheWarmMetric): void { collected.push(m); }

// Load thresholds
const thresholdsPath = path.join(FIXTURES_ROOT, "cache-thresholds.json");
const thresholds = JSON.parse(fs.readFileSync(thresholdsPath, "utf-8")) as Record<string, number>;

function writeAnalysis(): void {
  const dir = path.resolve(__dirname, "../../reports/performance");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const scenarios = collected.reduce((acc, m) => {
    const key = m.scenario;
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {} as Record<string, CacheWarmMetric[]>);

  // Build JSON analysis
  const summary: Record<string, { avgMs: number; minMs: number; maxMs: number; count: number; steps: Record<string, number> }> = {};
  for (const [name, metrics] of Object.entries(scenarios)) {
    const lats = metrics.map((m) => m.latencyMs);
    const stepMap: Record<string, number[]> = {};
    for (const m of metrics) {
      if (!stepMap[m.step]) stepMap[m.step] = [];
      stepMap[m.step].push(m.latencyMs);
    }
    const stepAvgs: Record<string, number> = {};
    for (const [step, vals] of Object.entries(stepMap)) {
      stepAvgs[step] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100;
    }
    summary[name] = {
      avgMs: Math.round(lats.reduce((a, b) => a + b, 0) / lats.length * 100) / 100,
      minMs: Math.min(...lats),
      maxMs: Math.max(...lats),
      count: lats.length,
      steps: stepAvgs,
    };
  }

  // Cold/warm split
  const coldMetrics = collected.filter((m) => m.scenario.includes("cold"));
  const warmMetrics = collected.filter((m) => m.scenario.includes("warm") || m.scenario.includes("same-process"));
  const persistentMetrics = collected.filter((m) => m.scenario.includes("new-process"));

  const coldAvg = coldMetrics.length > 0 ? Math.round(coldMetrics.reduce((a, b) => a + b.latencyMs, 0) / coldMetrics.length * 100) / 100 : 0;
  const warmAvg = warmMetrics.length > 0 ? Math.round(warmMetrics.reduce((a, b) => a + b.latencyMs, 0) / warmMetrics.length * 100) / 100 : 0;
  const persistentAvg = persistentMetrics.length > 0 ? Math.round(persistentMetrics.reduce((a, b) => a + b.latencyMs, 0) / persistentMetrics.length * 100) / 100 : 0;

  const analysis = {
    generated: new Date().toISOString(),
    thresholds,
    summary,
    coldVsWarm: {
      cold: { avgMs: coldAvg, count: coldMetrics.length },
      warmSameProcess: { avgMs: warmAvg, count: warmMetrics.length },
      persistentNewProcess: { avgMs: persistentAvg, count: persistentMetrics.length },
    },
    thresholdCheck: {
      coldCacheMs: { threshold: thresholds.coldCacheMs ?? 1000, actual: coldAvg, pass: coldAvg <= (thresholds.coldCacheMs ?? 1000) },
      warmCacheMs: { threshold: thresholds.warmCacheMs ?? 200, actual: warmAvg, pass: warmAvg <= (thresholds.warmCacheMs ?? 200) },
      sameProcessWarmCacheMs: { threshold: thresholds.sameProcessWarmCacheMs ?? 50, actual: warmAvg, pass: warmAvg <= (thresholds.sameProcessWarmCacheMs ?? 50) },
      subsequentHitExpectedMs: { threshold: thresholds.subsequentHitExpectedMs ?? 20, actual: persistentAvg, pass: persistentAvg <= (thresholds.subsequentHitExpectedMs ?? 20) },
    },
  };

  fs.writeFileSync(
    path.join(dir, "cache-warm-analysis.json"),
    JSON.stringify(analysis, null, 2),
    "utf-8",
  );

  // Build Markdown report
  let md = `# Cache Warm Performance Analysis\n\n`;
  md += `**Generated**: ${analysis.generated}\n\n`;
  md += `## Cold vs Warm Split\n\n`;
  md += `| Category | Avg Latency | Count | Threshold | Status |\n`;
  md += `|---|---:|---:|---:|---:|\n`;
  const tc = analysis.thresholdCheck;
  md += `| Cold cache | ${coldAvg}ms | ${coldMetrics.length} | ${tc.coldCacheMs.threshold}ms | ${tc.coldCacheMs.pass ? "✅" : "❌"} |\n`;
  md += `| Warm same-process | ${warmAvg}ms | ${warmMetrics.length} | ${tc.warmCacheMs.threshold}ms | ${tc.warmCacheMs.pass ? "✅" : "❌"} |\n`;
  md += `| Persistent new-process | ${persistentAvg}ms | ${persistentMetrics.length} | ${tc.subsequentHitExpectedMs.threshold}ms | ${tc.subsequentHitExpectedMs.pass ? "✅" : "❌"} |\n`;
  md += `\n## Per-Step Breakdown\n\n`;
  for (const [name, s] of Object.entries(summary)) {
    md += `### ${name}\n`;
    md += `| Step | Avg Latency |\n|---|---:|\n`;
    for (const [step, lat] of Object.entries(s.steps)) {
      md += `| ${step} | ${lat}ms |\n`;
    }
    md += `\n`;
  }
  md += `## Notes\n`;
  md += `- Cold cache = first compression in process (includes init + compress + save)\n`;
  md += `- Warm same-process = second call, cache hit from in-memory SQLite\n`;
  md += `- Persistent new-process = separate DB connection, simulating process restart\n`;
  md += `- Thresholds from fixtures/rc-hardening/cache-warm/cache-thresholds.json\n`;

  fs.writeFileSync(path.join(dir, "cache-warm-analysis.md"), md, "utf-8");
}

let db: Database;
let ctx: ServerContext;
let dbDir: string;
const SCOPE_ID = "repo_fixture";

beforeAll(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-perf-cw-"));
  await initAndMigrate(path.join(dbDir, "perf.db"));
  db = getDb();
  ctx = { db, receipts: new ReceiptService(db) };
  runStmt(db, `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at) VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`, [SCOPE_ID, process.cwd()]);
  registerAllStrategies();
});

afterAll(() => {
  try { writeAnalysis(); } catch (e) { console.warn("Analysis write failed:", String(e)); }
  closeDb();
  try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch (_e) { }
});

beforeEach(() => {
  try { db.exec("DELETE FROM memories_fts"); } catch (_e) { }
  db.exec("DELETE FROM profile_facts");
  db.exec("DELETE FROM receipts");
  db.exec("DELETE FROM memories");
  db.exec("DELETE FROM original_contents");
  db.exec("DELETE FROM compressed_contexts");
  db.exec("DELETE FROM failure_events");
  runStmt(db, `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at) VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`, [SCOPE_ID, process.cwd()]);
  try { (globalThis as any).gc?.(); } catch (_e) { }
});

// ── Per-step latency measurement ─────────────────────────────────────────────

perfDescribe("cache key computation steps", () => {
  it("measures per-step latency for cache lookup path", async () => {
    const content = loadFixture("repeated-100kb-test-output.log");
    const inputBytes = Buffer.byteLength(content, "utf-8");

    // Step 1: contentHash
    const { result: hash, ms: hashMs } = timeItSync(() => contentHash(content));
    record({ scenario: "per-step/cold", step: "contentHash", latencyMs: hashMs, cacheHit: false, status: "ok", timestamp: new Date().toISOString() });

    // Step 2: strategy resolution
    const { result: strategy, ms: strategyMs } = timeItSync(() => {
      const s = getStrategy("test_output");
      const effectiveType = s ? "test_output" : "plain_text";
      const version = s?.version ?? "";
      return { effectiveType, version };
    });
    record({ scenario: "per-step/cold", step: "strategyResolution", latencyMs: strategyMs, cacheHit: false, status: "ok", timestamp: new Date().toISOString() });

    // Step 3: cache key computation
    const { result: cacheKey, ms: cacheKeyMs } = timeItSync(() =>
      canCache(strategy.version)
        ? computeCacheKey(SCOPE_ID, hash, strategy.effectiveType, strategy.version, 2000, true)
        : ""
    );
    record({ scenario: "per-step/cold", step: "computeCacheKey", latencyMs: cacheKeyMs, cacheHit: false, status: "ok", timestamp: new Date().toISOString() });

    // Step 4: SQLite cache lookup
    const store = new CompressedStore(db);
    const { result: cached, ms: lookupMs } = timeItSync(() =>
      cacheKey ? store.findByCacheKey(cacheKey, SCOPE_ID) : null
    );
    record({ scenario: "per-step/cold", step: "findByCacheKey", latencyMs: lookupMs, cacheHit: false, status: "ok", timestamp: new Date().toISOString() });

    // Step 5: Full compress (cold — populates cache)
    const { result: r1, ms: compressMs } = await timeIt(() =>
      handleCompressContext(ctx, {
        content,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        keepOriginal: true,
      })
    );
    expect(r1.isError).toBeFalsy();
    const d1 = parseToolText(r1);
    record({ scenario: "per-step/cold", step: "fullCompress", latencyMs: compressMs, cacheHit: false, status: "ok", timestamp: new Date().toISOString() });

    // Step 6: Second call — cache hit (same process, SQLite)
    const { result: r2, ms: hitMs } = await timeIt(() =>
      handleCompressContext(ctx, {
        content,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        keepOriginal: true,
      })
    );
    expect(r2.isError).toBeFalsy();
    const d2 = parseToolText(r2);
    record({ scenario: "per-step/warm-same-process", step: "cacheHit", latencyMs: hitMs, cacheHit: true, status: "ok", timestamp: new Date().toISOString() });

    expect(d2.cacheHit).toBe(true);
  });
});

// ── Cold: first compress ─────────────────────────────────────────────────────

perfDescribe("cold cache (first compress)", () => {
  it("measures cold cache population for 100KB test output", async () => {
    const content = loadFixture("repeated-100kb-test-output.log");
    const { result, ms } = await timeIt(() =>
      handleCompressContext(ctx, {
        content,
        contentType: "test_output",
        scopeId: SCOPE_ID,
        keepOriginal: true,
      })
    );
    expect(result.isError).toBeFalsy();
    const d = parseToolText(result);
    record({
      scenario: "cold/cold-compress-100kb",
      step: "compress+save",
      latencyMs: ms,
      cacheHit: (d.cacheHit as boolean) ?? false,
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });
});

// ── Warm: same-process repeated hit ──────────────────────────────────────────

perfDescribe("warm cache same-process", () => {
  it("measures 5 repeated cache hits after cold population", async () => {
    const content = loadFixture("repeated-100kb-test-output.log");

    // Cold population
    await handleCompressContext(ctx, {
      content,
      contentType: "test_output",
      scopeId: SCOPE_ID,
      keepOriginal: true,
    });

    // 5 warm hits in same process
    for (let i = 0; i < 5; i++) {
      const { result, ms } = await timeIt(() =>
        handleCompressContext(ctx, {
          content,
          contentType: "test_output",
          scopeId: SCOPE_ID,
          keepOriginal: true,
        })
      );
      expect(result.isError).toBeFalsy();
      const d = parseToolText(result);
      record({
        scenario: "warm/warm-hit-same-process",
        step: `hit_${i + 1}`,
        latencyMs: ms,
        cacheHit: (d.cacheHit as boolean) ?? false,
        status: "ok",
        timestamp: new Date().toISOString(),
      });
    }
  });
});

// ── New-process: persistent cache via SQLite ─────────────────────────────────

perfDescribe("new-process persistent hit", () => {
  it("simulates new process hitting persistent SQLite cache", async () => {
    const content = loadFixture("repeated-100kb-test-output.log");

    // Populate a persistent DB
    const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-perf-persist-"));
    const persistDbPath = path.join(persistDir, "persist.db");
    try {
      await initAndMigrate(persistDbPath);
      const persistDb = getDb();
      const persistCtx: ServerContext = { db: persistDb, receipts: new ReceiptService(persistDb) };
      runStmt(persistDb, `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at) VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`, [SCOPE_ID, process.cwd()]);
      registerAllStrategies();

      // Cold compress in "first process"
      const { result: r1, ms: coldMs } = await timeIt(() =>
        handleCompressContext(persistCtx, {
          content,
          contentType: "test_output",
          scopeId: SCOPE_ID,
          keepOriginal: true,
        })
      );
      expect(r1.isError).toBeFalsy();
      record({
        scenario: "persistent/cold-in-first-process",
        step: "compress",
        latencyMs: coldMs,
        cacheHit: false,
        status: "ok",
        timestamp: new Date().toISOString(),
      });

      // Simulate "new process": close and reopen DB
      closeDb();

      // Reopen the same DB file (simulates process restart)
      await initAndMigrate(persistDbPath);
      const reopenedDb = getDb();
      const reopenedCtx: ServerContext = { db: reopenedDb, receipts: new ReceiptService(reopenedDb) };
      registerAllStrategies();

      // 3 hits in "new process"
      for (let i = 0; i < 3; i++) {
        const { result, ms } = await timeIt(() =>
          handleCompressContext(reopenedCtx, {
            content,
            contentType: "test_output",
            scopeId: SCOPE_ID,
            keepOriginal: true,
          })
        );
        expect(result.isError).toBeFalsy();
        const d = parseToolText(result);
        record({
          scenario: "persistent/new-process-hit",
          step: `hit_${i + 1}`,
          latencyMs: ms,
          cacheHit: (d.cacheHit as boolean) ?? false,
          status: "ok",
          timestamp: new Date().toISOString(),
        });
      }

      closeDb();
    } finally {
      try { fs.rmSync(persistDir, { recursive: true, force: true }); } catch (_e) { }
    }
  });
});
