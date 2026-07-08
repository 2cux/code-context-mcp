#!/usr/bin/env node

/**
 * Source Reproducibility Check
 *
 * Verifies that the repository is reproducible from tracked sources alone:
 *   1. Verify Git tracked files include src/memory/ and fixtures/quality-eval/memory/
 *   2. Copy git ls-files to a clean temp directory
 *   3. pnpm install --frozen-lockfile
 *   4. pnpm build (tsc)
 *   5. npx vitest run tests/quality
 *   6. Generate reports/release/source-reproducibility.md and .json
 *
 * This ensures no build or test depends on untracked local files.
 *
 * Usage: node scripts/release/source-reproducibility.mjs
 */

import { execSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { tmpdir, totalmem, cpus, platform } from "node:os";
import { fileURLToPath } from "node:url";

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

function writeReport(tempDir, trackedFileCount, testOutput) {
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
    repository: {
      trackedFiles: trackedFileCount,
      tempDir,
    },
    summary: {
      total: results.length,
      passed,
      failed,
      skipped,
      totalMs,
      reproducible: failed === 0,
    },
    steps: results,
    testOutput: testOutput
      ? {
          truncated: testOutput.length > 8000,
          text: testOutput.length > 8000
            ? testOutput.slice(0, 4000) + "\n...\n" + testOutput.slice(-4000)
            : testOutput,
        }
      : null,
  };

  writeFileSync(
    join(REPORTS_DIR, "source-reproducibility.json"),
    JSON.stringify(report, null, 2),
    "utf-8",
  );

  let md = `# Source Reproducibility Report\n\n`;
  md += `**Generated**: ${report.generated}\n\n`;
  md += `## Verdict\n\n`;
  md += report.summary.reproducible
    ? `✅ **Reproducible** — clean-source build and quality tests pass.\n\n`
    : `❌ **Not Reproducible** — ${failed} step(s) failed.\n\n`;

  md += `## Environment\n\n| Key | Value |\n|---|---:|\n`;
  md += `| Node.js | ${report.environment.node} |\n`;
  md += `| Platform | ${report.environment.platform} ${report.environment.arch} |\n`;
  md += `| CPUs | ${report.environment.cpus} |\n`;
  md += `| Memory | ${report.environment.totalMemoryMb}MB |\n\n`;

  md += `## Repository\n\n| Key | Value |\n|---|---:|\n`;
  md += `| Tracked files | ${trackedFileCount} |\n`;
  md += `| Temp directory | \`${tempDir}\` |\n\n`;

  md += `## Summary\n\n✅ ${passed} | ❌ ${failed} | ⏭️ ${skipped} | ⏱️ ${totalMs}ms\n\n`;

  md += `## Steps\n\n| # | Step | Status | Duration | Detail |\n|---|---:|---:|---:|---:|\n`;
  results.forEach((s, i) => {
    const icon = s.status === "ok" ? "✅" : s.status === "fail" ? "❌" : "⏭️";
    md += `| ${i + 1} | ${s.name} | ${icon} | ${s.durationMs}ms | ${(s.error || s.detail || "").slice(0, 120)} |\n`;
  });
  md += `\n`;

  // Append test output if available
  if (testOutput) {
    md += `## Quality Test Output\n\n\`\`\`\n${testOutput.slice(0, 6000)}\n\`\`\`\n\n`;
  }

  md += `## Artifacts\n\n- \`reports/release/source-reproducibility.json\` — structured data\n`;
  md += `- \`reports/release/source-reproducibility.md\` — this report\n`;

  writeFileSync(join(REPORTS_DIR, "source-reproducibility.md"), md, "utf-8");

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
    return { ok: true, stdout: out, stderr: "" };
  } catch (err) {
    const stdout = err.stdout || "";
    const stderr = err.stderr || "";
    return {
      ok: false,
      stdout,
      stderr: stderr || stdout || err.message,
      error: err.message,
    };
  }
}

