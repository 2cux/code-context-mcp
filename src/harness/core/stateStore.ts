/**
 * File State Store
 *
 * Persists run execution state to the filesystem using a directory-per-run
 * structure under the runs/ directory.
 *
 * Each run directory contains:
 *   state.json      — current RunState snapshot
 *   input.json       — input data supplied to the run
 *   output.json      — output data produced by the run
 *   logs.jsonl       — structured event log (managed by FileReporter)
 *   checkpoints.jsonl — checkpoint event log (managed by FileReporter)
 *   artifacts/       — captured outputs, diffs, logs (managed by FileArtifactStore)
 *
 * PRD §34: Run 执行记录持久化到 runs/ 目录。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ArtifactEntry, Checkpoint, RunId, RunState, RunStatus, SerializedError } from "./types.js";
import { RUN_STATUS_TRANSITIONS } from "./types.js";
import {
  resolveRunsDir,
  runDirPath,
  stateJsonPath,
  inputJsonPath,
  outputJsonPath,
} from "../utils/runPaths.js";

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

// ── Internal Helpers ──────────────────────────────────────────────────────────

/** Ensure a run directory exists. */
function ensureRunDir(runId: RunId): string {
  const dir = runDirPath(runsDir, runId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Read and parse a JSON file. Returns undefined if the file doesn't exist. */
function readJsonFile<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

/** Write an object as formatted JSON to a file. */
function writeJsonFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ── Create ────────────────────────────────────────────────────────────────────

/** Create a new run directory, write input.json and initial state.json. */
export function createRun(
  runId: RunId,
  moduleId: string,
  input: unknown,
  initialPhase?: string,
): RunState {
  ensureRunDir(runId);

  const now = new Date().toISOString();
  const state: RunState = {
    runId,
    moduleId,
    status: "created",
    currentPhase: initialPhase,
    input,
    artifacts: [],
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
  };

  // Write input.json
  writeJsonFile(inputJsonPath(runsDir, runId), input);

  // Write initial state.json
  writeJsonFile(stateJsonPath(runsDir, runId), state);

  return state;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Load a RunState from state.json. Returns undefined if not found. */
export function loadState(runId: RunId): RunState | undefined {
  return readJsonFile<RunState>(stateJsonPath(runsDir, runId));
}

/** List all RunIds in the runs directory. */
export function listRuns(): RunId[] {
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir)
    .filter((f) => {
      const fullPath = path.join(runsDir, f);
      return fs.statSync(fullPath).isDirectory();
    })
    .map((f) => f as RunId)
    .sort();
}

// ── Phase ─────────────────────────────────────────────────────────────────────

/** Update the current phase in state.json. */
export function updatePhase(runId: RunId, phase: string): void {
  const state = loadState(runId);
  if (!state) throw new Error(`Run "${runId}" not found.`);

  state.currentPhase = phase;
  state.updatedAt = new Date().toISOString();
  writeJsonFile(stateJsonPath(runsDir, runId), state);
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

/** Append a checkpoint to the state.json checkpoints array. */
export function updateCheckpoint(runId: RunId, checkpoint: Checkpoint): void {
  const state = loadState(runId);
  if (!state) throw new Error(`Run "${runId}" not found.`);

  state.checkpoints.push(checkpoint);
  state.updatedAt = new Date().toISOString();
  writeJsonFile(stateJsonPath(runsDir, runId), state);
}

// ── Output ────────────────────────────────────────────────────────────────────

/** Write output.json and update state.output. */
export function writeOutput(runId: RunId, output: unknown): void {
  const state = loadState(runId);
  if (!state) throw new Error(`Run "${runId}" not found.`);

  writeJsonFile(outputJsonPath(runsDir, runId), output);
  state.output = output;
  state.updatedAt = new Date().toISOString();
  writeJsonFile(stateJsonPath(runsDir, runId), state);
}

// ── Status Transitions ────────────────────────────────────────────────────────

/** Snapshot data that can be merged into the state during a status transition. */
export interface TransitionSnapshot {
  currentPhase?: string;
  checkpoints?: Checkpoint[];
  artifacts?: ArtifactEntry[];
  output?: unknown;
  error?: SerializedError;
}

/** Transition a run to a new status, validating the transition.
 *  Merges optional snapshot data and writes state.json exactly once. */
function transitionStatus(
  runId: RunId,
  newStatus: RunStatus,
  snap?: TransitionSnapshot,
): RunState {
  const state = loadState(runId);
  if (!state) throw new Error(`Run "${runId}" not found.`);

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

  // Merge snapshot data — single write for the entire transition
  if (snap) {
    if (snap.currentPhase !== undefined) state.currentPhase = snap.currentPhase;
    if (snap.checkpoints !== undefined) state.checkpoints = snap.checkpoints;
    if (snap.artifacts !== undefined) state.artifacts = snap.artifacts;
    if (snap.output !== undefined) state.output = snap.output;
    if (snap.error !== undefined) state.error = snap.error;
  }

  writeJsonFile(stateJsonPath(runsDir, runId), state);
  return state;
}

/** Transition a run to "running" status. */
export function markRunning(runId: RunId): RunState {
  return transitionStatus(runId, "running");
}

/** Mark a run as completed. Merges snapshot data in a single disk write. */
export function markCompleted(runId: RunId, snap?: TransitionSnapshot): RunState {
  return transitionStatus(runId, "completed", snap);
}

/** Mark a run as failed. Records the error and merges snapshot data in a single disk write. */
export function markFailed(
  runId: RunId,
  error: SerializedError,
  snap?: TransitionSnapshot,
): RunState {
  return transitionStatus(runId, "failed", { ...snap, error });
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** Delete a run directory and all its contents. */
export function deleteRun(runId: RunId): boolean {
  const dir = runDirPath(runsDir, runId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// ── Save (for backward compatibility / bulk snapshot) ─────────────────────────

/** Save a full RunState to state.json (overwrites). */
export function saveRun(state: RunState): void {
  ensureRunDir(state.runId);
  writeJsonFile(stateJsonPath(runsDir, state.runId), state);
}

/** Load a RunState from disk. Alias for loadState. */
export function loadRun(runId: RunId): RunState | undefined {
  return loadState(runId);
}
