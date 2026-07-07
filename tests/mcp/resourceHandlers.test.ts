/**
 * Resource handlers test
 */

import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import { runMigrations } from "../../src/storage/migrations.js";
import { listResources, readResource } from "../../src/mcp/resourceHandlers.js";
import { MemoryService } from "../../src/memory/memoryService.js";
import { CompressedStore } from "../../src/compressed/compressedStore.js";
import { resolveScope } from "../../src/scope/resolveScope.js";

describe("resourceHandlers", () => {
  let db: Database;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    runMigrations(db);
  });

  describe("listResources", () => {
    it("should return project-profile and project-stats resources", () => {
      const resources = listResources();
      expect(resources).toHaveLength(2);
      expect(resources[0]).toMatchObject({
        uri: "codecontext://project-profile",
        name: "Project Profile",
        mimeType: "application/json",
      });
      expect(resources[1]).toMatchObject({
        uri: "codecontext://project-stats",
        name: "Project Statistics",
        mimeType: "application/json",
      });
    });
  });

  describe("readResource", () => {
    it("should return project-profile resource with enhanced structure", () => {
      const scope = resolveScope();
      const memoryService = new MemoryService(db);

      // Add test memory
      memoryService.remember({
        scopeId: scope.scopeId,
        type: "project_rule",
        content: "Use pnpm for package management",
        summary: "Package manager rule",
        confidence: 0.9,
      });

      const result = readResource("codecontext://project-profile", { db });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]!.uri).toBe("codecontext://project-profile");
      expect(result.contents[0]!.mimeType).toBe("application/json");

      const data = JSON.parse(result.contents[0]!.text);
      expect(data).toHaveProperty("projectIdentity");
      expect(data).toHaveProperty("stableProjectRules");
      expect(data).toHaveProperty("recentActivity");
      expect(data).toHaveProperty("importantMemories");
      expect(data).toHaveProperty("memoryOverview");
      expect(data).toHaveProperty("compressionOverview");
      expect(data).toHaveProperty("agentGuidance");
      expect(data.projectIdentity.scopeId).toBe(scope.scopeId);
      expect(data.projectIdentity.note).toContain("Local-first");
      expect(data.agentGuidance.availableTools).toHaveLength(7);
      expect(data.memoryOverview.total).toBeGreaterThanOrEqual(1);
    });

    it("should return project-stats resource with summary counts", () => {
      const scope = resolveScope();
      const memoryService = new MemoryService(db);
      const compressedStore = new CompressedStore(db);

      // Add test data
      memoryService.remember({
        scopeId: scope.scopeId,
        type: "decision",
        content: "Test decision",
      });

      const result = readResource("codecontext://project-stats", { db });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]!.uri).toBe("codecontext://project-stats");
      expect(result.contents[0]!.mimeType).toBe("application/json");

      const data = JSON.parse(result.contents[0]!.text);
      expect(data).toHaveProperty("scopeId");
      expect(data).toHaveProperty("compressionCount");
      expect(data).toHaveProperty("memoryCount");
      expect(data).toHaveProperty("recoverableOriginalsCount");
      expect(data).toHaveProperty("totalEstimatedTokensSaved");
      expect(data).toHaveProperty("lastUpdated");
      expect(data).toHaveProperty("detailedStats");
      expect(data.scopeId).toBe(scope.scopeId);
      expect(data.memoryCount).toBeGreaterThanOrEqual(1);
      expect(data.detailedStats.memory.total).toBeGreaterThanOrEqual(1);
    });

    it("should handle empty project gracefully", () => {
      const result = readResource("codecontext://project-profile", { db });
      const data = JSON.parse(result.contents[0]!.text);

      expect(data.projectIdentity).toBeDefined();
      expect(data.stableProjectRules).toHaveLength(0);
      expect(data.recentActivity).toHaveLength(0);
      expect(data.importantMemories).toHaveLength(0);
      expect(data.memoryOverview.total).toBe(0);
    });

    it("should throw error for unknown resource URI", () => {
      expect(() => readResource("codecontext://unknown", { db })).toThrow("Unknown resource");
    });

    it("should only show agent-mode tools in project-profile (7 tools)", () => {
      const result = readResource("codecontext://project-profile", { db });
      const data = JSON.parse(result.contents[0]!.text);

      // Should have exactly 7 agent-mode tools
      expect(data.agentGuidance.availableTools).toHaveLength(7);

      const toolList = data.agentGuidance.availableTools.join(" ");

      // Should include agent-mode tools
      expect(toolList).toContain("current_scope");
      expect(toolList).toContain("compress_context");
      expect(toolList).toContain("retrieve_original");
      expect(toolList).toContain("remember_context");
      expect(toolList).toContain("recall_context");
      expect(toolList).toContain("forget_context");
      expect(toolList).toContain("run_context_flow");

      // Should NOT include dev-only tools
      expect(toolList).not.toContain("list_context");
      expect(toolList).not.toContain("delete_original");
      expect(toolList).not.toContain("cleanup_originals");
      expect(toolList).not.toContain("run_harness_flow");
      expect(toolList).not.toContain("list_compressions");
      expect(toolList).not.toContain("analyze_context");
      expect(toolList).not.toContain("list_failures");
      expect(toolList).not.toContain("failure_stats");
      expect(toolList).not.toContain("list_harness_flows");
      expect(toolList).not.toContain("get_harness_run");
      expect(toolList).not.toContain("check_harness_flow");
    });
  });
});
