/**
 * Fast Path ≠ HarnessRunner — Structural Assertions — Phase 03
 *
 * Proves that fast MCP tools do not route through HarnessRunner.
 * Two independent layers of proof:
 *
 *   A. Import analysis: only runHarnessFlow.ts imports runModule from runner.ts.
 *   B. Runtime spy: vi.spyOn(runModule) → call handlers → verify call counts.
 *
 * Also cross-references the profile gate (Phase 02) and validates against
 * fixture data in fixtures/fast-path-harness-boundary/path/.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// DB setup (for runtime spy tests)
// ---------------------------------------------------------------------------

import { initAndMigrate } from "../src/storage/migrations.js";
import { getDb, closeDb } from "../src/storage/db.js";
import { ReceiptService } from "../src/receipts/receiptService.js";
import type { Database } from "sql.js";
import type { ServerContext } from "../src/mcp/server.js";

let db: Database;
let ctx: ServerContext;

beforeAll(async () => {
  await initAndMigrate();
  db = getDb();
  ctx = { db, receipts: new ReceiptService(db) };
  // Register harness flows so handleRunHarnessFlow can find modules
  const { registerAllFlows } = await import("../src/harness/register.js");
  registerAllFlows();
});

afterAll(() => {
  closeDb();
});

// ---------------------------------------------------------------------------
// Profile gate imports (Phase 02)
// ---------------------------------------------------------------------------

import {
  FAST_TOOLS,
  HARNESS_TOOLS,
  ALL_CODEGRAPH_TOOLS,
  getAllowedCodeGraphTools,
  isCodeGraphToolAllowed,
} from "../src/mcp/profileGate.js";
import type { CodeGraphProfile } from "../src/mcp/profileGate.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "fast-path-harness-boundary",
  "path",
);

function readJsonFixture(filename: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(FIXTURES_DIR, filename), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAST_TOOL_NAMES = [...FAST_TOOLS];
const HARNESS_TOOL_NAMES = [...HARNESS_TOOLS];
const ALL_CODEGRAPH_TOOL_NAMES = [...ALL_CODEGRAPH_TOOLS];
const PROFILES: CodeGraphProfile[] = ["agent", "full", "harness", "debug"];

// ============================================================================
// Layer A: Import Analysis — structural proof at the source level
// ============================================================================

describe("Layer A: Import analysis — structural proof", () => {
  /**
   * All files under src/mcp/tools/ except runHarnessFlow.ts must NOT
   * import runModule or executeRun from harness/core/runner.
   *
   * This is verified by grepping source code at test time.
   */
  const TOOLS_DIR = path.resolve(import.meta.dirname, "..", "src", "mcp", "tools");

  const allToolFiles = fs
    .readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(TOOLS_DIR, f));

  it("only runHarnessFlow.ts imports runModule from harness/core/runner", () => {
    const importers: string[] = [];

    for (const file of allToolFiles) {
      const content = fs.readFileSync(file, "utf-8");
      // Match: import { ... runModule ... } from "...harness/core/runner..."
      if (
        /from\s+["'][^"']*harness\/core\/runner[^"']*["']/.test(content) &&
        /\brunModule\b/.test(content)
      ) {
        importers.push(path.basename(file));
      }
    }

    // Only runHarnessFlow.ts should import runModule
    expect(importers).toEqual(["runHarnessFlow.ts"]);
  });

  it("fast tool handlers do not import from harness/core/runner at all", () => {
    const fastHandlerFiles = allToolFiles.filter(
      (f) => !f.endsWith("runHarnessFlow.ts"),
    );

    for (const file of fastHandlerFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const importsFromRunner =
        /from\s+["'][^"']*harness\/core\/runner[^"']*["']/.test(content);
      expect(importsFromRunner).toBe(false);
    }
  });

  it("runHarnessFlow.ts explicitly calls runModule()", () => {
    const runHarnessFlowPath = path.join(TOOLS_DIR, "runHarnessFlow.ts");
    const content = fs.readFileSync(runHarnessFlowPath, "utf-8");
    // Verify the actual call site exists
    expect(content).toMatch(/runModule\s*\(/);
    expect(content).toMatch(
      /import\s*\{[^}]*\brunModule\b[^}]*\}\s*from\s*["'][^"']*harness\/core\/runner[^"']*["']/,
    );
  });

  it("executeRun is not imported by any MCP tool handler", () => {
    for (const file of allToolFiles) {
      const content = fs.readFileSync(file, "utf-8");
      // executeRun should NOT appear in any tool handler
      expect(content).not.toMatch(
        /import\s*\{[^}]*\bexecuteRun\b[^}]*\}\s*from\s*["'][^"']*harness\/core\/runner[^"']*["']/,
      );
    }
  });
});

