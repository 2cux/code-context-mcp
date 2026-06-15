/**
 * Artifact Store Tests
 *
 * Covers: writeArtifact, readArtifact, listArtifacts,
 * deleteArtifact, deleteAllArtifacts, artifactDir.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { setRunsDir } from "../../src/harness/core/stateStore.js";
import {
  writeArtifact,
  readArtifact,
  listArtifacts,
  deleteArtifact,
  deleteAllArtifacts,
  artifactDir,
} from "../../src/harness/core/artifactStore.js";

// ── Setup ─────────────────────────────────────────────────────────────────────

let tmpDir: string;
const runId = "run_art_test" as never;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-harness-art-"));
  setRunsDir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Artifact Dir ──────────────────────────────────────────────────────────────

describe("artifactDir", () => {
  it("returns the correct subdirectory for a run", () => {
    expect(artifactDir(runId)).toBe(path.join(tmpDir, runId));
  });
});

// ── Write / Read ──────────────────────────────────────────────────────────────

describe("writeArtifact and readArtifact", () => {
  it("writes and reads an artifact", () => {
    writeArtifact(runId, "output.json", '{"ok":true}');
    expect(readArtifact(runId, "output.json")).toBe('{"ok":true}');
  });

  it("returns undefined for a nonexistent artifact", () => {
    expect(readArtifact(runId, "nonexistent.txt")).toBeUndefined();
  });
});

// ── List ──────────────────────────────────────────────────────────────────────

describe("listArtifacts", () => {
  it("returns an empty array when no artifacts exist", () => {
    expect(listArtifacts(runId)).toEqual([]);
  });

  it("lists all artifact names in sorted order", () => {
    writeArtifact(runId, "c.txt", "c");
    writeArtifact(runId, "a.txt", "a");
    writeArtifact(runId, "b.txt", "b");
    expect(listArtifacts(runId)).toEqual(["a.txt", "b.txt", "c.txt"]);
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

describe("deleteArtifact", () => {
  it("deletes a single artifact and returns true", () => {
    writeArtifact(runId, "temp.txt", "data");
    expect(deleteArtifact(runId, "temp.txt")).toBe(true);
    expect(readArtifact(runId, "temp.txt")).toBeUndefined();
  });

  it("returns false for a nonexistent artifact", () => {
    expect(deleteArtifact(runId, "nonexistent.txt")).toBe(false);
  });
});

describe("deleteAllArtifacts", () => {
  it("deletes all artifacts for a run", () => {
    writeArtifact(runId, "a.txt", "a");
    writeArtifact(runId, "b.txt", "b");
    deleteAllArtifacts(runId);
    expect(listArtifacts(runId)).toEqual([]);
  });
});
