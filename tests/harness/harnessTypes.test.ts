/**
 * Harness Types Tests
 *
 * Covers: RunId, RunStatus, RunState, Checkpoint, HarnessManifest,
 * HarnessModule, HarnessContext, and RUN_STATUS_TRANSITIONS.
 */

import { describe, it, expect } from "vitest";
import { RUN_STATUS_TRANSITIONS } from "../../src/harness/core/types.js";
import type {
  HarnessManifest,
  HarnessModule,
  HarnessContext,
  RunState,
  RunStatus,
  Checkpoint,
} from "../../src/harness/core/types.js";

// ── RunStatus Transitions ─────────────────────────────────────────────────────

describe("RUN_STATUS_TRANSITIONS", () => {
  it("created can transition to running", () => {
    expect(RUN_STATUS_TRANSITIONS.created).toEqual(["running"]);
  });

  it("running can transition to failed or completed", () => {
    expect(RUN_STATUS_TRANSITIONS.running).toEqual(["failed", "completed"]);
  });

  it("terminal states have no valid transitions", () => {
    const terminals: RunStatus[] = ["failed", "completed"];
    for (const status of terminals) {
      expect(RUN_STATUS_TRANSITIONS[status]).toEqual([]);
    }
  });

  it('does not include "blocked", "passed", or "aborted"', () => {
    const allStatuses = Object.keys(RUN_STATUS_TRANSITIONS);
    expect(allStatuses).not.toContain("blocked");
    expect(allStatuses).not.toContain("passed");
    expect(allStatuses).not.toContain("aborted");
    expect(allStatuses).toEqual(["created", "running", "failed", "completed"]);
  });
});

// ── HarnessManifest Shape ─────────────────────────────────────────────────────

describe("HarnessManifest (type-level shape validation)", () => {
  it("accepts a valid manifest object", () => {
    const m: HarnessManifest = {
      id: "compression-flow",
      name: "Compression Flow",
      description: "Exercises the full compression closed loop",
      phases: [
        { name: "compress", description: "Compress content" },
        { name: "verify", description: "Verify round-trip" },
      ],
      checkpoints: [
        { name: "compress:code", description: "Compress code content", expect: "pass" },
        { name: "compress:verify", description: "Verify output", expect: "pass" },
      ],
      artifacts: [
        { name: "results", description: "Compression results", contentType: "application/json" },
      ],
      coversTools: [
        "current_scope",
        "compress_context",
        "retrieve_original",
      ],
    };
    expect(m.id).toBe("compression-flow");
    expect(m.phases).toHaveLength(2);
    expect(m.checkpoints).toHaveLength(2);
    expect(m.coversTools).toContain("compress_context");
  });

  it("allows optional inputSchema and outputSchema", () => {
    const m: HarnessManifest = {
      id: "test-flow",
      name: "Test Flow",
      description: "A test",
      phases: [],
      checkpoints: [],
      artifacts: [],
      coversTools: [],
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
    };
    expect(m.inputSchema?.type).toBe("object");
    expect(m.outputSchema?.type).toBe("object");
  });

  it("allows optional tags and capability", () => {
    const m: HarnessManifest = {
      id: "tagged-flow",
      name: "Tagged Flow",
      description: "A flow with tags and capability",
      phases: [],
      checkpoints: [],
      artifacts: [],
      coversTools: ["compress_context"],
      tags: ["compression", "acceptance"],
      capability: "compression",
    };
    expect(m.tags).toEqual(["compression", "acceptance"]);
    expect(m.capability).toBe("compression");
  });

  it("allows manifest without tags and capability (backward compatible)", () => {
    const m: HarnessManifest = {
      id: "minimal-flow",
      name: "Minimal",
      description: "Minimal manifest",
      phases: [],
      checkpoints: [],
      artifacts: [],
      coversTools: [],
    };
    expect(m.tags).toBeUndefined();
    expect(m.capability).toBeUndefined();
  });
});

// ── Checkpoint Shape ──────────────────────────────────────────────────────────

describe("Checkpoint (type-level shape validation)", () => {
  it("accepts a valid checkpoint", () => {
    const cp: Checkpoint = {
      seq: 0,
      timestamp: new Date().toISOString(),
      phase: "compress",
      label: "compress:code",
      outcome: "pass",
      message: "OK",
      metadata: { tokens: 100 },
    };
    expect(cp.outcome).toBe("pass");
    expect(cp.phase).toBe("compress");
  });
});

// ── RunState Shape ────────────────────────────────────────────────────────────

describe("RunState (type-level shape validation)", () => {
  it("accepts a valid run state object", () => {
    const r: RunState = {
      runId: "run_20260615_abc123_001" as never,
      moduleId: "compression-flow",
      status: "created",
      currentPhase: "compress",
      input: { text: "hello" },
      artifacts: [],
      checkpoints: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(r.status).toBe("created");
    expect(r.moduleId).toBe("compression-flow");
    expect(r.checkpoints).toHaveLength(0);
  });

  it("completed run can have output and completedAt", () => {
    const r: RunState = {
      runId: "run_20260615_xyz_002" as never,
      moduleId: "memory-flow",
      status: "completed",
      currentPhase: "verify",
      input: {},
      output: { checked: 8 },
      artifacts: [
        { name: "log", path: "run_xyz/log", size: 1024 },
      ],
      checkpoints: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    expect(r.status).toBe("completed");
    expect(r.output).toEqual({ checked: 8 });
    expect(r.artifacts).toHaveLength(1);
  });

  it("failed run can have an error", () => {
    const r: RunState = {
      runId: "run_20260615_err_003" as never,
      moduleId: "compression-flow",
      status: "failed",
      input: {},
      artifacts: [],
      checkpoints: [],
      error: { name: "Error", message: "Something went wrong" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    expect(r.status).toBe("failed");
    expect(r.error?.message).toBe("Something went wrong");
  });
});

// ── HarnessModule Shape ───────────────────────────────────────────────────────

describe("HarnessModule (type-level shape validation)", () => {
  it("accepts a minimal module with only manifest and run", () => {
    const mod: HarnessModule = {
      manifest: {
        id: "test-flow",
        name: "Test",
        description: "Test flow",
        phases: [],
        checkpoints: [],
        artifacts: [],
        coversTools: [],
      },
      run: async (_ctx: HarnessContext) => ({ ok: true }),
    };
    expect(mod.manifest.id).toBe("test-flow");
    expect(typeof mod.run).toBe("function");
  });

  it("accepts a module with setup and check", () => {
    const mod: HarnessModule<{ text: string }, { ok: boolean }> = {
      manifest: {
        id: "test-flow",
        name: "Test",
        description: "Test flow with all hooks",
        phases: [{ name: "main", description: "Main phase" }],
        checkpoints: [{ name: "test:step", description: "A step", expect: "pass" }],
        artifacts: [],
        coversTools: [],
      },
      setup: async (_ctx) => { /* prepare */ },
      run: async (ctx) => {
        ctx.checkpoint("test:step", "pass");
        return { ok: true };
      },
      check: async (_ctx, output) => {
        if (!output.ok) throw new Error("check failed");
      },
    };
    expect(mod.setup).toBeDefined();
    expect(mod.check).toBeDefined();
  });
});
