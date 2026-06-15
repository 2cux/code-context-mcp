/**
 * Run Path Utilities
 *
 * Resolves filesystem paths for run directories, state files, event logs,
 * and the .harness/ configuration directory.
 *
 * PRD §34: Run 路径解析工具。
 *
 * Directory structure per run:
 *   runs/<run-id>/
 *     state.json
 *     input.json
 *     output.json
 *     logs.jsonl
 *     checkpoints.jsonl
 *     artifacts/
 */

import * as path from "node:path";
import * as fs from "node:fs";
import type { RunId } from "../core/types.js";

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

// ── Run Directory ─────────────────────────────────────────────────────────────

/** Build the directory path for a given run. */
export function runDirPath(runsDir: string, runId: RunId): string {
  return path.join(runsDir, runId);
}

// ── Core State Files ──────────────────────────────────────────────────────────

/** Build the path for a run's state.json file. */
export function stateJsonPath(runsDir: string, runId: RunId): string {
  return path.join(runsDir, runId, "state.json");
}

/** Build the path for a run's input.json file. */
export function inputJsonPath(runsDir: string, runId: RunId): string {
  return path.join(runsDir, runId, "input.json");
}

/** Build the path for a run's output.json file. */
export function outputJsonPath(runsDir: string, runId: RunId): string {
  return path.join(runsDir, runId, "output.json");
}

// ── Event Log Files ───────────────────────────────────────────────────────────

/** Build the path for a run's logs.jsonl file. */
export function logsJsonlPath(runsDir: string, runId: RunId): string {
  return path.join(runsDir, runId, "logs.jsonl");
}

/** Build the path for a run's checkpoints.jsonl file. */
export function checkpointsJsonlPath(runsDir: string, runId: RunId): string {
  return path.join(runsDir, runId, "checkpoints.jsonl");
}

// ── Artifacts ─────────────────────────────────────────────────────────────────

/** Build the directory path for a run's artifacts/ subdirectory. */
export function artifactsDirPath(runsDir: string, runId: RunId): string {
  return path.join(runsDir, runId, "artifacts");
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
