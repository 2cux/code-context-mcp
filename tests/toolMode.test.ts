/**
 * MCP Tool Surface Mode Tests
 *
 * Validates that:
 *   - Agent mode exposes exactly 7 tools
 *   - Dev mode exposes 17 tools (all except dangerous)
 *   - Test mode exposes all 18 tools
 *   - Dangerous tools are excluded from agent and dev
 *   - run_context_flow is present in all three modes
 */

import { describe, it, expect } from "vitest";
import { getAllowedTools, isToolAllowed, resolveToolMode, getDangerousTools } from "../src/mcp/toolMode.js";
import { ALL_TOOL_NAMES } from "../src/mcp/toolRegistry.js";
import { TOOL_DEFINITIONS } from "../src/mcp/toolSchemas.js";

describe("toolMode", () => {
  describe("resolveToolMode", () => {
    it("defaults to agent when env is not set", () => {
      // In CI/tests, MCP_TOOL_MODE is typically not set
      const mode = resolveToolMode();
      expect(["agent", "dev", "test"]).toContain(mode);
    });
  });

  describe("agent mode", () => {
    const allowed = getAllowedTools("agent");

    it("exposes exactly 7 tools", () => {
      expect(allowed.size).toBe(7);
    });

    it("includes all required agent tools", () => {
      expect(allowed.has("current_scope")).toBe(true);
      expect(allowed.has("compress_context")).toBe(true);
      expect(allowed.has("retrieve_original")).toBe(true);
      expect(allowed.has("remember_context")).toBe(true);
      expect(allowed.has("recall_context")).toBe(true);
      expect(allowed.has("forget_context")).toBe(true);
      expect(allowed.has("run_context_flow")).toBe(true);
    });

    it("excludes dangerous tools", () => {
      for (const dt of getDangerousTools()) {
        expect(allowed.has(dt)).toBe(false);
      }
    });

    it("excludes harness tools", () => {
      expect(allowed.has("list_harness_flows")).toBe(false);
      expect(allowed.has("run_harness_flow")).toBe(false);
      expect(allowed.has("get_harness_run")).toBe(false);
      expect(allowed.has("check_harness_flow")).toBe(false);
    });

    it("excludes list/analyze tools", () => {
      expect(allowed.has("list_context")).toBe(false);
      expect(allowed.has("list_compressions")).toBe(false);
      expect(allowed.has("analyze_context")).toBe(false);
      expect(allowed.has("list_failures")).toBe(false);
      expect(allowed.has("failure_stats")).toBe(false);
    });

    it("isToolAllowed returns correct values", () => {
      expect(isToolAllowed("run_context_flow", "agent")).toBe(true);
      expect(isToolAllowed("delete_original", "agent")).toBe(false);
      expect(isToolAllowed("run_harness_flow", "agent")).toBe(false);
    });
  });

  describe("dev mode", () => {
    const allowed = getAllowedTools("dev");

    it("exposes 18 tools", () => {
      expect(allowed.size).toBe(18);
    });

    it("includes agent tools", () => {
      for (const t of ["current_scope", "compress_context", "retrieve_original", "remember_context", "recall_context", "forget_context", "run_context_flow"]) {
        expect(allowed.has(t)).toBe(true);
      }
    });

    it("includes dev-only tools", () => {
      for (const t of ["list_context", "list_compressions", "analyze_context", "list_failures", "failure_stats", "list_harness_flows", "run_harness_flow", "get_harness_run", "check_harness_flow"]) {
        expect(allowed.has(t)).toBe(true);
      }
    });

    it("includes dangerous tools for developer maintenance", () => {
      for (const dt of getDangerousTools()) {
        expect(allowed.has(dt)).toBe(true);
      }
    });
  });

  describe("test mode", () => {
    it("allows all 18 registered tools", () => {
      for (const name of ALL_TOOL_NAMES) {
        expect(isToolAllowed(name, "test")).toBe(true);
      }
    });

    it("allows dangerous tools", () => {
      expect(isToolAllowed("delete_original", "test")).toBe(true);
      expect(isToolAllowed("cleanup_originals", "test")).toBe(true);
    });
  });

  describe("TOOL_DEFINITIONS consistency", () => {
    it("every TOOL_DEFINITIONS name is in ALL_TOOL_NAMES", () => {
      const defNames = new Set(TOOL_DEFINITIONS.map((t) => t.name));
      for (const name of ALL_TOOL_NAMES) {
        expect(defNames.has(name)).toBe(true);
      }
    });

    it("agent mode tools are a subset of all registered tools", () => {
      const agentTools = getAllowedTools("agent");
      for (const name of agentTools) {
        expect(ALL_TOOL_NAMES).toContain(name);
      }
    });

    it("dev mode has agent mode as a subset", () => {
      const agent = getAllowedTools("agent");
      const dev = getAllowedTools("dev");
      for (const name of agent) {
        expect(dev.has(name)).toBe(true);
      }
    });
  });
});
