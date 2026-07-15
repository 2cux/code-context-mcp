#!/usr/bin/env node

/**
 * Fresh Install Package Smoke Test
 *
 * Verifies the npm tarball in an isolated first-run environment:
 * 1. npm pack after build.
 * 2. install the generated tgz in a temporary project.
 * 3. run package bins with brand-new HOME/USERPROFILE and empty DB dir.
 * 4. exercise the real MCP stdio handshake and agent business tools.
 * 5. fail non-zero on any protocol or business assertion failure.
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, totalmem, cpus } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const REPORTS_DIR = process.env.CODECONTEXT_RELEASE_REPORTS_DIR
  ? resolve(process.env.CODECONTEXT_RELEASE_REPORTS_DIR)
  : join(PROJECT_ROOT, "reports", "release");
const PACKAGE_NAME = "code-context-mcp";
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const SUPPLIED_TGZ = process.env.CODECONTEXT_RELEASE_TGZ
  ? resolve(process.env.CODECONTEXT_RELEASE_TGZ)
  : null;

const results = [];
let startTime = 0;
let context = null;

function step(name) {
  const record = { name, status: "pending", durationMs: 0, detail: "", error: null };
  results.push(record);
  const started = performance.now();
  process.stdout.write(`  ${name}... `);
  return {
    ok(detail = "") {
      record.status = "ok";
      record.durationMs = Math.round(performance.now() - started);
      record.detail = detail;
      console.log(`OK ${record.durationMs}ms`);
    },
    fail(error) {
      record.status = "fail";
      record.durationMs = Math.round(performance.now() - started);
      record.error = error instanceof Error ? error.message : String(error);
      record.detail = record.error;
      console.log(`FAIL ${record.durationMs}ms - ${record.error}`);
    },
  };
}

function failStep(s, error) {
  s.fail(error);
  return false;
}

function cleanOutput(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function run(command, args, opts = {}) {
  const actualCommand = process.platform === "win32" && command.endsWith(".cmd")
    ? (process.env.ComSpec || "cmd.exe")
    : command;
  const actualArgs = process.platform === "win32" && command.endsWith(".cmd")
    ? ["/d", "/s", "/c", command, ...args]
    : args;

  try {
    const stdout = execFileSync(actualCommand, actualArgs, {
      cwd: opts.cwd ?? PROJECT_ROOT,
      encoding: "utf-8",
      timeout: opts.timeout ?? 60000,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    return { ok: true, stdout, stderr: "" };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.toString?.() ?? "",
      stderr: error.stderr?.toString?.() ?? "",
      error: error.message,
    };
  }
}

function parseJson(output, label) {
  try {
    return JSON.parse(output.trim());
  } catch (error) {
    throw new Error(`${label} did not output valid JSON: ${error.message}; output=${output.slice(0, 500)}`);
  }
}

function packageBin(installRoot, name) {
  return join(installRoot, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
}

function makeFreshEnv(freshHome, npmCache) {
  const appData = join(freshHome, "AppData", "Roaming");
  const localAppData = join(freshHome, "AppData", "Local");
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  return {
    HOME: freshHome,
    USERPROFILE: freshHome,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    npm_config_cache: npmCache,
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
    MCP_TOOL_MODE: "agent",
  };
}

function hash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function gitCommit() {
  const result = run("git", ["rev-parse", "HEAD"], { timeout: 10000 });
  return result.ok ? result.stdout.trim() : null;
}

function gitDirty() {
  const result = run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { timeout: 10000 });
  return result.ok ? result.stdout.trim().length > 0 : null;
}

function parseToolResult(response, toolName) {
  if (response?.error) {
    throw new Error(`${toolName} JSON-RPC error: ${JSON.stringify(response.error)}`);
  }
  if (response?.result?.isError) {
    throw new Error(`${toolName} returned isError: ${JSON.stringify(response.result.content)}`);
  }
  const text = response?.result?.content?.find((item) => item?.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${toolName} returned no text result`);
  return parseJson(text, toolName);
}

async function exerciseMcpServer(command, env, cwd) {
  const actualCommand = process.platform === "win32" && command.endsWith(".cmd")
    ? (process.env.ComSpec || "cmd.exe")
    : command;
  const actualArgs = process.platform === "win32" && command.endsWith(".cmd")
    ? ["/d", "/s", "/c", command]
    : [];
  const child = spawn(actualCommand, actualArgs, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });

  let stdout = "";
  let stdoutBuffer = "";
  let stderr = "";
  let settled = false;
  let nextId = 1;
  const pending = new Map();

  return await new Promise((resolvePromise) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const waiter of pending.values()) waiter.reject(new Error("MCP client stopped before response"));
      pending.clear();
      if (!child.killed) child.kill();
      resolvePromise(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: "timeout exercising MCP business flow", stdout, stderr });
    }, 30000);

    const request = (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

    const notify = (method, params = {}) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    };

    const callTool = async (name, args) => {
      const response = await request("tools/call", { name, arguments: args });
      return parseToolResult(response, name);
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines.map((value) => value.trim()).filter(Boolean)) {
        try {
          const parsed = JSON.parse(line);
          const waiter = pending.get(parsed?.id);
          if (!waiter) continue;
          pending.delete(parsed.id);
          waiter.resolve(parsed);
        } catch {
          // Non-JSON stdout is retained for diagnostics but is not a response.
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => finish({ ok: false, error: error.message, stdout, stderr }));
    child.on("close", (code) => finish({ ok: false, error: `server exited before smoke completed with code ${code}`, stdout, stderr }));

    (async () => {
      try {
        const initialize = await request("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "fresh-install-smoke", version: "1.0.0" },
        });
        if (initialize?.error || initialize?.result?.serverInfo?.name !== "code-context-mcp") {
          throw new Error(`initialize failed: ${JSON.stringify(initialize)}`);
        }
        notify("notifications/initialized");

        const listed = await request("tools/list", {});
        if (listed?.error || !Array.isArray(listed?.result?.tools)) {
          throw new Error(`tools/list failed: ${JSON.stringify(listed)}`);
        }
        const toolNames = listed.result.tools.map((tool) => tool.name).sort();
        const expectedTools = [
          "compress_context", "current_scope", "forget_context", "recall_context",
          "remember_context", "retrieve_original", "run_context_flow",
        ].sort();
        if (JSON.stringify(toolNames) !== JSON.stringify(expectedTools)) {
          throw new Error(`expected exactly 7 agent tools (${expectedTools.join(", ")}), got ${toolNames.length} (${toolNames.join(", ")})`);
        }

        const scope = await callTool("current_scope", {});
        if (typeof scope.scopeId !== "string" || !scope.scopeId) throw new Error("current_scope returned no scopeId");

        const originalContent = Array.from({ length: 45 }, (_, index) =>
          `FAIL tests/smoke-${index}.test.ts > fresh install MCP business check\n` +
          `AssertionError: expected value-${index} to equal expected-${index}\n` +
          `    at verifySmoke (tests/smoke-${index}.test.ts:${index + 10}:7)`,
        ).join("\n\n");
        const compressed = await callTool("compress_context", {
          scopeId: scope.scopeId,
          content: originalContent,
          contentType: "test_output",
          keepOriginal: true,
          maxTokens: 1200,
        });
        if (compressed.compressed !== true) throw new Error(`compress_context compressed was not true: ${JSON.stringify(compressed)}`);
        if (!(compressed.tokensSaved > 0)) throw new Error(`compress_context tokensSaved must be > 0, got ${compressed.tokensSaved}`);
        if (typeof compressed.originalRef !== "string" || !compressed.originalRef) throw new Error("compress_context returned no originalRef");

        const retrieved = await callTool("retrieve_original", {
          scopeId: scope.scopeId,
          originalRef: compressed.originalRef,
          limit: originalContent.length + 1,
        });
        if (hash(retrieved.content) !== hash(originalContent)) {
          throw new Error(`retrieve_original content hash mismatch: expected ${hash(originalContent)}, got ${hash(retrieved.content)}`);
        }

        const memoryMarker = `fresh-install-memory-${Date.now()}-${process.pid}`;
        const remembered = await callTool("remember_context", {
          scopeId: scope.scopeId,
          type: "project_rule",
          content: `${memoryMarker} must remain locally recallable`,
          summary: memoryMarker,
          confidence: 1,
        });
        if (typeof remembered.memoryId !== "string" || !remembered.memoryId) throw new Error("remember_context returned no memoryId");

        const recalled = await callTool("recall_context", {
          scopeId: scope.scopeId,
          query: memoryMarker,
          limit: 5,
          includeProfile: false,
        });
        if (!Array.isArray(recalled.memories) || !recalled.memories.some((memory) =>
          memory.id === remembered.memoryId && String(memory.content).includes(memoryMarker))) {
          throw new Error(`recall_context did not return saved memory ${remembered.memoryId}`);
        }

        const flow = await callTool("run_context_flow", {
          flow: "compression",
          scopeId: scope.scopeId,
          content: originalContent,
          contentType: "test_output",
          options: { keepOriginal: true, maxTokens: 1200 },
        });
        if (flow.flow !== "compression" || flow.status !== "ok" || typeof flow.runId !== "string") {
          throw new Error(`run_context_flow business response invalid: ${JSON.stringify(flow)}`);
        }

        finish({
          ok: true,
          toolCount: toolNames.length,
          scopeId: scope.scopeId,
          tokensSaved: compressed.tokensSaved,
          originalHash: hash(originalContent),
          memoryId: remembered.memoryId,
          flowRunId: flow.runId,
          stdout,
          stderr,
        });
      } catch (error) {
        finish({ ok: false, error: error.message, stdout, stderr });
      }
    })();
  });
}

function writeReport() {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const totalMs = Math.round(performance.now() - startTime);
  const passed = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    generated: generatedAt,
    gitCommit: context?.gitCommit ?? null,
    gitDirty: context?.gitDirty ?? null,
    tgzSha256: context?.tgzSha256 ?? null,
    packageFileCount: context?.packageFileCount ?? null,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
      totalMemoryMb: Math.round(totalmem() / (1024 * 1024)),
      developerHome: homedir(),
    },
    freshInstall: context,
    summary: { total: results.length, passed, failed, skipped, totalMs },
    steps: results,
  };

  writeFileSync(join(REPORTS_DIR, "fresh-install-smoke.json"), JSON.stringify(report, null, 2), "utf-8");

  let md = "# Fresh Install Package Smoke Report\n\n";
  md += `**Generated**: ${report.generatedAt}\n\n`;
  md += "## Release Provenance\n\n| Key | Value |\n|---|---|\n";
  md += `| git commit | \`${report.gitCommit ?? "unknown"}\` |\n`;
  md += `| git dirty | \`${report.gitDirty ?? "unknown"}\` |\n`;
  md += `| tgz SHA-256 | \`${report.tgzSha256 ?? "unknown"}\` |\n`;
  md += `| package file count | ${report.packageFileCount ?? "unknown"} |\n\n`;
  md += "## Environment\n\n| Key | Value |\n|---|---:|\n";
  md += `| Node.js | ${report.environment.node} |\n`;
  md += `| Platform | ${report.environment.platform} ${report.environment.arch} |\n`;
  md += `| CPUs | ${report.environment.cpus} |\n`;
  md += `| Memory | ${report.environment.totalMemoryMb}MB |\n\n`;

  if (context) {
    md += "## Fresh Install Isolation\n\n| Key | Value |\n|---|---|\n";
    md += `| npm tarball | \`${context.tgzPath ?? "not created"}\` |\n`;
    md += `| install root | \`${context.installRoot}\` |\n`;
    md += `| HOME / USERPROFILE | \`${context.freshHome}\` |\n`;
    md += `| database directory | \`${context.dbDir}\` |\n\n`;
  }

  md += "## Summary\n\n";
  md += `PASS ${passed} | FAIL ${failed} | SKIP ${skipped} | ${totalMs}ms\n\n`;
  md += "## Steps\n\n| # | Step | Status | Duration | Detail |\n|---:|---|---:|---:|---|\n";
  results.forEach((s, i) => {
    const detail = String(s.error || s.detail || "").replace(/\r?\n/g, "<br>");
    const status = s.status === "ok" ? "PASS" : s.status === "fail" ? "FAIL" : "SKIP";
    md += `| ${i + 1} | ${s.name} | ${status} | ${s.durationMs}ms | ${detail} |\n`;
  });
  md += "\n## Artifacts\n\n";
  md += "- `reports/release/fresh-install-smoke.json` - structured data\n";
  md += "- `reports/release/fresh-install-smoke.md` - this report\n";
  writeFileSync(join(REPORTS_DIR, "fresh-install-smoke.md"), md, "utf-8");

  return { passed, failed };
}

async function main() {
  startTime = performance.now();
  console.log("CodeContext MCP - Fresh Install Package Smoke\n");

  const tempRoot = mkdtempSync(join(tmpdir(), "code-context-fresh-smoke-"));
  const installRoot = join(tempRoot, "install");
  const freshHome = join(tempRoot, "fresh-home");
  const npmCache = join(tempRoot, "npm-cache");
  const dbDir = join(freshHome, ".code-context-mcp");
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(freshHome, { recursive: true });
  mkdirSync(dbDir, { recursive: true });
  mkdirSync(npmCache, { recursive: true });
  context = {
    tempRoot,
    installRoot,
    freshHome,
    dbDir,
    tgzPath: SUPPLIED_TGZ,
    packageName: PACKAGE_NAME,
    gitCommit: process.env.CODECONTEXT_RELEASE_COMMIT || gitCommit(),
    gitDirty: process.env.CODECONTEXT_RELEASE_GIT_DIRTY === undefined
      ? gitDirty()
      : process.env.CODECONTEXT_RELEASE_GIT_DIRTY === "true",
    tgzSha256: null,
    packageFileCount: process.env.CODECONTEXT_RELEASE_PACKAGE_FILE_COUNT
      ? Number(process.env.CODECONTEXT_RELEASE_PACKAGE_FILE_COUNT)
      : null,
  };

  const env = makeFreshEnv(freshHome, npmCache);
  let canContinue = true;

  if (!SUPPLIED_TGZ) {
    const s = step("Build package artifacts");
    const r = run(NPM, ["run", "build"], { env, timeout: 120000 });
    if (r.ok && existsSync(join(PROJECT_ROOT, "dist", "index.js"))) s.ok("dist/index.js created");
    else canContinue = failStep(s, new Error(cleanOutput(r.stderr || r.stdout || r.error)));
  }

  if (canContinue && !SUPPLIED_TGZ) {
    const s = step("npm pack");
    const r = run(NPM, ["pack", "--json", "--silent", "--pack-destination", tempRoot], { env, timeout: 60000 });
    try {
      if (!r.ok) throw new Error(cleanOutput(r.stderr || r.stdout || r.error));
      const data = parseJson(r.stdout, "npm pack");
      const first = Array.isArray(data) ? data[0] : null;
      if (!first?.filename) throw new Error("npm pack did not report a tarball filename");
      const tgzPath = join(tempRoot, first.filename);
      if (!existsSync(tgzPath)) throw new Error(`tarball not found: ${tgzPath}`);
      context.tgzPath = tgzPath;
      context.packageFileCount = first.files?.length ?? null;
      s.ok(`${basename(tgzPath)} (${first.files?.length ?? "unknown"} files)`);
    } catch (error) {
      canContinue = failStep(s, error);
    }
  }

  if (canContinue && SUPPLIED_TGZ) {
    const s = step("Use release gate tgz");
    if (existsSync(SUPPLIED_TGZ)) {
      s.ok(basename(SUPPLIED_TGZ));
    } else {
      canContinue = failStep(s, new Error(`supplied release tgz not found: ${SUPPLIED_TGZ}`));
    }
  }

  if (canContinue) {
    const s = step("Verify tgz provenance");
    try {
      context.tgzSha256 = hashFile(context.tgzPath);
      const expectedSha = process.env.CODECONTEXT_RELEASE_TGZ_SHA256;
      if (expectedSha && context.tgzSha256 !== expectedSha) {
        throw new Error(`tgz SHA-256 mismatch: expected ${expectedSha}, got ${context.tgzSha256}`);
      }
      if (!Number.isInteger(context.packageFileCount) || context.packageFileCount < 1) {
        throw new Error("package file count was not supplied by npm pack");
      }
      s.ok(`sha256=${context.tgzSha256}; files=${context.packageFileCount}`);
    } catch (error) {
      canContinue = failStep(s, error);
    }
  }

  if (canContinue) {
    const s = step("Install packed tgz in temporary project");
    const r = run(NPM, ["install", context.tgzPath, "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: installRoot,
      env,
      timeout: 120000,
    });
    if (r.ok && existsSync(join(installRoot, "node_modules", PACKAGE_NAME))) {
      s.ok(`installed ${basename(context.tgzPath)} into ${installRoot}`);
    } else {
      canContinue = failStep(s, new Error(cleanOutput(r.stderr || r.stdout || r.error)));
    }
  }

  const codeContext = packageBin(installRoot, "code-context");
  const codeContextServer = packageBin(installRoot, "code-context-server");

  if (canContinue) {
    const s = step("Isolation preflight: fresh HOME and empty database directory");
    try {
      if (resolve(homedir()) === resolve(freshHome)) throw new Error("fresh HOME unexpectedly equals developer home");
      if (!existsSync(dbDir)) throw new Error(`fresh database directory was not created: ${dbDir}`);
      if (readdirSync(dbDir).length > 0) throw new Error(`database directory was not empty before first run: ${dbDir}`);
      if (existsSync(join(homedir(), ".code-context-mcp", "code-context.sqlite"))) {
        s.ok(`developer DB exists but is isolated; fresh HOME=${freshHome}`);
      } else {
        s.ok(`fresh HOME=${freshHome}; database directory empty`);
      }
    } catch (error) {
      canContinue = failStep(s, error);
    }
  }

  if (canContinue) {
    const s = step("code-context --version");
    const r = run(codeContext, ["--version"], { cwd: installRoot, env, timeout: 10000 });
    if (r.ok && /^\d+\.\d+\.\d+/.test(r.stdout.trim())) s.ok(`version ${r.stdout.trim()}`);
    else canContinue = failStep(s, new Error(cleanOutput(r.stderr || r.stdout || r.error || "missing version")));
  }

  if (canContinue) {
    const s = step("code-context doctor --json");
    const r = run(codeContext, ["doctor", "--json"], { cwd: installRoot, env, timeout: 30000 });
    try {
      if (!r.ok) throw new Error(cleanOutput(r.stderr || r.stdout || r.error));
      const data = parseJson(r.stdout, "code-context doctor --json");
      if (data.allPass !== true) throw new Error(`doctor allPass was not true: ${JSON.stringify(data.checks ?? [])}`);
      s.ok(`${data.checks?.length ?? 0} checks passed`);
    } catch (error) {
      canContinue = failStep(s, error);
    }
  }

  if (canContinue) {
    const s = step("code-context demo --json");
    const r = run(codeContext, ["demo", "--json"], { cwd: installRoot, env, timeout: 60000 });
    try {
      if (!r.ok) throw new Error(cleanOutput(r.stderr || r.stdout || r.error));
      const data = parseJson(r.stdout, "code-context demo --json");
      const summary = data.summary ?? {};
      if (!data.reportPath || !data.jsonPath) throw new Error("demo did not report markdown/json paths");
      if (Object.values(summary).some((value) => String(value).startsWith("failed:"))) {
        throw new Error(`demo summary contains failure: ${JSON.stringify(summary)}`);
      }
      s.ok(`reports: ${data.reportPath}, ${data.jsonPath}`);
    } catch (error) {
      canContinue = failStep(s, error);
    }
  }

  if (canContinue) {
    const s = step("code-context value --json");
    const r = run(codeContext, ["value", "--json"], { cwd: installRoot, env, timeout: 30000 });
    try {
      if (!r.ok) throw new Error(cleanOutput(r.stderr || r.stdout || r.error));
      const data = parseJson(r.stdout, "code-context value --json");
      if (!data.summary || !data.reportPaths?.markdown || !data.reportPaths?.json) throw new Error("value output missing summary/reportPaths");
      s.ok(`tokens saved: ${data.summary.totalEstimatedTokensSaved ?? 0}`);
    } catch (error) {
      canContinue = failStep(s, error);
    }
  }

  if (canContinue) {
    const s = step("Packed run_context_flow bypasses HarnessRunner");
    try {
      const flowModule = join(installRoot, "node_modules", PACKAGE_NAME, "dist", "mcp", "tools", "runContextFlow.js");
      const source = readFileSync(flowModule, "utf-8");
      const forbidden = ["harness/core/runner", "runModule(", "executeRun(", "HarnessRunner"];
      const match = forbidden.find((needle) => source.includes(needle));
      if (match) throw new Error(`packed run_context_flow references HarnessRunner path: ${match}`);
      s.ok("installed handler has no HarnessRunner import or entrypoint reference");
    } catch (error) {
      canContinue = failStep(s, error);
    }
  }

  if (canContinue) {
    const s = step("MCP stdio initialize and real agent business flow");
    try {
      const result = await exerciseMcpServer(codeContextServer, env, installRoot);
      if (!result.ok) throw new Error(cleanOutput(result.error || result.stderr || result.stdout));
      s.ok(
        `7 tools; scope=${result.scopeId}; tokensSaved=${result.tokensSaved}; ` +
        `originalSha256=${result.originalHash}; memory=${result.memoryId}; flow=${result.flowRunId}`,
      );
    } catch (error) {
      canContinue = failStep(s, error);
    }
  }

  if (canContinue) {
    const s = step("Isolation postflight: database created only under fresh HOME");
    try {
      const dbPath = join(dbDir, "code-context.sqlite");
      if (!existsSync(dbPath)) throw new Error(`expected fresh database not found: ${dbPath}`);
      if (!resolve(dbPath).startsWith(resolve(freshHome))) throw new Error(`database path escaped fresh HOME: ${dbPath}`);
      s.ok(`fresh database: ${dbPath}`);
    } catch (error) {
      failStep(s, error);
    }
  }

  const { passed, failed } = writeReport();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  const s = step("Smoke test crash");
  s.fail(error);
  writeReport();
  process.exit(1);
});


