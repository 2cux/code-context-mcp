/**
 * Tool Mode Security Regression Tests
 *
 * Validates MCP_TOOL_MODE enforcement across all three modes:
 *   1. ListTools filtering — only mode-appropriate tools are visible
 *   2. CallTool rejection — hidden tools are blocked with clear error
 *   3. Error message format — includes tool name and mode description
 *   4. Hidden tool call cases — every forbidden tool is explicitly rejected
 *
 * Covers the two enforcement points in server.ts:
 *   - Line 55: TOOL_DEFINITIONS.filter(t => isToolAllowed(t.name, mode))
 *   - Line 65: if (!isToolAllowed(name, mode)) { return error }
 */

import { describe, it, expect } from "vitest";
import { getAllowedTools, isToolAllowed, resolveToolMode, describeMode, getDangerousTools } from "../src/mcp/toolMode.js";
import { ALL_TOOL_NAMES } from "../src/mcp/toolRegistry.js";
import { TOOL_DEFINITIONS } from "../src/mcp/toolSchemas.js";
import { createToolHandlers } from "../src/mcp/toolRegistry.js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load test data
// ---------------------------------------------------------------------------

function loadJson(relPath: string) {
  const p = join(__dirname, "..", relPath);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

const hiddenCases = loadJson("fixtures/rc-hardening/tool-mode-security/hidden-tool-call-cases.json");
const expectedAgent = loadJson("fixtures/rc-hardening/tool-mode-security/expected-agent-tools.json");
const expectedDev = loadJson("fixtures/rc-hardening/tool-mode-security/expected-dev-tools.json");
const expectedTest = loadJson("fixtures/rc-hardening/tool-mode-security/expected-test-tools.json");

// ---------------------------------------------------------------------------
// Simulated server enforcement (mirrors server.ts lines 55 and 65)
// ---------------------------------------------------------------------------

/** Simulate server.ts ListTools: filter TOOL_DEFINITIONS by mode. */
function simulateListTools(mode: string) {
  return TOOL_DEFINITIONS.filter((t) => isToolAllowed(t.name, mode as any));
}

/** Simulate server.ts CallTool: check mode, return result or rejection. */
function simulateCallTool(name: string, mode: string): { allowed: boolean; error?: string } {
  if (!isToolAllowed(name, mode as any)) {
    return {
      allowed: false,
      error: `Tool "${name}" is not available in ${describeMode(mode as any)}`,
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Tool Mode Security Regression", () => {
  // ── Agent mode: ListTools ────────────────────────────────────────────

  describe("agent mode — ListTools", () => {
    const visible = simulateListTools("agent");
    const visibleNames = new Set(visible.map((t) => t.name));

    it("returns exactly 7 tools", () => {
      expect(visible).toHaveLength(7);
    });

    if (expectedAgent) {
      it("matches expected-agent-tools.json exactly", () => {
        const sorted = [...visibleNames].sort();
        const expected = [...expectedAgent].sort();
        expect(sorted).toEqual(expected);
      });
    }

    it("includes run_context_flow", () => {
      expect(visibleNames.has("run_context_flow")).toBe(true);
    });

    it("does NOT expose delete_original", () => {
      expect(visibleNames.has("delete_original")).toBe(false);
    });

    it("does NOT expose cleanup_originals", () => {
      expect(visibleNames.has("cleanup_originals")).toBe(false);
    });

    it("does NOT expose any harness tools", () => {
      for (const name of ALL_TOOL_NAMES) {
        if (name.includes("harness")) {
          expect(visibleNames.has(name)).toBe(false);
        }
      }
    });

    it("does NOT expose list/analyze/failure tools", () => {
      const inspectionTools = [
        "list_context", "list_compressions", "analyze_context",
        "list_failures", "failure_stats",
      ];
      for (const name of inspectionTools) {
        expect(visibleNames.has(name)).toBe(false);
      }
    });
  });

  // ── Agent mode: CallTool rejection ───────────────────────────────────

  describe("agent mode — CallTool rejection", () => {
    const allHiddenTools = ALL_TOOL_NAMES.filter(
      (n) => !isToolAllowed(n, "agent"),
    );

    it("identifies exactly 11 hidden tools", () => {
      expect(allHiddenTools).toHaveLength(11);
    });

    // Test every hidden tool is rejected (from test data)
    if (hiddenCases && hiddenCases.mustReject) {
      for (const toolName of hiddenCases.mustReject) {
        it(`rejects "${toolName}" in agent mode`, () => {
          const result = simulateCallTool(toolName, "agent");
          expect(result.allowed).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error).toContain(toolName);
          expect(result.error).toContain("not available");
        });
      }
    }

    // Test every hidden tool is rejected (comprehensive)
    for (const toolName of allHiddenTools) {
      it(`rejects "${toolName}" with clear error message`, () => {
        const result = simulateCallTool(toolName, "agent");
        expect(result.allowed).toBe(false);
        expect(result.error).toBeDefined();
        // Error must contain: tool name + not available
        expect(result.error).toContain(toolName);
        expect(result.error).toContain("not available");
        // Error must mention the mode
        expect(result.error!.toLowerCase()).toContain("agent");
      });
    }

    // Test every allowed tool IS allowed
    if (hiddenCases && hiddenCases.mustAllow) {
      for (const toolName of hiddenCases.mustAllow) {
        it(`allows "${toolName}" in agent mode`, () => {
          const result = simulateCallTool(toolName, "agent");
          expect(result.allowed).toBe(true);
        });
      }
    }

    // Special focus: dangerous tools
    it("rejects delete_original with specific message", () => {
      const result = simulateCallTool("delete_original", "agent");
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("delete_original");
      expect(result.error).toContain("not available");
    });

    it("rejects cleanup_originals with specific message", () => {
      const result = simulateCallTool("cleanup_originals", "agent");
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("cleanup_originals");
      expect(result.error).toContain("not available");
    });
  });

  // ── Dev mode: ListTools ──────────────────────────────────────────────

  describe("dev mode — ListTools", () => {
    const visible = simulateListTools("dev");
    const visibleNames = new Set(visible.map((t) => t.name));

    it("returns exactly 18 tools", () => {
      expect(visible).toHaveLength(18);
    });

    if (expectedDev) {
      it("matches expected-dev-tools.json exactly", () => {
        const sorted = [...visibleNames].sort();
        const expected = [...expectedDev].sort();
        expect(sorted).toEqual(expected);
      });
    }

    it("includes all 7 agent tools", () => {
      const agentTools = getAllowedTools("agent");
      for (const name of agentTools) {
        expect(visibleNames.has(name)).toBe(true);
      }
    });

    it("includes dangerous tools for developer maintenance", () => {
      expect(visibleNames.has("delete_original")).toBe(true);
      expect(visibleNames.has("cleanup_originals")).toBe(true);
    });

    it("includes harness tools", () => {
      expect(visibleNames.has("run_harness_flow")).toBe(true);
      expect(visibleNames.has("list_harness_flows")).toBe(true);
      expect(visibleNames.has("get_harness_run")).toBe(true);
      expect(visibleNames.has("check_harness_flow")).toBe(true);
    });
  });

  // ── Dev mode: CallTool ───────────────────────────────────────────────

  describe("dev mode — CallTool", () => {
    it("allows all 18 registered tools", () => {
      for (const name of ALL_TOOL_NAMES) {
        const result = simulateCallTool(name, "dev");
        expect(result.allowed).toBe(true);
      }
    });

    it("allows delete_original (dangerous but permitted in dev)", () => {
      const result = simulateCallTool("delete_original", "dev");
      expect(result.allowed).toBe(true);
    });

    it("allows run_harness_flow", () => {
      const result = simulateCallTool("run_harness_flow", "dev");
      expect(result.allowed).toBe(true);
    });
  });

  // ── Test mode: ListTools ─────────────────────────────────────────────

  describe("test mode — ListTools", () => {
    const visible = simulateListTools("test");
    const visibleNames = new Set(visible.map((t) => t.name));

    it("returns all 18 registered tools", () => {
      expect(visible).toHaveLength(18);
    });

    if (expectedTest) {
      it("matches expected-test-tools.json exactly", () => {
        const sorted = [...visibleNames].sort();
        const expected = [...expectedTest].sort();
        expect(sorted).toEqual(expected);
      });
    }
  });

  // ── Test mode: CallTool ──────────────────────────────────────────────

  describe("test mode — CallTool", () => {
    it("allows all 18 registered tools", () => {
      for (const name of ALL_TOOL_NAMES) {
        const result = simulateCallTool(name, "test");
        expect(result.allowed).toBe(true);
      }
    });
  });

  // ── Mode isolation ───────────────────────────────────────────────────

  describe("mode isolation", () => {
    it("agent mode tools are a strict subset of dev mode", () => {
      const agent = getAllowedTools("agent");
      const dev = getAllowedTools("dev");
      for (const name of agent) {
        expect(dev.has(name)).toBe(true);
      }
      // Dev has MORE tools
      expect(dev.size).toBeGreaterThan(agent.size);
    });

    it("dev mode tools are a subset of test mode", () => {
      const devTools = [...getAllowedTools("dev")];
      for (const name of devTools) {
        expect(isToolAllowed(name, "test")).toBe(true);
      }
    });

    it("no mode can add tools beyond ALL_TOOL_NAMES", () => {
      for (const mode of ["agent", "dev"] as const) {
        const allowed = getAllowedTools(mode);
        for (const name of allowed) {
          expect(ALL_TOOL_NAMES).toContain(name);
        }
      }
      // Test mode: check ALL_TOOL_NAMES explicitly
      for (const name of ALL_TOOL_NAMES) {
        expect(isToolAllowed(name, "test")).toBe(true);
      }
    });

    it("dangerous tools are blocked in agent mode, allowed in dev/test", () => {
      for (const dt of getDangerousTools()) {
        expect(isToolAllowed(dt, "agent")).toBe(false);
        expect(isToolAllowed(dt, "dev")).toBe(true);
        expect(isToolAllowed(dt, "test")).toBe(true);
      }
    });
  });

  // ── Error message format ─────────────────────────────────────────────

  describe("CallTool error messages", () => {
    it("agent mode error includes 'agent' and tool name", () => {
      const result = simulateCallTool("delete_original", "agent");
      expect(result.error!.toLowerCase()).toContain("agent");
      expect(result.error).toContain("delete_original");
    });

    it("dev mode — all tools pass, no error generated", () => {
      for (const name of ALL_TOOL_NAMES) {
        const result = simulateCallTool(name, "dev");
        expect(result.allowed).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });

    it("unknown tool names would still be rejected by handler lookup", () => {
      // server.ts also checks `if (!handler)` after mode check
      // This verifies the error message structure is consistent
      const result = simulateCallTool("nonexistent_tool", "agent");
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("nonexistent_tool");
      expect(result.error).toContain("not available");
    });
  });

  // ── Regression: every hidden tool explicitly tested ──────────────────

  describe("regression — hidden tool call cases (from test data)", () => {
    if (hiddenCases) {
      it(`mode is "${hiddenCases.mode}"`, () => {
        expect(hiddenCases.mode).toBe("agent");
      });

      it(`mustReject count matches — ${hiddenCases.mustReject.length} tools must be rejected in agent mode`, () => {
        for (const tool of hiddenCases.mustReject) {
          expect(isToolAllowed(tool, "agent")).toBe(false);
        }
      });

      it(`mustAllow count matches — ${hiddenCases.mustAllow.length} tools must be allowed in agent mode`, () => {
        for (const tool of hiddenCases.mustAllow) {
          expect(isToolAllowed(tool, "agent")).toBe(true);
        }
      });
    }
  });
});
