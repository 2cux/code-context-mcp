import { randomBytes } from "node:crypto";
import type { Database } from "sql.js";
import { queryAll, queryOne, runStmt, type SqlValue } from "../storage/db.js";
import { nowISO } from "../utils/time.js";

export interface ReceiptRecord {
  id: string;
  operation:
    | "compress"
    | "retrieve_original"
    | "delete_original"
    | "cleanup_originals"
    | "remember"
    | "recall"
    | "forget"
    | "list"
    | "harness_run"
    | "harness_phase"
    | "harness_checkpoint"
    | "harness_check"
    | "harness_artifact";
  scopeId: string;
  inputHash?: string;
  query?: string;
  resultIds?: string[];
  memoryIds?: string[];
  ccrIds?: string[];
  originalRefs?: string[];
  tokensBefore?: number;
  tokensAfter?: number;
  tokensSaved?: number;
  compressionRatio?: number;
  compressed?: boolean;
  retrievedOriginal?: boolean;
  failed?: boolean;
  errorReason?: string;
  cacheHit?: boolean;
  timestamp: string;
  // ── Run receipt fields (§34) ────────────────────────────────────────────────
  runId?: string;
  moduleId?: string;
  parentRunId?: string;
  phase?: string;
  eventType?: string;
  checkpointName?: string;
  artifactPaths?: string[];
  coveredTools?: string[];
}

type ReceiptInput = Omit<ReceiptRecord, "id" | "timestamp">;

let _receiptCounter = 0;

function generateReceiptId(): string {
  _receiptCounter += 1;
  const seq = String(_receiptCounter).padStart(6, "0");
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex"); // 6 hex chars of entropy
  return `rcp_${ts}_${rand}_${seq}`;
}

export class ReceiptService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  create(input: ReceiptInput): ReceiptRecord {
    const record: ReceiptRecord = {
      id: generateReceiptId(),
      ...input,
      timestamp: nowISO(),
    };

    runStmt(
      this.db,
      `INSERT INTO receipts (
         id, operation, scope_id, input_hash, query,
         result_ids, memory_ids, ccr_ids, original_refs,
         tokens_before, tokens_after, tokens_saved,
         compression_ratio, compressed, retrieved_original,
         failed, error_reason, cache_hit, timestamp,
         run_id, module_id, parent_run_id, phase,
         event_type, checkpoint_name, artifact_paths, covered_tools
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.operation,
        record.scopeId,
        record.inputHash ?? null,
        record.query ?? null,
        record.resultIds ? JSON.stringify(record.resultIds) : null,
        record.memoryIds ? JSON.stringify(record.memoryIds) : null,
        record.ccrIds ? JSON.stringify(record.ccrIds) : null,
        record.originalRefs ? JSON.stringify(record.originalRefs) : null,
        record.tokensBefore ?? null,
        record.tokensAfter ?? null,
        record.tokensSaved ?? null,
        record.compressionRatio ?? null,
        record.compressed ? 1 : 0,
        record.retrievedOriginal ? 1 : 0,
        record.failed ? 1 : 0,
        record.errorReason ?? null,
        record.cacheHit ? 1 : 0,
        record.timestamp,
        record.runId ?? null,
        record.moduleId ?? null,
        record.parentRunId ?? null,
        record.phase ?? null,
        record.eventType ?? null,
        record.checkpointName ?? null,
        record.artifactPaths ? JSON.stringify(record.artifactPaths) : null,
        record.coveredTools ? JSON.stringify(record.coveredTools) : null,
      ],
    );

    return record;
  }

  get(receiptId: string): ReceiptRecord | null {
    const row = queryOne(
      this.db,
      "SELECT * FROM receipts WHERE id = ?",
      [receiptId],
    );
    if (!row) return null;
    return this.rowToRecord(row);
  }

  getByRunId(runId: string): ReceiptRecord[] {
    const rows = queryAll(
      this.db,
      "SELECT * FROM receipts WHERE run_id = ? ORDER BY timestamp ASC",
      [runId],
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  list(
    scopeId: string,
    opts?: {
      operation?: string;
      runId?: string;
      eventType?: string;
      limit?: number;
      offset?: number;
    },
  ): ReceiptRecord[] {
    const limit = opts?.limit ?? 20;
    const offset = opts?.offset ?? 0;

    let sql = "SELECT * FROM receipts WHERE scope_id = ?";
    const params: SqlValue[] = [scopeId];

    if (opts?.operation) {
      sql += " AND operation = ?";
      params.push(opts.operation);
    }

    if (opts?.runId) {
      sql += " AND run_id = ?";
      params.push(opts.runId);
    }

    if (opts?.eventType) {
      sql += " AND event_type = ?";
      params.push(opts.eventType);
    }

    sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = queryAll(this.db, sql, params);
    return rows.map((r) => this.rowToRecord(r));
  }

  private safeJsonParse(raw: string | null | undefined): unknown {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined; // fail-open: corrupt JSON → undefined
    }
  }

  private rowToRecord(row: Record<string, unknown>): ReceiptRecord {
    return {
      id: row["id"] as string,
      operation: row["operation"] as ReceiptRecord["operation"],
      scopeId: row["scope_id"] as string,
      inputHash: (row["input_hash"] as string) ?? undefined,
      query: (row["query"] as string) ?? undefined,
      resultIds: this.safeJsonParse(row["result_ids"] as string | null) as string[] | undefined,
      memoryIds: this.safeJsonParse(row["memory_ids"] as string | null) as string[] | undefined,
      ccrIds: this.safeJsonParse(row["ccr_ids"] as string | null) as string[] | undefined,
      originalRefs: this.safeJsonParse(row["original_refs"] as string | null) as string[] | undefined,
      tokensBefore: (row["tokens_before"] as number) ?? undefined,
      tokensAfter: (row["tokens_after"] as number) ?? undefined,
      tokensSaved: (row["tokens_saved"] as number) ?? undefined,
      compressionRatio: (row["compression_ratio"] as number) ?? undefined,
      compressed: row["compressed"] ? Boolean(row["compressed"]) : undefined,
      retrievedOriginal: row["retrieved_original"] ? Boolean(row["retrieved_original"]) : undefined,
      failed: Boolean(row["failed"]),
      errorReason: (row["error_reason"] as string) ?? undefined,
      cacheHit: row["cache_hit"] ? Boolean(row["cache_hit"]) : undefined,
      timestamp: row["timestamp"] as string,
      // Run receipt fields (§34)
      runId: (row["run_id"] as string) ?? undefined,
      moduleId: (row["module_id"] as string) ?? undefined,
      parentRunId: (row["parent_run_id"] as string) ?? undefined,
      phase: (row["phase"] as string) ?? undefined,
      eventType: (row["event_type"] as string) ?? undefined,
      checkpointName: (row["checkpoint_name"] as string) ?? undefined,
      artifactPaths: this.safeJsonParse(row["artifact_paths"] as string | null) as string[] | undefined,
      coveredTools: this.safeJsonParse(row["covered_tools"] as string | null) as string[] | undefined,
    };
  }
}
