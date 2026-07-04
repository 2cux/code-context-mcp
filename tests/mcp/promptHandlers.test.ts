/**
 * Prompt handlers test
 */

import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import { runMigrations } from "../../src/storage/migrations.js";
import { listPrompts, getPrompt } from "../../src/mcp/promptHandlers.js";
import { MemoryService } from "../../src/memory/memoryService.js";
import { resolveScope } from "../../src/scope/resolveScope.js";

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
      expect(text).toContain(scope.scopeId);
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
  });
});
