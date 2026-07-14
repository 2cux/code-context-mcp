#!/usr/bin/env node

/**
 * CodeContext Stable Release Gate
 *
 * Meta-gate that orchestrates all release-quality checks and produces
 * a single verdict: pass (all MUST checks pass) or fail (any MUST check fails).
 *
 * Checks (11 categories):
 *   1. Source reproducibility          [MUST]  clean tracked-source build + quality tests
 *   2. TypeScript                      [MUST]  tsc --noEmit
 *   3. Vitest                          [MUST]  vitest run (all test files)
 *   4. Compression Quality Gate        [MUST]  compression-quality-check.mjs
 *   5. Memory Recall Quality Gate      [MUST]  focused recall quality test
 *   6. Fingerprint migration tests     [MUST]  memoryFingerprintMigration.test.ts
 *   7. Fast Path Boundary Gate         [MUST]  fast-path-boundary-check.mjs
 *   8. Agent tools and dangerous tools [MUST]  verify the source tool surface
 *   9. Fresh npm install smoke          [MUST]  clean pack/install/CLI/MCP smoke
 *  10. demo / value / doctor            [MUST]  run all three CLI commands
 *  11. Version and documentation       [MUST]  cross-reference release metadata
 *
 * Non-critical performance fluctuations produce WARNINGs but do NOT fail the gate.
 * Warnings must never mask a Direct MCP regression.
 *
 * Usage:
 *   node scripts/release/stable-readiness-check.mjs
 *
 * Outputs:
 *   reports/release/stable-readiness.json
 *   reports/release/stable-readiness.md
 *
 * Exit code: 0 = pass/warning, 1 = fail
 *
 * Does NOT execute npm publish or create git tags.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const REPORTS_DIR = path.join(ROOT, "reports", "release");
const SRC = path.join(ROOT, "src");

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** @typedef {{ check: string, status: "pass"|"warning"|"fail", detail: string, category: string, severity: "must"|"should", durationMs: number }} CheckResult */

/** @type {CheckResult[]} */
const checks = [];
/** @type {Array<{command: string, exitCode: number, ok: boolean, output: string}>} */
const commandOutputs = [];

/** @type {Array<{file: string, testName: string, assertion: string, error: string}>} */
let vitestFailures = [];

/**
 * @param {string} check
 * @param {string} detail
 * @param {string} category
 * @param {"must"|"should"} severity
 */
function pass(check, detail = "", category = "", severity = "must") {
  checks.push({ check, status: "pass", detail, category, severity, durationMs: 0 });
}
function warn(check, detail = "", category = "", severity = "should") {
  checks.push({ check, status: "warning", detail, category, severity, durationMs: 0 });
}
function fail(check, detail = "", category = "", severity = "must") {
  checks.push({ check, status: "fail", detail, category, severity, durationMs: 0 });
}

function finalVerdict() {
  const mustFail = checks.some((c) => c.severity === "must" && c.status === "fail");
  if (mustFail) return "FAIL";
  const hasWarning = checks.some((c) => c.status === "warning");
  if (hasWarning) return "WARNING";
  return "PASS";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
}
function readJson(relativePath) {
  return JSON.parse(readFile(relativePath));
}
function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function isolatedHomeEnv(prefix) {
  const home = fs.mkdtempSync(path.join(tmpdir(), prefix));
  const appData = path.join(home, "AppData", "Roaming");
  const localAppData = path.join(home, "AppData", "Local");
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(localAppData, { recursive: true });
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    MCP_TOOL_MODE: "agent",
  };
}

function summarizeOutput(stdout = "", stderr = "") {
  const text = `${stdout}\n${stderr}`.replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "").trim();
  if (text.length <= 1200) return text;
  return `${text.slice(0, 600)}\n… [output truncated] …\n${text.slice(-600)}`;
}

function recordCommand(command, result) {
  commandOutputs.push({
    command,
    exitCode: result.exitCode ?? result.code ?? (result.ok ? 0 : 1),
    ok: Boolean(result.ok),
    output: summarizeOutput(result.stdout, result.stderr || result.error || ""),
  });
}

/**
 * Run a command, return { ok, stdout, stderr, exitCode }.
 * @param {string} cmd
 * @param {{ cwd?: string, timeout?: number, env?: Record<string,string> }} [opts]
 */
function run(cmd, opts = {}) {
  const cwd = opts.cwd || ROOT;
  const timeout = opts.timeout || 120000;
  try {
    const out = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
    const result = { ok: true, stdout: out, stderr: "", exitCode: 0 };
    recordCommand(cmd, result);
    return result;
  } catch (err) {
    const result = {
      ok: false,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status || 1,
      error: err.message,
    };
    recordCommand(cmd, result);
    return result;
  }
}

/**
 * Spawn a Node.js script and wait for completion.
 * @param {string} scriptPath - relative to ROOT
 * @param {string[]} [args]
 * @param {{ env?: Record<string,string>, timeout?: number }} [opts]
 */
function runNodeScript(scriptPath, args = [], opts = {}) {
  const absPath = path.join(ROOT, scriptPath);
  const timeout = opts.timeout || 120000;
  try {
    const out = execSync(`node "${absPath}" ${args.join(" ")}`, {
      cwd: ROOT,
      encoding: "utf-8",
      timeout,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
    const result = { ok: true, stdout: out, stderr: "", exitCode: 0 };
    recordCommand(`node ${scriptPath} ${args.join(" ")}`.trim(), result);
    return result;
  } catch (err) {
    const result = {
      ok: false,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status || 1,
      error: err.message,
    };
    recordCommand(`node ${scriptPath} ${args.join(" ")}`.trim(), result);
    return result;
  }
}

/**
 * Spawn a process and collect stdout. Returns promise.
 */
function spawnAndCollect(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      timeout: opts.timeout || 30000,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      recordCommand([cmd, ...(args || [])].join(" "), { ok: code === 0, code, stdout, stderr });
      resolve({ ok: code === 0, code, stdout, stderr });
    });

    child.on("error", (err) => {
      recordCommand([cmd, ...(args || [])].join(" "), { ok: false, code: -1, stdout, stderr, error: err.message });
      resolve({ ok: false, code: -1, stdout, stderr, error: err.message });
    });
  });
}

