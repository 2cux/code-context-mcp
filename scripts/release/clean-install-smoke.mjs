#!/usr/bin/env node

/**
 * Fresh Install Package Smoke Test
 *
 * Verifies the npm tarball in an isolated first-run environment:
 * 1. npm pack after build.
 * 2. install the generated tgz in a temporary project.
 * 3. run package bins with brand-new HOME/USERPROFILE and empty DB dir.
 * 4. fail non-zero on any failed step.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, totalmem, cpus } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const REPORTS_DIR = join(PROJECT_ROOT, "reports", "release");
const PACKAGE_NAME = "code-context-mcp";
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

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

async function probeServer(command, env, cwd) {
  const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
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
  let stderr = "";
  let settled = false;

  return await new Promise((resolvePromise) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill();
      resolvePromise(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: "timeout waiting for tools/list response", stdout, stderr });
    }, 10000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      for (const line of stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed?.result?.tools) {
            finish({ ok: true, tools: parsed.result.tools, stdout, stderr });
            return;
          }
        } catch {
          // Keep collecting until a complete JSON-RPC line arrives.
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => finish({ ok: false, error: error.message, stdout, stderr }));
    child.on("close", (code) => finish({ ok: false, error: `server exited before response with code ${code}`, stdout, stderr }));
    child.stdin.write(`${request}\n`);
  });
}

function writeReport() {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const totalMs = Math.round(performance.now() - startTime);
  const passed = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const report = {
    generated: new Date().toISOString(),
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
  md += `**Generated**: ${report.generated}\n\n`;
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
  context = { tempRoot, installRoot, freshHome, dbDir, tgzPath: null, packageName: PACKAGE_NAME };

  const env = makeFreshEnv(freshHome, npmCache);
  let canContinue = true;

  {
    const s = step("Build package artifacts");
    const r = run(NPM, ["run", "build"], { env, timeout: 120000 });
    if (r.ok && existsSync(join(PROJECT_ROOT, "dist", "index.js"))) s.ok("dist/index.js created");
    else canContinue = failStep(s, new Error(cleanOutput(r.stderr || r.stdout || r.error)));
  }

  if (canContinue) {
    const s = step("npm pack");
    const r = run(NPM, ["pack", "--json", "--pack-destination", tempRoot], { env, timeout: 60000 });
    try {
      if (!r.ok) throw new Error(cleanOutput(r.stderr || r.stdout || r.error));
      const data = parseJson(r.stdout, "npm pack");
      const first = Array.isArray(data) ? data[0] : null;
      if (!first?.filename) throw new Error("npm pack did not report a tarball filename");
      const tgzPath = join(tempRoot, first.filename);
      if (!existsSync(tgzPath)) throw new Error(`tarball not found: ${tgzPath}`);
      context.tgzPath = tgzPath;
      s.ok(`${basename(tgzPath)} (${first.files?.length ?? "unknown"} files)`);
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
    const s = step("code-context-server first startup");
    try {
      const result = await probeServer(codeContextServer, env, installRoot);
      if (!result.ok) throw new Error(cleanOutput(result.error || result.stderr || result.stdout));
      if (!Array.isArray(result.tools) || result.tools.length !== 7) throw new Error(`expected 7 agent tools, got ${result.tools?.length ?? "none"}`);
      s.ok(`server responded with ${result.tools.length} agent tools`);
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


