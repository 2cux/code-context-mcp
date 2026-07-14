
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "sql.js";
import { compress } from "../../src/compression/compressionEngine.js";
import { registerAllStrategies } from "../../src/compression/registerStrategies.js";
import { CompressedStore } from "../../src/compressed/compressedStore.js";
import { RecallEngine } from "../../src/memory/recallEngine.js";
import { MemoryFtsIndex } from "../../src/memory/memoryFts.js";
import { DEFAULT_SCORER_CONFIG } from "../../src/memory/recallScorer.js";
import { MemoryService } from "../../src/memory/memoryService.js";
import { OriginalStore } from "../../src/originals/originalStore.js";
import { ReceiptService } from "../../src/receipts/receiptService.js";
import { closeDb, getDb, runStmt } from "../../src/storage/db.js";
import { initAndMigrate } from "../../src/storage/migrations.js";
import { countTokens } from "../../src/utils/tokenCount.js";
import {
  QG_ACTIVE_MEMORIES, QG_ALL_MEMORIES, QG_CROSS_SCOPE_QUERIES,
  QG_NEGATIVE_QUERIES, QG_NON_ACTIVE_MEMORIES, QG_RECALL_1_QUERIES,
  QG_RECALL_3_QUERIES, QG_SCOPE_A, QG_SCOPE_B, QG_SCOPE_B_MEMORIES, QG_SCOPE_C,
} from "../../fixtures/quality-eval/memory/qualityGateFixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const REPORTS = resolve(ROOT, "reports/quality");
const ARTIFACTS = resolve(ROOT, "artifacts");
const COMMAND = "npm run quality:reports";
const COMP_BASE_DIR = resolve(ROOT, "fixtures/quality-eval/compression");
const COMP_GATE_DIR = resolve(ROOT, "fixtures/quality-gate");
const COMP_GATE_INPUT_DIR = resolve(ROOT, "tests/fixtures");
const RECALL_FIXTURE = resolve(ROOT, "fixtures/quality-eval/memory/qualityGateFixtures.ts");

const compBaselineFixtures = [
  ["code.ts", "code", ["PaymentRequest", "PaymentResponse", "PaymentError", "processPayment", "refundPayment", "getPaymentStatus", "validateCard", "Luhn", "RETRY_DELAY_MS", "processing_error", "invalid_amount", "FIXME: Add rate limiting", "src/services/paymentService.ts"], 0.4],
  ["log.ts", "log", ["ERROR", "FATAL", "ConnectionRefusedError", "OutOfMemoryError", "QueryTimeoutError", "req_abc001", "/app/src/db/pool.ts", "/app/src/worker/reaper.ts", "All retries exhausted", "2026-07-07"], 0.3],
  ["conversationHistory.txt", "conversation_history", ["rate limiting", "login endpoint", "express-rate-limit", "redis", "5 requests", "60 seconds", "Retry-After", "src/middleware/rateLimiter.ts", "src/routes/auth.ts"], 0.35],
  ["commandOutput.txt", "command_output", ["typecheck", "TS2304", "TS2554", "TS2322", "src/services/userService.ts", "src/utils/format.ts", "Cannot find name", "Expected 2 arguments", "exit code 2"], 0.5],
  ["testOutput.txt", "test_output", ["tests/unit/auth/session.test.ts", "tests/unit/payment/priceCalc.test.ts", "tests/functional/listEmpty.test.tsx", "should clear cookie on logout", "should apply bulk discount correctly", "should render empty state message", "AssertionError", "TypeError", "3 failed", "12 passed"], 0.4],
  ["markdown.md", "markdown", ["CodeContext MCP", "Context Compression", "Project Memory", "Scope Isolation", "Content Router", "Compression Engine", "Memory Service", "SQLite", "compress_context", "retrieve_original", "remember_context", "recall_context", "MAX_TOKENS"], 0.5],
  ["json.json", "json", ["RATE_LIMITED", "Too many requests", "retryAfter", "req_abc_001", "INVALID_FORMAT", "email"], 0.5],
  ["ragChunk.json", "rag_chunk", ["JWT", "RS256", "HTTP-only cookie", "Redis", "docs/auth/architecture.md", "Token Management"], 0.5],
] as const;

