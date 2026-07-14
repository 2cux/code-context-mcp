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

  // Extract project name from git root or scope
  const projectRootName = scope.gitRoot ? scope.gitRoot.split(/[/\\]/).pop() || "unknown" : "unknown";
  const projectName = scope.remote
    ? scope.remote.replace(/\.git$/, "").split("/").pop() || projectRootName
    : projectRootName;

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

  // Recent top memories by type
  const topMemories = memoryService.list({
    scopeId: scope.scopeId,
    status: ["active"],
    limit: 5,
    sortBy: "confidence",
    sortOrder: "desc",
  });

  // Get top 3 project rules from static profile
  const staticRules = queryOne(
    db,
    `SELECT json_group_array(
       json_object(
         'type', m.type,
         'summary', m.summary,
         'content', m.content,
         'confidence', m.confidence
       )
     ) as json
     FROM profile_facts pf
     JOIN memories m ON pf.source_memory_id = m.id
     WHERE pf.scope_id = ? AND pf.layer = 'static' AND m.status = 'active'
     ORDER BY m.confidence DESC, m.created_at DESC
     LIMIT 3`,
    [scope.scopeId],
  );

  const topRules: Array<{ type: string; summary: string | null; content: string; confidence: number }> = staticRules?.["json"]
    ? JSON.parse(staticRules["json"] as string)
    : [];

  // Build brief (targeting ~800 tokens)
  const lines: string[] = [];

  lines.push("# CodeContext Project Brief");
  lines.push("");
  lines.push("## Current Project");
  lines.push(`Project: \`${projectName}\``);
  if (scope.branch) lines.push(`Branch: ${scope.branch}`);
  lines.push(`Scope: \`${scope.scopeId}\``);
  lines.push("");
  lines.push("**Local-first constraint**: Do not upload project code, logs, or memory content.");
  lines.push("");

  if (topRules.length > 0) {
    lines.push("## Project Rules");
    for (const rule of topRules) {
      const summary = rule.summary || rule.content.slice(0, 60);
      lines.push(`- [${rule.type}] ${summary}`);
    }
    lines.push("");
  }

  if (topMemories.items.length > 0) {
    lines.push("## Recent Memory");
    const seenTypes = new Set<string>();
    for (const m of topMemories.items.slice(0, 3)) {
      if (!seenTypes.has(m.type)) {
        seenTypes.add(m.type);
        const summary = m.summary || m.content.slice(0, 50);
        lines.push(`- [${m.type}] ${summary}`);
      }
    }
    lines.push("");
  }

  lines.push("## Stats");
  lines.push(`- Active memories: ${active}`);
  lines.push(`- Compressed contexts: ${compressedStore.count(scope.scopeId)}`);
  lines.push(`- Token savings: ${tokenStats.totalTokensSaved.toLocaleString()}`);
  lines.push("");

  lines.push("## Available Tools");
  lines.push("- `current_scope()` — show current repository scope");
  lines.push("- `compress_context(content, type)` — compress long content");
  lines.push("- `retrieve_original(ccrId)` — expand compressed context");
  lines.push("- `remember_context(type, content, summary)` — save project facts");
  lines.push("- `recall_context(query)` — search project memory");
  lines.push("- `forget_context(memoryId)` — remove outdated memory");
  lines.push("- `run_context_flow(flowType, payload)` — unified compression + memory flow");
  lines.push("");
  lines.push("All operations are scoped to this repository.");

  return lines.join("\n");
}
