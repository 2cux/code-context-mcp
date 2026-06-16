/**
 * Originals Flow Tests
 *
 * Covers: originalsFlow execution with real CodeContextAdapter.
 * This is the most critical flow — it tests the original content
 * storage, retrieval, and deletion lifecycle.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { originalsFlow } from "../../src/harness/flows/originalsFlow.js";
import { originalsFlowManifest } from "../../src/harness/manifests/originalsFlow.manifest.js";
import type { HarnessModule } from "../../src/harness/core/types.js";
import type { OriginalsFlowInput } from "../../src/harness/flows/originalsFlow.js";
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

describe("originalsFlow", () => {
  const TEST_CONTENT = "Unique test content for originals lifecycle verification.";

  it("executes full originals lifecycle and produces valid output", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: OriginalsFlowInput = {
      adapter,
      testContent: TEST_CONTENT,
    };

    const mod: HarnessModule<OriginalsFlowInput> = {
      manifest: originalsFlowManifest,
      run: originalsFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_originals_real" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    if (output) {
      expect(output.ccrId).toBeTruthy();
      expect(output.originalRef).toBeTruthy();
      expect(output.canRetrieveBeforeDelete).toBe(true);
      expect(output.contentMatchBeforeDelete).toBe(true);
      expect(output.deleteSucceeded).toBe(true);
      expect(output.canRetrieveAfterDelete).toBe(true);
      expect(output.cleanupRan).toBe(true);
      expect(output.passed).toBe(true);
    }
  });

  it("can retrieve original before deletion with byte-for-byte match", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: OriginalsFlowInput = {
      adapter,
      testContent: TEST_CONTENT,
    };

    const mod: HarnessModule<OriginalsFlowInput> = {
      manifest: originalsFlowManifest,
      run: originalsFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_originals_retrieve" as never,
      input,
    });

    expect(state.status).toBe("completed");

    // Verify retrieve-before-delete checkpoint passed
    const retrieveCp = state.checkpoints.find((c) => c.label === "originals:retrieve_before_delete");
    expect(retrieveCp?.outcome).toBe("pass");

    // Verify content match checkpoint passed
    const matchCp = state.checkpoints.find((c) => c.label === "originals:content_match");
    expect(matchCp?.outcome).toBe("pass");
  });

  it("correctly reports not-found after deletion", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: OriginalsFlowInput = {
      adapter,
      testContent: TEST_CONTENT,
    };

    const mod: HarnessModule<OriginalsFlowInput> = {
      manifest: originalsFlowManifest,
      run: originalsFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_originals_delete" as never,
      input,
    });

    expect(state.status).toBe("completed");

    // After deletion, retrieval should return null → flow step passes
    const afterDeleteCp = state.checkpoints.find((c) => c.label === "originals:retrieve_after_delete");
    expect(afterDeleteCp?.outcome).toBe("pass");

    // canRetrieveOriginal should be false after deletion → flow step passes
    const canRetrieveCp = state.checkpoints.find((c) => c.label === "originals:can_retrieve_false");
    expect(canRetrieveCp?.outcome).toBe("pass");
  });

  it("runs cleanup without error", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: OriginalsFlowInput = {
      adapter,
      testContent: TEST_CONTENT,
    };

    const mod: HarnessModule<OriginalsFlowInput> = {
      manifest: originalsFlowManifest,
      run: originalsFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_originals_cleanup" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const cleanupCp = state.checkpoints.find((c) => c.label === "originals:cleanup");
    expect(cleanupCp?.outcome).toBe("pass");
  });

  it("verifies canRetrieveOriginal flag transition", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: OriginalsFlowInput = {
      adapter,
      testContent: TEST_CONTENT,
    };

    const mod: HarnessModule<OriginalsFlowInput> = {
      manifest: originalsFlowManifest,
      run: originalsFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_originals_flag" as never,
      input,
    });

    expect(state.status).toBe("completed");

    // Before delete: canRetrieve should be true
    const beforeCp = state.checkpoints.find((c) => c.label === "originals:can_retrieve_true");
    expect(beforeCp?.outcome).toBe("pass");

    // After delete: canRetrieve should be false
    const afterCp = state.checkpoints.find((c) => c.label === "originals:can_retrieve_false");
    expect(afterCp?.outcome).toBe("pass");

    const output = state.output as Record<string, unknown> | undefined;
    if (output) {
      expect(output.canRetrieveBeforeDelete).toBe(true);
      expect(output.canRetrieveAfterDelete).toBe(true);
    }
  });
});
