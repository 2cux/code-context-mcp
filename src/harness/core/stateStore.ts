/**
 * Run State Store
 *
 * Persists RunState records to the filesystem under the runs/ directory.
 * Each run is stored as a JSON file keyed by RunId.
 * Supports create, read, update, list, and status-transition operations.
 *
 * PRD §34: Run 执行记录持久化到 runs/ 目录。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { RunId, RunState, RunStatus } from "./types.js";
import { RUN_STATUS_TRANSITIONS } from "./types.js";
import { resolveRunsDir } from "../utils/runPaths.js";

// ── Path Resolution ───────────────────────────────────────────────────────────

/** Default runs directory — resolved to an absolute path under the project root. */
const DEFAULT_RUNS_DIR = resolveRunsDir();

let runsDir = DEFAULT_RUNS_DIR;

/** Override the runs directory (test helper). */
export function setRunsDir(dir: string): void {
  runsDir = dir;
}

/** Get the current runs directory. */
export function getRunsDir(): string {
  return runsDir;
}

/** Resolve the file path for a given RunId. */
export function runFilePath(runId: RunId): string {
  return path.join(runsDir, `${runId}.json`);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/** Save a RunState to disk. Creates the runs/ directory if needed. */
export function saveRun(state: RunState): void {
  if (!fs.existsSync(runsDir)) {
    fs.mkdirSync(runsDir, { recursive: true });
  }
  const filePath = runFilePath(state.runId);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/** Load a RunState from disk. Returns undefined if not found. */
export function loadRun(runId: RunId): RunState | undefined {
  const filePath = runFilePath(runId);
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as RunState;
}

/** List all RunIds in the runs directory. */
export function listRuns(): RunId[] {
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "") as RunId)
    .sort();
}

// ── Status Transitions ────────────────────────────────────────────────────────

/** Transition a run to a new status, validating the transition. */
export function transitionStatus(runId: RunId, newStatus: RunStatus): RunState {
  const state = loadRun(runId);
  if (!state) {
    throw new Error(`Run "${runId}" not found.`);
  }

  const allowed = RUN_STATUS_TRANSITIONS[state.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid status transition: "${state.status}" -> "${newStatus}". ` +
        `Allowed: [${allowed.join(", ")}]`,
    );
  }

  state.status = newStatus;
  if (newStatus === "failed" || newStatus === "completed") {
    state.completedAt = new Date().toISOString();
  }
  state.updatedAt = new Date().toISOString();

  saveRun(state);
  return state;
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** Delete a run record from disk. */
export function deleteRun(runId: RunId): boolean {
  const filePath = runFilePath(runId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
