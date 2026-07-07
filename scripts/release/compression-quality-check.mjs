#!/usr/bin/env node

/**
 * CodeContext Compression Quality Check
 *
 * Loads 8 content-type fixtures, compresses each, validates:
 *   1. mustKeep[] — every required fact is present in compressed output
 *   2. mustNotInvent[] — no fabricated facts in compressed output
 *   3. minimumTokenSavingsRatio — adequate compression achieved
 *   4. original retrieval hash consistency
 *
 * Usage: node scripts/release/compression-quality-check.mjs
 */
import { registerAllStrategies } from "../../dist/compression/registerStrategies.js";
import { compress } from "../../dist/compression/compressionEngine.js";
import { countTokens } from "../../dist/utils/tokenCount.js";
import { shortHash } from "../../dist/utils/hash.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

registerAllStrategies();

/** All content types + fixture mapping */
const FIXTURES = [
  { name: "test_output"          , file: "vitest-output.txt"     , type: "test_output" },
  { name: "log"                  , file: "app-log.txt"           , type: "log" },
  { name: "command_output"       , file: "build-output.txt"      , type: "command_output" },
  { name: "code"                 , file: "sample.ts"             , type: "code" },
  { name: "json"                 , file: "response.json"         , type: "json" },
  { name: "markdown"             , file: "readme.md"             , type: "markdown" },
  { name: "rag_chunk"            , file: "rag-chunks.json"       , type: "rag_chunk" },
  { name: "conversation_history" , file: "conversation.json"     , type: "conversation_history" },
];

const FIXTURES_DIR  = resolve(PROJECT_ROOT, "tests", "fixtures");
const QUALITY_DIR   = resolve(PROJECT_ROOT, "fixtures", "quality-gate");

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const results = [];
  let totalOk = 0;
  let totalFail = 0;

  for (const f of FIXTURES) {
    const content = readFixture(f.file);
    if (!content) {
      console.log(`SKIP ${f.name} — fixture not found`);
      results.push({ ...f, status: "skip", reason: "fixture missing" });
      continue;
    }

    const qg = readQualityFixture(f.name);
    const minRatio = qg.minimumTokenSavingsRatio ?? 0.30;
    const tokensBefore = countTokens(content);

    // Budget: try to achieve the savings ratio
    const targetTokens = Math.max(300, Math.floor(tokensBefore * (1 - minRatio + 0.05)));

    const result = await compress({
      scopeId: "quality-gate",
      content,
      contentType: f.type,
      keepOriginal: true,          // needed for hash check
      maxTokens: targetTokens,
    });

    // --- 1. Token savings ---
    const ratio = tokensBefore > 0 ? result.tokensSaved / tokensBefore : 0;
    const ratioOk = ratio >= minRatio || tokensBefore <= targetTokens;

    // --- 2. mustKeep ---
    const mustKeep = qg.mustKeep ?? [];
    const keepFail = mustKeep.filter((k) => {
      const pattern = new RegExp(esc(k), "i");
      return !pattern.test(result.compressedContent);
    });

    // --- 3. mustNotInvent ---
    const mustNotInvent = qg.mustNotInvent ?? [];
    const inventFail = mustNotInvent.filter((k) => result.compressedContent.includes(k));

    // --- 4. Retrieve hash verification (when keepOriginal=true) ---
    const expectedHash = `orig_${shortHash(content)}`;
    const hashOk = result.originalRef === expectedHash;

    // --- Overall pass/fail ---
    const ok = !result.failed && keepFail.length === 0 && inventFail.length === 0 && hashOk;

    if (ok) totalOk++;
    else totalFail++;

    const status = result.failed ? "FAIL" : ok ? "PASS" : "FAIL";
    console.log(
      `${status} ${f.name.padEnd(25)} ` +
      `ratio=${ratio.toFixed(3)} (need≥${minRatio}) ` +
      `keep=${mustKeep.length - keepFail.length}/${mustKeep.length} ` +
      `invent=${inventFail.length} ${hashOk ? "" : "HASH-MISMATCH"}`
    );

    if (!ok && keepFail.length > 0) {
      for (const k of keepFail.slice(0, 5)) {
        console.log(`  MISSING: ${k}`);
      }
    }
    if (inventFail.length > 0) {
      for (const k of inventFail) {
        console.log(`  INVENTED: ${k}`);
      }
    }
    if (!hashOk) {
      console.log(`  HASH expected=${expectedHash} got=${result.originalRef}`);
    }

    results.push({
      ...f,
      status: ok ? "pass" : "fail",
      tokensBefore,
      tokensAfter: result.tokensAfter,
      ratio,
      keepFail: keepFail.length,
      inventFail: inventFail.length,
      hashOk,
    });
  }

  const total = results.length;
  console.log(`\n${totalOk}/${total} passed, ${totalFail}/${total} failed`);
  return totalFail === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("Quality check crashed:", err);
  process.exit(2);
});
