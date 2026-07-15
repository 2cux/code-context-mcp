/**
 * Prompt handlers test
 */

import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import { runMigrations } from "../../src/storage/migrations.js";
import { listPrompts, getPrompt } from "../../src/mcp/promptHandlers.js";
import { MemoryService } from "../../src/memory/memoryService.js";
import { resolveScope } from "../../src/scope/resolveScope.js";
import { TOOL_MAP } from "../../src/mcp/toolSchemas.js";
import { getAllowedTools } from "../../src/mcp/toolMode.js";

describe("promptHandlers", () => {
  let db: Database;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    runMigrations(db);
  });

  describe("listPrompts", () => {
    it("should return project_context_brief prompt", () => {
      const prompts = listPrompts();
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatchObject({
        name: "project_context_brief",
        description: expect.stringContaining("Brief project context"),
      });
    });
  });

  describe("getPrompt", () => {
    it("should return project_context_brief with formatted text under 800 tokens", () => {
      const scope = resolveScope();
      const memoryService = new MemoryService(db);

      // Add test memories
      memoryService.remember({
        scopeId: scope.scopeId,
        type: "project_rule",
        content: "Use TypeScript strict mode",
        summary: "TypeScript config rule",
        confidence: 0.95,
      });

      memoryService.remember({
        scopeId: scope.scopeId,
        type: "decision",
        content: "Use Vitest for testing",
        summary: "Test framework decision",
        confidence: 0.9,
      });

      const result = getPrompt("project_context_brief", { db });

      expect(result).toHaveProperty("description");
      expect(result).toHaveProperty("messages");
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.role).toBe("user");
      expect(result.messages[0]!.content.type).toBe("text");

      const text = result.messages[0]!.content.text;
      expect(text).toContain("# CodeContext Project Brief");
      expect(text).toContain("## Current Project");
      expect(text).toContain("## Stats");
      expect(text).toContain("## Available Tools");
      expect(text).toContain("Local-first constraint");

      // Should show project name, not scopeId
      expect(text).toContain("Project:");
      expect(text).not.toContain(`Project: \`${scope.scopeId}\``);

      expect(text).toContain("recall_context");
      expect(text).toContain("compress_context");
      expect(text).toContain("forget_context");

      // Estimate tokens (rough: ~4 chars per token)
      const estimatedTokens = text.length / 4;
      expect(estimatedTokens).toBeLessThan(1000);
    });

    it("should handle empty project gracefully", () => {
      const result = getPrompt("project_context_brief", { db });
      const text = result.messages[0]!.content.text;

      expect(text).toContain("# CodeContext Project Brief");
      expect(text).toContain("Active memories: 0");
      expect(text).toContain("Compressed contexts: 0");
      expect(text).toContain("Local-first constraint");
    });

    it("should throw error for unknown prompt", () => {
      expect(() => getPrompt("unknown_prompt", { db })).toThrow("Unknown prompt");
    });

    it("should only show agent-mode tools in project_context_brief (7 tools)", () => {
      const result = getPrompt("project_context_brief", { db });
      const text = result.messages[0]!.content.text;

      // Should include agent-mode tools
      expect(text).toContain("current_scope");
      expect(text).toContain("compress_context");
      expect(text).toContain("retrieve_original");
      expect(text).toContain("remember_context");
      expect(text).toContain("recall_context");
      expect(text).toContain("forget_context");
      expect(text).toContain("run_context_flow");

      // Should NOT include dev-only tools
      expect(text).not.toContain("list_context");
      expect(text).not.toContain("delete_original");
      expect(text).not.toContain("cleanup_originals");
      expect(text).not.toContain("run_harness_flow");
      expect(text).not.toContain("list_compressions");
      expect(text).not.toContain("analyze_context");
      expect(text).not.toContain("list_failures");
      expect(text).not.toContain("failure_stats");
      expect(text).not.toContain("list_harness_flows");
      expect(text).not.toContain("get_harness_run");
      expect(text).not.toContain("check_harness_flow");

      // Count tool mentions in "Available Tools" section
      const toolsSection = text.split("## Available Tools")[1]?.split("##")[0] ?? "";
      const toolLines = toolsSection.split("\n").filter(line => line.trim().startsWith("-"));
      expect(toolLines).toHaveLength(7);
    });

    it("should derive every guidance tool and parameter from the real MCP schemas", () => {
      const result = getPrompt("project_context_brief", { db });
      const text = result.messages[0]!.content.text;
      const toolsSection = text.split("## Available Tools")[1]?.split("##")[0] ?? "";
      const toolLines = toolsSection.split("\n").filter(line => line.trim().startsWith("-"));
      const signaturePattern = /^- `([a-z_]+)\(([^)]*)\)`/;

      expect(toolLines).toHaveLength(getAllowedTools("agent").size);

      for (const line of toolLines) {
        const match = line.match(signaturePattern);
        expect(match, `invalid guidance signature: ${line}`).not.toBeNull();

        const toolName = match![1]!;
        const parameterNames = match![2]
          ? match![2]!.split(", ").filter(Boolean)
          : [];
        const schema = TOOL_MAP[toolName];

        expect(getAllowedTools("agent").has(toolName)).toBe(true);
        expect(schema, `missing schema for ${toolName}`).toBeDefined();

        const schemaParameterNames = Object.keys(schema!.inputSchema.properties ?? {});
        const requiredParameterNames = new Set(schema!.inputSchema.required ?? []);
        const expectedParameterNames = toolName === "run_context_flow"
          ? schemaParameterNames
          : schemaParameterNames.filter(
              (parameterName) => parameterName !== "scopeId" && requiredParameterNames.has(parameterName),
            );

        expect(
          parameterNames,
          `${toolName} prompt signature differs from its MCP schema`,
        ).toEqual(expectedParameterNames);
      }

      expect(toolsSection).toContain("`compress_context(content)`");
      expect(toolsSection).toContain("`retrieve_original(originalRef)`");
      expect(toolsSection).toContain(
        "`run_context_flow(flow, scopeId, goal, content, contentType, query, options)`",
      );
    });

    it("should not expose dev-only, harness, or dangerous tools in guidance", () => {
      const result = getPrompt("project_context_brief", { db });
      const text = result.messages[0]!.content.text;
      const toolsSection = text.split("## Available Tools")[1]?.split("##")[0] ?? "";
      const agentTools = getAllowedTools("agent");

      for (const toolName of Object.keys(TOOL_MAP)) {
        if (!agentTools.has(toolName)) {
          expect(toolsSection).not.toContain(`\`${toolName}(`);
        }
      }

      expect(toolsSection.toLowerCase()).not.toContain("harness");
    });
  });
});
