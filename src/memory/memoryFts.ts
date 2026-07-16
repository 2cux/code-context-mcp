/**
 * Memory FTS Index — Phase 5
 *
 * Full-text search over memories using FTS5 when available,
 * with a LIKE-based fallback when the sql.js WASM build lacks FTS5.
 *
 * Architecture:
 *   - On construction, attempts to create a memories_fts FTS5 virtual table.
 *   - If creation fails (sql.js default WASM), falls back to LIKE search.
 *   - Sync methods (insert/update/delete) are no-ops in LIKE mode since
 *     LIKE searches the live memories table directly.
 *   - search() uses BM25 scoring with FTS5, or simple substring matching
 *     with LIKE.
 *
 * BM25 note:
 *   FTS5's bm25() function provides relevance scoring. Results are joined
 *   with the memories table to return full MemoryRecord rows with scores.
 */

import type { Database } from "sql.js";
import { queryAll, runStmt } from "../storage/db.js";
import type { MemoryRecord, MemoryType, MemoryStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FtsSearchResult {
  memory: MemoryRecord;
  score: number;
  rank: number;
}

export interface FtsSearchOptions {
  scopeId: string;
  query: string;
  types?: MemoryType[];
  status?: MemoryStatus[];
  limit?: number;
}

// ---------------------------------------------------------------------------
// MemoryFtsIndex
// ---------------------------------------------------------------------------

export class MemoryFtsIndex {
  private db: Database;
  private ftsAvailable: boolean;

  constructor(db: Database) {
    this.db = db;
    this.ftsAvailable = this.tryInitFts();
  }

  /** Whether FTS5 is available and initialized. */
  get isFtsAvailable(): boolean {
    return this.ftsAvailable;
  }

  // ==========================================================================
  // 17.3.1 — Initialize memories_fts
  // ==========================================================================

  /**
   * Try to create the FTS5 virtual table.
   * Returns true if successful, false if FTS5 is not available.
   */
  private tryInitFts(): boolean {
    try {
      // Check if already exists
      const existing = queryAll(
        this.db,
        `SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'`,
      );
      if (existing.length > 0) return true;

      // Try to create FTS5 virtual table
      runStmt(
        this.db,
        `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
           id UNINDEXED,
           scope_id UNINDEXED,
           type UNINDEXED,
           summary,
           content,
           source_ref
         )`,
      );
      return true;
    } catch {
      // FTS5 not available in this sql.js build — use LIKE fallback
      return false;
    }
  }

  // ==========================================================================
  // 17.3.2 — Sync: insert into FTS
  // ==========================================================================

  /**
   * Insert a memory into the FTS index.
   * No-op when FTS5 is not available (LIKE searches the live table directly).
   */
  insert(record: MemoryRecord): void {
    if (!this.ftsAvailable) return;

    try {
      runStmt(
        this.db,
        `INSERT INTO memories_fts (id, scope_id, type, summary, content, source_ref)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.scopeId,
          record.type,
          record.summary ?? null,
          record.content,
          record.sourceRef ?? null,
        ],
      );
    } catch {
      // Fail-open: FTS sync failure should not block memory operations
    }
  }

  // ==========================================================================
  // 17.3.3 — Sync: update FTS entry
  // ==========================================================================

  /**
   * Update a memory's FTS entry.
   * FTS5 does not support UPDATE — uses DELETE + INSERT.
   * No-op when FTS5 is not available.
   */
  update(record: MemoryRecord): void {
    if (!this.ftsAvailable) return;

    try {
      // FTS5 has no UPDATE — delete then re-insert
      runStmt(
        this.db,
        `DELETE FROM memories_fts WHERE id = ?`,
        [record.id],
      );
      this.insert(record);
    } catch {
      // Fail-open
    }
  }

  // ==========================================================================
  // 17.3.4 — Sync: delete from FTS
  // ==========================================================================

  /**
   * Remove a memory from the FTS index.
   * No-op when FTS5 is not available.
   */
  delete(memoryId: string): void {
    if (!this.ftsAvailable) return;

    try {
      runStmt(
        this.db,
        `DELETE FROM memories_fts WHERE id = ?`,
        [memoryId],
      );
    } catch {
      // Fail-open
    }
  }

  /** Remove an FTS row and propagate errors for transactional callers. */
  deleteStrict(memoryId: string): void {
    if (!this.ftsAvailable) return;
    runStmt(this.db, `DELETE FROM memories_fts WHERE id = ?`, [memoryId]);
  }

  // ==========================================================================
  // 17.3.5 — BM25 search (or LIKE fallback)
  // ==========================================================================

  /**
   * Search memories by full-text query.
   *
   * Uses FTS5 with BM25 scoring when available.
   * Falls back to LIKE-based substring matching on content and summary.
   *
   * Results are sorted by relevance score descending.
   * Only returns active memories by default (unless status filter specified).
   */
  search(opts: FtsSearchOptions): FtsSearchResult[] {
    // Guard: empty query should return nothing, not all active memories
    if (!opts.query || opts.query.trim().length === 0) {
      return [];
    }
    if (this.ftsAvailable) {
      return this.searchFts(opts);
    }
    return this.searchLike(opts);
  }

  // --------------------------------------------------------------------------
  // FTS5 path
  // --------------------------------------------------------------------------

  private searchFts(opts: FtsSearchOptions): FtsSearchResult[] {
    const limit = opts.limit ?? 10;

    // Build FTS5 MATCH query — escape special characters
    const ftsQuery = this.buildFtsQuery(opts.query);

    // Build WHERE filters for the joined memories table
    const conditions: string[] = ["m.scope_id = ?"];
    const params: (string | number)[] = [opts.scopeId];

    if (opts.types && opts.types.length > 0) {
      const placeholders = opts.types.map(() => "?").join(", ");
      conditions.push(`m.type IN (${placeholders})`);
      params.push(...opts.types);
    }

    if (opts.status && opts.status.length > 0) {
      const placeholders = opts.status.map(() => "?").join(", ");
      conditions.push(`m.status IN (${placeholders})`);
      params.push(...opts.status);
    } else {
      // Default: only active memories
      conditions.push("m.status = 'active'");
    }

    const whereClause = conditions.join(" AND ");

    try {
      const rows = queryAll(
        this.db,
        `SELECT m.*, bm25(memories_fts) as score
         FROM memories m
         JOIN memories_fts ON m.id = memories_fts.id
         WHERE memories_fts MATCH ? AND ${whereClause}
         ORDER BY score
         LIMIT ?`,
        [ftsQuery, ...params, limit],
      );

      return rows.map((row, idx) => ({
        memory: this.rowToMemoryRecord(row),
        score: row["score"] as number,
        rank: idx + 1,
      }));
    } catch {
      // FTS query parse error — fall back to LIKE
      return this.searchLike(opts);
    }
  }

  // --------------------------------------------------------------------------
  // LIKE fallback path
  // --------------------------------------------------------------------------

  private searchLike(opts: FtsSearchOptions): FtsSearchResult[] {
    const limit = opts.limit ?? 10;
    // Safety cap: max rows to fetch before scoring (protects against
    // very broad single-term queries on large memory sets).
    const FETCH_CAP = 200;

    // Split query into terms for multi-term matching
    const terms = opts.query
      .split(/\s+/)
      .filter((t) => t.length > 0);

    // Build WHERE clause AND params in-order (conditions and params MUST align)
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    // 1. Scope filter
    conditions.push("m.scope_id = ?");
    params.push(opts.scopeId);

    // 2. Type filter
    if (opts.types && opts.types.length > 0) {
      const placeholders = opts.types.map(() => "?").join(", ");
      conditions.push(`m.type IN (${placeholders})`);
      params.push(...opts.types);
    }

    // 3. Status filter (default: active only)
    if (opts.status && opts.status.length > 0) {
      const placeholders = opts.status.map(() => "?").join(", ");
      conditions.push(`m.status IN (${placeholders})`);
      params.push(...opts.status);
    } else {
      conditions.push("m.status = 'active'");
    }

    // 4. LIKE search conditions (built in-order with params)
    const likeTerms: string[] = [];
    for (const term of terms) {
      const pattern = `%${term}%`;
      likeTerms.push("(m.content LIKE ? OR m.summary LIKE ?)");
      params.push(pattern, pattern);
    }

    if (likeTerms.length > 0) {
      conditions.push(`(${likeTerms.join(" OR ")})`);
    }

    const whereClause = conditions.join(" AND ");

    // Fetch all matching rows (up to FETCH_CAP) then score and sort.
    // Previously we LIMITed before scoring by created_at DESC, which
    // could drop the best TF-match if it was old.  Quality-gate fix.
    const rows = queryAll(
      this.db,
      `SELECT m.* FROM memories m
       WHERE ${whereClause}
       LIMIT ?`,
      [...params, FETCH_CAP],
    );

    // Compute relevance scores, then sort descending and apply the real limit
    const scored = rows.map((row) => {
      const memory = this.rowToMemoryRecord(row);
      const score = this.computeLikeScore(memory, terms);
      return { memory, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const topN = scored.slice(0, limit);
    return topN.map((item, idx) => ({
      ...item,
      rank: idx + 1,
    }));
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Build an FTS5 query string, escaping special characters.
   * Splits into individual terms connected with AND so that ALL
   * terms must appear somewhere in the document (not necessarily adjacent).
   */
  private buildFtsQuery(raw: string): string {
    const terms = raw
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => {
        // Escape double-quotes and wrap each term
        const escaped = t.replace(/"/g, '""');
        return `"${escaped}"`;
      });
    return terms.join(" AND ");
  }

  /**
   * Compute a relevance score for LIKE results.
   *
   * Scoring factors:
   *   - Term frequency in content (TF)
   *   - Bonus for summary matches (+2 per summary hit, summaries are discriminative)
   *   - Exact phrase match bonus (+3)
   *   - Content length normalization: shorter docs with same TF score higher
   *   - Term IDF: very short terms (<3 chars) get half weight (common noise)
   *
   * Score range: roughly 0–20 for typical queries.
   */
  private computeLikeScore(
    memory: MemoryRecord,
    terms: string[],
  ): number {
    let score = 0;
    const contentLower = memory.content.toLowerCase();
    const summaryLower = (memory.summary ?? "").toLowerCase();

    for (const term of terms) {
      const lowerTerm = term.toLowerCase();
      const escaped = lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Content term frequency
      const contentMatches = (contentLower.match(new RegExp(escaped, "gi")) ?? []).length;

      // Summary term frequency (double weight: summaries are discriminative)
      const summaryMatches = (summaryLower.match(new RegExp(escaped, "gi")) ?? []).length;

      if (contentMatches > 0 || summaryMatches > 0) {
        // TF: log-scaled, max contribution ~2.1 for content, ~3.2 for summary
        const contentScore = Math.log(contentMatches + 1);
        const summaryScore = Math.log(summaryMatches + 1) * 2.0; // summary double weight
        // IDF: very short terms (< 3 chars) get reduced weight
        const termWeight = lowerTerm.length < 3 ? 0.5 : 1.0;
        score += (contentScore + summaryScore) * termWeight;
      }
    }

    // Exact phrase match bonus (query as a whole matching anywhere)
    const queryLower = terms.join(" ").toLowerCase();
    if (contentLower.includes(queryLower)) {
      score += 3.0;
    } else if (summaryLower.includes(queryLower)) {
      score += 4.0; // summary phrase match is even more signal
    }

    // Content density normalization: shorter content with same matches = more relevant
    const contentChars = Math.max(1, contentLower.length);
    const densityBonus = Math.min(1.0, 200 / contentChars); // max +1 for very short content

    return Math.round((score + densityBonus) * 100) / 100;
  }

  /**
   * Convert a DB row (from memories table with optional score) to MemoryRecord.
   */
  private rowToMemoryRecord(row: Record<string, unknown>): MemoryRecord {
    return {
      id: row["id"] as string,
      scopeId: row["scope_id"] as string,
      type: row["type"] as MemoryType,
      content: row["content"] as string,
      summary: (row["summary"] as string) ?? undefined,
      sourceRef: (row["source_ref"] as string) ?? undefined,
      confidence: row["confidence"] as number,
      status: row["status"] as MemoryStatus,
      createdAt: row["created_at"] as string,
      updatedAt: row["updated_at"] as string,
      expiresAt: (row["expires_at"] as string) ?? undefined,
      supersededBy: (row["superseded_by"] as string) ?? undefined,
      tags: safeParseJSONArray(row["tags"] as string | null),
      fingerprint: (row["fingerprint"] as string) ?? undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParseJSONArray(
  raw: string | null | undefined,
): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return undefined;
  } catch {
    return undefined;
  }
}
