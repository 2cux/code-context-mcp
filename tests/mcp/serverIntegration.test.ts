/**
 * MCP Server integration test — verify resources and prompts are registered
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import { runMigrations } from "../../src/storage/migrations.js";
import { listResources, readResource } from "../../src/mcp/resourceHandlers.js";
import { listPrompts, getPrompt } from "../../src/mcp/promptHandlers.js";
import { MemoryService } from "../../src/memory/memoryService.js";
import { resolveScope } from "../../src/scope/resolveScope.js";

describe("MCP Server Integration — Resources and Prompts", () => {
  let db: Database;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    runMigrations(db);
  });

  afterEach(() => {
    db?.close();
  });

  describe("Resource Discovery", () => {
    it("should list 2 resources without needing tool calls", () => {
      const resources = listResources();
      expect(resources).toHaveLength(2);
      expect(resources.map((r) => r.uri)).toEqual([
        "codecontext://project-profile",
        "codecontext://project-stats",
      ]);
    });

    it("should read project-profile resource without agent tool call", () => {
      const scope = resolveScope();
      const memoryService = new MemoryService(db);

      // Add test data
      memoryService.remember({
        scopeId: scope.scopeId,
        type: "project_rule",
        content: "Use TypeScript",
        summary: "Language choice",
        confidence: 0.9,
      });

      const result = readResource("codecontext://project-profile", { db });
      expect(result.contents).toHaveLength(1);

      const data = JSON.parse(result.contents[0]!.text);
      expect(data.scope.scopeId).toBe(scope.scopeId);
      expect(data.memory.total).toBeGreaterThanOrEqual(1);
      expect(data.hint).toContain("recall_context");
    });

    it("should read project-stats resource without agent tool call", () => {
      const result = readResource("codecontext://project-stats", { db });
      expect(result.contents).toHaveLength(1);

      const data = JSON.parse(result.contents[0]!.text);
      expect(data).toHaveProperty("scopeId");
      expect(data).toHaveProperty("memory");
      expect(data).toHaveProperty("compression");
      expect(data).toHaveProperty("tokens");
    });
  });

  describe("Prompt Discovery", () => {
    it("should list 1 prompt without needing tool calls", () => {
      const prompts = listPrompts();
      expect(prompts).toHaveLength(1);
      expect(prompts[0]!.name).toBe("project_context_brief");
    });

    it("should get project_context_brief prompt without agent tool call", () => {
      const scope = resolveScope();
      const memoryService = new MemoryService(db);

      // Add test data
      memoryService.remember({
        scopeId: scope.scopeId,
        type: "decision",
        content: "Use Vitest for testing",
        summary: "Test framework",
        confidence: 0.85,
      });

      const result = getPrompt("project_context_brief", { db });
      expect(result.description).toContain("Project context brief");
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.role).toBe("user");

      const text = result.messages[0]!.content.text;
      expect(text).toContain("# CodeContext Project Brief");
      expect(text).toContain(scope.scopeId);
      expect(text).toContain("recall_context");
      expect(text).toContain("compress_context");
    });
  });

  describe("Fast Path — No Tool Mode Impact", () => {
    it("resources and prompts work independently of tool mode", () => {
      // Resources and prompts don't go through tool registry
      // They're always available via ListResources/ReadResource/ListPrompts/GetPrompt

      const resources = listResources();
      expect(resources).toHaveLength(2);

      const prompts = listPrompts();
      expect(prompts).toHaveLength(1);

      // These calls don't touch toolMode.ts or toolRegistry.ts
      expect(resources[0]!.uri).toBe("codecontext://project-profile");
      expect(prompts[0]!.name).toBe("project_context_brief");
    });
  });
});
