#!/usr/bin/env node

/**
 * P0 real-world reliability gate.
 *
 * Each contract is executed independently so the JSON and Markdown reports
 * identify the exact release blocker instead of collapsing failures into one
 * broad test-suite result.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORTS_DIR = join(ROOT, "reports", "release");
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");
const startedAt = performance.now();

const contracts = [
  {
    id: "RWR-P0-001",
    title: "Maven BUILD FAILURE must not be reported as PASSED",
    file: "tests/testOutputMaven.test.ts",
    test: "never reports PASSED when a multi-module summary contains BUILD FAILURE",
  },
  {
    id: "RWR-P0-002",
    title: "Consecutive full-flow runs must not hit UNIQUE constraints",
    file: "tests/phase11-runContextFlow.test.ts",
    test: "runs full flow twice without UNIQUE constraint warnings",
  },
  {
    id: "RWR-P0-003",
    title: "Flow output must not contain ccr:undefined",
    file: "tests/phase11-runContextFlow.test.ts",
    test: "skips CCR-dependent memory when CCR persistence fails",
  },
  {
    id: "RWR-P0-004",
    title: "A failed child step must make the top-level status partial or failed",
    file: "tests/phase11-runContextFlow.test.ts",
    test: "skips CCR-dependent memory when CCR persistence fails",
  },
  {
    id: "RWR-P0-005",
    title: "Unverified summaries must not be written to memory automatically",
    file: "tests/phase11-runContextFlow.test.ts",
    test: "skips auto-memory when verificationStatus is UNKNOWN",
  },
  {
    id: "RWR-P0-006",
    title: "Markdown compression must preserve the unique rollback strategy",
    file: "tests/strategy.test.ts",
    test: "keeps a tail rollback strategy after many repeated components",
  },
  {
    id: "RWR-P0-007",
    title: "Chinese queries must recall English technical memory",
    file: "tests/queryExpansion.test.ts",
    test: "recalls the timeout scenario and returns match metadata",
  },
  {
    id: "RWR-P0-008",
    title: "hard_delete response must match database state",
    file: "tests/phase8-forgetContext.test.ts",
    test: "permanently removes the memory record",
  },
];

function tail(text, limit = 3000) {
  const normalized = String(text || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim();
  return normalized.length <= limit ? normalized : normalized.slice(-limit);
}

function runContract(contract) {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [VITEST, "run", contract.file, "-t", contract.test, "--reporter=dot"],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0" },
    },
  );
  const output = tail(`${result.stdout || ""}\n${result.stderr || ""}`);
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  const timedOut = result.error?.code === "ETIMEDOUT";
  return {
    ...contract,
    severity: "P0",
    status: exitCode === 0 && !result.error ? "PASS" : "FAIL",
    exitCode,
    durationMs: Math.round(performance.now() - started),
    command: `vitest run ${contract.file} -t ${JSON.stringify(contract.test)}`,
    ...(timedOut ? { error: "Timed out after 120 seconds" } : {}),
    ...(exitCode !== 0 || result.error ? { output } : {}),
  };
}

mkdirSync(REPORTS_DIR, { recursive: true });
const checks = contracts.map(runContract);
const failed = checks.filter((check) => check.status === "FAIL");
const generatedAt = new Date().toISOString();
const report = {
  gate: "Real-World Reliability Gate",
  schemaVersion: 1,
  generatedAt,
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  severity: "P0",
  summary: {
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    totalDurationMs: Math.round(performance.now() - startedAt),
  },
  checks,
  blockingFailures: failed.map(({ id, title, output, error }) => ({
    id,
    title,
    detail: error || output || "Reliability contract failed",
  })),
  releasePolicy: "Any P0 failure blocks the Stable Release Gate.",
};

const jsonPath = join(REPORTS_DIR, "real-world-reliability.json");
const markdownPath = join(REPORTS_DIR, "real-world-reliability.md");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const lines = [
  "# Real-World Reliability Gate",
  "",
  `**Verdict**: ${report.verdict}`,
  `**Severity**: P0`,
  `**Generated**: ${generatedAt}`,
  "",
  "Any failed P0 contract blocks the Stable Release Gate.",
  "",
  "| ID | P0 contract | Status | Duration |",
  "|---|---|---:|---:|",
  ...checks.map((check) =>
    `| ${check.id} | ${check.title.replace(/\|/g, "\\|")} | ${check.status} | ${check.durationMs} ms |`),
  "",
  `Summary: ${report.summary.passed}/${report.summary.total} passed; ${report.summary.failed} failed.`,
  "",
];
if (failed.length > 0) {
  lines.push("## Blocking failures", "");
  for (const check of failed) {
    lines.push(`### ${check.id}: ${check.title}`, "", "```text", check.error || check.output || "No diagnostic output", "```", "");
  }
}
writeFileSync(markdownPath, `${lines.join("\n")}\n`, "utf8");

console.log(`${report.verdict}: ${checks.length - failed.length}/${checks.length} P0 contracts passed`);
console.log("Report: reports/release/real-world-reliability.json");
console.log("Report: reports/release/real-world-reliability.md");
process.exitCode = report.verdict === "PASS" ? 0 : 1;
