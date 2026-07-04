/**
 * MCP Prompt Handlers
 *
 * Provides pre-built prompts for agent context injection.
 * No new tools added — agents access via ListPrompts/GetPrompt protocol.
 *
 * Prompts:
 *   project_context_brief   Short project context summary for agent orientation
 */

import type { Database } from "sql.js";
import { resolveScope } from "../scope/resolveScope.js";
import { queryOne } from "../storage/db.js";
import { MemoryService } from "../memory/memoryService.js";
import { CompressedStore } from "../compressed/compressedStore.js";
import { getTokenStats } from "../stats/tokenStats.js";

export interface PromptContext {
  db: Database;
}

interface PromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
}

export function listPrompts(): PromptDefinition[] {
  return [
    {
      name: "project_context_brief",
      description: "Brief project context overview: scope, memory, compression stats, and recent rules",
      arguments: [],
    },
  ];
}

export function getPrompt(
  name: string,
  ctx: PromptContext,
): { description: string; messages: Array<{ role: "user" | "assistant"; content: { type: "text"; text: string } }> } {
  if (name === "project_context_brief") {
    return {
      description: "Project context brief for agent orientation",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: buildProjectContextBrief(ctx.db),
          },
        },
      ],
    };
  }

  throw new Error(`Unknown prompt: ${name}`);
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildProjectContextBrief(db: Database): string {
  const scope = resolveScope();
  const memoryService = new MemoryService(db);
  const compressedStore = new CompressedStore(db);
  const tokenStats = getTokenStats(db, scope.scopeId);

  // Memory counts
  const memoryStats = queryOne(
    db,
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active
     FROM memories
     WHERE scope_id = ?`,
    [scope.scopeId],
  );

  const total = Number(memoryStats?.["total"] ?? 0);
  const active = Number(memoryStats?.["active"] ?? 0);

  // Recent top memories by type (1 per type, top 5 types by count)
  const topMemories = memoryService.list({
    scopeId: scope.scopeId,
    status: ["active"],
    limit: 10,
    sortBy: "confidence",
    sortOrder: "desc",
  });

  // Get top 5 project rules from static profile
  const staticRules = queryOne(
    db,
    `SELECT json_group_array(
       json_object(
         'type', m.type,
         'summary', m.summary,
         'confidence', m.confidence
       )
     ) as json
     FROM profile_facts pf
     JOIN memories m ON pf.source_memory_id = m.id
     WHERE pf.scope_id = ? AND pf.layer = 'static' AND m.status = 'active'
     ORDER BY m.confidence DESC, m.created_at DESC
     LIMIT 5`,
    [scope.scopeId],
  );

  const topRules: Array<{ type: string; summary: string | null; confidence: number }> = staticRules?.["json"]
    ? JSON.parse(staticRules["json"] as string)
    : [];

  // Build brief
  const lines: string[] = [];

  lines.push("# CodeContext Project Brief");
  lines.push("");
  lines.push("## Scope");
  lines.push(`- Project: \`${scope.scopeId}\``);
  lines.push(`- Strategy: ${scope.scopeStrategy}`);
  if (scope.gitRoot) lines.push(`- Git root: ${scope.gitRoot}`);
  if (scope.branch) lines.push(`- Branch: ${scope.branch}`);
  lines.push("");

  lines.push("## Memory");
  lines.push(`- Active memories: ${active} / ${total} total`);
  if (topMemories.items.length > 0) {
    lines.push("- Recent context:");
    const seenTypes = new Set<string>();
    for (const m of topMemories.items.slice(0, 5)) {
      if (!seenTypes.has(m.type)) {
        seenTypes.add(m.type);
        const summary = m.summary || m.content.slice(0, 60);
        lines.push(`  - [${m.type}] ${summary} (confidence: ${m.confidence.toFixed(2)})`);
      }
    }
  }
  lines.push("");

  lines.push("## Compression");
  lines.push(`- Compressed contexts: ${compressedStore.count(scope.scopeId)}`);
  lines.push(`- Token savings: ${tokenStats.totalTokensSaved.toLocaleString()} tokens saved`);
  if (tokenStats.averageCompressionRatio > 0) {
    lines.push(`- Average compression: ${(tokenStats.averageCompressionRatio * 100).toFixed(1)}%`);
  }
  lines.push("");

  if (topRules.length > 0) {
    lines.push("## Project Rules (Static Profile)");
    for (const rule of topRules) {
      const summary = rule.summary || "(no summary)";
      lines.push(`- [${rule.type}] ${summary}`);
    }
    lines.push("");
  }

  lines.push("## Agent Tips");
  lines.push("- Use `recall_context` to search project memory");
  lines.push("- Use `compress_context` to compress long outputs and save tokens");
  lines.push("- Use `remember_context` to save important project facts");
  lines.push("- All context is scoped to this repository");

  return lines.join("\n");
}
