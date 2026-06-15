/**
 * Run Path Utilities
 *
 * Resolves filesystem paths for run records, artifacts, and the
 * .harness/ configuration directory.
 *
 * PRD §34: Run 路径解析工具。
 */

import * as path from "node:path";
import * as fs from "node:fs";

// ── Directory Resolution ──────────────────────────────────────────────────────

/** Resolve the project root (nearest directory containing .git). */
export function resolveProjectRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      // No .git found — use cwd as fallback
      return path.resolve(process.cwd());
    }
    dir = parent;
  }
}

/** Resolve the runs directory path. */
export function resolveRunsDir(projectRoot?: string): string {
  const root = projectRoot ?? resolveProjectRoot();
  return path.join(root, "runs");
}

/** Resolve the .harness config directory path. */
export function resolveHarnessDir(projectRoot?: string): string {
  const root = projectRoot ?? resolveProjectRoot();
  return path.join(root, ".harness");
}

// ── Path Builders ─────────────────────────────────────────────────────────────

/** Build the file path for a run record JSON file. */
export function runRecordPath(runsDir: string, runId: string): string {
  return path.join(runsDir, `${runId}.json`);
}

/** Build the directory path for a run's artifacts. */
export function runArtifactDirPath(runsDir: string, runId: string): string {
  return path.join(runsDir, runId);
}

// ── Directory Setup ───────────────────────────────────────────────────────────

/** Ensure the runs directory and .harness directory exist. */
export function ensureRunDirs(projectRoot?: string): { runsDir: string; harnessDir: string } {
  const root = projectRoot ?? resolveProjectRoot();
  const runsDir = resolveRunsDir(root);
  const harnessDir = resolveHarnessDir(root);

  if (!fs.existsSync(runsDir)) {
    fs.mkdirSync(runsDir, { recursive: true });
  }
  if (!fs.existsSync(harnessDir)) {
    fs.mkdirSync(harnessDir, { recursive: true });
  }

  return { runsDir, harnessDir };
}
