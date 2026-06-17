#!/usr/bin/env node

/**
 * Clean Install & Package Smoke Test
 *
 * Verifies that the package works in a clean environment:
 *   1. Clean install (npm install)
 *   2. Build (tsc)
 *   3. CLI help & version
 *   4. MCP server starts & lists correct tools per mode
 *   5. npm pack tarball is clean (no local data leaks)
 *
 * Usage: node scripts/release/clean-install-smoke.mjs
 */

import { execSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir, totalmem, cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const REPORTS_DIR = join(PROJECT_ROOT, "reports", "release");

// ---------------------------------------------------------------------------
// Report state
// ---------------------------------------------------------------------------

const results = [];
let startTime;

function step(name) {
  const s = { name, status: "pending", durationMs: 0, detail: "", error: null };
  results.push(s);
  const t0 = performance.now();
  process.stdout.write(`  ${name}... `);
  return {
    ok(detail = "") {
      s.status = "ok";
      s.durationMs = Math.round(performance.now() - t0);
      s.detail = detail;
      console.log(`✅ ${s.durationMs}ms`);
    },
    fail(err) {
      s.status = "fail";
      s.durationMs = Math.round(performance.now() - t0);
      s.error = err instanceof Error ? err.message : String(err);
      s.detail = s.error;
      console.log(`❌ ${s.durationMs}ms — ${s.error}`);
    },
    skip(reason) {
      s.status = "skip";
      s.durationMs = 0;
      s.detail = reason;
      console.log(`⏭️ ${reason}`);
    },
  };
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
    },
    summary: { total: results.length, passed, failed, skipped, totalMs },
    steps: results,
  };

  writeFileSync(
    join(REPORTS_DIR, "clean-install-smoke.json"),
    JSON.stringify(report, null, 2),
    "utf-8",
  );

  let md = `# Clean Install & Package Smoke Report\n\n`;
  md += `**Generated**: ${report.generated}\n\n`;
  md += `## Environment\n\n| Key | Value |\n|---|---:|\n`;
  md += `| Node.js | ${report.environment.node} |\n`;
  md += `| Platform | ${report.environment.platform} ${report.environment.arch} |\n`;
  md += `| CPUs | ${report.environment.cpus} |\n`;
  md += `| Memory | ${report.environment.totalMemoryMb}MB |\n\n`;
  md += `## Summary\n\n✅ ${passed} | ❌ ${failed} | ⏭️ ${skipped} | ⏱️ ${totalMs}ms\n\n`;
  md += `## Steps\n\n| # | Step | Status | Duration | Detail |\n|---|---:|---:|---:|---:|\n`;
  results.forEach((s, i) => {
    const icon = s.status === "ok" ? "✅" : s.status === "fail" ? "❌" : "⏭️";
    md += `| ${i + 1} | ${s.name} | ${icon} | ${s.durationMs}ms | ${s.error || s.detail || ""} |\n`;
  });
  md += `\n## Artifacts\n\n- \`reports/release/clean-install-smoke.json\` — structured data\n`;
  md += `- \`reports/release/clean-install-smoke.md\` — this report\n`;

  writeFileSync(join(REPORTS_DIR, "clean-install-smoke.md"), md, "utf-8");

  return { passed, failed };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, opts = {}) {
  const cwd = opts.cwd || PROJECT_ROOT;
  try {
    const out = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: opts.timeout || 60000,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    // npm outputs to stderr, capture both
    return { ok: true, stdout: out, stderr: out };
  } catch (err) {
    const stdout = err.stdout || "";
    const stderr = err.stderr || "";
    return {
      ok: false,
      stdout,
      stderr: stderr || stdout,
      error: err.message,
    };
  }
}