/**
 * Extract the LAST complete JSON object from text.
 * Vitest --reporter=json outputs NDJSON (one JSON per line) — the last line
 * is the summary object we need. For single-object output, finds the first
 * complete JSON object.
 */
function extractLastJson(text) {
  // Split by lines and try each line from the end (NDJSON format)
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{")) {
      try {
        return JSON.parse(line);
      } catch {
        // Fall through to full-text extraction
        break;
      }
    }
  }

  // Fallback: find the outermost single JSON object in the full text
  return extractFirstJson(text);
}

/** Extract the first complete JSON object from text. */
function extractFirstJson(text) {
  const firstBrace = text.indexOf("{");
  if (firstBrace < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(firstBrace, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Extract JSON from text — tries last-line NDJSON first, then full text. */
function extractJson(text) {
  return extractLastJson(text);
}

function collectVitestFailures(json) {
  if (!json?.testResults) return;
  for (const tr of json.testResults) {
    for (const ar of tr.assertionResults || []) {
      if (ar.status === "failed") {
        vitestFailures.push({
          file: tr.name || "unknown",
          testName: ar.fullName || [...(ar.ancestorTitles || []), ar.title].join(" > "),
          assertion: ar.title || "",
          error: (ar.failureMessages || []).join("\n").slice(0, 1000),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Timing wrapper
// ---------------------------------------------------------------------------

/**
 * Run a check function with timing.
 * @param {string} checkName
 * @param {string} category
 * @param {"must"|"should"} severity
 * @param {() => Promise<void>} fn
 */
async function timed(checkName, category, severity, fn) {
  const t0 = performance.now();
  try {
    await fn();
  } catch (err) {
    fail(checkName, err.message, category, severity);
  }
  // Update the last check's duration
  const last = checks[checks.length - 1];
  if (last && last.check === checkName) {
    last.durationMs = Math.round(performance.now() - t0);
  }
}

// ---------------------------------------------------------------------------
// Check 1: Source reproducibility
// ---------------------------------------------------------------------------

async function checkSourceReproducibility() {
  const checkName = "1. Source reproducibility";
  const category = "reproducibility";
  const severity = "must";

  await timed(checkName, category, severity, async () => {
    const scriptPath = "scripts/release/source-reproducibility.mjs";
    if (!fileExists(scriptPath)) {
      fail(checkName, `Script not found: ${scriptPath}`, category, severity);
      return;
    }
    const r = runNodeScript(scriptPath, [], { timeout: 600000 });
    if (r.exitCode === 0) {
      pass(checkName, "clean tracked-source build and quality tests passed", category, severity);
    } else {
      fail(checkName, `source reproducibility failed (exit ${r.exitCode})`, category, severity);
    }
  });
}

// ---------------------------------------------------------------------------
// Check 2: TypeScript zero errors
// ---------------------------------------------------------------------------

async function checkTypeScript() {
  const checkName = "2. TypeScript zero errors";
  const category = "build";
  const severity = "must";

  await timed(checkName, category, severity, async () => {
    const r = run("npx tsc --noEmit", { timeout: 120000 });
    if (r.ok) {
      pass(checkName, "tsc --noEmit returned zero errors", category, severity);
    } else {
      const errLines = (r.stdout + r.stderr).split("\n").filter((l) => l.includes("error TS")).slice(0, 5).join("; ");
      fail(checkName, `TypeScript errors found: ${errLines || r.error || "unknown"}`, category, severity);
    }
  });
}

// ---------------------------------------------------------------------------
// Check 3: Vitest zero failures (all test files)
// ---------------------------------------------------------------------------

async function checkVitest() {
  const checkName = "3. Vitest zero failures";
  const category = "tests";
  const severity = "must";

  await timed(checkName, category, severity, async () => {
    const r = run("npx vitest run --reporter=json 2>&1", {
      timeout: 300000,
      env: isolatedHomeEnv("cc-stable-vitest-"),
    });

    // vitest writes JSON to stdout
    const json = extractJson(r.stdout);
    if (json) {
      const failed = json.numFailedTests || 0;
      const passed = json.numPassedTests || 0;
      const total = json.numTotalTests || 0;
      // numTotalTestSuites counts describe blocks; count unique test file names instead
      const testFiles = json.testResults ? new Set(json.testResults.map((tr) => tr.name)).size : (json.numTotalTestSuites || 0);

      // Extract failure details for the report
      vitestFailures = [];
      if (json.testResults) {
        for (const tr of json.testResults) {
          if (tr.status === "failed" || (tr.assertionResults || []).some((a) => a.status === "failed")) {
            for (const ar of tr.assertionResults || []) {
              if (ar.status === "failed") {
                vitestFailures.push({
                  file: tr.name,
                  testName: ar.fullName || (ar.ancestorTitles || []).concat(ar.title).join(" > "),
                  assertion: ar.title || "",
                  error: (ar.failureMessages || []).join("\n").slice(0, 500),
                });
              }
            }
          }
        }
      }

      if (failed === 0) {
        pass(checkName, `${passed} tests passed, ${testFiles} test files, 0 failures`, category, severity);
      } else {
        const detail = `${failed} failures out of ${total} tests, ${testFiles} test files`;
        fail(checkName, detail, category, severity);
      }
    } else if (r.exitCode === 0) {
      // Fallback: check text output
      if ((r.stdout + r.stderr).includes("Tests") && !(r.stdout + r.stderr).includes("FAIL")) {
        pass(checkName, "All tests passed (text mode detection)", category, severity);
      } else {
        warn(checkName, "Could not parse vitest JSON output, but exit code was 0 — check manually", category, severity);
      }
    } else {
      fail(checkName, `Vitest exited with code ${r.exitCode}: ${(r.stderr + r.stdout).slice(0, 300)}`, category, severity);
    }
  });
}

// ---------------------------------------------------------------------------
// Check 4: Compression Quality Gate
// ---------------------------------------------------------------------------

async function checkCompressionQuality() {
  const checkName = "4. Compression Quality Gate";
  const category = "quality";
  const severity = "must";

  await timed(checkName, category, severity, async () => {
    const scriptPath = "scripts/release/compression-quality-check.mjs";
    if (!fileExists(scriptPath)) {
      fail(checkName, `Script not found: ${scriptPath}`, category, severity);
      return;
    }

    const r = runNodeScript(scriptPath, [], { timeout: 60000 });
    if (r.exitCode === 0) {
      // Parse output for pass counts
      const output = r.stdout;
      const passMatch = output.match(/(\d+)\/(\d+)\s+passed/);
      if (passMatch) {
        pass(checkName, `Compression quality: ${passMatch[0]}`, category, severity);
      } else {
        pass(checkName, "Compression quality gate passed (exit 0)", category, severity);
      }
    } else {
      fail(checkName, `Compression quality gate FAILED (exit ${r.exitCode}): ${(r.stdout + r.stderr).slice(0, 300)}`, category, severity);
    }
  });
}

// ---------------------------------------------------------------------------
// Check 5: Memory Recall Quality Gate
// ---------------------------------------------------------------------------

async function checkMemoryRecallQuality() {
  const checkName = "5. Memory Recall Quality Gate";
  const category = "quality";
  const severity = "must";

  await timed(checkName, category, severity, async () => {
    // Run the dedicated quality gate. The full Vitest run is a separate MUST check.
    const r = run("npx vitest run tests/quality/recallQualityGate.test.ts --reporter=json 2>&1", { timeout: 180000 });
    const json = extractJson(r.stdout);

    // Count memory-related test failures
    if (json && json.testResults) {
      const memoryTestFiles = json.testResults.filter((tr) => {
        const name = (tr.name || "").toLowerCase();
        return name.includes("recallqualitygate");
      });

      const failures = memoryTestFiles.reduce((sum, tr) => {
        const fileFails = (tr.assertionResults || []).filter((a) => a.status === "failed").length;
        return sum + fileFails;
      }, 0);

      if (failures === 0) {
        pass(checkName, `${memoryTestFiles.length} memory/recall test files, 0 failures`, category, severity);
      } else {
        fail(checkName, `${failures} failures in memory/recall test files`, category, severity);
      }
    } else {
      // Fallback: run focused recall tests
      const focused = run("npx vitest run tests/quality/recallQualityGate.test.ts --reporter=verbose 2>&1", { timeout: 180000 });
      if (focused.exitCode === 0 && !focused.stdout.includes("FAIL")) {
        pass(checkName, "Memory/recall focused tests pass", category, severity);
      } else if (focused.exitCode !== 0) {
        fail(checkName, `Memory/recall tests have failures`, category, severity);
      } else {
        warn(checkName, "Could not isolate memory recall results — check full vitest run", category, severity);
      }
    }

    // Also verify memory recall source implementation exists
    const recallFile = path.join(SRC, "memory", "recallContext.ts");
    const memoryServiceFile = path.join(SRC, "memory", "memoryService.ts");
    if (!fs.existsSync(recallFile) && !fs.existsSync(memoryServiceFile)) {
      fail(checkName, "Memory recall source files missing", category, severity);
    }
  });
}

// ---------------------------------------------------------------------------
// Check 6: Fingerprint migration tests
// ---------------------------------------------------------------------------

async function checkFingerprintMigration() {
  const checkName = "6. Fingerprint migration tests";
  const category = "migration";
  const severity = "must";

  await timed(checkName, category, severity, async () => {
    const testFile = "tests/memoryFingerprintMigration.test.ts";
    if (!fileExists(testFile)) {
      fail(checkName, `Test file not found: ${testFile}`, category, severity);
      return;
    }
    const r = run("npx vitest run tests/memoryFingerprintMigration.test.ts --reporter=json 2>&1", { timeout: 180000 });
    const json = extractJson(r.stdout);
    const failed = json?.numFailedTests ?? (r.exitCode === 0 ? 0 : 1);
    const passed = json?.numPassedTests ?? 0;
    if (r.exitCode === 0 && failed === 0) {
      pass(checkName, `${passed} fingerprint migration tests passed`, category, severity);
    } else {
      fail(checkName, `fingerprint migration tests failed: ${failed} failure(s)`, category, severity);
      collectVitestFailures(json);
    }
  });
}

// ---------------------------------------------------------------------------
// Check 7: Fast Path Boundary Gate
// ---------------------------------------------------------------------------

async function checkFastPathBoundary() {
  const checkName = "7. Fast Path Boundary Gate";
  const category = "boundary";
  const severity = "must";

  await timed(checkName, category, severity, async () => {
    const scriptPath = "scripts/release/fast-path-boundary-check.mjs";
    if (!fileExists(scriptPath)) {
      fail(checkName, `Script not found: ${scriptPath}`, category, severity);
      return;
    }

    const r = runNodeScript(scriptPath, [], { timeout: 120000 });
    if (r.exitCode === 0) {
      pass(checkName, "Fast path boundary gate passed", category, severity);
    } else {
      fail(checkName, `Fast path boundary gate FAILED (exit ${r.exitCode}): ${(r.stdout + r.stderr).slice(0, 300)}`, category, severity);
    }
  });
}

// ---------------------------------------------------------------------------
// Check 8: Agent mode = 7 tools
// ---------------------------------------------------------------------------

async function checkAgentModeToolCount() {
  const checkName = "8. Agent mode = 7 tools";
  const category = "tool-surface";
  const severity = "must";

  await timed(checkName, category, severity, async () => {
    const toolModeSrc = readFile("src/mcp/toolMode.ts");

    // Extract AGENT_TOOLS entries
    const agentToolsMatch = toolModeSrc.match(/AGENT_TOOLS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
    if (!agentToolsMatch) {
      fail(checkName, "Cannot find AGENT_TOOLS definition in toolMode.ts", category, severity);
      return;
    }

    const toolsBlock = agentToolsMatch[1];
    const toolNames = [...toolsBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    if (toolNames.length === 7) {
      pass(checkName, `AGENT_TOOLS has exactly 7 entries: ${toolNames.join(", ")}`, category, severity);
    } else {
      fail(checkName, `AGENT_TOOLS has ${toolNames.length} entries, expected 7: ${toolNames.join(", ")}`, category, severity);
    }
  });
}

// ---------------------------------------------------------------------------
// Check 9: Dangerous tools not in agent mode
// ---------------------------------------------------------------------------

async function checkDangerousToolsHidden() {
  const checkName = "8. Dangerous tools not in agent mode";
  const category = "tool-surface";
  const severity = "must";

  await timed(checkName, category, severity, async () => {
    const toolModeSrc = readFile("src/mcp/toolMode.ts");

    // Get dangerous tools
    const dangerousMatch = toolModeSrc.match(/getDangerousTools[^}]*return\s+\[([^\]]*)\]/);
    const dangerousTools = dangerousMatch
      ? [...dangerousMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
      : ["delete_original", "cleanup_originals"]; // fallback

    // Get AGENT_TOOLS
    const agentToolsMatch = toolModeSrc.match(/AGENT_TOOLS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
    const agentToolNames = agentToolsMatch
      ? [...agentToolsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
      : [];

    const violations = dangerousTools.filter((dt) => agentToolNames.includes(dt));

    if (violations.length === 0) {
      pass(checkName, `Dangerous tools (${dangerousTools.join(", ")}) excluded from AGENT_TOOLS`, category, severity);
    } else {
      fail(checkName, `Dangerous tools in AGENT_TOOLS: ${violations.join(", ")}`, category, severity);
    }

    // Also verify harness tools are not in agent mode
    if (agentToolNames.length > 0) {
      const harnessTools = agentToolNames.filter((t) => t.toLowerCase().includes("harness"));
      if (harnessTools.length > 0) {
        fail(checkName, `Harness tools in AGENT_TOOLS: ${harnessTools.join(", ")}`, category, severity);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Check 10: demo / value / doctor runnable
// ---------------------------------------------------------------------------

async function checkCliCommandsRunnable() {
  const checkName = "10. demo / value / doctor runnable";
  const category = "cli";
  const severity = "must";

  await timed(checkName, category, severity, async () => {
    // Ensure dist exists
    if (!fileExists("dist/cli/index.js")) {
      fail(checkName, "dist/cli/index.js not found — run build first", category, severity);
      return;
    }

    const commands = [
      { name: "doctor", args: ["doctor"] },
      { name: "demo", args: ["demo"] },
      { name: "value", args: ["value"] },
    ];

    let allOk = true;
    const details = [];
    const cliHome = fs.mkdtempSync(path.join(tmpdir(), "cc-stable-cli-"));
    const cliEnv = {
      HOME: cliHome,
      USERPROFILE: cliHome,
      APPDATA: path.join(cliHome, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(cliHome, "AppData", "Local"),
      MCP_TOOL_MODE: "agent",
    };
    fs.mkdirSync(cliEnv.APPDATA, { recursive: true });
    fs.mkdirSync(cliEnv.LOCALAPPDATA, { recursive: true });

    for (const cmd of commands) {
      const r = await spawnAndCollect("node", ["dist/cli/index.js", ...cmd.args], {
        timeout: 30000,
        env: cliEnv,
      });
      if (cmd.name === "doctor") {
        // Doctor's exit status is derived from the report. Parse and verify
        // the semantic contract instead of treating any JSON output as pass.
        const json = extractJson(r.stdout);
        if (json && json.allPass === true && r.ok) {
          details.push(`${cmd.name}: allPass=true`);
        } else {
          allOk = false;
          details.push(
            `${cmd.name}: expected exit 0 and allPass=true, got exit ${r.code}, report=${JSON.stringify(json)}`,
          );
        }
      } else if (r.ok) {
        // Verify output is valid JSON
        const json = extractJson(r.stdout);
        if (json) {
          details.push(`${cmd.name}: ok`);
        } else {
          allOk = false;
          details.push(`${cmd.name}: output not valid JSON: ${r.stdout.slice(0, 100)}`);
        }
      } else {
        allOk = false;
        details.push(`${cmd.name}: exit ${r.code}: ${(r.stderr || r.error || "").slice(0, 100)}`);
      }
    }

    if (allOk) {
      pass(checkName, details.join("; "), category, severity);
    } else {
      fail(checkName, details.join("; "), category, severity);
    }
  });
}

// ---------------------------------------------------------------------------
// Check 9: npm pack install + smoke
// ---------------------------------------------------------------------------

async function checkNpmPackSmoke() {
  const checkName = "9. Fresh npm install smoke";
  const category = "packaging";
  const severity = "must";

 await timed(checkName, category, severity, async () => {
    const smokeScript = "scripts/release/clean-install-smoke.mjs";
    if (!fileExists(smokeScript)) {
      fail(checkName, "Script not found: " + smokeScript, category, severity);
      return;
    }
    const smoke = runNodeScript(smokeScript, [], { timeout: 600000 });
    if (smoke.exitCode === 0) {
      pass(checkName, "fresh HOME npm pack/install/CLI/MCP smoke passed", category, severity);
    } else {
      fail(checkName, "fresh npm install smoke failed (exit " + smoke.exitCode + ")", category, severity);
    }
    return;
    // Step 1: Ensure dist exists
    if (!fileExists("dist/index.js")) {
      fail(checkName, "dist/index.js not found — run build first", category, severity);
      return;
    }

    // Step 2: Verify npm pack --dry-run produces clean tarball (no data leaks)
    const dryRunResult = run("npm pack --dry-run 2>&1", { timeout: 30000 });
    const dryOutput = dryRunResult.stdout + dryRunResult.stderr;

    // Parse file paths from npm pack --dry-run output (format: "npm notice <size> <path>")
    const fileLinePattern = /^npm notice\s+[\d.]+[kM]?B\s+(.+)$/;
    const packagedFiles = dryOutput
      .split("\n")
      .map((l) => { const m = l.trim().match(fileLinePattern); return m ? m[1] : null; })
      .filter(Boolean);

    const forbiddenPatterns = [
      { pattern: ".sqlite", msg: ".sqlite database file" },
      { pattern: ".env", msg: ".env file" },
    ];
    // Directories/paths that indicate data leaks (only flag if NOT in dist/)
    const forbiddenDirPatterns = ["runs/", "originals/"];

    const findings = [];
    for (const file of packagedFiles) {
      // Files under dist/ are compiled source code, not user data
      if (file.startsWith("dist/")) continue;

      for (const fp of forbiddenPatterns) {
        if (file.includes(fp.pattern) || file.endsWith(fp.pattern.replace("*", ""))) {
          findings.push(`${fp.msg}: ${file}`);
        }
      }
      for (const dp of forbiddenDirPatterns) {
        if (file.includes(dp)) {
          findings.push(`data leak: ${dp} → ${file}`);
        }
      }
    }

    // Also check raw output for patterns that might not have a file path line
    const rawCheckPatterns = ["raw-results.jsonl"];
    for (const p of rawCheckPatterns) {
      if (dryOutput.includes(p) && !packagedFiles.some((f) => f && f.includes(p))) {
        findings.push(`raw text contains: ${p}`);
      }
    }

    if (findings.length > 0) {
      fail(checkName, `npm pack forbidden content: ${findings.slice(0, 5).join("; ")}`, category, severity);
      return;
    }

    // Step 3: Create temp directory for pack+install test
    const tmpDir = path.join(tmpdir(), `cc-stable-smoke-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // Step 4: npm pack (with forward-slashed dest for cross-platform compat)
      const packDest = tmpDir.replace(/\\/g, "/");
      const packResult = run(`npm pack --pack-destination "${packDest}"`, { timeout: 60000 });
      if (!packResult.ok) {
        fail(checkName, `npm pack failed: ${(packResult.stderr + packResult.stdout).slice(0, 200)}`, category, severity);
        return;
      }

      // Find the tarball
      const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tgz"));
      if (files.length === 0) {
        fail(checkName, "npm pack produced no .tgz file", category, severity);
        return;
      }

      // Step 5: Install from tarball into a temp project using --prefix
      const installDir = path.join(tmpDir, "smoke-test");
      fs.mkdirSync(installDir, { recursive: true });
      fs.writeFileSync(
        path.join(installDir, "package.json"),
        JSON.stringify({ name: "smoke-test", private: true, version: "1.0.0" }),
        "utf-8",
      );

      // Use forward slashes — npm on Windows handles them fine and avoids shell-escaping bugs
      const tarballPath = path.join(tmpDir, files[0]).replace(/\\/g, "/");
      const installDirFwd = installDir.replace(/\\/g, "/");
      const installResult = run(
        `npm install "${tarballPath}" --ignore-scripts --prefix "${installDirFwd}"`,
        { timeout: 120000 },
      );

      // On Windows, npm cleanup may fail with EPERM even if install succeeded.
      // Check whether the package directory actually exists.
      let pkgDir = path.join(installDir, "node_modules", "code-context-mcp");

      if (!installResult.ok && !fs.existsSync(pkgDir)) {
        // Try without --prefix, using --cwd style
        const retryResult = run(
          `npm install "${tarballPath}" --ignore-scripts`,
          { cwd: installDir, timeout: 120000 },
        );
        if (!retryResult.ok && !fs.existsSync(pkgDir)) {
          fail(checkName,
            `npm install from tarball failed: ${(installResult.stderr + installResult.stdout + retryResult.stderr + retryResult.stdout).slice(0, 300)}`,
            category, severity,
          );
          return;
        }
      }

      // Double-check: package dir might be under a different path structure
      if (!fs.existsSync(pkgDir)) {
        // npm with --prefix may put node_modules at the prefix root
        const altPkgDir = path.join(installDir, "node_modules", "code-context-mcp");
        if (fs.existsSync(altPkgDir)) pkgDir = altPkgDir;
      }
      if (!fs.existsSync(pkgDir)) {
        fail(checkName, "Installed package dir not found in node_modules after npm install", category, severity);
        return;
      }

      // Step 6: Test CLI startup from the npm-installed package
      const cliEntry = path.join(pkgDir, "dist", "cli", "index.js");
      const cliResult = await spawnAndCollect("node", [cliEntry, "--version"], { timeout: 10000 });

      if (!cliResult.ok || !cliResult.stdout.trim()) {
        fail(checkName, `CLI from installed package failed: ${cliResult.stderr || cliResult.error || "no output"}`, category, severity);
        return;
      }

      const version = cliResult.stdout.trim();

      // Step 7: Test MCP server startup from the npm-installed package
      const isWin = process.platform === "win32";
      const mcpEntry = path.join(pkgDir, "dist", "index.js");
      const mcpRequest = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

      const mcpResult = await new Promise((resolve) => {
        const child = spawn("node", [mcpEntry], {
          cwd: pkgDir,
          env: { ...process.env, MCP_TOOL_MODE: "agent" },
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 15000,
          shell: isWin,
        });

        let stdout = "";
        let resolved = false;
        const timer = setTimeout(() => {
          if (!resolved) { resolved = true; child.kill(); resolve({ ok: false, error: "timeout" }); }
        }, 10000);

        child.stdout.on("data", (d) => {
          stdout += d.toString();
          try {
            const parsed = JSON.parse(stdout.trim().split("\n").pop() || stdout.trim());
            if (parsed.result && parsed.result.tools) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                child.kill();
                resolve({ ok: true, tools: parsed.result.tools });
              }
            }
          } catch { /* not enough data yet */ }
        });

        child.on("close", () => {
          if (!resolved) { resolved = true; clearTimeout(timer); resolve({ ok: false, error: "closed before response" }); }
        });

        child.on("error", (err) => {
          if (!resolved) { resolved = true; clearTimeout(timer); resolve({ ok: false, error: err.message }); }
        });

        child.stdin.write(mcpRequest + "\n");
      });

      if (mcpResult.ok && mcpResult.tools) {
        pass(checkName,
          `Pack OK (no forbidden files), dry-run clean, install OK, CLI v${version}, MCP server ${mcpResult.tools.length} tools`,
          category, severity,
        );
      } else {
        fail(checkName,
          `CLI v${version} works but MCP server failed: ${mcpResult.error || "no tools in response"}`,
          category, severity,
        );
      }
    } finally {
      // Cleanup temp dir
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
}

// ---------------------------------------------------------------------------
// Check 11: README / version / CHANGELOG consistency
// ---------------------------------------------------------------------------

async function checkVersionConsistency() {
  const checkName = "11. Version and documentation consistency";
  const category = "docs";
  const severity = "must";

  await timed(checkName, category, severity, async () => {
    const issues = [];

    // Get version from package.json
    const pkg = readJson("package.json");
    const pkgVersion = pkg.version;
    if (!pkgVersion) {
      fail(checkName, "No version in package.json", category, severity);
      return;
    }

    // Get version from CLI source
    const cliSrc = readFile("src/cli/index.ts");
    const cliVersionMatch = cliSrc.match(/const VERSION\s*=\s*"([^"]+)"/);
    const cliVersion = cliVersionMatch ? cliVersionMatch[1] : null;

    if (!cliVersion) {
      issues.push("CLI VERSION constant not found");
    } else if (cliVersion !== pkgVersion) {
      issues.push(`CLI version ${cliVersion} ≠ package.json ${pkgVersion}`);
    }

    // Get version from README
    const readme = readFile("README.md");
    const readmeVersionBadge = readme.match(/npm version.*?v?(\d+\.\d+\.\d+)/);
    const readmeVersionText = readme.match(/>\s*\*{0,2}v?(\d+\.\d+\.\d+)/);

    // Check README references current major.minor at least
    if (!readme.includes(`v${pkgVersion}`)) {
      // This is informational — README may reference major.minor only
      if (!readme.includes(`v${pkgVersion.split(".").slice(0, 2).join(".")}`)) {
        issues.push(`README does not reference v${pkgVersion} or v${pkgVersion.split(".").slice(0, 2).join(".")}`);
      }
    }

    // Get version from CHANGELOG
    const changelog = readFile("CHANGELOG.md");
    const latestEntry = changelog.match(/##\s*\[([^\]]+)\]/);
    const changelogVersion = latestEntry ? latestEntry[1] : null;

    if (!changelogVersion) {
      issues.push("CHANGELOG has no version entry");
    } else if (changelogVersion !== pkgVersion && !changelogVersion.includes(pkgVersion)) {
      issues.push(`CHANGELOG latest [${changelogVersion}] ≠ package.json ${pkgVersion}`);
    }

    // Check MCP server version in doctor.ts
    const doctorSrc = readFile("src/cli/doctor.ts");
    const doctorVersionMatch = doctorSrc.match(/version:\s*"([^"]+)"/);
    const doctorVersion = doctorVersionMatch ? doctorVersionMatch[1] : null;
    if (doctorVersion && doctorVersion !== pkgVersion) {
      issues.push(`Doctor version ${doctorVersion} ≠ package.json ${pkgVersion}`);
    }

    // Check release notes existence
    const releaseNotesPath = `docs/releases/v${pkgVersion}.md`;
    const releaseNotesRcPath = `docs/releases/v${pkgVersion}-rc.md`;

    if (issues.length === 0) {
      pass(checkName, `All sources consistent at v${pkgVersion}`, category, severity);
    } else {
      fail(checkName, issues.join("; "), category, severity);
    }
  });
}

// ---------------------------------------------------------------------------
// Report generator
// ---------------------------------------------------------------------------

function getGitMetadata() {
  const commit = run("git rev-parse HEAD", { timeout: 15000 });
  const dirty = run("git status --porcelain", { timeout: 15000 });
  return {
    commit: commit.ok ? commit.stdout.trim() : "unknown",
    dirty: dirty.ok ? dirty.stdout.trim().length > 0 : true,
  };
}

function buildJsonReport(verdict, startTime) {
  const totalMs = Math.round(performance.now() - startTime);

  const mustChecks = checks.filter((c) => c.severity === "must");
  const shouldChecks = checks.filter((c) => c.severity === "should");

  return {
    generatedAt: new Date().toISOString(),
    generated: new Date().toISOString(),
    git: getGitMetadata(),
    project: "code-context-mcp",
    version: (() => {
      try { return readJson("package.json").version; } catch { return "unknown"; }
    })(),
    verdict,
    summary: {
      total: checks.length,
      pass: checks.filter((c) => c.status === "pass").length,
      warning: checks.filter((c) => c.status === "warning").length,
      fail: checks.filter((c) => c.status === "fail").length,
      mustPass: mustChecks.filter((c) => c.status === "pass").length,
      mustFail: mustChecks.filter((c) => c.status === "fail").length,
      mustWarning: mustChecks.filter((c) => c.status === "warning").length,
      totalDurationMs: totalMs,
    },
    checks,
    commandOutputs,
    testFailures: vitestFailures.length > 0 ? vitestFailures : undefined,
    verdictRules: {
      pass: "All MUST checks pass. Ready for stable release.",
      warning: "All MUST checks pass but one or more SHOULD checks are warnings. Review before release.",
      fail: "One or more MUST checks FAILED. Do NOT release until resolved.",
      categories: {
        must: [
          "Source reproducibility",
          "TypeScript zero errors",
          "Vitest zero failures (all test files)",
          "Compression Quality Gate pass",
          "Memory Recall Quality Gate pass",
          "Fingerprint migration tests",
          "Fast Path Boundary Gate pass",
          "Agent mode = 7 tools",
          "Dangerous tools not in agent mode",
          "Fresh npm install smoke",
          "demo / value / doctor runnable",
          "Version and documentation consistency",
        ],
        should: [
          "Performance fluctuations (non-critical, does not block release)",
          "Documentation warnings",
          "Cache hit latency",
        ],
      },
    },
  };
}

function buildMarkdownReport(report) {
  const lines = [];
  const statusIcon = { pass: "✅", warning: "⚠️", fail: "❌" };

  lines.push("# CodeContext Stable Release Gate");
  lines.push("");
  lines.push(`**GeneratedAt**: ${report.generatedAt}`);
  lines.push(`**Git commit**: ${report.git.commit}`);
  lines.push(`**Git dirty**: ${report.git.dirty}`);
  lines.push(`**Project**: ${report.project} v${report.version}`);
  lines.push("");
  lines.push(`## Verdict: **${report.verdict}** ${statusIcon[report.verdict.toLowerCase()] || (report.verdict === "PASS" ? "✅" : "❌")}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|---|---|");
  lines.push(`| ✅ Pass | ${report.summary.pass} |`);
  lines.push(`| ⚠️ Warning | ${report.summary.warning} |`);
  lines.push(`| ❌ Fail | ${report.summary.fail} |`);
  lines.push(`| **Total** | **${report.summary.total}** |`);
  lines.push(`| MUST pass | ${report.summary.mustPass} |`);
  lines.push(`| MUST fail | ${report.summary.mustFail} |`);
  lines.push(`| Total duration | ${(report.summary.totalDurationMs / 1000).toFixed(1)}s |`);
  lines.push("");

  // Verdict rules
  lines.push("## Verdict Rules");
  lines.push("");
  lines.push("### ❌ MUST (fail = release blocked)");
  lines.push("");
  for (const item of report.verdictRules.categories.must) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("### ⚠️ SHOULD (warning only — review but do not block)");
  lines.push("");
  for (const item of report.verdictRules.categories.should) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  // Check results by category
  lines.push("## Check Results");
  lines.push("");

  const categories = [...new Set(report.checks.map((c) => c.category))];
  for (const cat of categories) {
    const catChecks = report.checks.filter((c) => c.category === cat);
    lines.push(`### ${cat}`);
    lines.push("");
    lines.push("| # | Check | Status | Severity | Duration | Detail |");
    lines.push("|---|---|---|---:|---:|");
    let idx = 1;
    for (const c of catChecks) {
      const icon = statusIcon[c.status] || "?";
      const severity = c.severity === "must" ? "🔴 MUST" : "🟡 SHOULD";
      const detail = c.detail.length > 100 ? c.detail.slice(0, 97) + "..." : c.detail;
      lines.push(`| ${idx} | ${c.check} | ${icon} ${c.status} | ${severity} | ${c.durationMs}ms | ${detail} |`);
      idx++;
    }
    lines.push("");
  }

  // Test failure details (from vitest)
  if (report.testFailures && report.testFailures.length > 0) {
    lines.push("## ❌ Test Failure Details");
    lines.push("");
    lines.push(`| # | Test File | Test Name | Assertion | Error |`);
    lines.push("|---|---:|---|---:|---|");
    report.testFailures.forEach((f, i) => {
      const errorSnippet = f.error.replace(/\n/g, " // ").slice(0, 150);
      const testName = f.testName.length > 60 ? f.testName.slice(0, 57) + "..." : f.testName;
      const fileShort = f.file.replace(/\\/g, "/").split("/").slice(-2).join("/");
      lines.push(`| ${i + 1} | \`${fileShort}\` | ${testName} | ${f.assertion} | ${errorSnippet} |`);
    });
    lines.push("");
  }

 // Detailed check results (for failures)
  lines.push("## Subcommand Output Summaries");
  lines.push("");
  lines.push("| Command | Exit | Status | Output summary |");
  lines.push("|---|---:|---|---|");
  for (const command of report.commandOutputs) {
    const output = (command.output || "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
    lines.push(`| ${command.command} | ${command.exitCode} | ${command.ok ? "PASS" : "FAIL"} | ${output.slice(0, 240)} |`);
  }
  lines.push("");

 const failedChecks = report.checks.filter((c) => c.status === "fail");
  if (failedChecks.length > 0) {
    lines.push("## ❌ Failed Checks (Detail)");
    lines.push("");
    for (const c of failedChecks) {
      lines.push(`### ${c.check}`);
      lines.push("");
      lines.push(`- **Severity**: ${c.severity.toUpperCase()}`);
      lines.push(`- **Category**: ${c.category}`);
      lines.push(`- **Detail**: ${c.detail}`);
      lines.push(`- **Duration**: ${c.durationMs}ms`);
      lines.push("");
    }
  }

  // Action
  if (report.verdict === "FAIL") {
    lines.push("## ❌ Action Required");
    lines.push("");
    lines.push("One or more MUST checks failed. **Do NOT release until resolved.**");
    lines.push("");
    lines.push("Fix the failed MUST checks above and re-run:");
    lines.push("```bash");
    lines.push("node scripts/release/stable-readiness-check.mjs");
    lines.push("```");
  } else if (report.verdict === "WARNING") {
    lines.push("## ⚠️ Review Before Release");
    lines.push("");
    lines.push("All MUST checks pass. Review the warning items before proceeding.");
    lines.push("");
    lines.push("To proceed with release:");
    lines.push("```bash");
    lines.push("node scripts/release/stable-readiness-check.mjs");
    lines.push("# If clean, proceed with:");
    lines.push("# npm publish  (or pnpm publish)");
    lines.push("```");
  } else {
    lines.push("## ✅ Ready for Stable Release");
    lines.push("");
    lines.push("All checks pass. The release is ready.");
    lines.push("");
    lines.push("Next steps:");
    lines.push("```bash");
    lines.push("# 1. Review this report one final time");
    lines.push("# 2. Create git tag:");
    lines.push("git tag -a v" + report.version + " -m \"Release v" + report.version + "\"");
    lines.push("# 3. Push tag:");
    lines.push("git push origin v" + report.version);
    lines.push("# 4. Publish to npm:");
    lines.push("npm publish");
    lines.push("```");
  }
  lines.push("");

  // Non-scope
  lines.push("## Non-Scope");
  lines.push("");
  lines.push("This gate does NOT:");
  lines.push("- Execute `npm publish`");
  lines.push("- Create git tags");
  lines.push("- Push to remote");
  lines.push("- Upload to any external service");
  lines.push("- Check image/binary compression (explicit non-goal)");
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = performance.now();

  console.log("═══════════════════════════════════════════");
  console.log("  CodeContext Stable Release Gate");
  console.log("═══════════════════════════════════════════");
  console.log("");

 // Run all checks sequentially so output is readable
  await checkSourceReproducibility(); // 1
 await checkTypeScript();             // 1
  await checkVitest();                 // 3
  await checkCompressionQuality();     // 4
  await checkMemoryRecallQuality();    // 5
  await checkFingerprintMigration();  // 6
  await checkFastPathBoundary();       // 7
  await checkAgentModeToolCount();     // 8
  await checkDangerousToolsHidden();   // 9
  await checkNpmPackSmoke();           // 9
  await checkCliCommandsRunnable();    // 10
  await checkVersionConsistency();     // 11

  // Print per-check results
  console.log("");
  const statusIcon = { pass: "✅", warning: "⚠️", fail: "❌" };
  for (const c of checks) {
    const icon = statusIcon[c.status] || "?";
    const severity = c.severity === "must" ? "[MUST]" : "[SHOULD]";
    console.log(`${icon} ${severity} ${c.check}: ${c.detail}`);
  }

  // Generate report
  const verdict = finalVerdict();
  const report = buildJsonReport(verdict, t0);

  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const jsonPath = path.join(REPORTS_DIR, "stable-readiness.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  const md = buildMarkdownReport(report);
  const mdPath = path.join(REPORTS_DIR, "stable-readiness.md");
  fs.writeFileSync(mdPath, md, "utf-8");

  // Print summary
  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log(`  Verdict: ${verdict}`);
  console.log(`  Pass: ${report.summary.pass}  Warning: ${report.summary.warning}  Fail: ${report.summary.fail}`);
  console.log(`  Duration: ${(report.summary.totalDurationMs / 1000).toFixed(1)}s`);
  console.log("═══════════════════════════════════════════");
  console.log(`  Report: reports/release/stable-readiness.json`);
  console.log(`  Report: reports/release/stable-readiness.md`);
  console.log("═══════════════════════════════════════════");
  console.log("");

  if (verdict === "FAIL") {
    console.log("❌ STABLE RELEASE BLOCKED — fix MUST failures above.");
  } else if (verdict === "WARNING") {
    console.log("⚠️  All MUST checks pass. Review warnings before release.");
  } else {
    console.log("✅ STABLE RELEASE READY.");
  }

  process.exit(verdict === "FAIL" ? 1 : 0);
}

main().catch((err) => {
  console.error("Stable readiness check crashed:", err);
  process.exit(2);
});
