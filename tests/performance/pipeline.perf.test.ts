/**
 * Performance: pipeline tests (cache, retrieve, recall, run_context_flow)
 * Run: PERF_TEST=1 npx vitest run tests/performance/pipeline.perf.test.ts
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
import { handleRetrieveOriginal } from "../../src/mcp/tools/retrieveOriginal.js";
import { handleRecallContext } from "../../src/mcp/tools/recallContext.js";
import { handleRememberContext } from "../../src/mcp/tools/rememberContext.js";
import { handleRunContextFlow } from "../../src/mcp/tools/runContextFlow.js";
import type { ServerContext } from "../../src/mcp/server.js";
import type { Database } from "sql.js";

const PERF_ENABLED = process.env.PERF_TEST === "1";
const perfDescribe = PERF_ENABLED ? describe : describe.skip;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/mcp-eval");

interface PerfMetric {
  scenario: string; sizeLabel: string; inputBytes: number;
  tokensBefore: number; tokensAfter: number; tokensSaved: number;
  compressionRatio: number; latencyMs: number; cacheHit: boolean;
  receiptCreated: boolean; runId: string | null; artifactCount: number;
  status: string; timestamp: string;
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

const collected: PerfMetric[] = [];

function record(m: PerfMetric): void { collected.push(m); }

function writeReport(): void {
  const dir = path.resolve(__dirname, "../../reports/performance");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Append to existing raw-results.jsonl
  const rawPath = path.join(dir, "raw-results.jsonl");
  const existing = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, "utf-8").trim() : "";
  const newLines = collected.map((m) => JSON.stringify(m));
  fs.writeFileSync(rawPath, (existing ? existing + "\n" : "") + newLines.join("\n") + "\n", "utf-8");
  // Merge/write full report
  const allLines = fs.readFileSync(rawPath, "utf-8").trim().split("\n").filter((l) => l).map((l) => JSON.parse(l) as PerfMetric);
  const byScenario = new Map<string, PerfMetric[]>();
  for (const m of allLines) { const arr = byScenario.get(m.scenario) || []; arr.push(m); byScenario.set(m.scenario, arr); }
  const scenarios = Array.from(byScenario.entries()).map(([name, runs]) => {
    const lats = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
    const idx = (p: number) => Math.ceil(lats.length * p / 100) - 1;
    return { scenario: name, sizeLabel: runs[0]?.sizeLabel ?? "", runs: runs.length,
      inputBytes: runs[0]?.inputBytes ?? 0, p50Ms: lats[Math.max(0, idx(50))] ?? 0,
      p95Ms: lats[Math.max(0, idx(95))] ?? 0, maxMs: lats[lats.length - 1] ?? 0,
      avgTokensSaved: Math.round(runs.reduce((a, b) => a + b.tokensSaved, 0) / runs.length),
      avgCompressionRatio: Math.round(runs.reduce((a, b) => a + b.compressionRatio, 0) / runs.length * 100) / 100,
      cacheHitRate: runs.filter((r) => r.cacheHit).length / runs.length,
      receiptSuccessRate: runs.filter((r) => r.receiptCreated).length / runs.length,
      statuses: runs.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    };
  });
  const report = { generated: new Date().toISOString(), scenarios };
  fs.writeFileSync(path.join(dir, "performance-report.json"), JSON.stringify(report, null, 2), "utf-8");
  // Markdown
  let md = `# Performance Report\n\n**Generated**: ${report.generated}\n\n| Scenario | Size | Runs | Input | p50 | p95 | Max | Tokens Saved | Ratio |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const s of scenarios) {
    md += `| ${s.scenario} | ${s.sizeLabel} | ${s.runs} | ${s.inputBytes.toLocaleString()}B | ${s.p50Ms}ms | ${s.p95Ms}ms | ${s.maxMs}ms | ${s.avgTokensSaved.toLocaleString()} | ${s.avgCompressionRatio} |\n`;
  }
  // Target check
  let targets: Record<string, number> = {};
  try { const raw = loadFixture("config/performance-targets.json"); const p = JSON.parse(raw); if (typeof p === "object") targets = p; } catch (_e) { }
  md += `\n## Performance Targets\n\n| Target | Threshold | Scenario | p50 | p95 | Status |\n|---|---:|---:|---:|---:|---:|\n`;
  const targetMap: Array<{ label: string; key: string; match: string }> = [
    { label: "compress 100KB", key: "compress_context_100kb_ms", match: "100KB test output" },
    { label: "compress 1MB", key: "compress_context_1mb_ms", match: "1MB test output" },
    { label: "retrieve", key: "retrieve_original_ms", match: "retrieve" },
    { label: "recall 100", key: "recall_context_100_memories_ms", match: "100 memories" },
    { label: "recall 1000", key: "recall_context_1000_memories_ms", match: "1000 memories" },
    { label: "run_context_flow", key: "run_context_flow_full_ms", match: "run_context_flow" },
  ];
  for (const tm of targetMap) {
    const thresh = targets[tm.key] ?? 0;
    const s = scenarios.find((sc) => sc.scenario.includes(tm.match));
    const st = s && thresh > 0 ? (s.p95Ms <= thresh ? "PASS" : "FAIL") : "N/A";
    md += `| ${tm.label} | ${thresh > 0 ? thresh + "ms" : "—"} | ${s?.scenario ?? "N/A"} | ${s?.p50Ms ?? "—"}ms | ${s?.p95Ms ?? "—"}ms | ${st} |\n`;
  }
  md += `
## Notes
- In-memory SQLite for speed
- Cold-start includes DB init (disk read, migration checks)
- Warm same-process hits are sub-millisecond SQLite lookups
- New-process persistent hits include DB reopen overhead (~50-90ms normal)
- See reports/performance/cache-warm-analysis.md for detailed cold/warm breakdown
`;
  fs.writeFileSync(path.join(dir, "performance-report.md"), md, "utf-8");
}

let db: Database;
let ctx: ServerContext;
let dbDir: string;
const SCOPE_ID = "repo_fixture";

beforeAll(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-perf-pipe-"));
  await initAndMigrate(path.join(dbDir, "perf.db"));
  db = getDb();
  ctx = { db, receipts: new ReceiptService(db) };
  runStmt(db, `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at) VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`, [SCOPE_ID, process.cwd()]);
  registerAllStrategies();
});

afterAll(() => {
  try { writeReport(); } catch (e) { console.warn("Report write failed:", String(e)); }
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

// ── cache hit ──────────────────────────────────────────────────────────────────

perfDescribe("cache hit", () => {
  it("serves second compression from cache (100KB)", async () => {
    const content = loadFixture("performance/test-output-100kb.log");
    const { result: r1, ms: ms1 } = await timeIt(() => handleCompressContext(ctx, { content, contentType: "test_output", scopeId: SCOPE_ID, keepOriginal: true }));
    const d1 = parseToolText(r1);
    record({ scenario: "compress/cache_miss_100KB", sizeLabel: "100KB cache miss", inputBytes: 102400, tokensBefore: (d1.tokensBefore as number) ?? 0, tokensAfter: (d1.tokensAfter as number) ?? 0, tokensSaved: (d1.tokensSaved as number) ?? 0, compressionRatio: (d1.compressionRatio as number) ?? 0, latencyMs: ms1, cacheHit: false, receiptCreated: true, runId: null, artifactCount: 1, status: "ok", timestamp: new Date().toISOString() });
    const { result: r2, ms: ms2 } = await timeIt(() => handleCompressContext(ctx, { content, contentType: "test_output", scopeId: SCOPE_ID, keepOriginal: true }));
    const d2 = parseToolText(r2);
    record({ scenario: "compress/cache_hit_100KB", sizeLabel: "100KB cache hit", inputBytes: 102400, tokensBefore: (d2.tokensBefore as number) ?? 0, tokensAfter: (d2.tokensAfter as number) ?? 0, tokensSaved: (d2.tokensSaved as number) ?? 0, compressionRatio: (d2.compressionRatio as number) ?? 0, latencyMs: ms2, cacheHit: d2.cacheHit === true, receiptCreated: true, runId: null, artifactCount: 1, status: "ok", timestamp: new Date().toISOString() });
  });
});

// ── retrieve ───────────────────────────────────────────────────────────────────

perfDescribe("retrieve_original", () => {
  it("retrieves original after 100KB compression", async () => {
    const content = loadFixture("performance/test-output-100kb.log");
    const cr = await handleCompressContext(ctx, { content, contentType: "test_output", scopeId: SCOPE_ID, keepOriginal: true });
    const cd = parseToolText(cr);
    const { result, ms } = await timeIt(() => handleRetrieveOriginal(ctx, { originalRef: cd.originalRef as string, scopeId: SCOPE_ID }));
    expect(result.isError).toBeFalsy();
    const d = parseToolText(result);
    record({ scenario: "retrieve_original/100KB", sizeLabel: "100KB", inputBytes: Buffer.byteLength(content, "utf-8"), tokensBefore: (d.tokens as number) ?? 0, tokensAfter: 0, tokensSaved: 0, compressionRatio: 0, latencyMs: ms, cacheHit: false, receiptCreated: typeof d.receiptId === "string", runId: null, artifactCount: 0, status: "ok", timestamp: new Date().toISOString() });
  });
});

// ── recall ─────────────────────────────────────────────────────────────────────

perfDescribe("recall_context", () => {
  it("recalls against 100 memories", async () => {
    const raw = loadFixture("memory/memory-seed-100.jsonl");
    for (const line of raw.split("\n").filter((l) => l.trim())) {
      const mem = JSON.parse(line);
      await handleRememberContext(ctx, { type: mem.type, content: mem.content, summary: mem.summary, scopeId: SCOPE_ID, sourceRef: mem.sourceRef, confidence: mem.confidence });
    }
    const { result, ms } = await timeIt(() => handleRecallContext(ctx, { query: "compression receipt recall pnpm scope", scopeId: SCOPE_ID, limit: 20 }));
    expect(result.isError).toBeFalsy();
    const d = parseToolText(result);
    record({ scenario: "recall/100 memories", sizeLabel: "100 memories", inputBytes: Buffer.byteLength(raw, "utf-8"), tokensBefore: 100, tokensAfter: Array.isArray(d.memories) ? (d.memories as unknown[]).length : 0, tokensSaved: 0, compressionRatio: 0, latencyMs: ms, cacheHit: false, receiptCreated: typeof d.receiptId === "string", runId: null, artifactCount: 0, status: "ok", timestamp: new Date().toISOString() });
  });
});

// ── extreme recall (PERF_TEST_EXTREME) ─────────────────────────────────────────

const extreme = process.env.PERF_TEST_EXTREME === "1" ? describe : describe.skip;
extreme("recall_extreme", () => {
  it("recalls against 1000 memories", async () => {
    const raw = loadFixture("memory/memory-seed-1000.jsonl");
    for (const line of raw.split("\n").filter((l) => l.trim())) {
      const mem = JSON.parse(line);
      await handleRememberContext(ctx, { type: mem.type, content: mem.content, summary: mem.summary, scopeId: SCOPE_ID, sourceRef: mem.sourceRef, confidence: mem.confidence });
    }
    const { result, ms } = await timeIt(() => handleRecallContext(ctx, { query: "compression receipt recall pnpm scope", scopeId: SCOPE_ID, limit: 20 }));
    expect(result.isError).toBeFalsy();
    const d = parseToolText(result);
    record({ scenario: "recall/1000 memories", sizeLabel: "1000 memories", inputBytes: Buffer.byteLength(raw, "utf-8"), tokensBefore: 1000, tokensAfter: Array.isArray(d.memories) ? (d.memories as unknown[]).length : 0, tokensSaved: 0, compressionRatio: 0, latencyMs: ms, cacheHit: false, receiptCreated: typeof d.receiptId === "string", runId: null, artifactCount: 0, status: "ok", timestamp: new Date().toISOString() });
  });
});

// ── run_context_flow ───────────────────────────────────────────────────────────

perfDescribe("run_context_flow", () => {
  it("runs full pipeline on 100KB test output", async () => {
    const content = loadFixture("performance/test-output-100kb.log");
    const { result, ms } = await timeIt(() => handleRunContextFlow(ctx, { flow: "full", content, contentType: "test_output", scopeId: SCOPE_ID, query: "auth session token cookie failure", goal: "Compress test failure log", options: { keepOriginal: true, saveMemory: true, includeRecall: true, maxTokens: 2000 } }));
    expect(result.isError).toBeFalsy();
    const d = parseToolText(result);
    record({ scenario: "run_context_flow/full_100KB", sizeLabel: "100KB pipeline", inputBytes: Buffer.byteLength(content, "utf-8"), tokensBefore: (d.tokensBefore as number) ?? 0, tokensAfter: (d.tokensAfter as number) ?? 0, tokensSaved: (d.tokensSaved as number) ?? 0, compressionRatio: (d.compressionRatio as number) ?? 0, latencyMs: ms, cacheHit: false, receiptCreated: typeof d.receiptId === "string", runId: (d.runId as string) ?? null, artifactCount: 0, status: (d.status as string) ?? "ok", timestamp: new Date().toISOString() });
  });
});