function spawnAndCollect(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || PROJECT_ROOT,
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
      resolve({ ok: code === 0, code, stdout, stderr });
    });

    child.on("error", (err) => {
      resolve({ ok: false, code: -1, stdout, stderr, error: err.message });
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  startTime = performance.now();
  console.log("CodeContext MCP — Clean Install & Package Smoke\n");

  // ---------- 1. Clean install ----------
  {
    const s = step("Clean install");
    // Detect package manager: pnpm (lockfile), then npm
    const hasPnpmLock = existsSync(join(PROJECT_ROOT, "pnpm-lock.yaml"));
    const hasPackageLock = existsSync(join(PROJECT_ROOT, "package-lock.json"));

    let installCmd;
    if (hasPnpmLock) {
      installCmd = "pnpm install --frozen-lockfile --ignore-scripts";
    } else if (hasPackageLock) {
      installCmd = "npm ci --ignore-scripts";
    } else {
      installCmd = "npm install --ignore-scripts";
    }

    const r = run(installCmd, { timeout: 120000 });
    if (r.ok) {
      s.ok(`${hasPnpmLock ? "pnpm" : "npm"} install done`);
    } else {
      // Fallback: regular install
      const fallback = hasPnpmLock
        ? "pnpm install --ignore-scripts"
        : "npm install --ignore-scripts";
      const r2 = run(fallback, { timeout: 120000 });
      if (r2.ok) {
        s.ok(`${hasPnpmLock ? "pnpm" : "npm"} install done (fallback)`);
      } else {
        s.fail(new Error(r.error || r2.error));
      }
    }
  }

  // ---------- 2. Build ----------
  {
    const s = step("Build (tsc)");
    // Clean first
    if (existsSync(join(PROJECT_ROOT, "dist"))) {
      rmSync(join(PROJECT_ROOT, "dist"), { recursive: true, force: true });
    }
    const r = run("npx tsc", { timeout: 120000 });
    if (r.ok) {
      const distExists = existsSync(join(PROJECT_ROOT, "dist", "index.js"));
      if (distExists) {
        s.ok("dist/index.js created");
      } else {
        s.fail(new Error("dist/index.js not found after build"));
      }
    } else {
      s.fail(new Error(r.stderr.slice(0, 200)));
    }
  }

  // ---------- 3. tsc --noEmit ----------
  {
    const s = step("TypeScript check (tsc --noEmit)");
    const r = run("npx tsc --noEmit", { timeout: 60000 });
    if (r.ok) s.ok("zero errors");
    else s.fail(new Error(r.stderr.slice(0, 200)));
  }

  // ---------- 4. CLI version ----------
  {
    const s = step("CLI version");
    const r = await spawnAndCollect(
      "node", ["dist/cli/index.js", "--version"],
      { timeout: 10000 },
    );
    if (r.ok && r.stdout.trim()) {
      s.ok(`version: ${r.stdout.trim()}`);
    } else {
      s.fail(new Error(r.stderr || r.error || "no output"));
    }
  }

  // ---------- 5. CLI help ----------
  {
    const s = step("CLI help");
    const r = await spawnAndCollect(
      "node", ["dist/cli/index.js", "--help"],
      { timeout: 10000 },
    );
    if (r.ok && r.stdout.includes("Usage")) {
      s.ok("help displayed");
    } else {
      s.fail(new Error("help not displayed"));
    }
  }

  // ---------- 6. MCP server: agent mode (7 tools) ----------
  {
    const s = step("MCP server: agent mode tools");
    // Send tools/list request via stdin, capture response via stdout
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    const child = spawn("node", ["dist/index.js"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, MCP_TOOL_MODE: "agent" },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill();
          resolve({ ok: false, error: "timeout" });
        }
      }, 10000);

      child.stdout.on("data", (d) => {
        stdout += d.toString();
        // Try to parse JSON-RPC response
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
        } catch {
          // Not enough data yet
        }
      });

      child.stderr.on("data", (d) => { stderr += d.toString(); });

      child.on("close", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ ok: false, error: "closed before response", stderr });
        }
      });

      child.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ ok: false, error: err.message });
        }
      });

      // Send the request
      child.stdin.write(request + "\n");
    });

    if (result.ok) {
      const toolCount = result.tools.length;
      const toolNames = result.tools.map((t) => t.name).join(", ");
      if (toolCount === 7) {
        s.ok(`7 tools (agent mode): ${toolNames}`);
      } else {
        s.fail(new Error(`expected 7 tools, got ${toolCount}: ${toolNames}`));
      }
    } else {
      s.fail(new Error(result.error));
    }
  }

  // ---------- 7. MCP server: dev mode (18 tools) ----------
  {
    const s = step("MCP server: dev mode tools");
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    const child = spawn("node", ["dist/index.js"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, MCP_TOOL_MODE: "dev" },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill();
          resolve({ ok: false, error: "timeout" });
        }
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
        } catch {
          // Not enough data yet
        }
      });

      child.stderr.on("data", (d) => { stderr += d.toString(); });

      child.on("close", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ ok: false, error: "closed before response", stderr });
        }
      });

      child.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ ok: false, error: err.message });
        }
      });

      child.stdin.write(request + "\n");
    });

    if (result.ok) {
      const toolCount = result.tools.length;
      const harnessTools = result.tools.filter((t) =>
        t.name.toLowerCase().includes("harness")
      );
      const hiddenCount = harnessTools.length;
      if (toolCount === 18) {
        s.ok(`18 tools (dev mode, ${hiddenCount} harness)`);
      } else {
        s.fail(new Error(`expected 18 tools, got ${toolCount}`));
      }
    } else {
      s.fail(new Error(result.error));
    }
  }

  // ---------- 8. npm pack tarball check ----------
  {
    const s = step("npm pack: tarball content check");
    // npm outputs file list to stderr; merge into stdout via shell
    const isWin = process.platform === "win32";
    const r = run(isWin ? "cmd /c \"npm pack --dry-run 2>&1\"" : "npm pack --dry-run 2>&1", { timeout: 30000 });
    if (r.ok) {
      const output = (r.stdout || "") + "\n" + (r.stderr || "");
      const forbidden = ["runs/", "raw-results.jsonl", ".sqlite", "originals/", ".env"];
      const findings = [];

      // npm pack --dry-run lists files with format: "npm notice <size> <path>"
      // Size patterns: 1.1kB, 13.7kB, 2.2MB, 398B, etc.
      const fileLinePattern = /^npm notice\s+[\d.]+[kM]?B\s+(.+)$/;
      const includedFiles = output
        .split("\n")
        .map((l) => {
          const m = l.trim().match(fileLinePattern);
          return m ? m[1] : null;
        })
        .filter(Boolean);

      for (const pattern of forbidden) {
        for (const file of includedFiles) {
          // dist/originals/ is source code, not cached user data
          // Only flag top-level originals/, runs/, .sqlite, .env
          if (file.startsWith("dist/") && pattern !== ".env" && pattern !== "*.sqlite") continue;
          if (file.includes(pattern) || file.endsWith(pattern.replace("*", ""))) {
            findings.push(`${pattern} → ${file}`);
          }
        }
      }

      if (findings.length === 0) {
        s.ok(`no forbidden files in ${includedFiles.length} packaged files`);
      } else {
        s.fail(new Error(`forbidden files found: ${findings.join("; ")}`));
      }
    } else {
      s.fail(new Error(r.stderr.slice(0, 200)));
    }
  }

  // ---------- 9. Check package.json version ----------
  {
    const s = step("Package version");
    try {
      const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8"));
      s.ok(`v${pkg.version}`);
    } catch (err) {
      s.fail(err);
    }
  }

  // ---------- Final ----------
  const { passed, failed } = writeReport();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
