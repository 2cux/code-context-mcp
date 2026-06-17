/**
 * Performance: compression tests
 * Run: PERF_TEST=1 npx vitest run tests/performance/compress.perf.test.ts
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
  const lines = collected.map((m) => JSON.stringify(m));
  fs.writeFileSync(path.join(dir, "raw-results.jsonl"), lines.join("\n") + "\n", "utf-8");
  // Aggregate
  const byScenario = new Map<string, PerfMetric[]>();
  for (const m of collected) {
    const arr = byScenario.get(m.scenario) || [];
    arr.push(m);
    byScenario.set(m.scenario, arr);
  }
  const scenarios = Array.from(byScenario.entries()).map(([name, runs]) => {
    const lats = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
    const idx = (p: number) => Math.ceil(lats.length * p / 100) - 1;
    return { scenario: name, sizeLabel: runs[0]?.sizeLabel ?? "", runs: runs.length,
      inputBytes: runs[0]?.inputBytes ?? 0,
      p50Ms: lats[Math.max(0, idx(50))] ?? 0, p95Ms: lats[Math.max(0, idx(95))] ?? 0,
      maxMs: lats[lats.length - 1] ?? 0,
      avgTokensSaved: Math.round(runs.reduce((a, b) => a + b.tokensSaved, 0) / runs.length),
      avgCompressionRatio: Math.round(runs.reduce((a, b) => a + b.compressionRatio, 0) / runs.length * 100) / 100,
      statuses: runs.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    };
  });
  fs.writeFileSync(path.join(dir, "compress-report.json"), JSON.stringify({ generated: new Date().toISOString(), scenarios }, null, 2), "utf-8");
}

let db: Database;
let ctx: ServerContext;
let dbDir: string;
const SCOPE_ID = "repo_fixture";

beforeAll(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-perf-compress-"));
  await initAndMigrate(path.join(dbDir, "perf.db"));
  db = getDb();
  ctx = { db, receipts: new ReceiptService(db) };
  runStmt(db, `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at) VALUES (?, ?, 'cwdFallback', datetime('now'), datetime('now'))`, [SCOPE_ID, process.cwd()]);
  registerAllStrategies();
});

afterAll(async () => {
  try { writeReport(); } catch (e) { console.warn("Report write failed:", String(e)); }

  // Generate extreme-memory report (always, even when extreme tests skipped)
  try {
    const { loadMemoryThresholds, checkMemoryStatus } = await import("../../src/safety/memoryGuard.js");
    loadMemoryThresholds(path.resolve(__dirname, "../../fixtures/rc-hardening/extreme-perf/memory-thresholds.json"));
    const mem = checkMemoryStatus();
    const extremeMode = mem.shouldSkipExtreme ? "skipped" : mem.shouldUseSampling ? "sampled" : "full";
    const extremeCases = [
      { label: "132KB RAG chunks", bytes: 132009, minMemMb: 4096 },
      { label: "218KB TypeScript", bytes: 218117, minMemMb: 4096 },
      { label: "500KB test output", bytes: 512000, minMemMb: 8192 },
      { label: "1MB test output", bytes: 1048576, minMemMb: 16384 },
      { label: "604KB JSON", bytes: 604035, minMemMb: 4096 },
    ];
    const dir = path.resolve(__dirname, "../../reports/performance");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const extremeReport = {
      generated: new Date().toISOString(),
      memory: { totalMemoryMb: mem.totalMemoryMb, freeMemoryMb: mem.freeMemoryMb, heapUsedMb: mem.heapUsedMb },
      mode: extremeMode,
      sampleRatio: extremeMode === "sampled" ? 0.2 : null,
      thresholds: (() => {
        try {
          return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../fixtures/rc-hardening/extreme-perf/memory-thresholds.json"), "utf-8"));
        } catch { return { note: "thresholds file not found" }; }
      })(),
      cases: extremeCases.map((c) => ({
        label: c.label,
        bytes: c.bytes,
        minMemMb: c.minMemMb,
        eligible: extremeMode === "skipped"
          ? "skipped (low memory)"
          : extremeMode === "sampled" && c.minMemMb > 8192
            ? "skipped (too large for sampled mode)"
            : extremeMode === "sampled"
              ? "sampled"
              : "full",
      })),
      notes: [
        extremeMode === "skipped"
          ? `Total memory (${mem.totalMemoryMb}MB) below skip threshold (8192MB). All extreme tests skipped.`
          : extremeMode === "sampled"
            ? `Total memory (${mem.totalMemoryMb}MB) below recommended (16384MB). Sampling mode would be used.`
            : `Total memory (${mem.totalMemoryMb}MB) meets extreme recommendation. Full extreme suite available.`,
        `PERF_TEST_EXTREME=${process.env.PERF_TEST_EXTREME ?? "not set"} — extreme tests ${process.env.PERF_TEST_EXTREME === "1" ? "enabled" : "skipped (set PERF_TEST_EXTREME=1 to enable)"}.`,
      ],
    };
    fs.writeFileSync(path.join(dir, "extreme-memory-report.json"), JSON.stringify(extremeReport, null, 2), "utf-8");

    let md = `# Extreme Memory Report\n\n**Generated**: ${extremeReport.generated}\n\n`;
    md += `## Memory Status\n\n| Metric | Value |\n|---|---:|\n`;
    md += `| Total Memory | ${mem.totalMemoryMb}MB |\n| Free Memory | ${mem.freeMemoryMb}MB |\n| Heap Used | ${mem.heapUsedMb}MB |\n`;
    md += `| Mode | **${extremeMode.toUpperCase()}** |\n`;
    md += `| PERF_TEST_EXTREME | ${process.env.PERF_TEST_EXTREME ?? "not set"} |\n\n`;
    md += `## Thresholds\n\n| Threshold | Value |\n|---|---:|\n`;
    const t = extremeReport.thresholds;
    md += `| Standard Minimum | ${t.standardMinMemoryMb ?? "N/A"}MB |\n| Extreme Recommended | ${t.extremeRecommendedMemoryMb ?? "N/A"}MB |\n`;
    md += `| Skip Below | ${t.skipBelowMemoryMb ?? "N/A"}MB |\n| Sample Ratio | ${t.sampleRatioWhenLowMemory ?? "N/A"} |\n\n`;
    md += `## Case Eligibility\n\n| Case | Size | Min Mem | Status |\n|---|---:|---:|---:|\n`;
    for (const ec of extremeReport.cases) {
      md += `| ${ec.label} | ${ec.bytes.toLocaleString()}B | ${ec.minMemMb}MB | ${ec.eligible} |\n`;
    }
    md += `\n## Notes\n\n`;
    for (const note of extremeReport.notes) { md += `- ${note}\n`; }
    md += `\n## Running\n\n\`\`\`bash\n# Standard (always safe)\nPERF_TEST=1 npx vitest run tests/performance/\n\n# Extreme (16GB+ recommended)\nPERF_TEST=1 PERF_TEST_EXTREME=1 node --max-old-space-size=16384 node_modules/vitest/vitest.mjs run tests/performance/\n\`\`\`\n`;
    fs.writeFileSync(path.join(dir, "extreme-memory-report.md"), md, "utf-8");
  } catch (e) { console.warn("Extreme memory report write failed:", String(e)); }

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

perfDescribe("compress_context standard sizes", () => {
  const cases = [
    { label: "10KB test output", file: "performance/test-output-10kb.log", type: "test_output", bytes: 10240 },
    { label: "100KB test output", file: "performance/test-output-100kb.log", type: "test_output", bytes: 102400 },
    { label: "100KB server log", file: "performance/server-log-mixed-100kb.log", type: "log", bytes: 102400 },
    { label: "100KB build failure", file: "performance/build-output-failure-100kb.log", type: "command_output", bytes: 102400 },
  ];
  for (const c of cases) {
    it(`compresses ${c.label}`, async () => {
      const content = loadFixture(c.file);
      const { result, ms } = await timeIt(() => handleCompressContext(ctx, { content, contentType: c.type, scopeId: SCOPE_ID, keepOriginal: true }));
      expect(result.isError).toBeFalsy();
      const d = parseToolText(result);
      record({ scenario: `compress/${c.label}`, sizeLabel: c.label, inputBytes: c.bytes, tokensBefore: (d.tokensBefore as number) ?? 0, tokensAfter: (d.tokensAfter as number) ?? 0, tokensSaved: (d.tokensSaved as number) ?? 0, compressionRatio: (d.compressionRatio as number) ?? 0, latencyMs: ms, cacheHit: (d.cacheHit as boolean) ?? false, receiptCreated: typeof d.receiptId === "string", runId: null, artifactCount: 1, status: (d.failed as boolean) ? "partial" : "ok", timestamp: new Date().toISOString() });
    });
  }
});

// 500KB+1MB only with PERF_TEST_EXTREME
// Memory guard: auto-skip below 8GB, use sampling in 8-16GB range
const extreme = process.env.PERF_TEST_EXTREME === "1" ? describe : describe.skip;
extreme("compress_context extreme sizes", () => {
  // Lazy-load memory guard
  let memoryStatus: ReturnType<typeof import("../../src/safety/memoryGuard.js").checkMemoryStatus> | null = null;
  let sampleRatio = 1.0;
  let extremeMode: "full" | "sampled" | "skipped" = "full";

  beforeAll(async () => {
    // Load thresholds and check memory
    const { loadMemoryThresholds, checkMemoryStatus, getSampleRatio } = await import("../../src/safety/memoryGuard.js");
    loadMemoryThresholds(path.resolve(__dirname, "../../fixtures/rc-hardening/extreme-perf/memory-thresholds.json"));
    memoryStatus = checkMemoryStatus();
    if (memoryStatus!.shouldSkipExtreme) {
      extremeMode = "skipped";
    } else if (memoryStatus!.shouldUseSampling) {
      extremeMode = "sampled";
      sampleRatio = getSampleRatio();
    }
  });

  const cases = [
    { label: "132KB RAG chunks", file: "content/rag-chunks.json", type: "rag_chunk", bytes: 132009, minMemMb: 4096 },
    { label: "218KB TypeScript", file: "content/large-typescript-file.ts", type: "code", bytes: 218117, minMemMb: 4096 },
    { label: "500KB test output", file: "performance/test-output-500kb.log", type: "test_output", bytes: 512000, minMemMb: 8192, rcFile: "../../fixtures/rc-hardening/extreme-perf/500kb-test-output.log" },
    { label: "1MB test output", file: "performance/test-output-1mb.log", type: "test_output", bytes: 1048576, minMemMb: 16384, rcFile: "../../fixtures/rc-hardening/extreme-perf/1mb-test-output.log" },
    { label: "604KB JSON", file: "content/large-json-response.json", type: "json", bytes: 604035, minMemMb: 4096 },
  ];

  for (const c of cases) {
    const testFn = c.minMemMb > 8192 && extremeMode === "sampled"
      ? it.skip  // Skip largest cases in sampled mode
      : extremeMode === "skipped"
        ? it.skip
        : it;

    testFn(`compresses ${c.label} [${extremeMode}]`, async () => {
      // Try rc-hardening fixture first, fall back to mcp-eval
      let content: string;
      const rcPath = (c as any).rcFile
        ? path.resolve(__dirname, (c as any).rcFile)
        : null;
      if (rcPath && fs.existsSync(rcPath)) {
        content = fs.readFileSync(rcPath, "utf-8");
        (c as any).bytes = Buffer.byteLength(content, "utf-8");
      } else {
        content = loadFixture(c.file);
      }

      // Apply sampling when in low-memory mode
      const sampleNote = extremeMode === "sampled" ? ` [sampled ${Math.round(sampleRatio * 100)}%]` : "";
      let testContent = content;
      if (extremeMode === "sampled") {
        const { sampleContent } = await import("../../src/safety/memoryGuard.js");
        testContent = sampleContent(content, sampleRatio);
      }

      const { result, ms } = await timeIt(() =>
        handleCompressContext(ctx, {
          content: testContent,
          contentType: c.type as any,
          scopeId: SCOPE_ID,
          keepOriginal: true,
        })
      );
      expect(result.isError).toBeFalsy();
      const d = parseToolText(result);
      const status = extremeMode === "sampled"
        ? "sampled"
        : (d.failed as boolean)
          ? "partial"
          : "ok";
      record({
        scenario: `compress/${c.label}${sampleNote}`,
        sizeLabel: `${c.label} [${extremeMode}]`,
        inputBytes: (c as any).bytes ?? c.bytes,
        tokensBefore: (d.tokensBefore as number) ?? 0,
        tokensAfter: (d.tokensAfter as number) ?? 0,
        tokensSaved: (d.tokensSaved as number) ?? 0,
        compressionRatio: (d.compressionRatio as number) ?? 0,
        latencyMs: ms,
        cacheHit: (d.cacheHit as boolean) ?? false,
        receiptCreated: typeof d.receiptId === "string",
        runId: null,
        artifactCount: 1,
        status,
        timestamp: new Date().toISOString(),
      });
    });
  }

});