// ============================================================================
// Layer B: Runtime spy — HarnessRunner.runModule call verification
// ============================================================================

describe("Layer B: Runtime spy — HarnessRunner not called by fast handlers", () => {
  let runModuleSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    // Import the runner module and spy on runModule
    const runnerModule = await import("../src/harness/core/runner.js");
    runModuleSpy = vi.spyOn(runnerModule, "runModule");
  });

  afterAll(() => {
    runModuleSpy.mockRestore();
  });

  // --------------------------------------------------------------------------
  // Fast handler call (CodeContext representative — all 17 non-harness tools)
  // --------------------------------------------------------------------------

  describe("fast handler representative: handleCurrentScope", () => {
    it("does NOT call runModule", async () => {
      const beforeCount = runModuleSpy.mock.calls.length;

      const { handleCurrentScope } = await import(
        "../src/mcp/tools/currentScope.js"
      );
      await handleCurrentScope(ctx, {});

      expect(runModuleSpy.mock.calls.length).toBe(beforeCount);
    });
  });

  describe("fast handler representative: handleRunContextFlow", () => {
    it("does NOT call runModule (compression flow)", async () => {
      const beforeCount = runModuleSpy.mock.calls.length;

      const { handleRunContextFlow } = await import(
        "../src/mcp/tools/runContextFlow.js"
      );
      // Call with minimal valid args for compression flow
      await handleRunContextFlow(ctx, {
        flow: "compression",
        content: "Sample log output for testing\nError: test failure\n  at foo.ts:42",
        contentType: "log",
      });

      expect(runModuleSpy.mock.calls.length).toBe(beforeCount);
    });

    it("does NOT call runModule (memory flow)", async () => {
      const beforeCount = runModuleSpy.mock.calls.length;

      const { handleRunContextFlow } = await import(
        "../src/mcp/tools/runContextFlow.js"
      );
      await handleRunContextFlow(ctx, {
        flow: "memory",
        query: "test project rule",
      });

      expect(runModuleSpy.mock.calls.length).toBe(beforeCount);
    });
  });

  describe("fast handler representative: handleRecallContext", () => {
    it("does NOT call runModule", async () => {
      const beforeCount = runModuleSpy.mock.calls.length;

      const { handleRecallContext } = await import(
        "../src/mcp/tools/recallContext.js"
      );
      await handleRecallContext(ctx, { query: "test" });

      expect(runModuleSpy.mock.calls.length).toBe(beforeCount);
    });
  });

  describe("fast handler representative: handleListHarnessFlows", () => {
    it("does NOT call runModule (ctx-less, reads registry directly)", async () => {
      const beforeCount = runModuleSpy.mock.calls.length;

      const { handleListHarnessFlows } = await import(
        "../src/mcp/tools/listHarnessFlows.js"
      );
      await handleListHarnessFlows({});

      expect(runModuleSpy.mock.calls.length).toBe(beforeCount);
    });
  });

  // --------------------------------------------------------------------------
  // Harness handler — MUST call runModule
  // --------------------------------------------------------------------------

  describe("harness handler: handleRunHarnessFlow", () => {
    it("DOES call runModule", async () => {
      const beforeCount = runModuleSpy.mock.calls.length;

      const { handleRunHarnessFlow } = await import(
        "../src/mcp/tools/runHarnessFlow.js"
      );

      // Provide a real mock implementation for this call only
      runModuleSpy.mockResolvedValueOnce({
        runId: "run_test_abc123_001",
        status: "failed",
        moduleId: "compression-flow",
        phase: "validate:input",
        checkpoints: [],
        artifacts: [],
        input: {},
        output: null,
        error: { message: "Input validation failed", stack: "" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      // Call with minimal valid args — flow matches registered flows
      await handleRunHarnessFlow(ctx, { flowId: "compression-flow" });

      expect(runModuleSpy.mock.calls.length).toBeGreaterThan(beforeCount);
    });
  });

  // --------------------------------------------------------------------------
  // Category-level: aggregate call counts
  // --------------------------------------------------------------------------

  describe("aggregate assertions", () => {
    it("fast handler calls never increment runModule counter", async () => {
      const beforeCount = runModuleSpy.mock.calls.length;

      // Call several representative fast handlers
      const { handleCurrentScope } = await import(
        "../src/mcp/tools/currentScope.js"
      );
      const { handleListContext } = await import(
        "../src/mcp/tools/listContext.js"
      );
      const { handleRunContextFlow } = await import(
        "../src/mcp/tools/runContextFlow.js"
      );

      await handleCurrentScope(ctx, {});
      await handleListContext(ctx, { scopeId: "repo_test" });
      await handleRunContextFlow(ctx, {
        flow: "compression",
        content: "test log line",
        contentType: "log",
      });

      // Still no calls to runModule
      expect(runModuleSpy.mock.calls.length).toBe(beforeCount);
    });
  });
});

// ============================================================================
// Layer C: Profile gate × HarnessRunner boundary (Phase 02 cross-ref)
// ============================================================================

describe("Layer C: Profile gate × HarnessRunner boundary", () => {
  it("fast tools (CATEGORY) are never in harness profile", () => {
    for (const t of FAST_TOOL_NAMES) {
      expect(isCodeGraphToolAllowed(t, "harness")).toBe(false);
    }
  });

  it("harness tools (CATEGORY) are never in agent or full profile", () => {
    for (const t of HARNESS_TOOL_NAMES) {
      expect(isCodeGraphToolAllowed(t, "agent")).toBe(false);
      expect(isCodeGraphToolAllowed(t, "full")).toBe(false);
    }
  });

  it("FAST_TOOLS ∩ HARNESS_TOOLS = ∅", () => {
    for (const t of FAST_TOOL_NAMES) {
      expect(HARNESS_TOOLS.has(t)).toBe(false);
    }
    for (const t of HARNESS_TOOL_NAMES) {
      expect(FAST_TOOLS.has(t)).toBe(false);
    }
  });

  it("all tools are either fast or harness (complete partition)", () => {
    const union = new Set([...FAST_TOOLS, ...HARNESS_TOOLS]);
    for (const t of ALL_CODEGRAPH_TOOL_NAMES) {
      expect(union.has(t)).toBe(true);
    }
    expect(union.size).toBe(ALL_CODEGRAPH_TOOL_NAMES.length);
  });

  it("fixture: fast-tools-must-not-use-harness.json matches categories", () => {
    const fixture = readJsonFixture("fast-tools-must-not-use-harness.json");
    const fastToolsFromFixture = fixture.fastToolsMustNotUseHarnessRunner as string[];

    // Fixture lists exactly the same tools as FAST_TOOLS
    expect(new Set(fastToolsFromFixture).size).toBe(FAST_TOOL_NAMES.length);
    for (const t of fastToolsFromFixture) {
      expect(FAST_TOOLS.has(t)).toBe(true);
    }

    expect(fixture.expectedHarnessRunnerCalls).toBe(0);
    expect(typeof fixture.failureMessage).toBe("string");
    expect(fixture.failureMessage).toMatch(/HarnessRunner/i);
  });

  it("fixture: harness-tools-may-use-harness.json matches categories", () => {
    const fixture = readJsonFixture("harness-tools-may-use-harness.json");
    const harnessToolsFromFixture = fixture.harnessToolsMayUseHarnessRunner as string[];

    expect(new Set(harnessToolsFromFixture).size).toBe(HARNESS_TOOL_NAMES.length);
    for (const t of harnessToolsFromFixture) {
      expect(HARNESS_TOOLS.has(t)).toBe(true);
    }
    expect(typeof fixture.expected).toBe("string");
    expect(fixture.expected).toMatch(/workflow/i);
  });
});

// ============================================================================
// Layer D: Permission matrix from profile-call-permissions.json
// ============================================================================

describe("Layer D: Permission matrix validation", () => {
  const fixture = readJsonFixture("profile-call-permissions.json");
  const permissions = fixture.callPermissions as Array<{
    profile: string;
    tool: string;
    allowed: boolean;
  }>;

  it("fixture has at least 6 permission entries", () => {
    expect(permissions.length).toBeGreaterThanOrEqual(6);
  });

  it("each permission entry matches profile gate implementation", () => {
    for (const entry of permissions) {
      const actual = isCodeGraphToolAllowed(
        entry.tool,
        entry.profile as CodeGraphProfile,
      );
      expect(actual).toBe(entry.allowed);
    }
  });

  it("codegraph_harness_run: NOT allowed in agent", () => {
    const entry = permissions.find(
      (e) => e.profile === "agent" && e.tool === "codegraph_harness_run",
    );
    expect(entry).toBeDefined();
    expect(entry!.allowed).toBe(false);
    expect(isCodeGraphToolAllowed("codegraph_harness_run", "agent")).toBe(false);
  });

  it("codegraph_harness_run: NOT allowed in full", () => {
    const entry = permissions.find(
      (e) => e.profile === "full" && e.tool === "codegraph_harness_run",
    );
    expect(entry).toBeDefined();
    expect(entry!.allowed).toBe(false);
    expect(isCodeGraphToolAllowed("codegraph_harness_run", "full")).toBe(false);
  });

  it("codegraph_harness_run: allowed in harness", () => {
    const entry = permissions.find(
      (e) => e.profile === "harness" && e.tool === "codegraph_harness_run",
    );
    expect(entry).toBeDefined();
    expect(entry!.allowed).toBe(true);
    expect(isCodeGraphToolAllowed("codegraph_harness_run", "harness")).toBe(true);
  });

  it("codegraph_harness_run: allowed in debug", () => {
    const entry = permissions.find(
      (e) => e.profile === "debug" && e.tool === "codegraph_harness_run",
    );
    expect(entry).toBeDefined();
    expect(entry!.allowed).toBe(true);
    expect(isCodeGraphToolAllowed("codegraph_harness_run", "debug")).toBe(true);
  });

  it("codegraph_find: allowed in agent", () => {
    const entry = permissions.find(
      (e) => e.profile === "agent" && e.tool === "codegraph_find",
    );
    expect(entry).toBeDefined();
    expect(entry!.allowed).toBe(true);
    expect(isCodeGraphToolAllowed("codegraph_find", "agent")).toBe(true);
  });

  it("codegraph_find: allowed in full", () => {
    const entry = permissions.find(
      (e) => e.profile === "full" && e.tool === "codegraph_find",
    );
    expect(entry).toBeDefined();
    expect(entry!.allowed).toBe(true);
    expect(isCodeGraphToolAllowed("codegraph_find", "full")).toBe(true);
  });
});

// ============================================================================
// Layer E: CodeContext tool registry — only run_harness_flow uses runner
// ============================================================================

describe("Layer E: CodeContext tool registry boundary", () => {
  it("createToolHandlers creates handler for run_harness_flow", async () => {
    const { createToolHandlers } = await import("../src/mcp/toolRegistry.js");
    const handlers = createToolHandlers(ctx);
    expect(handlers).toBeDefined();
    expect(typeof handlers["run_harness_flow"]).toBe("function");
  });

  it("17 non-harness tools are fast path (no runner import in source)", async () => {
    // This is the structural guarantee: the source code of the 17 fast
    // tools does not import from harness/core/runner.  Layer A already
    // proved this by scanning the source files.  Here we verify the
    // handler registry correctly maps all tools.
    const { createToolHandlers, ALL_TOOL_NAMES } = await import(
      "../src/mcp/toolRegistry.js"
    );
    const handlers = createToolHandlers(ctx);

    // Every registered tool has a handler
    for (const name of ALL_TOOL_NAMES) {
      expect(handlers[name]).toBeDefined();
    }

    // The harness tools exist in the registry
    expect(handlers["run_harness_flow"]).toBeDefined();
    expect(handlers["list_harness_flows"]).toBeDefined();
    expect(handlers["get_harness_run"]).toBeDefined();
    expect(handlers["check_harness_flow"]).toBeDefined();

    // Fast tools exist too
    expect(handlers["compress_context"]).toBeDefined();
    expect(handlers["recall_context"]).toBeDefined();
    expect(handlers["run_context_flow"]).toBeDefined();
    expect(handlers["current_scope"]).toBeDefined();
  });
});

// ============================================================================
// Layer F: Fixture integrity
// ============================================================================

describe("Layer F: Fixture integrity", () => {
  it("all 3 fixture files exist and are valid JSON", () => {
    const files = [
      "fast-tools-must-not-use-harness.json",
      "harness-tools-may-use-harness.json",
      "profile-call-permissions.json",
    ];
    for (const f of files) {
      const fixture = readJsonFixture(f);
      expect(fixture).toBeDefined();
      expect(typeof fixture).toBe("object");
    }
  });
});