const compGateFixtures = [
  ["test_output", "vitest-output.txt", "test_output"], ["log", "app-log.txt", "log"],
  ["command_output", "build-output.txt", "command_output"], ["code", "sample.ts", "code"],
  ["json", "response.json", "json"], ["markdown", "readme.md", "markdown"],
  ["rag_chunk", "rag-chunks.json", "rag_chunk"], ["conversation_history", "conversation.json", "conversation_history"],
] as const;

const minSavings: Record<string, number> = {
  test_output: 0.30, log: 0.10, command_output: 0.00, code: 0.45,
  json: 0.10, markdown: 0.40, rag_chunk: 0.35, conversation_history: 0.50,
};
const recallThreshold = { recallAt1Min: 0.80, recallAt3Min: 0.95, crossScopeHitsMax: 0, nonActiveLeakIdsMax: 0, duplicateResultSetsMax: 0, falseRecallRate: "informational" };

function ensureDir(p: string) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }
function sha256(data: string | Buffer) { return createHash("sha256").update(data).digest("hex"); }
function git(args: string[], fallback = "unknown") { try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf-8" }).trim(); } catch { return fallback; } }
function listFiles(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => { const p = resolve(dir, e.name); return e.isDirectory() ? listFiles(p) : [p]; }).sort(); }
function fixtureHash(paths: string[]) { const h = createHash("sha256"); for (const p of paths.sort()) { h.update(relative(ROOT, p).replace(/\\/g, "/")); h.update("\0"); h.update(readFileSync(p)); h.update("\0"); } return h.digest("hex"); }
function fixtureInfo(version: string, paths: string[]) { return { version, hash: fixtureHash(paths), paths: paths.map(p => relative(ROOT, p).replace(/\\/g, "/")).sort() }; }
function meta(generatedAt: string) { return { generatedAt, gitCommit: git(["rev-parse", "HEAD"]), gitDirty: git(["status", "--short"], "").length > 0, generator: "tests/quality/generateBaseline.ts", command: COMMAND }; }
function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }
function ratio(a: number, b: number) { return b > 0 ? a / b : 0; }
function escRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function readJson(p: string) { return JSON.parse(readFileSync(p, "utf-8")); }
function ensureScope(db: Database, scopeId: string) { const now = new Date().toISOString(); runStmt(db, `INSERT OR IGNORE INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, [scopeId, ROOT, "cwdFallback", now, now]); }
async function runCompressionBaseline() {
  registerAllStrategies();
  const out = [];
  for (const [name, contentType, facts, budgetRatio] of compBaselineFixtures) {
    const content = readFileSync(resolve(COMP_BASE_DIR, name), "utf-8");
    const tokens = countTokens(content);
    const result = await compress({ scopeId: "quality-baseline", content, contentType, keepOriginal: false, maxTokens: Math.max(50, Math.floor(tokens * budgetRatio)) });
    const keyFacts = facts.map(fact => {
      const searchIn = contentType === "conversation_history" ? result.compressedContent.toLowerCase() : result.compressedContent;
      const searchFor = contentType === "conversation_history" ? fact.toLowerCase() : fact;
      return { fact, retained: searchIn.includes(searchFor) };
    });
    const retained = keyFacts.filter(f => f.retained).length;
    out.push({
      fixture: name, contentType,
      threshold: { type: "baseline", enforced: false, note: "Baseline measurement only; not a release-gate result." },
      measured: { tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter, tokensSaved: result.tokensSaved, tokenSavingsRatio: result.compressionRatio, factsTotal: facts.length, factsRetained: retained, keyFactRetentionRate: ratio(retained, facts.length), keyFacts },
      verdict: "MEASURED",
    });
  }
  return out;
}

function persistAndVerifyOriginal(db: Database, result: Awaited<ReturnType<typeof compress>>, content: string, contentType: string, scopeId: string) {
  const expectedSha256 = sha256(content);
  if (!result.originalRef) return { ok: false, lengthOk: false, sha256Ok: false, expectedLength: content.length, actualLength: 0, expectedSha256, reason: "missing originalRef" };
  const compressedStore = new CompressedStore(db);
  const originalStore = new OriginalStore(db);
  const ccr = compressedStore.save({
    scopeId, contentType, strategy: result.strategy, compressedContent: result.compressedContent,
    summary: result.summary, originalRef: result.originalRef, tokensBefore: result.tokensBefore,
    tokensAfter: result.tokensAfter, tokensSaved: result.tokensSaved, compressionRatio: result.compressionRatio,
    canRetrieveOriginal: true, failed: Boolean(result.failed), errorReason: result.errorReason,
    contentHash: expectedSha256, strategyVersion: result.strategyVersion,
  });
  originalStore.save({ id: result.originalRef, scopeId, ccrId: ccr.id, contentType, content });
  const retrieved = originalStore.retrieve(result.originalRef, scopeId);
  const actualContent = retrieved?.content ?? "";
  const actualSha256 = retrieved ? sha256(actualContent) : undefined;
  const lengthOk = Boolean(retrieved) && retrieved!.totalChars === content.length && retrieved!.returnedChars === content.length && actualContent.length === content.length && retrieved!.hasMore === false;
  const sha256Ok = actualSha256 === expectedSha256;
  return { ok: lengthOk && sha256Ok, lengthOk, sha256Ok, expectedLength: content.length, actualLength: actualContent.length, expectedSha256, actualSha256, originalRef: result.originalRef, reason: retrieved ? undefined : "retrieve returned null" };
}

async function runCompressionGate() {
  registerAllStrategies();
  const scopeId = "quality-gate";
  await initAndMigrate(":memory:");
  const db = getDb();
  ensureScope(db, scopeId);
  try {
    const out = [];
    for (const [name, file, contentType] of compGateFixtures) {
      const path = resolve(COMP_GATE_INPUT_DIR, file);
      const qPath = resolve(COMP_GATE_DIR, `${name}.json`);
      const quality = existsSync(qPath) ? readJson(qPath) : {};
      const minTokenSavingsRatio = quality.minimumTokenSavingsRatio ?? minSavings[contentType] ?? 0;
      if (!existsSync(path)) {
        out.push({ fixture: name, file, contentType, threshold: { minTokenSavingsRatio, mustKeepCount: 0, mustNotInventCount: 0, retrievalProofRequired: true }, measured: { tokensBefore: 0, tokensAfter: 0, tokensSaved: 0, tokenSavingsRatio: 0, missingMustKeep: [], invented: [], retrievalProof: { ok: false, reason: "fixture missing" }, compressionFailed: true, errorReason: "fixture missing" }, verdict: "SKIP" });
        continue;
      }
      const content = readFileSync(path, "utf-8");
      const tokensBefore = countTokens(content);
      const result = await compress({ scopeId, content, contentType, keepOriginal: true, maxTokens: Math.max(300, Math.floor(tokensBefore * (1 - minTokenSavingsRatio))) });
      const actualRatio = tokensBefore > 0 ? result.tokensSaved / tokensBefore : 0;
      const mustKeep: string[] = quality.mustKeep ?? [];
      const mustNotInvent: string[] = quality.mustNotInvent ?? [];
      const missingMustKeep = mustKeep.filter(k => !new RegExp(escRegex(k), "i").test(result.compressedContent));
      const invented = mustNotInvent.filter(k => result.compressedContent.includes(k));
      const retrievalProof = persistAndVerifyOriginal(db, result, content, contentType, scopeId);
      const ok = !result.failed && missingMustKeep.length === 0 && invented.length === 0 && actualRatio >= minTokenSavingsRatio && retrievalProof.ok;
      out.push({
        fixture: name, file, contentType,
        threshold: { minTokenSavingsRatio, mustKeepCount: mustKeep.length, mustNotInventCount: mustNotInvent.length, retrievalProofRequired: true },
        measured: { tokensBefore, tokensAfter: result.tokensAfter, tokensSaved: result.tokensSaved, tokenSavingsRatio: actualRatio, missingMustKeep, invented, retrievalProof, compressionFailed: Boolean(result.failed), errorReason: result.errorReason },
        verdict: ok ? "PASS" : "FAIL",
      });
    }
    return out;
  } finally { closeDb(); }
}
function seedRecall(db: Database) {
  for (const s of [QG_SCOPE_A, QG_SCOPE_B, QG_SCOPE_C]) ensureScope(db, s);
  const receipts = new ReceiptService(db);
  const ftsIndex = new MemoryFtsIndex(db);
  const memoryService = new MemoryService(db, { receipts, ftsIndex });
  const recallEngine = new RecallEngine(db, ftsIndex);
  for (const mem of QG_ACTIVE_MEMORIES) memoryService.remember(mem);
  for (const mem of QG_NON_ACTIVE_MEMORIES) {
    const saved = memoryService.remember(mem);
    let status: "superseded" | "forgotten" | "expired" = "forgotten";
    if (mem.content.includes("superseded")) status = "superseded";
    else if (mem.content.includes("expired") || mem.content.includes("Expired")) status = "expired";
    runStmt(db, `UPDATE memories SET status = ? WHERE id = ? AND scope_id = ?`, [status, saved.memoryId, QG_SCOPE_A]);
    const updated = memoryService.get(saved.memoryId, QG_SCOPE_A);
    if (updated) ftsIndex.update(updated);
  }
  for (const mem of QG_SCOPE_B_MEMORIES) memoryService.remember(mem);
  return recallEngine;
}

async function runRecallReport(reportMeta: any, fixture: any) {
  await initAndMigrate(":memory:");
  const db = getDb();
  try {
    const recallEngine = seedRecall(db);
    const recallAt1 = QG_RECALL_1_QUERIES.map(t => {
      const results = recallEngine.searchEnhanced({ scopeId: QG_SCOPE_A, query: t.query, limit: 10 });
      const found = results.find(r => r.memory.content.includes(t.targetContent));
      const rankFound = found?.rank ?? -1;
      return { query: t.query, label: t.label, targetContent: t.targetContent, rankFound, inTop1: rankFound === 1, inTop3: rankFound >= 1 && rankFound <= 3, totalResults: results.length };
    });
    const recallAt3 = QG_RECALL_3_QUERIES.map(t => {
      const results = recallEngine.searchEnhanced({ scopeId: QG_SCOPE_A, query: t.query, limit: 5 });
      const found = results.find(r => r.memory.content.includes(t.targetContent));
      const rankFound = found?.rank ?? -1;
      return { query: t.query, label: t.label, targetContent: t.targetContent, rankFound, inTop1: rankFound === 1, inTop3: rankFound >= 1 && rankFound <= 3, totalResults: results.length };
    });
    const falseRecall = QG_NEGATIVE_QUERIES.map(t => {
      const results = recallEngine.searchEnhanced({ scopeId: QG_SCOPE_A, query: t.query, limit: 10 });
      return { query: t.query, label: t.label, totalResults: results.length, leakedIds: results.map(r => r.memory.id) };
    });
    const crossScope = QG_CROSS_SCOPE_QUERIES.map(t => {
      const results = recallEngine.searchEnhanced({ scopeId: QG_SCOPE_A, query: t.query, limit: 10 });
      const leaked = results.filter(r => r.memory.content.includes(t.scopeBContent));
      return { query: t.query, label: t.label, totalResults: results.length, leakedIds: leaked.map(r => r.memory.id) };
    });
    const nonActiveQueries = [
      ["npm package manager lock file", "superseded old npm rule"], ["React Router v5", "superseded old React Router v5"],
      ["user registration email verification", "forgotten registration flow"], ["console.log spam production", "forgotten console spam bug"],
      ["webpack bundler migrate Vite", "expired webpack dependency"],
    ];
    const nonActiveLeak = nonActiveQueries.map(([query, label]) => {
      const results = recallEngine.searchEnhanced({ scopeId: QG_SCOPE_A, query, limit: 10 });
      const leaked = results.filter(r => r.memory.status !== "active");
      return { query, label, totalResults: results.length, leakedIds: leaked.map(r => r.memory.id) };
    });
    const broadLeakIds = new Set<string>();
    for (const query of ["package", "React", "API", "test", "bug", "task", "dependency"]) {
      for (const result of recallEngine.searchEnhanced({ scopeId: QG_SCOPE_A, query, limit: 20 })) {
        if (result.memory.status !== "active") broadLeakIds.add(result.memory.id);
      }
    }
    if (broadLeakIds.size) nonActiveLeak.push({ query: "broad non-active scan", label: "broad non-active scan", totalResults: broadLeakIds.size, leakedIds: [...broadLeakIds] });
    const duplicateIds = [...QG_RECALL_1_QUERIES.map(t => t.query), ...QG_RECALL_3_QUERIES.map(t => t.query), "project package manager", "test failure", "bug"].map(query => {
      const results = recallEngine.searchEnhanced({ scopeId: QG_SCOPE_A, query, limit: 20 });
      const counts = new Map<string, number>();
      for (const result of results) counts.set(result.memory.id, (counts.get(result.memory.id) ?? 0) + 1);
      return { query, label: "duplicate result id check", totalResults: results.length, duplicateIds: [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id) };
    });
    const recallAt1Hits = recallAt1.filter(r => r.inTop1).length;
    const recallAt3Hits = recallAt3.filter(r => r.inTop3).length;
    const falseRecallHits = falseRecall.filter(r => r.leakedIds.length > 0).length;
    const crossScopeHits = crossScope.reduce((s, r) => s + r.leakedIds.length, 0);
    const nonActiveLeakIds = new Set(nonActiveLeak.flatMap(r => r.leakedIds)).size;
    const duplicateResultSets = duplicateIds.filter(r => r.duplicateIds.length > 0).length;
    const measured = { recallAt1: ratio(recallAt1Hits, recallAt1.length), recallAt1Hits, recallAt1Total: recallAt1.length, recallAt3: ratio(recallAt3Hits, recallAt3.length), recallAt3Hits, recallAt3Total: recallAt3.length, falseRecallRate: ratio(falseRecallHits, falseRecall.length), falseRecallHits, falseRecallTotal: falseRecall.length, crossScopeHits, nonActiveLeakIds, duplicateResultSets, fixtureMemoryCount: QG_ALL_MEMORIES.length };
    const pass = measured.recallAt1 >= recallThreshold.recallAt1Min && measured.recallAt3 >= recallThreshold.recallAt3Min && measured.crossScopeHits === 0 && measured.nonActiveLeakIds === 0 && measured.duplicateResultSets === 0;
    return {
      meta: reportMeta, fixture,
      baselineMeasurement: { threshold: { type: "baseline", enforced: false, note: "Baseline measurement only; release gate verdict is separate." }, measured, verdict: "MEASURED" },
      releaseGateResult: { threshold: recallThreshold, measured, verdict: pass ? "PASS" : "FAIL" },
      details: { recallAt1, recallAt3, falseRecall, crossScope, nonActiveLeak, duplicateIds },
      scorerConfig: DEFAULT_SCORER_CONFIG,
    };
  } finally { closeDb(); }
}
function buildCompressionReport(reportMeta: any, baseline: any[], gate: any[]) {
  const gateFailed = gate.filter(r => r.verdict === "FAIL").length;
  const gateSkipped = gate.filter(r => r.verdict === "SKIP").length;
  return {
    meta: reportMeta,
    fixture: fixtureInfo("compression-baseline-and-release-gate-v1", [...listFiles(COMP_BASE_DIR), ...listFiles(COMP_GATE_DIR), ...compGateFixtures.map(([, file]) => resolve(COMP_GATE_INPUT_DIR, file))]),
    baselineMeasurement: {
      threshold: { type: "baseline", enforced: false, note: "No baseline threshold is enforced." },
      measured: { averageKeyFactRetention: ratio(baseline.reduce((s, r) => s + r.measured.keyFactRetentionRate, 0), baseline.length), averageTokenSavings: ratio(baseline.reduce((s, r) => s + r.measured.tokenSavingsRatio, 0), baseline.length), fixtureCount: baseline.length },
      verdict: "MEASURED", fixtures: baseline,
    },
    releaseGateResult: {
      threshold: { perFixture: "mustKeep all retained, mustNotInvent absent, token savings >= fixture threshold, original retrieval sha256/length proof passes" },
      measured: { passed: gate.filter(r => r.verdict === "PASS").length, failed: gateFailed, skipped: gateSkipped, total: gate.length },
      verdict: gateFailed === 0 && gateSkipped === 0 ? "PASS" : "FAIL", fixtures: gate,
    },
  };
}

function writeJson(path: string, data: unknown) { writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8"); }

function compressionMd(r: any) {
  const lines = ["# Compression Quality Report", "", `GeneratedAt: ${r.meta.generatedAt}`, `Git commit: ${r.meta.gitCommit}`, `Git dirty: ${r.meta.gitDirty}`, `Fixture version/hash: ${r.fixture.version} / ${r.fixture.hash}`, `Repeatable command: \`${r.meta.command}\``, "", "## Baseline Measurement", "", "Threshold: none enforced (baseline measurement only).", `Measured result: average key fact retention ${pct(r.baselineMeasurement.measured.averageKeyFactRetention)}, average token savings ${pct(r.baselineMeasurement.measured.averageTokenSavings)}.`, `Verdict: ${r.baselineMeasurement.verdict}`, "", "| Fixture | Type | Before | After | Savings | Facts | Retention | Verdict |", "|---|---|---:|---:|---:|---:|---:|---|"];
  for (const f of r.baselineMeasurement.fixtures) lines.push(`| ${f.fixture} | ${f.contentType} | ${f.measured.tokensBefore} | ${f.measured.tokensAfter} | ${pct(f.measured.tokenSavingsRatio)} | ${f.measured.factsRetained}/${f.measured.factsTotal} | ${pct(f.measured.keyFactRetentionRate)} | ${f.verdict} |`);
  lines.push("", "## Release Gate Result", "", `Threshold: ${r.releaseGateResult.threshold.perFixture}.`, `Measured result: ${r.releaseGateResult.measured.passed}/${r.releaseGateResult.measured.total} passed, ${r.releaseGateResult.measured.failed} failed, ${r.releaseGateResult.measured.skipped} skipped.`, `Verdict: ${r.releaseGateResult.verdict}`, "", "| Fixture | Type | Threshold Savings | Measured Savings | Missing Facts | Invented | Retrieval | Verdict |", "|---|---|---:|---:|---:|---:|---|---|");
  for (const f of r.releaseGateResult.fixtures) lines.push(`| ${f.fixture} | ${f.contentType} | ${pct(f.threshold.minTokenSavingsRatio)} | ${pct(f.measured.tokenSavingsRatio)} | ${f.measured.missingMustKeep.length} | ${f.measured.invented.length} | ${f.measured.retrievalProof.ok ? "PASS" : "FAIL"} | ${f.verdict} |`);
  lines.push("", "This report separates current baseline measurements from the release gate. Baseline values are not release results.");
  return `${lines.join("\n")}\n`;
}

