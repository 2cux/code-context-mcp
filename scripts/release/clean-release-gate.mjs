#!/usr/bin/env node

/**
 * Traceable clean release gate.
 *
 * The caller repository is read-only for the duration of the gate. All builds,
 * reports, npm artifacts, installs, and smoke state live under one temporary
 * run directory. This script never creates a tag and never publishes a package.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN_ROOT = mkdtempSync(join(tmpdir(), "code-context-release-gate-"));
const WORKTREE = join(RUN_ROOT, "source");
const ARTIFACTS_DIR = join(RUN_ROOT, "artifacts");
const REPORTS_DIR = join(RUN_ROOT, "reports");
const GATE_LOG = join(RUN_ROOT, "stable-readiness.log");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const startedAt = performance.now();

mkdirSync(ARTIFACTS_DIR, { recursive: true });
mkdirSync(REPORTS_DIR, { recursive: true });

const steps = [];
let worktreeAdded = false;
let commit = null;
let initialStatus = null;
let finalStatus = null;
let finalCommit = null;
let tgzPath = null;
let tgzSha256 = null;
let packageFileCount = null;
let stableReport = null;
let smokeReport = null;
let fatalError = null;

function commandName(command, args) {
  return [command, ...args].join(" ");
}

function run(command, args, options = {}) {
  const started = performance.now();
  const actualCommand = process.platform === "win32" && command.endsWith(".cmd")
    ? (process.env.ComSpec || "cmd.exe")
    : command;
  const actualArgs = process.platform === "win32" && command.endsWith(".cmd")
    ? ["/d", "/s", "/c", command, ...args]
    : args;
  try {
    const stdout = execFileSync(actualCommand, actualArgs, {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, ...(options.env ?? {}) },
      encoding: "utf-8",
      timeout: options.timeout ?? 120000,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    steps.push({
      name: options.name ?? commandName(command, args),
      command: commandName(command, args),
      status: "PASS",
      exitCode: 0,
      durationMs: Math.round(performance.now() - started),
    });
    return stdout;
  } catch (error) {
    const stdout = error.stdout?.toString?.() ?? "";
    const stderr = error.stderr?.toString?.() ?? "";
    const detail = `${stderr}\n${stdout}`.trim().slice(-4000) || error.message;
    steps.push({
      name: options.name ?? commandName(command, args),
      command: commandName(command, args),
      status: "FAIL",
      exitCode: Number.isInteger(error.status) ? error.status : 1,
      durationMs: Math.round(performance.now() - started),
      detail,
    });
    throw new Error(`${options.name ?? commandName(command, args)} failed: ${detail}`);
  }
}

function git(args, options = {}) {
  return run("git", args, { ...options, cwd: options.cwd ?? ROOT }).trim();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function copyReports() {
  const source = join(WORKTREE, "reports");
  if (existsSync(source)) cpSync(source, REPORTS_DIR, { recursive: true, force: true });
}

function writeReport() {
  const generatedAt = new Date().toISOString();
  const initialGitDirty = initialStatus === null ? null : initialStatus.length > 0;
  const finalGitDirty = finalStatus === null ? null : finalStatus.length > 0;
  const sameIdentity = Boolean(
    commit &&
    tgzSha256 &&
    stableReport?.gitCommit === commit &&
    stableReport?.tgzSha256 === tgzSha256 &&
    stableReport?.packageFileCount === packageFileCount &&
    smokeReport?.gitCommit === commit &&
    smokeReport?.tgzSha256 === tgzSha256 &&
    smokeReport?.packageFileCount === packageFileCount,
  );
  const stablePassed = stableReport && ["PASS", "WARNING"].includes(stableReport.verdict);
  const smokePassed = smokeReport?.summary?.failed === 0;
  const callerUnchanged = initialGitDirty === false && finalGitDirty === false && finalCommit === commit;
  const verdict = !fatalError && stablePassed && smokePassed && sameIdentity && callerUnchanged
    ? "PASS"
    : "FAIL";
  const report = {
    verdict,
    generatedAt,
    gitCommit: commit,
    gitDirty: initialGitDirty,
    finalGitDirty,
    finalGitCommit: finalCommit,
    tgzSha256,
    packageFileCount,
    tgzPath,
    runDirectory: RUN_ROOT,
    reportsDirectory: REPORTS_DIR,
    stableVerdict: stableReport?.verdict ?? null,
    freshInstallSmokePassed: smokePassed,
    sameCommitAndTgz: sameIdentity,
    callerWorkingTreeUnchanged: callerUnchanged,
    error: fatalError,
    summary: {
      totalDurationMs: Math.round(performance.now() - startedAt),
      passedSteps: steps.filter((step) => step.status === "PASS").length,
      failedSteps: steps.filter((step) => step.status === "FAIL").length,
    },
    steps,
  };

  writeFileSync(join(RUN_ROOT, "release-gate.json"), JSON.stringify(report, null, 2), "utf-8");
  const lines = [
    "# Traceable Clean Release Gate",
    "",
    `**Verdict**: ${verdict}`,
    `**Generated**: ${generatedAt}`,
    "",
    "## Provenance",
    "",
    "| Field | Value |",
    "|---|---|",
    `| git commit | \`${commit ?? "unknown"}\` |`,
    `| git dirty (before) | \`${initialGitDirty ?? "unknown"}\` |`,
    `| git dirty (after) | \`${finalGitDirty ?? "unknown"}\` |`,
    `| tgz SHA-256 | \`${tgzSha256 ?? "unknown"}\` |`,
    `| package file count | ${packageFileCount ?? "unknown"} |`,
    `| same commit and tgz | ${sameIdentity ? "PASS" : "FAIL"} |`,
    `| fresh-install MCP smoke | ${smokePassed ? "PASS" : "FAIL"} |`,
    `| caller working tree unchanged | ${callerUnchanged ? "PASS" : "FAIL"} |`,
    "",
    "## Temporary outputs",
    "",
    `- Final tgz: \`${tgzPath ?? "not produced"}\``,
    `- Reports: \`${REPORTS_DIR}\``,
    `- Stable gate log: \`${GATE_LOG}\``,
    "",
    "This gate does not create tags and does not run `npm publish`.",
    "",
  ];
  if (fatalError) lines.push("## Failure", "", fatalError, "");
  writeFileSync(join(RUN_ROOT, "release-gate.md"), lines.join("\n"), "utf-8");
  return report;
}

async function main() {
  try {
    commit = git(["rev-parse", "HEAD"], { name: "Capture release commit" });
    initialStatus = git(
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { name: "Require clean caller working tree" },
    );
    if (initialStatus) {
      steps[steps.length - 1] = {
        ...steps[steps.length - 1],
        status: "FAIL",
        exitCode: 1,
        detail: initialStatus,
      };
      throw new Error(`release gate requires a clean working tree:\n${initialStatus}`);
    }

    git(["worktree", "add", "--detach", WORKTREE, commit], {
      name: "Create detached temporary release worktree",
      timeout: 60000,
    });
    worktreeAdded = true;

    const isolatedHome = join(RUN_ROOT, "home");
    const env = {
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      npm_config_cache: join(RUN_ROOT, "npm-cache"),
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      npm_config_audit: "false",
    };
    mkdirSync(isolatedHome, { recursive: true });

    run(PNPM, ["install", "--frozen-lockfile"], {
      cwd: WORKTREE,
      env,
      timeout: 600000,
      name: "Install dependencies in temporary worktree",
    });
    run(PNPM, ["build"], {
      cwd: WORKTREE,
      env,
      timeout: 180000,
      name: "Build release package",
    });

    const packOutput = run(NPM, ["pack", "--json", "--pack-destination", ARTIFACTS_DIR], {
      cwd: WORKTREE,
      env,
      timeout: 120000,
      name: "Create final npm tgz",
    });
    const pack = JSON.parse(packOutput);
    const packageInfo = Array.isArray(pack) ? pack[0] : null;
    if (!packageInfo?.filename || !Array.isArray(packageInfo.files)) {
      throw new Error("npm pack did not return filename and file inventory");
    }
    tgzPath = join(ARTIFACTS_DIR, packageInfo.filename);
    packageFileCount = packageInfo.files.length;
    tgzSha256 = sha256(tgzPath);

    const releaseEnv = {
      ...env,
      CODECONTEXT_RELEASE_TGZ: tgzPath,
      CODECONTEXT_RELEASE_TGZ_SHA256: tgzSha256,
      CODECONTEXT_RELEASE_PACKAGE_FILE_COUNT: String(packageFileCount),
      CODECONTEXT_RELEASE_COMMIT: commit,
      CODECONTEXT_RELEASE_GIT_DIRTY: "false",
    };
    let gateOutput = "";
    try {
      gateOutput = run("node", ["scripts/release/stable-readiness-check.mjs"], {
        cwd: WORKTREE,
        env: releaseEnv,
        timeout: 1800000,
        name: "Run stable release gate against final tgz",
      });
    } finally {
      const failureOutput = steps.at(-1)?.name === "Run stable release gate against final tgz"
        ? steps.at(-1)?.detail ?? ""
        : "";
      writeFileSync(GATE_LOG, gateOutput || failureOutput, "utf-8");
    }

    stableReport = readJson(join(WORKTREE, "reports", "release", "stable-readiness.json"));
    smokeReport = readJson(join(WORKTREE, "reports", "release", "fresh-install-smoke.json"));
    if (!["PASS", "WARNING"].includes(stableReport.verdict)) {
      throw new Error(`stable release gate verdict was ${stableReport.verdict}`);
    }
  } catch (error) {
    fatalError = error.stack || error.message || String(error);
  } finally {
    try {
      copyReports();
    } catch (error) {
      fatalError ||= `could not copy temporary reports: ${error.message}`;
    }
    if (worktreeAdded) {
      try {
        git(["worktree", "remove", "--force", WORKTREE], {
          name: "Remove temporary release worktree",
          timeout: 120000,
        });
        git(["worktree", "prune"], { name: "Prune temporary worktree metadata" });
      } catch (error) {
        fatalError ||= error.message;
      }
    }

    try {
      finalCommit = git(["rev-parse", "HEAD"], { name: "Recheck caller commit" });
      finalStatus = git(
        ["status", "--porcelain=v1", "--untracked-files=all"],
        { name: "Recheck caller working tree" },
      );
      if (initialStatus === "" && (finalStatus !== "" || finalCommit !== commit)) {
        fatalError ||= `caller repository changed during gate: commit=${finalCommit}, status=${finalStatus || "clean"}`;
      }
    } catch (error) {
      fatalError ||= error.message;
    }

    const report = writeReport();
    console.log(`${report.verdict}: ${join(RUN_ROOT, "release-gate.json")}`);
    if (tgzPath) console.log(`tgz: ${basename(tgzPath)} sha256=${tgzSha256} files=${packageFileCount}`);
    process.exitCode = report.verdict === "PASS" ? 0 : 1;
  }
}

main();
