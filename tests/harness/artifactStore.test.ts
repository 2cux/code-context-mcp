/**
 * Artifact Store Tests
 *
 * Covers: writeMarkdown, writeJson, writeText, writeLog,
 * writeArtifact, readArtifact, listArtifacts,
 * deleteArtifact, deleteAllArtifacts, artifactDir.
 *
 * Artifacts are stored under: runs/<runId>/artifacts/
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { setRunsDir } from "../../src/harness/core/stateStore.js";
import {
  writeMarkdown,
  writeJson,
  writeText,
  writeLog,
  writeArtifact,
  readArtifact,
  listArtifacts,
  deleteArtifact,
  deleteAllArtifacts,
  artifactDir,
} from "../../src/harness/core/artifactStore.js";
import { artifactsDirPath } from "../../src/harness/utils/runPaths.js";

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
  it("returns the artifacts/ subdirectory for a run", () => {
    expect(artifactDir(runId)).toBe(artifactsDirPath(tmpDir, runId));
  });

  it("creates the artifacts/ directory on first write", () => {
    writeArtifact(runId, "test.txt", "hello");
    const dir = artifactDir(runId);
    expect(fs.existsSync(dir)).toBe(true);
  });
});

// ── Typed Write Methods ──────────────────────────────────────────────────────

describe("writeMarkdown", () => {
  it("writes a .md file in artifacts/", () => {
    writeMarkdown(runId, "report", "# Hello");
    const content = readArtifact(runId, "report.md");
    expect(content).toBe("# Hello");
  });

  it("does not double-append .md extension", () => {
    writeMarkdown(runId, "report.md", "# Hello");
    const content = readArtifact(runId, "report.md");
    expect(content).toBe("# Hello");
  });
});

describe("writeJson", () => {
  it("writes a .json file in artifacts/ with an object", () => {
    writeJson(runId, "config", { enabled: true, count: 42 });
    const content = readArtifact(runId, "config.json");
    expect(content).toBeDefined();
    expect(JSON.parse(content!)).toEqual({ enabled: true, count: 42 });
  });

  it("writes a .json file with a string argument", () => {
    writeJson(runId, "raw.json", '{"raw":true}');
    const content = readArtifact(runId, "raw.json");
    expect(JSON.parse(content!)).toEqual({ raw: true });
  });
});

describe("writeText", () => {
  it("writes a .txt file in artifacts/", () => {
    writeText(runId, "notes", "plain text content");
    const content = readArtifact(runId, "notes.txt");
    expect(content).toBe("plain text content");
  });
});

describe("writeLog", () => {
  it("writes a .log file in artifacts/", () => {
    writeLog(runId, "output", "[INFO] server started");
    const content = readArtifact(runId, "output.log");
    expect(content).toBe("[INFO] server started");
  });
});

// ── Generic Write / Read ─────────────────────────────────────────────────────

describe("writeArtifact and readArtifact", () => {
  it("writes and reads an artifact with explicit name", () => {
    writeArtifact(runId, "output.json", '{"ok":true}');
    expect(readArtifact(runId, "output.json")).toBe('{"ok":true}');
  });

  it("returns undefined for a nonexistent artifact", () => {
    expect(readArtifact(runId, "nonexistent.txt")).toBeUndefined();
  });

  it("rejects empty artifact names", () => {
    expect(() => writeArtifact(runId, "", "data")).toThrow("must not be empty");
  });

  it("rejects path traversal in artifact names", () => {
    expect(() => writeArtifact(runId, "../escape.txt", "data")).toThrow("..");
    expect(() => writeArtifact(runId, "/absolute/path.txt", "data")).toThrow("absolute");
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
