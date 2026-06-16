/**
 * Memory Flow Tests
 *
 * Covers: memoryFlow execution with real CodeContextAdapter.
 * Uses an in-memory SQLite database for full integration testing.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { memoryFlow } from "../../src/harness/flows/memoryFlow.js";
import { memoryFlowManifest } from "../../src/harness/manifests/memoryFlow.manifest.js";
import type { HarnessModule } from "../../src/harness/core/types.js";
import type { MemoryFlowInput } from "../../src/harness/flows/memoryFlow.js";
import { createCodeContextAdapter } from "../../src/harness/adapters/codeContextAdapter.js";
import { initDb } from "../../src/storage/db.js";
import { runMigrations } from "../../src/storage/migrations.js";
import { registerAllStrategies } from "../../src/compression/registerStrategies.js";
import type { Database } from "sql.js";

// ── Setup ───────────────────────────────────────────────────────────────────────

let db: Database;

beforeAll(async () => {
  db = await initDb(":memory:");
  runMigrations(db);
  registerAllStrategies();
});

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("memoryFlow", () => {
  it("executes real memory lifecycle with adapter and produces valid output", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: MemoryFlowInput = { adapter };

    const mod: HarnessModule<MemoryFlowInput> = {
      manifest: memoryFlowManifest,
      run: memoryFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_memory_real" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const stepCheckpoints = state.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:completed" && c.label !== "run:error" && c.label !== "run:failed",
    );
    expect(stepCheckpoints.length).toBeGreaterThan(0);

    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    if (output) {
      expect(typeof output.totalOperations).toBe("number");
      expect(typeof output.remembered).toBe("number");
      expect(output.remembered).toBeGreaterThan(0);
      expect(Array.isArray(output.results)).toBe(true);
    }
  });

  it("remembers and recalls a project_rule successfully", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: MemoryFlowInput = { adapter };

    const mod: HarnessModule<MemoryFlowInput> = {
      manifest: memoryFlowManifest,
      run: memoryFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_memory_recall" as never,
      input,
    });

    expect(state.status).toBe("completed");

    // Verify the remember checkpoint passed
    const rememberCp = state.checkpoints.find((c) => c.label === "memory:remember_rule");
    expect(rememberCp?.outcome).toBe("pass");

    // Verify recall finds the stored rule
    const recallCp = state.checkpoints.find((c) => c.label === "memory:recall_finds_rule");
    expect(recallCp?.outcome).toBe("pass");
  });

  it("supersedes old rule and excludes it from recall", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: MemoryFlowInput = { adapter };

    const mod: HarnessModule<MemoryFlowInput> = {
      manifest: memoryFlowManifest,
      run: memoryFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_memory_supersede" as never,
      input,
    });

    expect(state.status).toBe("completed");

    // Verify supersede checkpoint passed
    const supersedeCp = state.checkpoints.find((c) => c.label === "memory:supersede_old");
    expect(supersedeCp?.outcome).toBe("pass");

    // Verify recall excludes superseded
    const excludeCp = state.checkpoints.find((c) => c.label === "memory:recall_excludes_superseded");
    expect(excludeCp?.outcome).toBe("pass");

    // Verify recall includes new
    const includeCp = state.checkpoints.find((c) => c.label === "memory:recall_includes_new");
    expect(includeCp?.outcome).toBe("pass");
  });

  it("hard-deletes a memory successfully", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: MemoryFlowInput = { adapter };

    const mod: HarnessModule<MemoryFlowInput> = {
      manifest: memoryFlowManifest,
      run: memoryFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_memory_harddelete" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const hardDeleteCp = state.checkpoints.find((c) => c.label === "memory:forget_hard");
    expect(hardDeleteCp?.outcome).toBe("pass");
  });
});