function recallMd(r: any) {
  const m = r.releaseGateResult.measured;
  const lines = ["# Recall Quality Report", "", `GeneratedAt: ${r.meta.generatedAt}`, `Git commit: ${r.meta.gitCommit}`, `Git dirty: ${r.meta.gitDirty}`, `Fixture version/hash: ${r.fixture.version} / ${r.fixture.hash}`, `Repeatable command: \`${r.meta.command}\``, "", "## Baseline Measurement", "", "Threshold: none enforced (baseline measurement only).", `Measured result: Recall@1 ${pct(m.recallAt1)} (${m.recallAt1Hits}/${m.recallAt1Total}), Recall@3 ${pct(m.recallAt3)} (${m.recallAt3Hits}/${m.recallAt3Total}), false recall ${pct(m.falseRecallRate)} (${m.falseRecallHits}/${m.falseRecallTotal}), cross-scope hits ${m.crossScopeHits}, non-active leaked IDs ${m.nonActiveLeakIds}, duplicate result sets ${m.duplicateResultSets}.`, `Verdict: ${r.baselineMeasurement.verdict}`, "", "## Release Gate Result", "", `Threshold: Recall@1 >= ${pct(r.releaseGateResult.threshold.recallAt1Min)}, Recall@3 >= ${pct(r.releaseGateResult.threshold.recallAt3Min)}, cross-scope hits = 0, non-active leaked IDs = 0, duplicate result sets = 0. False recall is informational.`, `Measured result: Recall@1 ${pct(m.recallAt1)}, Recall@3 ${pct(m.recallAt3)}, cross-scope hits ${m.crossScopeHits}, non-active leaked IDs ${m.nonActiveLeakIds}, duplicate result sets ${m.duplicateResultSets}.`, `Verdict: ${r.releaseGateResult.verdict}`, "", "## Recall@1 Details", "", "| Query | Target | Rank | In Top 1 | Total Results |", "|---|---|---:|---|---:|"];
  for (const d of r.details.recallAt1) lines.push(`| ${d.query} | ${d.targetContent} | ${d.rankFound} | ${d.inTop1 ? "yes" : "no"} | ${d.totalResults} |`);
  lines.push("", "## Recall@3 Details", "", "| Query | Target | Rank | In Top 3 | Total Results |", "|---|---|---:|---|---:|");
  for (const d of r.details.recallAt3) lines.push(`| ${d.query} | ${d.targetContent} | ${d.rankFound} | ${d.inTop3 ? "yes" : "no"} | ${d.totalResults} |`);
  lines.push("", "This report separates current baseline measurements from the release gate. Baseline values are not release results.");
  return `${lines.join("\n")}\n`;
}

