/**
 * File Artifact Store
 *
 * Persists run artifacts (captured outputs, diffs, logs) to the filesystem
 * under runs/<runId>/artifacts/ directory. Artifacts are keyed by a logical
 * name and stored with appropriate file extensions.
 *
 * Supports typed write methods:
 *   - writeMarkdown  (.md)
 *   - writeJson      (.json)
 *   - writeText      (.txt)
 *   - writeLog       (.log)
 *
 * PRD §34: Run 执行记录持久化到 runs/ 目录，artifacts 按 run 组织。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { RunId } from "./types.js";
import { getRunsDir } from "./stateStore.js";
import { artifactsDirPath } from "../utils/runPaths.js";

// ── Path Helpers ──────────────────────────────────────────────────────────────

/** Resolve the artifacts directory for a given run. */
export function artifactDir(runId: RunId): string {
  return artifactsDirPath(getRunsDir(), runId);
}

/** Ensure the artifacts directory exists. */
function ensureArtifactsDir(runId: RunId): void {
  const dir = artifactDir(runId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Name Validation ───────────────────────────────────────────────────────────

/**
 * Sanitize an artifact name to prevent path traversal.
 * Only allows alphanumeric chars, hyphens, underscores, dots, and slashes
 * within a single path segment (no ".." or absolute paths).
 */
function sanitizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Artifact name must not be empty.");
  }
  if (trimmed.includes("..")) {
    throw new Error(`Artifact name must not contain "..": ${trimmed}`);
  }
  if (path.isAbsolute(trimmed)) {
    throw new Error(`Artifact name must not be an absolute path: ${trimmed}`);
  }
  // Resolve and strip any leading traversal segments
  const resolved = path.resolve("/", trimmed);
  const relative = path.relative("/", resolved);
  if (relative === "") {
    throw new Error(`Artifact name resolves to root: ${trimmed}`);
  }
  return relative;
}

// ── Typed Write Methods ───────────────────────────────────────────────────────

/** Write a markdown artifact (.md extension appended if not present). */
export function writeMarkdown(runId: RunId, name: string, content: string): void {
  const safeName = sanitizeName(name);
  const fileName = safeName.endsWith(".md") ? safeName : `${safeName}.md`;
  ensureArtifactsDir(runId);
  const filePath = path.join(artifactDir(runId), fileName);
  fs.writeFileSync(filePath, content, "utf-8");
}

/** Write a JSON artifact (.json extension appended if not present). */
export function writeJson(runId: RunId, name: string, content: unknown): void {
  const safeName = sanitizeName(name);
  const fileName = safeName.endsWith(".json") ? safeName : `${safeName}.json`;
  ensureArtifactsDir(runId);
  const filePath = path.join(artifactDir(runId), fileName);
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(filePath, text, "utf-8");
}

/** Write a text artifact (.txt extension appended if not present). */
export function writeText(runId: RunId, name: string, content: string): void {
  const safeName = sanitizeName(name);
  const fileName = safeName.endsWith(".txt") ? safeName : `${safeName}.txt`;
  ensureArtifactsDir(runId);
  const filePath = path.join(artifactDir(runId), fileName);
  fs.writeFileSync(filePath, content, "utf-8");
}

/** Write a log artifact (.log extension appended if not present). */
export function writeLog(runId: RunId, name: string, content: string): void {
  const safeName = sanitizeName(name);
  const fileName = safeName.endsWith(".log") ? safeName : `${safeName}.log`;
  ensureArtifactsDir(runId);
  const filePath = path.join(artifactDir(runId), fileName);
  fs.writeFileSync(filePath, content, "utf-8");
}

// ── Generic Write (backward compatibility) ────────────────────────────────────

/**
 * Sanitize an artifact name to prevent path traversal.
 * Exported so that consumers (e.g. HarnessContext) can build consistent
 * ArtifactEntry paths that match the actual on-disk filename.
 */
export function sanitizeArtifactName(name: string): string {
  return sanitizeName(name);
}

/** Write an artifact with an explicit file name (no extension logic applied). */
export function writeArtifact(
  runId: RunId,
  name: string,
  content: string,
  encoding: BufferEncoding = "utf-8",
): void {
  const safeName = sanitizeName(name);
  ensureArtifactsDir(runId);
  const filePath = path.join(artifactDir(runId), safeName);
  fs.writeFileSync(filePath, content, encoding);
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Read an artifact for a run. Returns undefined if not found. */
export function readArtifact(runId: RunId, name: string): string | undefined {
  const safeName = sanitizeName(name);
  const filePath = path.join(artifactDir(runId), safeName);
  if (!fs.existsSync(filePath)) return undefined;
  return fs.readFileSync(filePath, "utf-8");
}

// ── List ──────────────────────────────────────────────────────────────────────

/** List all artifact names for a run. */
export function listArtifacts(runId: RunId): string[] {
  const dir = artifactDir(runId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .sort();
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** Delete a single artifact for a run. */
export function deleteArtifact(runId: RunId, name: string): boolean {
  const safeName = sanitizeName(name);
  const filePath = path.join(artifactDir(runId), safeName);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/** Delete all artifacts for a run. */
export function deleteAllArtifacts(runId: RunId): void {
  const dir = artifactDir(runId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
