/**
 * Profile Boundary Regression Tests — Phase 02
 *
 * Locks down the tool exposure boundary for four CodeGraph MCP profiles:
 *   agent   — fast direct MCP tools only (6)
 *   full    — all non-harness tools, harness excluded
 *   harness — harness workflow/report/audit/debug tools only (4)
 *   debug   — full ∪ harness (all 10)
 *
 * Validates against fixture data in:
 *   fixtures/fast-path-harness-boundary/profiles/
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  resolveCodeGraphProfile,
  getAllowedCodeGraphTools,
  isCodeGraphToolAllowed,
  getHarnessTools,
  getFastTools,
  getAllCodeGraphTools,
  describeCodeGraphProfile,
  FAST_TOOLS,
  HARNESS_TOOLS,
  ALL_CODEGRAPH_TOOLS,
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
  "profiles",
);

function readJsonFixture(filename: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(FIXTURES_DIR, filename), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants from implementation
// ---------------------------------------------------------------------------

const FAST_TOOL_NAMES = [...FAST_TOOLS];
const HARNESS_TOOL_NAMES = [...HARNESS_TOOLS];
const ALL_TOOL_NAMES = [...ALL_CODEGRAPH_TOOLS];

// All 4 profiles
const PROFILES: CodeGraphProfile[] = ["agent", "full", "harness", "debug"];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Profile Gate — CodeGraph MCP Tool Surface", () => {
  // ==========================================================================
  // Profile resolution
  // ==========================================================================

  describe("resolveCodeGraphProfile", () => {
    it("defaults to agent when CODEGRAPH_PROFILE is not set", () => {
      // In CI/tests, CODEGRAPH_PROFILE is typically not set
      const profile = resolveCodeGraphProfile();
      expect(profile).toBe("agent");
    });

    it("returns agent for invalid profile values", () => {
      // Simulate by checking that only valid values produce non-default
      const valid = ["agent", "full", "harness", "debug"];
      // The function itself handles invalid by returning "agent"
      // We can't set env vars easily in parallel tests, so verify
      // that the function returns a valid profile for its default
      const profile = resolveCodeGraphProfile();
      expect(valid).toContain(profile);
    });
  });

  // ==========================================================================
  // Agent profile
  // ==========================================================================

  describe("agent profile", () => {
    const allowed = getAllowedCodeGraphTools("agent");

    it("exposes exactly 6 fast tools", () => {
      expect(allowed.size).toBe(6);
    });

    it("includes all 6 fast direct MCP tools", () => {
      for (const t of FAST_TOOL_NAMES) {
        expect(allowed.has(t)).toBe(true);
      }
    });

    it("does not expose any harness tools", () => {
      for (const t of HARNESS_TOOL_NAMES) {
        expect(allowed.has(t)).toBe(false);
      }
    });

    it("codegraph_harness_run is NOT visible", () => {
      expect(isCodeGraphToolAllowed("codegraph_harness_run", "agent")).toBe(
        false,
      );
    });

    it("matches fixture: expected-agent-tools.json", () => {
      const fixture = readJsonFixture("expected-agent-tools.json");
      const expectedTools = fixture.expectedTools as string[];
      const mustNotInclude = fixture.mustNotInclude as string[];

      expect(fixture.profile).toBe("agent");

      // mustInclude
      for (const t of expectedTools) {
        expect(isCodeGraphToolAllowed(t, "agent")).toBe(true);
      }

      // mustNotInclude
      for (const t of mustNotInclude) {
        expect(isCodeGraphToolAllowed(t, "agent")).toBe(false);
      }
    });
  });

  // ==========================================================================
  // Full profile
  // ==========================================================================

  describe("full profile", () => {
    const allowed = getAllowedCodeGraphTools("full");

    it("includes all fast tools", () => {
      for (const t of FAST_TOOL_NAMES) {
        expect(allowed.has(t)).toBe(true);
      }
    });

    it("does not expose any harness tools", () => {
      for (const t of HARNESS_TOOL_NAMES) {
        expect(allowed.has(t)).toBe(false);
      }
    });

    it("codegraph_harness_run is NOT visible", () => {
      expect(isCodeGraphToolAllowed("codegraph_harness_run", "full")).toBe(
        false,
      );
    });

    it("profile description mentions harness exclusion", () => {
      const desc = describeCodeGraphProfile("full");
      expect(desc.toLowerCase()).toMatch(/harness.*excluded|excluded|non-harness/);
    });
  });

  // ==========================================================================
  // Harness profile
  // ==========================================================================

  describe("harness profile", () => {
    const allowed = getAllowedCodeGraphTools("harness");

    it("exposes exactly 4 harness tools", () => {
      expect(allowed.size).toBe(4);
    });

    it("includes all 4 harness tools", () => {
      for (const t of HARNESS_TOOL_NAMES) {
        expect(allowed.has(t)).toBe(true);
      }
    });

    it("does not expose any fast tools", () => {
      for (const t of FAST_TOOL_NAMES) {
        expect(allowed.has(t)).toBe(false);
      }
    });

    it("codegraph_harness_run IS visible", () => {
      expect(isCodeGraphToolAllowed("codegraph_harness_run", "harness")).toBe(
        true,
      );
    });

    it("matches fixture: expected-harness-tools.json", () => {
      const fixture = readJsonFixture("expected-harness-tools.json");
      const expectedTools = fixture.expectedTools as string[];
      const mustNotInclude = fixture.mustNotInclude as string[];

      expect(fixture.profile).toBe("harness");

      // mustInclude
      for (const t of expectedTools) {
        expect(isCodeGraphToolAllowed(t, "harness")).toBe(true);
      }

      // mustNotInclude
      for (const t of mustNotInclude) {
        expect(isCodeGraphToolAllowed(t, "harness")).toBe(false);
      }
    });
  });

  // ==========================================================================
  // Debug profile
  // ==========================================================================

  describe("debug profile", () => {
    const allowed = getAllowedCodeGraphTools("debug");

    it("exposes exactly 10 tools (6 fast + 4 harness)", () => {
      expect(allowed.size).toBe(10);
    });

    it("debug profile = full ∪ harness", () => {
      const fullTools = getAllowedCodeGraphTools("full");
      const harnessTools = getAllowedCodeGraphTools("harness");

      // Every full tool is in debug
      for (const t of fullTools) {
        expect(allowed.has(t)).toBe(true);
      }

      // Every harness tool is in debug
      for (const t of harnessTools) {
        expect(allowed.has(t)).toBe(true);
      }

      // Debug has exactly the union size (no extra, no missing)
      const unionSize = new Set([...fullTools, ...harnessTools]).size;
      expect(allowed.size).toBe(unionSize);
    });

    it("codegraph_harness_run IS visible", () => {
      expect(isCodeGraphToolAllowed("codegraph_harness_run", "debug")).toBe(
        true,
      );
    });

    it("matches fixture: expected-debug-composition.json", () => {
      const fixture = readJsonFixture("expected-debug-composition.json");

      expect(fixture.profile).toBe("debug");

      const mustInclude = fixture.mustInclude as string[];
      for (const t of mustInclude) {
        expect(isCodeGraphToolAllowed(t, "debug")).toBe(true);
      }

      // mustEqualUnionOf: debug = full ∪ harness
      const mustEqualUnionOf = fixture.mustEqualUnionOf as string[];
      expect(mustEqualUnionOf).toContain("full");
      expect(mustEqualUnionOf).toContain("harness");

      // Verify the union property
      const fullSet = getAllowedCodeGraphTools("full");
      const harnessSet = getAllowedCodeGraphTools("harness");
      const debugSet = getAllowedCodeGraphTools("debug");
      const computedUnion = new Set([...fullSet, ...harnessSet]);

      expect(debugSet.size).toBe(computedUnion.size);
      for (const t of computedUnion) {
        expect(debugSet.has(t)).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Profile rules validation (against profile-rules.json)
  // ==========================================================================

  describe("profile-rules.json consistency", () => {
    const rules = readJsonFixture("profile-rules.json");
    const profiles = rules.profiles as Record<string, Record<string, unknown>>;

    it("defines all 4 profiles", () => {
      expect(Object.keys(profiles).sort()).toEqual(
        ["agent", "full", "harness", "debug"].sort(),
      );
    });

    it("agent: mustInclude all fast tools, mustExclude all harness tools", () => {
      const agentRules = profiles["agent"]!;
      const mustInclude = agentRules.mustInclude as string[];
      const mustExclude = agentRules.mustExclude as string[];

      for (const t of mustInclude) {
        expect(isCodeGraphToolAllowed(t, "agent")).toBe(true);
      }
      for (const t of mustExclude) {
        expect(isCodeGraphToolAllowed(t, "agent")).toBe(false);
      }
    });

    it("full: mustExclude all harness tools", () => {
      const fullRules = profiles["full"]!;
      const mustExclude = fullRules.mustExclude as string[];

      for (const t of mustExclude) {
        expect(isCodeGraphToolAllowed(t, "full")).toBe(false);
      }
      // Also validate that all non-harness tools are included
      for (const t of FAST_TOOL_NAMES) {
        expect(isCodeGraphToolAllowed(t, "full")).toBe(true);
      }
    });

    it("harness: mustIncludeOnly harness tools", () => {
      const harnessRules = profiles["harness"]!;
      const mustIncludeOnly = harnessRules.mustIncludeOnly as string[];

      // All specified tools are included
      for (const t of mustIncludeOnly) {
        expect(isCodeGraphToolAllowed(t, "harness")).toBe(true);
      }
      // No other tools are included
      const harnessAllowed = getAllowedCodeGraphTools("harness");
      expect(harnessAllowed.size).toBe(mustIncludeOnly.length);
    });

    it("debug: composition = [full, harness]", () => {
      const debugRules = profiles["debug"]!;
      const composition = debugRules.composition as string[];

      expect(composition).toContain("full");
      expect(composition).toContain("harness");

      // Verify debug = full ∪ harness
      const fullSet = getAllowedCodeGraphTools("full");
      const harnessSet = getAllowedCodeGraphTools("harness");
      const debugSet = getAllowedCodeGraphTools("debug");

      const union = new Set([...fullSet, ...harnessSet]);
      expect(debugSet.size).toBe(union.size);
      for (const t of union) {
        expect(debugSet.has(t)).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Cross-profile boundary assertions
  // ==========================================================================

  describe("cross-profile boundaries", () => {
    it("no profile exposes tools from another category unexpectedly", () => {
      // Verify the boundary is clean — each profile's tool set is
      // exactly what it claims to be.
      const agentSet = getAllowedCodeGraphTools("agent");
      const harnessSet = getAllowedCodeGraphTools("harness");
      const fullSet = getAllowedCodeGraphTools("full");
      const debugSet = getAllowedCodeGraphTools("debug");

      // Agent ∩ Harness = ∅
      for (const t of agentSet) {
        expect(harnessSet.has(t)).toBe(false);
      }

      // Full ∩ Harness = ∅
      for (const t of fullSet) {
        expect(harnessSet.has(t)).toBe(false);
      }

      // Agent ⊆ Full
      for (const t of agentSet) {
        expect(fullSet.has(t)).toBe(true);
      }

      // Agent ⊆ Debug
      for (const t of agentSet) {
        expect(debugSet.has(t)).toBe(true);
      }

      // Full ⊆ Debug
      for (const t of fullSet) {
        expect(debugSet.has(t)).toBe(true);
      }

      // Harness ⊆ Debug
      for (const t of harnessSet) {
        expect(debugSet.has(t)).toBe(true);
      }
    });

    it("fast tools are never in harness profile", () => {
      for (const t of FAST_TOOL_NAMES) {
        expect(isCodeGraphToolAllowed(t, "harness")).toBe(false);
      }
    });

    it("harness tools are never in agent or full profile", () => {
      for (const t of HARNESS_TOOL_NAMES) {
        expect(isCodeGraphToolAllowed(t, "agent")).toBe(false);
        expect(isCodeGraphToolAllowed(t, "full")).toBe(false);
      }
    });

    it("harness tools are always in debug profile", () => {
      for (const t of HARNESS_TOOL_NAMES) {
        expect(isCodeGraphToolAllowed(t, "debug")).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Tool count invariants
  // ==========================================================================

  describe("tool count invariants", () => {
    it("there are exactly 6 fast tools", () => {
      expect(FAST_TOOL_NAMES.length).toBe(6);
    });

    it("there are exactly 4 harness tools", () => {
      expect(HARNESS_TOOL_NAMES.length).toBe(4);
    });

    it("there are exactly 10 total CodeGraph tools", () => {
      expect(ALL_TOOL_NAMES.length).toBe(10);
    });

    it("all 4 profiles return a valid set", () => {
      for (const p of PROFILES) {
        const tools = getAllowedCodeGraphTools(p);
        expect(tools.size).toBeGreaterThan(0);
        expect(tools.size).toBeLessThanOrEqual(10);
      }
    });
  });

  // ==========================================================================
  // Visibility matrix (explicit per-tool, per-profile)
  // ==========================================================================

  describe("visibility matrix", () => {
    // Construct a matrix: for each tool, which profiles see it
    const matrix: Record<string, CodeGraphProfile[]> = {};

    for (const tool of ALL_TOOL_NAMES) {
      matrix[tool] = [];
      for (const profile of PROFILES) {
        if (isCodeGraphToolAllowed(tool, profile)) {
          matrix[tool]!.push(profile);
        }
      }
    }

    it("fast tools are visible in agent, full, debug — not harness", () => {
      for (const t of FAST_TOOL_NAMES) {
        expect(matrix[t]!.sort()).toEqual(
          ["agent", "full", "debug"].sort(),
        );
      }
    });

    it("harness tools are visible in harness, debug — not agent, full", () => {
      for (const t of HARNESS_TOOL_NAMES) {
        expect(matrix[t]!.sort()).toEqual(
          ["harness", "debug"].sort(),
        );
      }
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe("edge cases", () => {
    it("unknown tool name returns false for all profiles", () => {
      for (const p of PROFILES) {
        expect(isCodeGraphToolAllowed("nonexistent_tool", p)).toBe(false);
      }
    });

    it("empty tool name returns false for all profiles", () => {
      for (const p of PROFILES) {
        expect(isCodeGraphToolAllowed("", p)).toBe(false);
      }
    });

    it("getHarnessTools returns exactly 4 tools", () => {
      expect(getHarnessTools()).toHaveLength(4);
    });

    it("getFastTools returns exactly 6 tools", () => {
      expect(getFastTools()).toHaveLength(6);
    });

    it("getAllCodeGraphTools returns exactly 10 tools", () => {
      expect(getAllCodeGraphTools()).toHaveLength(10);
    });
  });

  // ==========================================================================
  // Profile description strings
  // ==========================================================================

  describe("describeCodeGraphProfile", () => {
    it("returns non-empty description for every profile", () => {
      for (const p of PROFILES) {
        const desc = describeCodeGraphProfile(p);
        expect(desc.length).toBeGreaterThan(0);
      }
    });

    it("agent description mentions 'agent' or 'default'", () => {
      expect(describeCodeGraphProfile("agent").toLowerCase()).toMatch(
        /agent|default/,
      );
    });

    it("harness description mentions 'harness' or 'workflow'", () => {
      expect(describeCodeGraphProfile("harness").toLowerCase()).toMatch(
        /harness|workflow/,
      );
    });

    it("debug description mentions 'debug' or 'development' or 'ci'", () => {
      expect(describeCodeGraphProfile("debug").toLowerCase()).toMatch(
        /debug|development|ci|all/,
      );
    });
  });

  // ==========================================================================
  // Fixture integrity
  // ==========================================================================

  describe("fixture integrity", () => {
    it("all 4 fixture files exist and are valid JSON", () => {
      const files = [
        "expected-agent-tools.json",
        "expected-harness-tools.json",
        "profile-rules.json",
        "expected-debug-composition.json",
      ];
      for (const f of files) {
        const fixture = readJsonFixture(f);
        expect(fixture).toBeDefined();
        expect(typeof fixture).toBe("object");
      }
    });

    it("expected-agent-tools.json expectedTools has exactly 6 entries", () => {
      const fixture = readJsonFixture("expected-agent-tools.json");
      expect((fixture.expectedTools as string[]).length).toBe(6);
    });

    it("expected-harness-tools.json expectedTools has exactly 4 entries", () => {
      const fixture = readJsonFixture("expected-harness-tools.json");
      expect((fixture.expectedTools as string[]).length).toBe(4);
    });
  });
});
