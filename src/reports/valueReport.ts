/**
 * Value Report — Usage Value Aggregation
 *
 * Aggregates compression, memory, retrieve, and receipt data
 * into a user-readable value report, inspired by Headroom's
 * token savings and observability approach.
 *
 * Design principles:
 *   - Read-only: no mutations, only queries
 *   - Friendly for empty data: returns zero counts, not errors
 *   - No cloud uploads: emphasizes local-first data location
 */

import type { Database } from "sql.js";
import { queryAll, queryOne } from "../storage/db.js";
import type { CompressedStore } from "../compressed/compressedStore.js";
import type { MemoryService } from "../memory/memoryService.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValueReportData {
  summary: {
    totalCompressions: number;
    totalEstimatedTokensSaved: number;
    averageCompressionRatio: number;
    cacheHits: number;
    totalRetrieves: number;
    memoriesSaved: number;
    memoriesRecalled: number;
    memoriesForgotten: number;
    recoverableOriginals: number;
    lastActivityAt?: string;
  };
  retrievalTrust: {
    originalsStored: number;
    originalsRetrieved: number;
    latestRetrieveProof?: {
      originalRef: string;
      retrievedAt: string;
      ccrId: string;
    };
    localOnlyNote: string;
  };
  topSavings: Array<{
    ccrId: string;
    contentType: string;
    tokensBefore: number;
    tokensAfter: number;
    tokensSaved: number;
    compressionRatio: number;
    createdAt: string;
    summary?: string;
  }>;
  agentUsefulness: {
    recentRecalledMemories: Array<{
      memoryId: string;
      type: string;
      summary?: string;
      recalledAt: string;
      score?: number;
    }>;
    mostUsefulProjectRules: Array<{
      memoryId: string;
      content: string;
      recallCount: number;
      lastRecalledAt?: string;
    }>;
    suggestedNextCommand: string;
  };
  topCompressions: Array<{
    ccrId: string;
    contentType: string;
    tokensSaved: number;
    compressionRatio: number;
    createdAt: string;
    summary?: string;
  }>;
  recentMemories: Array<{
    memoryId: string;
    type: string;
    summary?: string;
    createdAt: string;
    status: string;
  }>;
  localFirstNote: {
    dataLocation: string;
    noDataUploaded: boolean;
  };
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function buildValueReport(
  db: Database,
  scopeId: string,
  opts?: {
    topN?: number;
    recentN?: number;
  },
): ValueReportData {
  const topN = opts?.topN ?? 5;
  const recentN = opts?.recentN ?? 10;

  // ---- Summary stats ----
  const summaryRow = queryOne(
    db,
    `SELECT
       COUNT(CASE WHEN operation = 'compress' THEN 1 END) AS total_compressions,
       COALESCE(SUM(CASE WHEN operation = 'compress' THEN tokens_saved END), 0) AS total_tokens_saved,
       COALESCE(AVG(CASE WHEN operation = 'compress' THEN compression_ratio END), 0) AS avg_compression_ratio,
       COUNT(CASE WHEN operation = 'compress' AND cache_hit = 1 THEN 1 END) AS cache_hits,
       COUNT(CASE WHEN operation = 'retrieve_original' THEN 1 END) AS total_retrieves,
       COUNT(CASE WHEN operation = 'remember' THEN 1 END) AS memories_saved,
       COUNT(CASE WHEN operation = 'recall' THEN 1 END) AS memories_recalled,
       COUNT(CASE WHEN operation = 'forget' THEN 1 END) AS memories_forgotten,
       MAX(timestamp) AS last_activity
     FROM receipts
     WHERE scope_id = ?`,
    [scopeId],
  );

  // Count recoverable originals
  const originalsCountRow = queryOne(
    db,
    `SELECT COUNT(*) AS recoverable_originals
     FROM original_contents
     WHERE scope_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    [scopeId],
  );

  const summary = {
    totalCompressions: (summaryRow?.["total_compressions"] as number) ?? 0,
    totalEstimatedTokensSaved: (summaryRow?.["total_tokens_saved"] as number) ?? 0,
    averageCompressionRatio: (summaryRow?.["avg_compression_ratio"] as number) ?? 0,
    cacheHits: (summaryRow?.["cache_hits"] as number) ?? 0,
    totalRetrieves: (summaryRow?.["total_retrieves"] as number) ?? 0,
    memoriesSaved: (summaryRow?.["memories_saved"] as number) ?? 0,
    memoriesRecalled: (summaryRow?.["memories_recalled"] as number) ?? 0,
    memoriesForgotten: (summaryRow?.["memories_forgotten"] as number) ?? 0,
    recoverableOriginals: (originalsCountRow?.["recoverable_originals"] as number) ?? 0,
    lastActivityAt: (summaryRow?.["last_activity"] as string | null) ?? undefined,
  };

  // ---- Retrieval Trust ----
  const originalsStoredRow = queryOne(
    db,
    `SELECT COUNT(*) AS originals_stored
     FROM original_contents
     WHERE scope_id = ?`,
    [scopeId],
  );

  const originalsRetrievedRow = queryOne(
    db,
    `SELECT COUNT(DISTINCT original_refs.value) AS originals_retrieved
     FROM receipts, json_each(receipts.original_refs) AS original_refs
     WHERE receipts.scope_id = ? AND receipts.operation = 'retrieve_original' AND receipts.failed = 0`,
    [scopeId],
  );

  const latestRetrieveRow = queryOne(
    db,
    `SELECT r.original_refs, r.timestamp, r.ccr_ids
     FROM receipts r
     WHERE r.scope_id = ? AND r.operation = 'retrieve_original' AND r.failed = 0
     ORDER BY r.timestamp DESC
     LIMIT 1`,
    [scopeId],
  );

  let latestRetrieveProof: ValueReportData["retrievalTrust"]["latestRetrieveProof"];
  if (latestRetrieveRow && latestRetrieveRow["original_refs"]) {
    const originalRefs = JSON.parse(latestRetrieveRow["original_refs"] as string) as string[];
    const ccrIds = latestRetrieveRow["ccr_ids"]
      ? (JSON.parse(latestRetrieveRow["ccr_ids"] as string) as string[])
      : [];
    if (originalRefs.length > 0) {
      latestRetrieveProof = {
        originalRef: originalRefs[0] ?? "",
        retrievedAt: (latestRetrieveRow["timestamp"] as string) ?? "",
        ccrId: ccrIds[0] ?? "",
      };
    }
  }

  const retrievalTrust = {
    originalsStored: (originalsStoredRow?.["originals_stored"] as number) ?? 0,
    originalsRetrieved: (originalsRetrievedRow?.["originals_retrieved"] as number) ?? 0,
    latestRetrieveProof,
    localOnlyNote: "All originals stored locally. No data uploaded to cloud.",
  };

  // ---- Top Savings (with before/after tokens) ----
  const topSavingsRows = queryAll(
    db,
    `SELECT id, content_type, tokens_before, tokens_after, tokens_saved, compression_ratio, created_at, summary
     FROM compressed_contexts
     WHERE scope_id = ? AND failed = 0
     ORDER BY tokens_saved DESC
     LIMIT ?`,
    [scopeId, topN],
  );

  const topSavings = topSavingsRows.map((row) => ({
    ccrId: (row["id"] as string) ?? "",
    contentType: (row["content_type"] as string) ?? "unknown",
    tokensBefore: (row["tokens_before"] as number) ?? 0,
    tokensAfter: (row["tokens_after"] as number) ?? 0,
    tokensSaved: (row["tokens_saved"] as number) ?? 0,
    compressionRatio: (row["compression_ratio"] as number) ?? 0,
    createdAt: (row["created_at"] as string) ?? "",
    summary: (row["summary"] as string | null) ?? undefined,
  }));

  // Keep topCompressions for backward compatibility
  const topCompressions = topSavingsRows.map((row) => ({
    ccrId: (row["id"] as string) ?? "",
    contentType: (row["content_type"] as string) ?? "unknown",
    tokensSaved: (row["tokens_saved"] as number) ?? 0,
    compressionRatio: (row["compression_ratio"] as number) ?? 0,
    createdAt: (row["created_at"] as string) ?? "",
    summary: (row["summary"] as string | null) ?? undefined,
  }));

  // ---- Recent project memories ----
  const memoryRows = queryAll(
    db,
    `SELECT id, type, summary, created_at, status
     FROM memories
     WHERE scope_id = ? AND status = 'active'
     ORDER BY created_at DESC
     LIMIT ?`,
    [scopeId, recentN],
  );

  const recentMemories = memoryRows.map((row) => ({
    memoryId: (row["id"] as string) ?? "",
    type: (row["type"] as string) ?? "unknown",
    summary: (row["summary"] as string | null) ?? undefined,
    createdAt: (row["created_at"] as string) ?? "",
    status: (row["status"] as string) ?? "active",
  }));

  // ---- Agent Usefulness ----
  // Recent recalled memories (from recall receipts)
  const recentRecallRows = queryAll(
    db,
    `SELECT r.memory_ids, r.timestamp
     FROM receipts r
     WHERE r.scope_id = ? AND r.operation = 'recall' AND r.memory_ids IS NOT NULL
     ORDER BY r.timestamp DESC
     LIMIT 5`,
    [scopeId],
  );

  const recentRecalledMemories: ValueReportData["agentUsefulness"]["recentRecalledMemories"] = [];
  for (const recallRow of recentRecallRows) {
    const memoryIds = recallRow["memory_ids"]
      ? (JSON.parse(recallRow["memory_ids"] as string) as string[])
      : [];
    for (const memId of memoryIds.slice(0, 2)) {
      // Top 2 per recall
      const memRow = queryOne(
        db,
        `SELECT id, type, summary FROM memories WHERE id = ? AND scope_id = ?`,
        [memId, scopeId],
      );
      if (memRow) {
        recentRecalledMemories.push({
          memoryId: (memRow["id"] as string) ?? "",
          type: (memRow["type"] as string) ?? "unknown",
          summary: (memRow["summary"] as string | null) ?? undefined,
          recalledAt: (recallRow["timestamp"] as string) ?? "",
        });
      }
    }
    if (recentRecalledMemories.length >= recentN) break;
  }

  // Most useful project_rule memories (by recall count)
  const usefulRulesRows = queryAll(
    db,
    `SELECT m.id, m.content, COUNT(DISTINCT r.id) AS recall_count, MAX(r.timestamp) AS last_recalled
     FROM memories m
     LEFT JOIN receipts r ON r.scope_id = m.scope_id
       AND r.operation = 'recall'
       AND r.memory_ids LIKE '%' || m.id || '%'
     WHERE m.scope_id = ? AND m.type = 'project_rule' AND m.status = 'active'
     GROUP BY m.id
     ORDER BY recall_count DESC, last_recalled DESC
     LIMIT 3`,
    [scopeId],
  );

  const mostUsefulProjectRules = usefulRulesRows.map((row) => ({
    memoryId: (row["id"] as string) ?? "",
    content: (row["content"] as string) ?? "",
    recallCount: (row["recall_count"] as number) ?? 0,
    lastRecalledAt: (row["last_recalled"] as string | null) ?? undefined,
  }));

  // Suggested next command
  let suggestedNextCommand = "code-context compress <file>  # Start saving tokens";
  if (summary.totalCompressions > 0 && summary.memoriesSaved === 0) {
    suggestedNextCommand =
      "code-context remember --type project_rule --file <path> --profile-target static";
  } else if (summary.totalCompressions > 0 && summary.memoriesSaved > 0 && summary.memoriesRecalled === 0) {
    suggestedNextCommand = 'code-context recall "project rules" --profile';
  } else if (summary.totalRetrieves === 0 && retrievalTrust.originalsStored > 0) {
    suggestedNextCommand = "code-context retrieve <originalRef>  # Verify originals are recoverable";
  } else if (summary.totalCompressions > 5) {
    suggestedNextCommand = "code-context stats  # Review token savings over time";
  }

  const agentUsefulness = {
    recentRecalledMemories,
    mostUsefulProjectRules,
    suggestedNextCommand,
  };

  // ---- Local-first note ----
  const localFirstNote = {
    dataLocation: "~/.code-context-mcp/code-context.sqlite",
    noDataUploaded: true,
  };

  return {
    summary,
    retrievalTrust,
    topSavings,
    agentUsefulness,
    topCompressions,
    recentMemories,
    localFirstNote,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------

export function formatValueReportMarkdown(report: ValueReportData): string {
  const lines: string[] = [];

  lines.push("# CodeContext Usage Value Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");

  // ---- Value Summary (top-level overview) ----
  lines.push("## Value Summary");
  lines.push("");
  if (report.summary.totalCompressions === 0) {
    lines.push("**No usage data yet.** Run `code-context compress <file>` to start saving tokens.");
    lines.push("");
    lines.push("CodeContext helps you:");
    lines.push("- **Compress** long logs, test output, and error traces to save context tokens");
    lines.push("- **Remember** project rules, decisions, and patterns that persist across sessions");
    lines.push("- **Recall** relevant project knowledge on demand");
    lines.push("- **Retrieve** original content when you need full details");
    lines.push("");
  } else {
    lines.push(`- **Total Token Saved**: ${report.summary.totalEstimatedTokensSaved.toLocaleString()}`);
    lines.push(`- **Average Compression Ratio**: ${(report.summary.averageCompressionRatio * 100).toFixed(1)}%`);
    lines.push(`- **Recoverable Originals**: ${report.summary.recoverableOriginals}`);
    lines.push(`- **Memory Count**: ${report.summary.memoriesSaved} saved, ${report.summary.memoriesRecalled} recalled`);
    if (report.summary.lastActivityAt) {
      lines.push(`- **Last Activity**: ${report.summary.lastActivityAt.slice(0, 19).replace("T", " ")}`);
    }
    lines.push("");
  }

  // ---- Retrieval Trust ----
  lines.push("## Retrieval Trust");
  lines.push("");
  lines.push(`- **Original Records Count**: ${report.retrievalTrust.originalsStored}`);
  lines.push(`- **Retrieved Records Count**: ${report.retrievalTrust.originalsRetrieved}`);
  if (report.retrievalTrust.latestRetrieveProof) {
    const proof = report.retrievalTrust.latestRetrieveProof;
    lines.push(`- **Latest Retrieve Proof**: \`${proof.originalRef}\` retrieved at ${proof.retrievedAt.slice(0, 19).replace("T", " ")}`);
  } else {
    lines.push("- **Latest Retrieve Proof**: No retrieval yet");
  }
  lines.push(`- **${report.retrievalTrust.localOnlyNote}**`);
  lines.push("");

  // ---- Top Savings ----
  lines.push("## Top 5 Highest Token-Saving Compressions");
  lines.push("");
  if (report.topSavings.length === 0) {
    lines.push("_No compressions yet._");
  } else {
    lines.push("| CCR ID | Content Type | Before Tokens | After Tokens | Saved Tokens | Ratio |");
    lines.push("|--------|--------------|---------------|--------------|--------------|-------|");
    for (const c of report.topSavings) {
      const shortId = c.ccrId.slice(0, 12) + "…";
      lines.push(
        `| ${shortId} | ${c.contentType} | ${c.tokensBefore.toLocaleString()} | ${c.tokensAfter.toLocaleString()} | **${c.tokensSaved.toLocaleString()}** | ${(c.compressionRatio * 100).toFixed(1)}% |`,
      );
    }
  }
  lines.push("");

  // ---- Agent Usefulness ----
  lines.push("## Agent Usefulness");
  lines.push("");

  lines.push("### Recent Recalled Memories");
  if (report.agentUsefulness.recentRecalledMemories.length === 0) {
    lines.push("_No memories recalled yet._");
  } else {
    lines.push("");
    for (const m of report.agentUsefulness.recentRecalledMemories.slice(0, 5)) {
      const summary = m.summary ? ` — ${m.summary.slice(0, 60)}${m.summary.length > 60 ? "…" : ""}` : "";
      lines.push(`- \`${m.memoryId.slice(0, 12)}…\` (${m.type})${summary}`);
      lines.push(`  _Recalled: ${m.recalledAt.slice(0, 19).replace("T", " ")}_`);
    }
  }
  lines.push("");

  lines.push("### Most Useful Project Rules");
  if (report.agentUsefulness.mostUsefulProjectRules.length === 0) {
    lines.push("_No project rules saved yet._");
  } else {
    lines.push("");
    for (const rule of report.agentUsefulness.mostUsefulProjectRules) {
      const preview = rule.content.slice(0, 80).replace(/\n/g, " ");
      lines.push(`- \`${rule.memoryId.slice(0, 12)}…\` (recalled ${rule.recallCount}× ${rule.lastRecalledAt ? "— last: " + rule.lastRecalledAt.slice(0, 10) : ""})`);
      lines.push(`  _"${preview}${rule.content.length > 80 ? "…" : ""}"_`);
    }
  }
  lines.push("");

  lines.push("### Suggested Next Command");
  lines.push("");
  lines.push("```bash");
  lines.push(report.agentUsefulness.suggestedNextCommand);
  lines.push("```");
  lines.push("");

  // ---- Recent Memories (legacy section, kept for compatibility) ----
  lines.push("## Recent Project Memories");
  lines.push("");
  if (report.recentMemories.length === 0) {
    lines.push("_No active memories yet._");
  } else {
    lines.push("| Memory ID | Type | Summary | Created At |");
    lines.push("|-----------|------|---------|------------|");
    for (const m of report.recentMemories) {
      const shortId = m.memoryId.slice(0, 12) + "…";
      const summary = m.summary ? m.summary.slice(0, 50) + (m.summary.length > 50 ? "…" : "") : "—";
      lines.push(
        `| ${shortId} | ${m.type} | ${summary} | ${m.createdAt.slice(0, 19)} |`,
      );
    }
  }
  lines.push("");

  // ---- Local-first note ----
  lines.push("## Local-First Data");
  lines.push("");
  lines.push(`- **Data Location**: ${report.localFirstNote.dataLocation}`);
  lines.push(`- **No Data Uploaded**: ${report.localFirstNote.noDataUploaded ? "✓ All data stays local" : "—"}`);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("_This report aggregates compression, memory, and retrieval statistics from your local CodeContext database._");
  lines.push("");

  return lines.join("\n");
}
