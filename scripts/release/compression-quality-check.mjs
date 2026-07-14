#!/usr/bin/env node

/**
 * CodeContext Compression Quality Check
 *
 * Loads 8 content-type fixtures, compresses each, validates:
 *   1. mustKeep[] - every required fact is present in compressed output
 *   2. mustNotInvent[] - no fabricated facts in compressed output
 *   3. minimumTokenSavingsRatio - adequate compression achieved
 *   4. OriginalStore retrieval proof - full length + SHA-256 match
 *
 * Usage: node scripts/release/compression-quality-check.mjs
 */
import { registerAllStrategies } from "../../dist/compression/registerStrategies.js";
import { compress } from "../../dist/compression/compressionEngine.js";
import { CompressedStore } from "../../dist/compressed/compressedStore.js";
import { OriginalStore } from "../../dist/originals/originalStore.js";
import { initAndMigrate } from "../../dist/storage/migrations.js";
import { closeDb, runStmt } from "../../dist/storage/db.js";
import { countTokens } from "../../dist/utils/tokenCount.js";
import { fullHash } from "../../dist/utils/hash.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const SCOPE_ID = "quality-gate";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

registerAllStrategies();

/** All content types + fixture mapping */
const FIXTURES = [
  { name: "test_output", file: "vitest-output.txt", type: "test_output" },
  { name: "log", file: "app-log.txt", type: "log" },
  { name: "command_output", file: "build-output.txt", type: "command_output" },
  { name: "code", file: "sample.ts", type: "code" },
  { name: "json", file: "response.json", type: "json" },
  { name: "markdown", file: "readme.md", type: "markdown" },
  { name: "rag_chunk", file: "rag-chunks.json", type: "rag_chunk" },
  { name: "conversation_history", file: "conversation.json", type: "conversation_history" },
];

const DEFAULT_MIN_TOKEN_SAVINGS_BY_TYPE = {
  test_output: 0.30,
  log: 0.10,
  command_output: 0.00,
  code: 0.45,
  json: 0.10,
  markdown: 0.40,
  rag_chunk: 0.35,
  conversation_history: 0.50,
};

const FIXTURES_DIR = resolve(PROJECT_ROOT, "tests", "fixtures");
const QUALITY_DIR = resolve(PROJECT_ROOT, "fixtures", "quality-gate");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFixture(file) {
  const p = resolve(FIXTURES_DIR, file);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf-8");
}

function readQualityFixture(name) {
  const p = resolve(QUALITY_DIR, `${name}.json`);
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf-8"));
}

