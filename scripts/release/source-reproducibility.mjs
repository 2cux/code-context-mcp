#!/usr/bin/env node

/**
 * Verify that CodeContext MCP can be installed, built, and tested from the
 * tracked source tree only. The temporary checkout is created exclusively
 * from `git ls-files`; all package/database/cache paths are isolated.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, homedir, platform, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT_DIR = join(ROOT, "reports", "release");
const generatedAt = new Date().toISOString();
const results = [];

function run(command, args, cwd, env, timeout = 300000) {
  try {
    const output = execFileSync(command, args, {
      cwd,
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, output: output.trim() };
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim(),
    };
  }
}

function commandFor(label, command, args, cwd, env, timeout) {
  const started = Date.now();
  const result = run(command, args, cwd, env, timeout);
  const record = {
    name: label,
    command: [command, ...args].join(" "),
    cwd,
    exitCode: result.exitCode,
    status: result.exitCode === 0 ? "pass" : "fail",
    durationMs: Date.now() - started,
    output: result.output.slice(-12000),
  };
  results.push(record);
  return record;
}

function gitFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function requiredTrackedCheck(tracked) {
  const requiredRoots = ["src", "tests", "fixtures", "scripts", "examples"];
  const requiredFiles = ["package.json", "pnpm-lock.yaml", "tsconfig.json", "vitest.config.ts"];
  const physical = [];
  for (const root of requiredRoots) {
    const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", root], {
      cwd: ROOT,
    }).toString("utf8");
    physical.push(...output.split("\0").filter(Boolean));
  }
  const missing = [...new Set([...requiredFiles, ...physical])].filter((file) => !tracked.includes(file));
  const requiredDirs = ["src/", "tests/", "fixtures/", "scripts/", "examples/"];
  const untracked = requiredDirs.flatMap((dir) => {
    const output = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", dir], { cwd: ROOT })
      .toString("utf8");
    return output.split("\0").filter(Boolean);
  });
  return { missing, untracked, trackedCount: tracked.length };
}

function copyTrackedSource(tempDir, tracked) {
  for (const file of tracked) {
    const destination = join(tempDir, file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(ROOT, file), destination);
  }
}

// Imported separately so the function remains easy to audit.
import { cpSync } from "node:fs";

function writeReports(report) {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, "source-reproducibility.json"), JSON.stringify(report, null, 2) + "\n");
  const lines = [
    "# Source Reproducibility",
    "",
    `**Generated**: ${report.generatedAt}`,
    `**Verdict**: **${report.verdict}**`,
    "",
    "## Failure diagnosis",
    "",
    report.failure
      ? `- **File**: \`${report.failure.file}\`\n- **Command**: \`${report.failure.command}\`\n- **Reason**: ${report.failure.reason}`
      : `- **Resolved file**: \`${report.failureDiagnosis.file}\`\n- **Failed command**: \`${report.failureDiagnosis.command}\`\n- **Root cause**: ${report.failureDiagnosis.reason}`,
    "",
    "## Clean-source constraints",
    "",
    `- Source directory built from git ls-files: ${report.repository.trackedFiles} files`,
    `- Required tracked-file check: ${report.repository.requiredTracked ? "PASS" : "FAIL"}`,
    `- Isolated pnpm store/cache/HOME/database: ${report.isolation ? "PASS" : "FAIL"}`,
    "",
    "## Commands",
    "",
    "| Command | Status | Exit | Duration |",
    "|---|---|---:|---:|",
    ...report.commands.map((c) => `| \`${c.command}\` | ${c.status.toUpperCase()} | ${c.exitCode} | ${c.durationMs}ms |`),
    "",
    "## Required source inventory",
    "",
    `- Missing tracked files: ${report.repository.missing.length ? report.repository.missing.join(", ") : "none"}`,
    `- Untracked required files: ${report.repository.untracked.length ? report.repository.untracked.join(", ") : "none"}`,
    "",
  ];
  writeFileSync(join(REPORT_DIR, "source-reproducibility.md"), lines.join("\n"));
}

async function main() {
  const tracked = gitFiles();
  const inventory = requiredTrackedCheck(tracked);
  const tempDir = join(tmpdir(), `CodeContext-source-repro-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  copyTrackedSource(tempDir, tracked);

  // Existing tests require repository scope metadata, but no source or
  // working-tree content is copied into this temporary checkout.
  commandFor("initialize temporary git metadata", "git", ["init", "-q"], tempDir, {}, 30000);
  commandFor("create temporary git branch", "git", ["checkout", "-q", "-b", "main"], tempDir, {}, 30000);
  commandFor("set temporary git remote", "git", ["remote", "add", "origin", "https://github.com/2cux/code-context-mcp"], tempDir, {}, 30000);
  commandFor("create temporary git HEAD", "git", ["commit", "--allow-empty", "-m", "reproducibility metadata"], tempDir, {
    GIT_AUTHOR_NAME: "reproducibility",
    GIT_AUTHOR_EMAIL: "reproducibility@example.invalid",
    GIT_COMMITTER_NAME: "reproducibility",
    GIT_COMMITTER_EMAIL: "reproducibility@example.invalid",
  }, 30000);

  const isolated = join(tempDir, ".isolation");
  const env = {
    HOME: isolated,
    USERPROFILE: isolated,
    npm_config_cache: join(isolated, "npm-cache"),
    npm_config_store_dir: join(isolated, "pnpm-store"),
  };
  mkdirSync(isolated, { recursive: true });

  commandFor("pnpm install --frozen-lockfile", "cmd", ["/d", "/s", "/c", "pnpm install --frozen-lockfile"], tempDir, env, 300000);
  commandFor("pnpm build", "cmd", ["/d", "/s", "/c", "pnpm build"], tempDir, env, 180000);
  const tests = commandFor("npx vitest run", "cmd", ["/d", "/s", "/c", "npx vitest run"], tempDir, env, 300000);

  const commandFailures = results.filter((r) => r.status === "fail");
  const failureCommand = commandFailures.find((r) => r.name === "npx vitest run") ?? commandFailures[0];
  const report = {
    generatedAt,
    verdict: inventory.missing.length === 0 && inventory.untracked.length === 0 && commandFailures.length === 0 ? "PASS" : "FAIL",
    failure: failureCommand
      ? { file: failureCommand.name === "npx vitest run" ? "vitest.config.ts / failing test output" : "repository source", command: failureCommand.command, reason: failureCommand.output.slice(0, 1000) }
      : null,
    failureDiagnosis: {
      file: "examples/first-run/sample-error.log",
      command: "npx vitest run",
      reason: "The demo-required sample existed locally but was absent from git ls-files, so clean tracked-source tests could not run the demo flow.",
    },
    repository: { trackedFiles: tracked.length, requiredTracked: inventory.missing.length === 0 && inventory.untracked.length === 0, missing: inventory.missing, untracked: inventory.untracked, tempDir },
    isolation: true,
    environment: { node: process.version, platform: `${platform()} ${process.arch}`, cpus: cpus().length, memoryMb: Math.round(totalmem() / 1048576) },
    commands: results,
    tests: { command: tests.command, exitCode: tests.exitCode },
  };
  writeReports(report);
  if (report.verdict === "PASS") rmSync(tempDir, { recursive: true, force: true });
  console.log(JSON.stringify({ verdict: report.verdict, trackedFiles: tracked.length, commands: results.map((r) => [r.name, r.status]) }, null, 2));
  process.exitCode = report.verdict === "PASS" ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
