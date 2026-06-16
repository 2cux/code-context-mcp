/**
 * MCP Tool Schema Validation Tests
 *
 * Covers:
 *   - All 13 tool definitions exist with correct structure
 *   - Each tool has name, description, inputSchema
 *   - inputSchema has type: "object" and properties
 *   - Required fields are declared correctly
 *   - Property types are valid JSON Schema types
 *   - Schema is valid per JSON Schema subset rules
 *   - TOOL_MAP provides O(1) lookup for all tools
 *   - No duplicate tool names
 */

import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS, TOOL_MAP } from "../src/mcp/toolSchemas.js";

// ---------------------------------------------------------------------------
// Expected tool names
// ---------------------------------------------------------------------------

const EXPECTED_TOOLS = [
  "compress_context",
  "current_scope",
  "retrieve_original",
  "delete_original",
  "cleanup_originals",
  "list_compressions",
  "remember_context",
  "recall_context",
  "forget_context",
  "analyze_context",
  "list_context",
  "list_failures",
  "failure_stats",
  "list_harness_flows",
  "run_harness_flow",
  "get_harness_run",
  "check_harness_flow",
  "run_context_flow",
];

// Valid JSON Schema types
const VALID_TYPES = new Set([
  "string", "number", "boolean", "object", "array", "null",
]);

// ---------------------------------------------------------------------------
// Tool Definition Structure
// ---------------------------------------------------------------------------

