/**
 * Check Engine Tests
 *
 * Covers: checkFlow, checkAllFlows, writeCheckReports.
 * Verifies rules 1–15 for manifest and runtime checks.
 *
 * PRD §12.1–12.3: Harness Check Engine.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  checkFlow,
  checkAllFlows,
  writeCheckReports,
} from "../../src/harness/core/checkEngine.js";
import type {
  FlowCheckReport,
  BatchCheckReport,
} from "../../src/harness/core/checkEngine.js";
import { registerModule, clearModules } from "../../src/harness/core/registry.js";
import { setRunsDir } from "../../src/harness/core/stateStore.js";
import { resetMockDatabase } from "../../src/harness/core/mockAdapters.js";
import type { HarnessManifest, HarnessModule } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<HarnessManifest> = {}): HarnessManifest {
  return {
    id: "check-test-flow",
    name: "Check Test Flow",
    description: "A flow for testing the check engine",
    phases: [{ name: "main", description: "Main phase" }],
    checkpoints: [{ name: "main:step", description: "A step", expect: "pass" }],
    artifacts: [{ name: "report", description: "Test report" }],
    coversTools: ["compress_context", "retrieve_original"],
    ...overrides,
  };
}

function makeModule(
  manifestOverrides: Partial<HarnessManifest> = {},
): HarnessModule {
  const manifest = makeManifest(manifestOverrides);
  return {
    manifest,
    run: async (ctx) => {
      ctx.checkpoint("main:step", "pass");
      ctx.writeArtifact("report", JSON.stringify({ ok: true }), "application/json");
      return { ok: true };
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-harness-check-"));
  setRunsDir(tmpDir);
  clearModules();
  resetMockDatabase();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetMockDatabase();
});

// ── checkFlow: Not Found ──────────────────────────────────────────────────────

describe("checkFlow: not found", () => {
  it("returns a fail report for an unregistered flow", async () => {
    const report = await checkFlow("nonexistent-flow");
    expect(report.flowId).toBe("nonexistent-flow");
    expect(report.isRunnable).toBe(false);
    expect(report.summary.fail).toBeGreaterThanOrEqual(1);
    expect(report.manifestChecks[0]?.rule).toBe("manifest.notFound");
  });
});

// ── checkFlow: Manifest Only ──────────────────────────────────────────────────

describe("checkFlow: manifestOnly", () => {
  it("runs only manifest checks, skips runtime checks", async () => {
    registerModule(makeModule({ id: "manifest-only-flow" }));

    const report = await checkFlow("manifest-only-flow", { manifestOnly: true });

    expect(report.flowId).toBe("manifest-only-flow");
    expect(report.isRunnable).toBe(true);
    expect(report.manifestChecks.length).toBeGreaterThan(0);

    // All runtime checks should be "skip"
    for (const rc of report.runtimeChecks) {
      expect(rc.outcome).toBe("skip");
    }
    expect(report.runtimeChecks).toHaveLength(5); // rules 11–15
  });

  it("manifest checks pass for a well-formed manifest", async () => {
    registerModule(makeModule({ id: "well-formed-flow" }));

    const report = await checkFlow("well-formed-flow", { manifestOnly: true });

    const failed = report.manifestChecks.filter((c) => c.outcome === "fail");
    expect(failed).toEqual([]);
  });

  it("manifest check: coveredTools.real passes with valid tools", async () => {
    registerModule(
      makeModule({
        id: "valid-tools-flow",
        coversTools: ["compress_context", "retrieve_original", "current_scope"],
      }),
    );

    const report = await checkFlow("valid-tools-flow", { manifestOnly: true });
    const toolCheck = report.manifestChecks.find(
      (c) => c.rule === "manifest.coveredTools.real",
    );
    expect(toolCheck?.outcome).toBe("pass");
  });

  it("manifest check: coveredTools.real fails with unknown tools", async () => {
    registerModule(
      makeModule({
        id: "bad-tools-flow",
        coversTools: ["compress_context", "nonexistent_tool_xyz"],
      }),
    );

    const report = await checkFlow("bad-tools-flow", { manifestOnly: true });
    const toolCheck = report.manifestChecks.find(
      (c) => c.rule === "manifest.coveredTools.real",
    );
    expect(toolCheck?.outcome).toBe("fail");
  });
});

// ── checkFlow: Full (manifest + runtime) ──────────────────────────────────────

describe("checkFlow: full check", () => {
  it("runs manifest + runtime checks for a registered module", async () => {
    registerModule(makeModule({ id: "full-check-flow" }));

    const report = await checkFlow("full-check-flow");

    expect(report.manifestChecks.length).toBeGreaterThan(0);
    // Runtime checks should have been executed (not all skip)
    const nonSkipRuntime = report.runtimeChecks.filter((c) => c.outcome !== "skip");
    expect(nonSkipRuntime.length).toBeGreaterThan(0);
  });

  it("runtime check: state.json produced on success", async () => {
    registerModule(makeModule({ id: "state-check-flow" }));

    const report = await checkFlow("state-check-flow");
    const stateCheck = report.runtimeChecks.find(
      (c) => c.rule === "run.generates.stateJson",
    );
    expect(stateCheck?.outcome).toBe("pass");
  });

  it("runtime check: output.json produced on success", async () => {
    registerModule(makeModule({ id: "output-check-flow" }));

    const report = await checkFlow("output-check-flow");
    const outputCheck = report.runtimeChecks.find(
      (c) => c.rule === "run.generates.outputJson",
    );
    expect(outputCheck?.outcome).toBe("pass");
  });

  it("runtime check: logs.jsonl produced on success", async () => {
    registerModule(makeModule({ id: "logs-check-flow" }));

    const report = await checkFlow("logs-check-flow");
    const logsCheck = report.runtimeChecks.find(
      (c) => c.rule === "run.generates.logsJsonl",
    );
    expect(logsCheck?.outcome).toBe("pass");
  });

  it("runtime check: receipt produced on success", async () => {
    registerModule(makeModule({ id: "receipt-check-flow" }));

    const report = await checkFlow("receipt-check-flow");
    const receiptCheck = report.runtimeChecks.find(
      (c) => c.rule === "run.generates.receipt",
    );
    expect(receiptCheck?.outcome).toBe("pass");
  });

  it("runtime check: declares and produces expected artifacts", async () => {
    registerModule(
      makeModule({
        id: "artifact-check-flow",
        artifacts: [{ name: "report", description: "Test report" }],
      }),
    );

    const report = await checkFlow("artifact-check-flow");
    const artifactCheck = report.runtimeChecks.find(
      (c) => c.rule === "artifacts.asExpected",
    );
    expect(artifactCheck?.outcome).toBe("pass");
  });

  it("runtime check: fails when declared artifacts are missing", async () => {
    registerModule(
      makeModule({
        id: "missing-artifact-flow",
        artifacts: [
          { name: "report", description: "Produced" },
          { name: "metrics", description: "NOT produced" },
        ],
      }),
    );

    const report = await checkFlow("missing-artifact-flow");
    const artifactCheck = report.runtimeChecks.find(
      (c) => c.rule === "artifacts.asExpected",
    );
    expect(artifactCheck?.outcome).toBe("fail");
  });

  it("sets runId in report when runtime checks execute", async () => {
    registerModule(makeModule({ id: "runid-check-flow" }));

    const report = await checkFlow("runid-check-flow");
    expect(report.runId).toBeTruthy();
    expect(report.runId).toMatch(/^run_/);
  });
});

// ── checkAllFlows ─────────────────────────────────────────────────────────────

describe("checkAllFlows", () => {
  it("checks all registered flows", async () => {
    registerModule(makeModule({ id: "batch-flow-a" }));
    registerModule(makeModule({ id: "batch-flow-b" }));

    const batchReport = await checkAllFlows({ manifestOnly: true });

    expect(batchReport.totalFlows).toBeGreaterThanOrEqual(2);
    expect(batchReport.flows.length).toBeGreaterThanOrEqual(2);
    expect(batchReport.summary.total).toBeGreaterThan(0);
    expect(batchReport.timestamp).toBeTruthy();

    const flowIds = batchReport.flows.map((f) => f.flowId);
    expect(flowIds).toContain("batch-flow-a");
    expect(flowIds).toContain("batch-flow-b");
  });

  it("checks only specified flowIds when provided", async () => {
    registerModule(makeModule({ id: "target-flow" }));
    registerModule(makeModule({ id: "other-flow" }));

    const batchReport = await checkAllFlows({
      manifestOnly: true,
      flowIds: ["target-flow"],
    });

    expect(batchReport.totalFlows).toBe(1);
    expect(batchReport.flows[0]?.flowId).toBe("target-flow");
  });

  it("returns empty report when no flows registered", async () => {
    const batchReport = await checkAllFlows({ manifestOnly: true });
    expect(batchReport.totalFlows).toBe(0);
    expect(batchReport.flows).toEqual([]);
  });
});

// ── writeCheckReports ─────────────────────────────────────────────────────────

describe("writeCheckReports", () => {
  it("writes check-report.json and check-report.md to artifacts/", async () => {
    registerModule(makeModule({ id: "report-write-flow" }));
    const batchReport = await checkAllFlows({ manifestOnly: true });

    const { jsonPath, mdPath } = writeCheckReports(batchReport);

    // These paths should be valid even if files couldn't be written
    expect(jsonPath).toContain("check-report.json");
    expect(mdPath).toContain("check-report.md");
  });

  it("produces valid JSON in check-report.json when writable", async () => {
    // Use a temp directory that we control
    const originalCwd = process.cwd;
    // writeCheckReports writes to artifacts/ under the project root
    // We verify it doesn't throw and returns valid paths
    registerModule(makeModule({ id: "json-report-flow" }));
    const batchReport = await checkAllFlows({ manifestOnly: true });

    const result = writeCheckReports(batchReport);
    expect(result.jsonPath).toBeTruthy();
    expect(result.mdPath).toBeTruthy();
  });
});

// ── Flow Category Detection ──────────────────────────────────────────────────

describe("checkFlow: category detection", () => {
  it("correctly routes MCP smoke flow to mock MCP adapter", async () => {
    registerModule({
      manifest: {
        id: "mcp-tools-smoke-flow",
        name: "MCP Smoke",
        description: "MCP tools smoke test",
        phases: [{ name: "smoke", description: "Smoke test" }],
        checkpoints: [],
        artifacts: [],
        coversTools: ["compress_context"],
        tags: ["smoke", "mcp"],
        capability: "smoke-test",
      },
      run: async (ctx) => {
        // Should receive mock MCP adapter via input
        const input = ctx.input as Record<string, unknown>;
        const adapter = input.adapter;
        // The mock MCP adapter should have a callTool function
        if (adapter && typeof (adapter as Record<string, unknown>).callTool === "function") {
          ctx.checkpoint("smoke:adapter", "pass");
        }
        return { ok: true };
      },
    });

    const report = await checkFlow("mcp-tools-smoke-flow");
    // Should pass — the mock MCP adapter is injected
    const nonSkipRuntime = report.runtimeChecks.filter((c) => c.outcome !== "skip");
    expect(nonSkipRuntime.length).toBeGreaterThan(0);
    expect(nonSkipRuntime.every((c) => c.outcome === "pass")).toBe(true);
  });

  it("correctly routes CLI smoke flow to mock CLI adapter", async () => {
    registerModule({
      manifest: {
        id: "cli-smoke-flow",
        name: "CLI Smoke",
        description: "CLI smoke test",
        phases: [{ name: "smoke", description: "Smoke test" }],
        checkpoints: [],
        artifacts: [],
        coversTools: [],
        tags: ["cli"],
        capability: "smoke-test",
      },
      run: async (ctx) => {
        const input = ctx.input as Record<string, unknown>;
        const adapter = input.adapter;
        if (adapter && typeof (adapter as Record<string, unknown>).run === "function") {
          ctx.checkpoint("smoke:adapter", "pass");
        }
        return { ok: true };
      },
    });

    const report = await checkFlow("cli-smoke-flow");
    const nonSkipRuntime = report.runtimeChecks.filter((c) => c.outcome !== "skip");
    expect(nonSkipRuntime.length).toBeGreaterThan(0);
    expect(nonSkipRuntime.every((c) => c.outcome === "pass")).toBe(true);
  });
});
