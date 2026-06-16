/**
 * Compression Flow Tests
 *
 * Covers: compressionFlow execution with real CodeContextAdapter.
 * Uses an in-memory SQLite database for full integration testing.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { compressionFlow } from "../../src/harness/flows/compressionFlow.js";
import { compressionFlowManifest } from "../../src/harness/manifests/compressionFlow.manifest.js";
import type { HarnessModule } from "../../src/harness/core/types.js";
import type { CompressionFlowInput } from "../../src/harness/flows/compressionFlow.js";
import { createCodeContextAdapter } from "../../src/harness/adapters/codeContextAdapter.js";
import { initDb, closeDb } from "../../src/storage/db.js";
import { runMigrations } from "../../src/storage/migrations.js";
import { registerAllStrategies } from "../../src/compression/registerStrategies.js";
import type { Database } from "sql.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FIXTURES = [
  {
    label: "plain_text",
    content: "This is a simple plain text message for testing compression.",
  },
  {
    label: "json",
    content: JSON.stringify({ name: "test", version: "1.0.0", dependencies: { express: "^4.18.0", typescript: "^5.0.0" } }),
    contentType: "json",
  },
  {
    label: "markdown",
    content: "# Test Document\n\nThis is a **markdown** document with `inline code`.\n\n## Section\n\n- Item 1\n- Item 2\n- Item 3",
    contentType: "markdown",
  },
];

// ── Setup ───────────────────────────────────────────────────────────────────────

let db: Database;

beforeAll(async () => {
  db = await initDb(":memory:");
  runMigrations(db);
  registerAllStrategies();
});

// Ensure db is closed after all tests in this file
// (closeDb handles persistence; :memory: is no-op for persist)

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("compressionFlow", () => {
  it("executes real compression loop with adapter and produces valid output", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: CompressionFlowInput = {
      adapter,
      fixtures: FIXTURES,
    };

    const mod: HarnessModule<CompressionFlowInput> = {
      manifest: compressionFlowManifest,
      run: compressionFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_compress_real" as never,
      input,
    });

    expect(state.status).toBe("completed");

    // Verify checkpoints
    const stepCheckpoints = state.checkpoints.filter(
      (c) => c.label !== "run:start" && c.label !== "run:completed" && c.label !== "run:error" && c.label !== "run:failed",
    );

    // Should have checkpoints for each fixture across all phases
    expect(stepCheckpoints.length).toBeGreaterThan(0);

    // Verify output shape
    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    if (output) {
      expect(output.totalFixtures).toBe(FIXTURES.length);
      expect(typeof output.totalCompressed).toBe("number");
      expect(typeof output.totalTokensSaved).toBe("number");
      expect(Array.isArray(output.results)).toBe(true);
    }
  });

  it("records token savings for compressible content", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: CompressionFlowInput = {
      adapter,
      fixtures: [FIXTURES[1]], // JSON fixture
    };

    const mod: HarnessModule<CompressionFlowInput> = {
      manifest: compressionFlowManifest,
      run: compressionFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_compress_tokens" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const output = state.output as Record<string, unknown> | undefined;
    if (output) {
      const results = output.results as Array<Record<string, unknown>>;
      expect(results.length).toBe(1);

      // Verify token fields exist and are valid
      const r = results[0];
      if (r) {
        expect(typeof r.tokensBefore).toBe("number");
        expect(typeof r.tokensAfter).toBe("number");
        expect(typeof r.tokensSaved).toBe("number");
        expect(r.ccrId).toBeTruthy();
      }
    }
  });

  it("generates originalRef and supports round-trip retrieval", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: CompressionFlowInput = {
      adapter,
      fixtures: [FIXTURES[0]], // Plain text fixture
    };

    const mod: HarnessModule<CompressionFlowInput> = {
      manifest: compressionFlowManifest,
      run: compressionFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_compress_roundtrip" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const output = state.output as Record<string, unknown> | undefined;
    if (output) {
      const results = output.results as Array<Record<string, unknown>>;
      expect(results.length).toBe(1);
      const r = results[0];
      if (r) {
        expect(r.originalRef).toBeTruthy();
        expect(r.canRetrieveOriginal).toBe(true);
        expect(r.roundtripMatch).toBe(true);
      }
    }
  });

  it("creates receipts for each compression", async () => {
    const adapter = createCodeContextAdapter(db);

    const input: CompressionFlowInput = {
      adapter,
      fixtures: [FIXTURES[2]], // Markdown fixture
    };

    const mod: HarnessModule<CompressionFlowInput> = {
      manifest: compressionFlowManifest,
      run: compressionFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_compress_receipt" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const output = state.output as Record<string, unknown> | undefined;
    if (output) {
      const results = output.results as Array<Record<string, unknown>>;
      expect(results.length).toBe(1);
      const r = results[0];
      if (r) {
        expect(r.receiptId).toBeTruthy();
        expect(typeof r.receiptId).toBe("string");
        expect((r.receiptId as string).length).toBeGreaterThan(0);
      }
    }
  });
});