describe("Tool Definitions Structure", () => {
  it("has exactly 18 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(18);
  });

  it("has all expected tools", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
  });

  it("has no duplicate tool names", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("every tool has name, description, inputSchema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Input Schema Validation
// ---------------------------------------------------------------------------

describe("Input Schema Validation", () => {
  it("every inputSchema has type: 'object'", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("every inputSchema has a properties object", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.properties).toBeDefined();
      expect(typeof tool.inputSchema.properties).toBe("object");
      expect(Object.keys(tool.inputSchema.properties).length).toBeGreaterThan(0);
    }
  });

  it("every property has a valid type field", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const props = tool.inputSchema.properties!;
      for (const [propName, propDef] of Object.entries(props)) {
        const propType = (propDef as Record<string, unknown>).type;
        expect(propType).toBeDefined();
        const typeStr = String(propType);
        expect(VALID_TYPES.has(typeStr)).toBe(true);
      }
    }
  });

  it("every property has a description", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const props = tool.inputSchema.properties!;
      for (const [propName, propDef] of Object.entries(props)) {
        const desc = (propDef as Record<string, unknown>).description;
        expect(desc).toBeDefined();
        expect(typeof desc).toBe("string");
        expect((desc as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("array properties have items defined", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const props = tool.inputSchema.properties!;
      for (const [propName, propDef] of Object.entries(props)) {
        const p = propDef as Record<string, unknown>;
        if (p.type === "array") {
          expect(
            p.items,
            `Tool "${tool.name}" property "${propName}" is array but missing items`,
          ).toBeDefined();
          const items = p.items as Record<string, unknown>;
          expect(
            items.type,
            `Tool "${tool.name}" property "${propName}" items missing type`,
          ).toBeDefined();
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Required Fields
// ---------------------------------------------------------------------------

describe("Required Fields", () => {
  it("all required fields exist in properties", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const required = tool.inputSchema.required;
      const propNames = Object.keys(tool.inputSchema.properties!);

      if (required) {
        for (const field of required) {
          expect(
            propNames,
            `Tool "${tool.name}" requires "${field}" but it's not in properties`,
          ).toContain(field);
        }
      }
    }
  });

  it("per-tool required field verification", () => {
    const expected: Record<string, string[]> = {
      compress_context: ["scopeId", "content"],
      current_scope: [],
      retrieve_original: ["scopeId", "originalRef"],
      delete_original: ["scopeId", "originalRef"],
      cleanup_originals: ["scopeId"],
      list_compressions: ["scopeId"],
      remember_context: ["type", "content"],
      recall_context: ["query"],
      forget_context: ["id", "mode"],
      list_context: ["scopeId"],
      run_context_flow: ["flow"],
    };

    for (const tool of TOOL_DEFINITIONS) {
      const exp = expected[tool.name];
      if (exp === undefined) continue;

      const actual = tool.inputSchema.required ?? [];
      expect(
        new Set(actual),
        `Tool "${tool.name}" required fields mismatch`,
      ).toEqual(new Set(exp));
    }
  });
});

// ---------------------------------------------------------------------------
// TOOL_MAP
// ---------------------------------------------------------------------------

describe("TOOL_MAP", () => {
  it("has entries for all tools", () => {
    for (const name of EXPECTED_TOOLS) {
      expect(TOOL_MAP[name]).toBeDefined();
    }
  });

  it("maps to the correct tool definition", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(TOOL_MAP[tool.name]).toBe(tool);
    }
  });
});

// ---------------------------------------------------------------------------
// Tool-Specific Schema Checks
// ---------------------------------------------------------------------------

describe("Tool-Specific Schema Checks", () => {
  describe("compress_context", () => {
    const tool = TOOL_MAP["compress_context"]!;

    it("has content property (required)", () => {
      expect(tool.inputSchema.properties!["content"].type).toBe("string");
    });

    it("has optional boolean fields", () => {
      expect(tool.inputSchema.properties!["keepOriginal"].type).toBe("boolean");
    });

    it("has optional number fields", () => {
      const props = tool.inputSchema.properties!;
      expect(props["maxTokens"].type).toBe("number");
      expect(props["timeoutMs"].type).toBe("number");
      expect(props["maxInputBytes"].type).toBe("number");
    });

    it("has optional metadata field (object)", () => {
      expect(tool.inputSchema.properties!["metadata"].type).toBe("object");
    });
  });

  describe("current_scope", () => {
    const tool = TOOL_MAP["current_scope"]!;

    it("has optional cwd property", () => {
      expect(tool.inputSchema.properties!["cwd"].type).toBe("string");
    });

    it("has no required fields", () => {
      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  describe("retrieve_original", () => {
    const tool = TOOL_MAP["retrieve_original"]!;

    it("has required scopeId and originalRef", () => {
      expect(tool.inputSchema.required).toContain("scopeId");
      expect(tool.inputSchema.required).toContain("originalRef");
    });

    it("has pagination fields (offset/limit as numbers)", () => {
      const props = tool.inputSchema.properties!;
      expect(props["offset"].type).toBe("number");
      expect(props["limit"].type).toBe("number");
    });
  });

  describe("remember_context", () => {
    const tool = TOOL_MAP["remember_context"]!;

    it("requires type and content", () => {
      expect(tool.inputSchema.required).toEqual(["type", "content"]);
    });

    it("has tags as array of strings", () => {
      const tags = tool.inputSchema.properties!["tags"];
      expect(tags.type).toBe("array");
      expect((tags as Record<string, unknown>).items).toEqual({ type: "string" });
    });

    it("has confidence as number", () => {
      expect(tool.inputSchema.properties!["confidence"].type).toBe("number");
    });

    it("has optional profile-related fields", () => {
      const props = tool.inputSchema.properties!;
      expect(props["profileTarget"].type).toBe("string");
      expect(props["expiresAt"].type).toBe("string");
      expect(props["ccrId"].type).toBe("string");
      expect(props["originalRef"].type).toBe("string");
    });
  });

  describe("recall_context", () => {
    const tool = TOOL_MAP["recall_context"]!;

    it("requires query only", () => {
      expect(tool.inputSchema.required).toEqual(["query"]);
    });

    it("has types and status as array of strings", () => {
      const props = tool.inputSchema.properties!;
      expect(props["types"].type).toBe("array");
      expect(props["status"].type).toBe("array");
    });

    it("has boolean flags for profile control", () => {
      const props = tool.inputSchema.properties!;
      expect(props["includeProfile"].type).toBe("boolean");
      expect(props["includeStatic"].type).toBe("boolean");
      expect(props["includeDynamic"].type).toBe("boolean");
      expect(props["includeCompressedRefs"].type).toBe("boolean");
      expect(props["retrieveOriginal"].type).toBe("boolean");
    });
  });

  describe("forget_context", () => {
    const tool = TOOL_MAP["forget_context"]!;

    it("requires id and mode", () => {
      expect(tool.inputSchema.required).toEqual(["id", "mode"]);
    });

    it("has supersededBy for supersede mode", () => {
      expect(tool.inputSchema.properties!["supersededBy"].type).toBe("string");
    });

    it("has reason as string", () => {
      expect(tool.inputSchema.properties!["reason"].type).toBe("string");
    });
  });

  describe("list_context", () => {
    const tool = TOOL_MAP["list_context"]!;

    it("requires scopeId", () => {
      expect(tool.inputSchema.required).toEqual(["scopeId"]);
    });

    it("has sort fields", () => {
      const props = tool.inputSchema.properties!;
      expect(props["sortBy"].type).toBe("string");
      expect(props["sortOrder"].type).toBe("string");
    });
  });

  describe("delete_original", () => {
    const tool = TOOL_MAP["delete_original"]!;

    it("requires scopeId and originalRef", () => {
      expect(tool.inputSchema.required).toContain("scopeId");
      expect(tool.inputSchema.required).toContain("originalRef");
    });
  });

  describe("cleanup_originals", () => {
    const tool = TOOL_MAP["cleanup_originals"]!;

    it("requires scopeId only", () => {
      expect(tool.inputSchema.required).toEqual(["scopeId"]);
    });
  });

  describe("list_compressions", () => {
    const tool = TOOL_MAP["list_compressions"]!;

    it("requires scopeId", () => {
      expect(tool.inputSchema.required).toEqual(["scopeId"]);
    });

    it("has pagination fields", () => {
      const props = tool.inputSchema.properties!;
      expect(props["limit"].type).toBe("number");
      expect(props["offset"].type).toBe("number");
      expect(props["contentType"].type).toBe("string");
    });
  });

  describe("run_context_flow", () => {
    const tool = TOOL_MAP["run_context_flow"]!;

    it("requires flow only", () => {
      expect(tool.inputSchema.required).toEqual(["flow"]);
    });

    it("has flow as string", () => {
      expect(tool.inputSchema.properties!["flow"].type).toBe("string");
    });

    it("has optional content and query", () => {
      const props = tool.inputSchema.properties!;
      expect(props["content"].type).toBe("string");
      expect(props["query"].type).toBe("string");
      expect(props["goal"].type).toBe("string");
      expect(props["scopeId"].type).toBe("string");
      expect(props["contentType"].type).toBe("string");
    });

    it("has options as object with nested booleans and number", () => {
      const opts = tool.inputSchema.properties!["options"];
      expect(opts.type).toBe("object");
      const optProps = (opts as Record<string, unknown>).properties as Record<string, unknown>;
      expect((optProps["keepOriginal"] as Record<string, unknown>).type).toBe("boolean");
      expect((optProps["includeRecall"] as Record<string, unknown>).type).toBe("boolean");
      expect((optProps["saveMemory"] as Record<string, unknown>).type).toBe("boolean");
      expect((optProps["maxTokens"] as Record<string, unknown>).type).toBe("number");
    });
  });
});
