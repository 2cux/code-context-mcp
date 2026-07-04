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
       COUNT(CASE WHEN operation = 'forget' THEN 1 END) AS memories_forgotten
     FROM receipts
     WHERE scope_id = ?`,
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
  };

  // ---- Top compressions by token savings ----
  const topRows = queryAll(
    db,
    `SELECT id, content_type, tokens_saved, compression_ratio, created_at, summary
     FROM compressed_contexts
     WHERE scope_id = ? AND failed = 0
     ORDER BY tokens_saved DESC
     LIMIT ?`,
    [scopeId, topN],
  );

  const topCompressions = topRows.map((row) => ({
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

  // ---- Local-first note ----
  const localFirstNote = {
    dataLocation: "Local SQLite database (.codecontext.db in project root)",
    noDataUploaded: true,
  };

  return {
    summary,
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

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total Compressions**: ${report.summary.totalCompressions}`);
  lines.push(`- **Total Estimated Tokens Saved**: ${report.summary.totalEstimatedTokensSaved.toLocaleString()}`);
  lines.push(`- **Average Compression Ratio**: ${report.summary.averageCompressionRatio.toFixed(2)}`);
  lines.push(`- **Cache Hits**: ${report.summary.cacheHits}`);
  lines.push(`- **Total Retrieves**: ${report.summary.totalRetrieves}`);
  lines.push(`- **Memories Saved**: ${report.summary.memoriesSaved}`);
  lines.push(`- **Memories Recalled**: ${report.summary.memoriesRecalled}`);
  lines.push(`- **Memories Forgotten**: ${report.summary.memoriesForgotten}`);
  lines.push("");

  // Top compressions
  lines.push("## Top 5 Highest Token-Saving Compressions");
  lines.push("");
  if (report.topCompressions.length === 0) {
    lines.push("_No compressions yet._");
  } else {
    lines.push("| CCR ID | Content Type | Tokens Saved | Compression Ratio | Created At |");
    lines.push("|--------|--------------|--------------|-------------------|------------|");
    for (const c of report.topCompressions) {
      const shortId = c.ccrId.slice(0, 12) + "…";
      lines.push(
        `| ${shortId} | ${c.contentType} | ${c.tokensSaved.toLocaleString()} | ${c.compressionRatio.toFixed(2)} | ${c.createdAt.slice(0, 19)} |`,
      );
    }
  }
  lines.push("");

  // Recent memories
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

  // Local-first note
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
