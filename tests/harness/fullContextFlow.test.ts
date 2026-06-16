/**
 * Full Context Flow Tests
 *
 * Covers: fullContextFlow execution with real CodeContextAdapter.
 * Uses an in-memory SQLite database for full integration testing.
 * This is the final acceptance flow.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { fullContextFlow } from "../../src/harness/flows/fullContextFlow.js";
import { fullContextFlowManifest } from "../../src/harness/manifests/fullContextFlow.manifest.js";
import type { HarnessModule } from "../../src/harness/core/types.js";
import type { FullContextFlowInput } from "../../src/harness/flows/fullContextFlow.js";
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

describe("fullContextFlow", () => {
  it("executes the complete value chain and produces valid output", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: FullContextFlowInput = { adapter };

    const mod: HarnessModule<FullContextFlowInput> = {
      manifest: fullContextFlowManifest,
      run: fullContextFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_full_real" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    if (output) {
      expect(output.overallStatus).toBeDefined();
      expect(typeof output.totalCheckpoints).toBe("number");
      expect(typeof output.passedCheckpoints).toBe("number");
      expect(Array.isArray(output.stages)).toBe(true);

      // Stages should cover compress, retrieve, remember, recall, supersede, list_audit, receipts
      const stages = output.stages as Array<Record<string, unknown>>;
      expect(stages.length).toBeGreaterThanOrEqual(6);
    }
  });

  it("compresses test_output fixture successfully", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: FullContextFlowInput = { adapter };

    const mod: HarnessModule<FullContextFlowInput> = {
      manifest: fullContextFlowManifest,
      run: fullContextFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_full_compress" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const compressCp = state.checkpoints.find((c) => c.label === "full:compress");
    expect(compressCp?.outcome).toBe("pass");

    const validCp = state.checkpoints.find((c) => c.label === "full:compress_valid");
    expect(validCp?.outcome).toBe("pass");
  });

  it("retrieves original content after compression", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: FullContextFlowInput = { adapter };

    const mod: HarnessModule<FullContextFlowInput> = {
      manifest: fullContextFlowManifest,
      run: fullContextFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_full_retrieve" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const retrieveCp = state.checkpoints.find((c) => c.label === "full:retrieve_original");
    expect(retrieveCp?.outcome).toBe("pass");

    const matchCp = state.checkpoints.find((c) => c.label === "full:original_match");
    expect(matchCp?.outcome).toBe("pass");
  });

  it("remembers test failure and recalls it via FTS", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: FullContextFlowInput = { adapter };

    const mod: HarnessModule<FullContextFlowInput> = {
      manifest: fullContextFlowManifest,
      run: fullContextFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_full_memory" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const rememberCp = state.checkpoints.find((c) => c.label === "full:remember_failure");
    expect(rememberCp?.outcome).toBe("pass");

    const recallCp = state.checkpoints.find((c) => c.label === "full:recall_finds_memory");
    expect(recallCp?.outcome).toBe("pass");
  });

  it("supersedes memory and excludes old from recall", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: FullContextFlowInput = { adapter };

    const mod: HarnessModule<FullContextFlowInput> = {
      manifest: fullContextFlowManifest,
      run: fullContextFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_full_supersede" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const supersedeCp = state.checkpoints.find((c) => c.label === "full:supersede");
    expect(supersedeCp?.outcome).toBe("pass");

    const excludeCp = state.checkpoints.find((c) => c.label === "full:recall_excludes_old");
    expect(excludeCp?.outcome).toBe("pass");
  });

  it("verifies receipt completeness", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: FullContextFlowInput = { adapter };

    const mod: HarnessModule<FullContextFlowInput> = {
      manifest: fullContextFlowManifest,
      run: fullContextFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_full_receipts" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const crossRefCp = state.checkpoints.find((c) => c.label === "full:receipt_cross_ref");
    expect(crossRefCp?.outcome).toBe("pass");

    const completeCp = state.checkpoints.find((c) => c.label === "full:receipt_complete");
    expect(completeCp?.outcome).toBe("pass");
  });
});
