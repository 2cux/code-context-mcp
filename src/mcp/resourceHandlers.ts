/**
 * MCP Resource Handlers
 *
 * Provides read-only project context resources for agent discovery.
 * No new tools added — agents access via ListResources/ReadResource protocol.
 *
 * Resources:
 *   codecontext://project-profile   Full project context snapshot
 *   codecontext://project-stats     Stats and counts
 */

import type { Database } from "sql.js";
import { resolveScope } from "../scope/resolveScope.js";
import { queryOne } from "../storage/db.js";
import { MemoryService } from "../memory/memoryService.js";
import { CompressedStore } from "../compressed/compressedStore.js";
import { getTokenStats } from "../stats/tokenStats.js";

export interface ResourceContext {
  db: Database;
}

interface ProjectProfileResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

interface ProjectStatsResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export function listResources(): Array<ProjectProfileResource | ProjectStatsResource> {
  return [
    {
      uri: "codecontext://project-profile",
      name: "Project Profile",
      description: "Current project scope, memory, and context overview",
      mimeType: "application/json",
    },
    {
      uri: "codecontext://project-stats",
      name: "Project Statistics",
      description: "Token savings, compression, and memory counts",
      mimeType: "application/json",
    },
  ];
}

export function readResource(uri: string, ctx: ResourceContext): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  if (uri === "codecontext://project-profile") {
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(getProjectProfile(ctx.db), null, 2),
      }],
    };
  }

  if (uri === "codecontext://project-stats") {
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(getProjectStats(ctx.db), null, 2),
      }],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
}

// ---------------------------------------------------------------------------
// Resource builders
// ---------------------------------------------------------------------------

function getProjectProfile(db: Database) {
  const scope = resolveScope();
  const memoryService = new MemoryService(db);
  const compressedStore = new CompressedStore(db);

  // Recent active memories (top 10 by confidence)
  const recentMemories = memoryService.list({
    scopeId: scope.scopeId,
    status: ["active"],
    limit: 10,
    sortBy: "confidence",
    sortOrder: "desc",
  });

  // Memory counts by type
  const memoryCountByType = queryOne(
    db,
    `SELECT json_group_object(type, count) as json
     FROM (
       SELECT type, COUNT(*) as count
       FROM memories
       WHERE scope_id = ? AND status = 'active'
       GROUP BY type
     )`,
    [scope.scopeId],
  );

  const memoryByType = memoryCountByType?.["json"]
    ? JSON.parse(memoryCountByType["json"] as string)
    : {};

  // Compression stats
  const ccrCount = compressedStore.count(scope.scopeId);

  // Count originals
  const originalCountRow = queryOne(
    db,
    `SELECT COUNT(*) as cnt FROM original_contents WHERE scope_id = ?`,
    [scope.scopeId],
  );
  const originalCount = Number(originalCountRow?.["cnt"] ?? 0);

  // Token stats
  const tokenStats = getTokenStats(db, scope.scopeId);

  // Static profile facts (top 5 project rules)
  const staticFacts = queryOne(
    db,
    `SELECT json_group_array(
       json_object(
         'type', m.type,
         'summary', m.summary,
         'content', m.content,
         'confidence', m.confidence,
         'createdAt', m.created_at
       )
     ) as json
     FROM profile_facts pf
     JOIN memories m ON pf.source_memory_id = m.id
     WHERE pf.scope_id = ? AND pf.layer = 'static' AND m.status = 'active'
     ORDER BY m.confidence DESC, m.created_at DESC
     LIMIT 5`,
    [scope.scopeId],
  );

  const topStaticFacts = staticFacts?.["json"] ? JSON.parse(staticFacts["json"] as string) : [];

  // Recent activity (dynamic profile facts, top 3)
  const recentActivity = queryOne(
    db,
    `SELECT json_group_array(
       json_object(
         'type', m.type,
         'summary', m.summary,
         'confidence', m.confidence,
         'createdAt', m.created_at
       )
     ) as json
     FROM profile_facts pf
     JOIN memories m ON pf.source_memory_id = m.id
     WHERE pf.scope_id = ? AND pf.layer = 'dynamic' AND m.status = 'active'
     ORDER BY m.created_at DESC
     LIMIT 3`,
    [scope.scopeId],
  );

  const recentDynamicFacts = recentActivity?.["json"] ? JSON.parse(recentActivity["json"] as string) : [];

  // Last updated timestamp
  const lastUpdate = queryOne(
    db,
    `SELECT MAX(created_at) as last_updated FROM memories WHERE scope_id = ?`,
    [scope.scopeId],
  );

  const lastUpdated = lastUpdate?.["last_updated"] as string | null;

  return {
    projectIdentity: {
      scopeId: scope.scopeId,
      scopeStrategy: scope.scopeStrategy,
      gitRoot: scope.gitRoot,
      remote: scope.remote,
      branch: scope.branch,
      note: "Local-first storage. No project code, logs, or memory uploaded.",
    },
    stableProjectRules: topStaticFacts.map((f: { type: string; summary: string | null; content: string; confidence: number; createdAt: string }) => ({
      type: f.type,
      summary: f.summary || f.content.slice(0, 80),
      confidence: f.confidence,
      createdAt: f.createdAt,
    })),
    recentActivity: recentDynamicFacts.map((f: { type: string; summary: string | null; confidence: number; createdAt: string }) => ({
      type: f.type,
      summary: f.summary,
      confidence: f.confidence,
      createdAt: f.createdAt,
    })),
    importantMemories: recentMemories.items.slice(0, 5).map((m) => ({
      type: m.type,
      summary: m.summary || m.content.slice(0, 80),
      confidence: m.confidence,
      createdAt: m.createdAt,
    })),
    memoryOverview: {
      total: recentMemories.total,
      active: recentMemories.items.length,
      byType: memoryByType,
    },
    compressionOverview: {
      totalCompressed: ccrCount,
      recoverableOriginals: originalCount,
      tokensSaved: tokenStats.totalTokensSaved,
      compressionRatio: tokenStats.averageCompressionRatio,
    },
    lastUpdated,
    agentGuidance: {
      availableTools: [
        "recall_context - search project memory by query",
        "compress_context - compress long content and save tokens",
        "remember_context - save important project facts",
        "list_context - list all memories",
        "forget_context - remove outdated memories",
      ],
      localFirstNote: "All context is scoped to this repository. Do not upload project code or logs.",
    },
  };
}