function contextMd(r: any) {
  const c = r.compression, mem = r.recall;
  const lines = ["# CodeContext Context Quality Report", "", `GeneratedAt: ${r.meta.generatedAt}`, `Git commit: ${r.meta.gitCommit}`, `Git dirty: ${r.meta.gitDirty}`, `Repeatable command: \`${r.meta.command}\``, "", "## Fixture Versions", "", `- Compression: ${c.fixture.version} / ${c.fixture.hash}`, `- Recall: ${mem.fixture.version} / ${mem.fixture.hash}`, "", "## Baseline Measurement", "", "Threshold: none enforced; baseline measurements are current observations only.", `Measured result: compression retention ${pct(c.baselineMeasurement.measured.averageKeyFactRetention)}, compression savings ${pct(c.baselineMeasurement.measured.averageTokenSavings)}, recall@1 ${pct(mem.baselineMeasurement.measured.recallAt1)}, recall@3 ${pct(mem.baselineMeasurement.measured.recallAt3)}.`, "Verdict: MEASURED", "", "## Release Gate Result", "", "Threshold: compression per-fixture gate and recall gate thresholds from the child reports.", `Measured result: compression ${c.releaseGateResult.measured.passed}/${c.releaseGateResult.measured.total} passed; recall@1 ${pct(mem.releaseGateResult.measured.recallAt1)}, recall@3 ${pct(mem.releaseGateResult.measured.recallAt3)}, cross-scope hits ${mem.releaseGateResult.measured.crossScopeHits}, non-active leaked IDs ${mem.releaseGateResult.measured.nonActiveLeakIds}.`, `Verdict: ${r.releaseGateResult.verdict}`, "", "See `reports/quality/compression-quality.md` and `reports/quality/recall-quality.md` for detailed measured results."];
  return `${lines.join("\n")}\n`;
}