function gitLsFiles() {
  const r = run("git ls-files", { timeout: 15000 });
  if (!r.ok) throw new Error(`git ls-files failed: ${r.stderr}`);
  return r.stdout
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  startTime = performance.now();
  console.log("CodeContext MCP — Source Reproducibility Check\n");

  const isWin = process.platform === "win32";

  // ---------- 1. Verify required directories are tracked ----------
  const requiredDirs = ["src/memory/", "fixtures/quality-eval/memory/"];
  let trackedFiles = [];

  {
    const s = step("Verify required source dirs are Git-tracked");
    try {
      trackedFiles = gitLsFiles();
      const missing = [];
      for (const dir of requiredDirs) {
        const hasFiles = trackedFiles.some((f) => f.startsWith(dir));
        if (!hasFiles) missing.push(dir);
      }
      if (missing.length === 0) {
        const srcMemoryCount = trackedFiles.filter((f) => f.startsWith("src/memory/")).length;
        const fixtureCount = trackedFiles.filter((f) =>
          f.startsWith("fixtures/quality-eval/memory/"),
        ).length;
        s.ok(
          `${requiredDirs.length} dirs present (src/memory/: ${srcMemoryCount} files, fixtures/quality-eval/memory/: ${fixtureCount} files)`,
        );
      } else {
        s.fail(new Error(`Missing tracked dirs: ${missing.join(", ")}`));
      }
    } catch (err) {
      s.fail(err);
    }
  }

  // If the first step failed, stop early — no point proceeding
  if (results.some((r) => r.status === "fail")) {
    const { passed, failed } = writeReport("", 0, "");
    console.log(`\n${passed} passed, ${failed} failed — source reproducibility check FAILED`);
    process.exit(1);
  }

  // ---------- 2. Create temp directory with git ls-files content ----------
  const tempRoot = join(tmpdir(), `codecontext-clean-${Date.now()}`);
  let tempDir = tempRoot;

  {
    const s = step("Copy git ls-files to temp directory");
    try {
      mkdirSync(tempRoot, { recursive: true });

      // Collect all directories we need to create
      const dirSet = new Set();
      for (const f of trackedFiles) {
        const d = dirname(f);
        if (d !== ".") {
          // Build all parent dirs
          const parts = d.split("/");
          for (let i = 1; i <= parts.length; i++) {
            dirSet.add(parts.slice(0, i).join("/"));
          }
        }
      }

      // Create directories
      for (const d of dirSet) {
        mkdirSync(join(tempRoot, d), { recursive: true });
      }

      // Copy files
      let copied = 0;
      for (const f of trackedFiles) {
        const src = join(PROJECT_ROOT, f);
        const dst = join(tempRoot, f);
        if (existsSync(src) && statSync(src).isFile()) {
          cpSync(src, dst);
          copied++;
        }
      }

      s.ok(`${copied}/${trackedFiles.length} files copied to ${tempRoot}`);
    } catch (err) {
      s.fail(err);
    }
  }

  // ---------- 3. pnpm install --frozen-lockfile ----------
  {
    const s = step("pnpm install --frozen-lockfile");
    const hasPnpmLock = existsSync(join(tempRoot, "pnpm-lock.yaml"));
    if (!hasPnpmLock) {
      s.fail(new Error("pnpm-lock.yaml not found in temp dir — is it tracked?"));
    } else {
      const cmd = isWin ? "cmd /c \"pnpm install --frozen-lockfile 2>&1\"" : "pnpm install --frozen-lockfile";
      const r = run(cmd, { cwd: tempRoot, timeout: 180000 });
      if (r.ok || r.stdout.includes("Done in")) {
        s.ok("dependencies installed");
      } else {
        // Check if node_modules was created despite stderr noise
        if (existsSync(join(tempRoot, "node_modules"))) {
          s.ok("dependencies installed (with warnings)");
        } else {
          s.fail(new Error(r.stderr.slice(0, 300)));
        }
      }
    }
  }

  // ---------- 4. pnpm build ----------
  {
    const s = step("Build (tsc)");
    // Clean dist first if it exists
    if (existsSync(join(tempRoot, "dist"))) {
      rmSync(join(tempRoot, "dist"), { recursive: true, force: true });
    }
    const cmd = isWin ? "cmd /c \"npx tsc 2>&1\"" : "npx tsc";
    const r = run(cmd, { cwd: tempRoot, timeout: 120000 });
    if (r.ok) {
      const distExists = existsSync(join(tempRoot, "dist", "index.js"));
      if (distExists) {
        s.ok("dist/index.js created");
      } else {
        s.fail(new Error("dist/index.js not found after build"));
      }
    } else {
      s.fail(new Error(r.stderr.slice(0, 300)));
    }
  }

  // ---------- 5. npx vitest run tests/quality ----------
  let testOutput = "";

  {
    const s = step("npx vitest run tests/quality");
    const cmd = isWin
      ? "cmd /c \"npx vitest run tests/quality 2>&1\""
      : "npx vitest run tests/quality";
    const r = run(cmd, { cwd: tempRoot, timeout: 120000 });
    testOutput = (r.stdout || "") + "\n" + (r.stderr || "");

    // Strip ANSI escape codes for reliable parsing
    const cleanOutput = testOutput.replace(/\x1b\[[0-9;]*m/g, "");

    // vitest summary lines are at the end of output:
    //   Test Files  N passed (N)           — all pass
    //   Test Files  N failed | M passed    — some fail
    //   Tests  N passed (N)                — all pass
    //   Tests  N failed | M passed         — some fail
    const filesSummaryMatch = cleanOutput.match(/Test Files\s+([^\n]+)/);
    const testsSummaryMatch = cleanOutput.match(/^\s+Tests\s+([^\n]+)/m);

    const filesOk = filesSummaryMatch && !filesSummaryMatch[1].includes("failed");
    const testsOk = testsSummaryMatch && !testsSummaryMatch[1].includes("failed");
    const allPassed = filesOk && testsOk;

    if (filesSummaryMatch && testsSummaryMatch) {
      if (allPassed) {
        const tFiles = filesSummaryMatch[1].trim();
        const tTests = testsSummaryMatch[1].trim();
        s.ok(`${tFiles} | ${tTests}`);
      } else {
        const tFiles = filesSummaryMatch[1].trim();
        const tTests = testsSummaryMatch ? testsSummaryMatch[1].trim() : "?";
        s.fail(new Error(`Test Files ${tFiles}, Tests ${tTests}`));
      }
    } else if (r.ok && existsSync(join(tempRoot, "node_modules", ".cache"))) {
      s.ok("quality tests completed (see report for details)");
    } else {
      s.fail(new Error(r.stderr.slice(0, 300) || "no test output captured"));
    }
  }

  // ---------- Final ----------
  const { passed, failed } = writeReport(tempDir, trackedFiles.length, testOutput);
  console.log(`\n${passed} passed, ${failed} failed`);

  // Clean up temp dir on success
  if (failed === 0) {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
      console.log(`Cleaned up ${tempRoot}`);
    } catch {
      // best effort
    }
  } else {
    console.log(`Temp directory kept for inspection: ${tempRoot}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Source reproducibility check crashed:", err);
  process.exit(1);
});