function getProjectStats(db: Database) {
  const scope = resolveScope();
  const compressedStore = new CompressedStore(db);
  const tokenStats = getTokenStats(db, scope.scopeId);

  // Memory stats
  const memoryStats = queryOne(
    db,
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
       SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END) as superseded,
       SUM(CASE WHEN status = 'forgotten' THEN 1 ELSE 0 END) as forgotten,
       SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired
     FROM memories
     WHERE scope_id = ?`,
    [scope.scopeId],
  );

  const total = Number(memoryStats?.["total"] ?? 0);
  const active = Number(memoryStats?.["active"] ?? 0);
  const superseded = Number(memoryStats?.["superseded"] ?? 0);
  const forgotten = Number(memoryStats?.["forgotten"] ?? 0);
  const expired = Number(memoryStats?.["expired"] ?? 0);

  // Count originals
  const originalCountRow = queryOne(
    db,
    `SELECT COUNT(*) as cnt FROM original_contents WHERE scope_id = ?`,
    [scope.scopeId],
  );
  const originalCount = Number(originalCountRow?.["cnt"] ?? 0);

  // Last updated timestamp
  const lastUpdate = queryOne(
    db,
    `SELECT MAX(updated_at) as last_updated FROM (
       SELECT MAX(created_at) as updated_at FROM memories WHERE scope_id = ?
       UNION ALL
       SELECT MAX(created_at) as updated_at FROM compressed_contexts WHERE scope_id = ?
     )`,
    [scope.scopeId, scope.scopeId],
  );

  const lastUpdated = lastUpdate?.["last_updated"] as string | null;

  return {
    scopeId: scope.scopeId,
    compressionCount: compressedStore.count(scope.scopeId),
    memoryCount: active,
    recoverableOriginalsCount: originalCount,
    totalEstimatedTokensSaved: tokenStats.totalTokensSaved,
    lastUpdated,
    detailedStats: {
      memory: {
        total,
        active,
        superseded,
        forgotten,
        expired,
      },
      compression: {
        totalCCRs: compressedStore.count(scope.scopeId),
        recoverableOriginals: originalCount,
        averageCompressionRatio: tokenStats.averageCompressionRatio,
      },
      tokens: {
        totalCompressions: tokenStats.totalCompressions,
        totalRetrieves: tokenStats.totalRetrieves,
        totalMemories: tokenStats.totalMemories,
        totalRecalls: tokenStats.totalRecalls,
        totalTokensBefore: tokenStats.totalTokensBefore,
        totalTokensAfter: tokenStats.totalTokensAfter,
        totalTokensSaved: tokenStats.totalTokensSaved,
      },
    },
  };
}