export async function generateQualityReports() {
  ensureDir(REPORTS); ensureDir(ARTIFACTS);
  const reportMeta = meta(new Date().toISOString());
  const compressionReport = buildCompressionReport(reportMeta, await runCompressionBaseline(), await runCompressionGate());
  const recallReport = await runRecallReport(reportMeta, fixtureInfo("recall-quality-gate-v1", [RECALL_FIXTURE]));
  const contextReport = {
    meta: reportMeta,
    baselineMeasurement: { threshold: { type: "baseline", enforced: false, note: "No context-level baseline threshold is enforced." }, measured: { compressionAverageKeyFactRetention: compressionReport.baselineMeasurement.measured.averageKeyFactRetention, compressionAverageTokenSavings: compressionReport.baselineMeasurement.measured.averageTokenSavings, recallAt1: recallReport.baselineMeasurement.measured.recallAt1, recallAt3: recallReport.baselineMeasurement.measured.recallAt3 }, verdict: "MEASURED" },
    releaseGateResult: { threshold: { compression: compressionReport.releaseGateResult.threshold, recall: recallReport.releaseGateResult.threshold }, measured: { compression: compressionReport.releaseGateResult.measured, recall: recallReport.releaseGateResult.measured }, verdict: compressionReport.releaseGateResult.verdict === "PASS" && recallReport.releaseGateResult.verdict === "PASS" ? "PASS" : "FAIL" },
    compression: compressionReport,
    recall: recallReport,
  };
  writeJson(resolve(REPORTS, "compression-quality.json"), compressionReport);
  writeFileSync(resolve(REPORTS, "compression-quality.md"), compressionMd(compressionReport), "utf-8");
  writeJson(resolve(REPORTS, "recall-quality.json"), recallReport);
  const recallMarkdown = recallMd(recallReport);
  writeFileSync(resolve(REPORTS, "recall-quality.md"), recallMarkdown, "utf-8");
  writeFileSync(resolve(ARTIFACTS, "recall-quality-gate-report.md"), recallMarkdown, "utf-8");
  writeJson(resolve(REPORTS, "context-quality.json"), contextReport);
  writeFileSync(resolve(REPORTS, "context-quality.md"), contextMd(contextReport), "utf-8");
  return contextReport;
}