/** Escape regex special characters */
function esc(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureScope(db) {
  const now = new Date().toISOString();
  runStmt(
    db,
    `INSERT OR IGNORE INTO scopes
       (scope_id, cwd, scope_strategy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [SCOPE_ID, PROJECT_ROOT, "cwdFallback", now, now],
  );
}

function statusLabel(ok) {
  return ok ? "PASS" : "FAIL";
}

function formatRatio(value) {
  return value.toFixed(3);
}

function persistAndVerifyOriginal({
  compressedStore,
  originalStore,
  result,
  fixture,
  content,
}) {
  const expectedSha256 = fullHash(content);

  if (!result.originalRef) {
    return {
      ok: false,
      originalRef: undefined,
      lengthOk: false,
      sha256Ok: false,
      expectedLength: content.length,
      actualLength: 0,
      expectedSha256,
      actualSha256: undefined,
      reason: "missing originalRef",
    };
  }

  const ccr = compressedStore.save({
    scopeId: SCOPE_ID,
    contentType: fixture.type,
    strategy: result.strategy,
    compressedContent: result.compressedContent,
    summary: result.summary,
    originalRef: result.originalRef,
    tokensBefore: result.tokensBefore,
    tokensAfter: result.tokensAfter,
    tokensSaved: result.tokensSaved,
    compressionRatio: result.compressionRatio,
    canRetrieveOriginal: true,
    failed: Boolean(result.failed),
    errorReason: result.errorReason,
    contentHash: expectedSha256,
    strategyVersion: result.strategyVersion,
  });

  originalStore.save({
    id: result.originalRef,
    scopeId: SCOPE_ID,
    ccrId: ccr.id,
    contentType: fixture.type,
    content,
  });

  const retrieved = originalStore.retrieve(result.originalRef, SCOPE_ID);
  const actualContent = retrieved?.content ?? "";
  const actualSha256 = retrieved ? fullHash(actualContent) : undefined;
  const lengthOk =
    Boolean(retrieved) &&
    retrieved.totalChars === content.length &&
    retrieved.returnedChars === content.length &&
    actualContent.length === content.length &&
    retrieved.hasMore === false;
  const sha256Ok = actualSha256 === expectedSha256;

  return {
    ok: lengthOk && sha256Ok,
    originalRef: result.originalRef,
    lengthOk,
    sha256Ok,
    expectedLength: content.length,
    actualLength: actualContent.length,
    expectedSha256,
    actualSha256,
    reason: retrieved ? undefined : "retrieve returned null",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const db = await initAndMigrate(":memory:");
  ensureScope(db);
  const compressedStore = new CompressedStore(db);
  const originalStore = new OriginalStore(db);

  const results = [];
  let totalOk = 0;
  let totalFail = 0;

  for (const f of FIXTURES) {
    const content = readFixture(f.file);
    if (!content) {
      console.log(`SKIP ${f.name} - fixture not found`);
      results.push({ ...f, status: "skip", reason: "fixture missing" });
      continue;
    }

    const qg = readQualityFixture(f.name);
    const minRatio =
      qg.minimumTokenSavingsRatio ??
      DEFAULT_MIN_TOKEN_SAVINGS_BY_TYPE[f.type] ??
      0;
    const tokensBefore = countTokens(content);

    // Budget: try to achieve this fixture's content-type-specific ratio.
    const targetTokens = Math.max(
      300,
      Math.floor(tokensBefore * (1 - minRatio)),
    );

    const result = await compress({
      scopeId: SCOPE_ID,
      content,
      contentType: f.type,
      keepOriginal: true,
      maxTokens: targetTokens,
    });

    // --- 1. Token savings ---
    const ratio = tokensBefore > 0 ? result.tokensSaved / tokensBefore : 0;
    const ratioOk = ratio >= minRatio;

    // --- 2. mustKeep ---
    const mustKeep = qg.mustKeep ?? [];
    const keepFail = mustKeep.filter((k) => {
      const pattern = new RegExp(esc(k), "i");
      return !pattern.test(result.compressedContent);
    });

    // --- 3. mustNotInvent ---
    const mustNotInvent = qg.mustNotInvent ?? [];
    const inventFail = mustNotInvent.filter((k) =>
      result.compressedContent.includes(k),
    );

    // --- 4. OriginalStore closed-loop retrieval proof ---
    const retrievalProof = persistAndVerifyOriginal({
      compressedStore,
      originalStore,
      result,
      fixture: f,
      content,
    });

    const keyFactsOk = keepFail.length === 0;
    const noInventionOk = inventFail.length === 0;
    const engineOk = !result.failed;
    const ok =
      engineOk &&
      keyFactsOk &&
      noInventionOk &&
      ratioOk &&
      retrievalProof.ok;

    if (ok) totalOk++;
    else totalFail++;

    const status = ok ? "PASS" : "FAIL";
    console.log(`${status} ${f.name}`);
    console.log(
      `  key facts:       ${statusLabel(keyFactsOk)} ` +
        `${mustKeep.length - keepFail.length}/${mustKeep.length}`,
    );
    console.log(
      `  no invention:    ${statusLabel(noInventionOk)} ` +
        `${inventFail.length} invented`,
    );
    console.log(
      `  token savings:   ${statusLabel(ratioOk)} ` +
        `ratio=${formatRatio(ratio)} need>=${formatRatio(minRatio)} ` +
        `(${result.tokensSaved}/${tokensBefore} tokens)`,
    );
    console.log(
      `  retrieval proof: ${statusLabel(retrievalProof.ok)} ` +
        `length=${retrievalProof.actualLength}/${retrievalProof.expectedLength} ` +
        `sha256=${statusLabel(retrievalProof.sha256Ok)}`,
    );
    if (!engineOk) {
      console.log(
        `  compression:     FAIL ${result.errorReason ?? "unknown error"}`,
      );
    }

    if (keepFail.length > 0) {
      for (const k of keepFail.slice(0, 5)) {
        console.log(`  MISSING: ${k}`);
      }
    }
    if (inventFail.length > 0) {
      for (const k of inventFail) {
        console.log(`  INVENTED: ${k}`);
      }
    }
    if (!ratioOk) {
      console.log(
        `  TOKEN-SAVINGS-MISMATCH expected>=${formatRatio(minRatio)} ` +
          `got=${formatRatio(ratio)}`,
      );
    }
    if (!retrievalProof.ok) {
      if (retrievalProof.reason) {
        console.log(`  RETRIEVAL: ${retrievalProof.reason}`);
      }
      console.log(`  RETRIEVAL-REF: ${retrievalProof.originalRef ?? "<none>"}`);
      console.log(
        `  RETRIEVAL-SHA256 expected=${retrievalProof.expectedSha256} ` +
          `got=${retrievalProof.actualSha256 ?? "<none>"}`,
      );
    }

    results.push({
      ...f,
      status: ok ? "pass" : "fail",
      tokensBefore,
      tokensAfter: result.tokensAfter,
      ratio,
      keyFactsOk,
      noInventionOk,
      ratioOk,
      retrievalProofOk: retrievalProof.ok,
    });
  }

  const total = results.length;
  console.log(`\n${totalOk}/${total} passed, ${totalFail}/${total} failed`);
  closeDb();
  return totalFail === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    closeDb();
    console.error("Quality check crashed:", err);
    process.exit(2);
  });
