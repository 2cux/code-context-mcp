/**
 * Recall Engine — Phase 5 / Phase 7
 *
 * Searches project memory using the FTS index.
 * Returns scored, ranked results with confidence merging and recency weighting.
 *
 * The recall engine delegates search to MemoryFtsIndex (FTS5 or LIKE fallback),
 * adds canExpand flag, merges confidence scores, and applies recency decay.
 */

import type { Database } from "sql.js";
import { MemoryFtsIndex, type FtsSearchResult } from "./memoryFts.js";
import { queryAll } from "../storage/db.js";
import type { MemoryType, MemoryStatus, MemoryRecord } from "./types.js";
import { parseSourceRef } from "./sourceRef.js";
import {
  scoreResults,
  DEFAULT_SCORER_CONFIG,
  type RecallScorerConfig,
} from "./recallScorer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecallSearchParams {
  scopeId: string;
  query: string;
  types?: MemoryType[];
  status?: MemoryStatus[];
  limit?: number;
  includeCanExpand?: boolean;
  /** Configurable scoring weights (defaults to quality-gate-tuned values). */
  scorerConfig?: RecallScorerConfig;
}

/** Extended result with merged confidence and recency weighting. */
export interface EnhancedSearchResult {
  memory: MemoryRecord;
  /** Raw BM25 (or LIKE) relevance score from FTS. */
  score: number;
  /** The memory's confidence value (0–1). */
  confidence: number;
  /** score × confidence — relevance adjusted by trustworthiness. */
  mergedScore: number;
  /** Recency boost multiplier (1.0 = today, decays toward 0 for older memories). */
  recencyBoost: number;
  /** Final score = mergedScore × (1 + recencyBoost × 0.3), sorted descending. */
  finalScore: number;
  /** Rank (1-based) after sorting by finalScore. */
  rank: number;
  /** Whether the original content is retrievable via compressed_contexts. */
  canExpand: boolean;
}

export interface RecallSearchResult {
  memory: FtsSearchResult["memory"] & { score: number; canExpand: boolean };
  score: number;
  rank: number;
}

export interface RelatedCCR {
  ccrId: string;
  summary?: string;
  originalRef?: string;
  canRetrieveOriginal: boolean;
}

// (Scoring weights are now in recallScorer.ts — DEFAULT_SCORER_CONFIG)

// ---------------------------------------------------------------------------
// RecallEngine
// ---------------------------------------------------------------------------

export class RecallEngine {
  private db: Database;
  private ftsIndex: MemoryFtsIndex;

  constructor(db: Database, ftsIndex?: MemoryFtsIndex) {
    this.db = db;
    this.ftsIndex = ftsIndex ?? new MemoryFtsIndex(db);
  }

  // ==========================================================================
  // 20.1 — Enhanced search with confidence merging + recency weighting
  // ==========================================================================

  /**
   * Search memories with full processing pipeline:
   *   1. FTS search (BM25 or LIKE fallback)
   *   2. Resolve canExpand (linked compressed contexts)
   *   3. Merge confidence: mergedScore = score × confidence
   *   4. Apply recency weighting
   *   5. Sort by finalScore descending, assign ranks
   */
  searchEnhanced(params: RecallSearchParams): EnhancedSearchResult[] {
    const config = params.scorerConfig ?? DEFAULT_SCORER_CONFIG;
    const now = Date.now();

    const rawResults = this.ftsIndex.search({
      scopeId: params.scopeId,
      query: params.query,
      types: params.types,
      status: params.status,
      limit: params.limit ?? 10,
    });

    if (rawResults.length === 0) return [];

    // Resolve canExpand if requested
    const canExpandSet = params.includeCanExpand
      ? this.resolveCanExpand(
          params.scopeId,
          rawResults.map((r) => r.memory.id),
        )
      : new Set<string>();

    // Compute configured scores via RecallScorer
    const scoreInputs = rawResults.map((r) => ({
      bm25Score: r.score,
      confidence: r.memory.confidence,
      createdAt: r.memory.createdAt,
      now,
    }));
    const scoredResults = scoreResults(scoreInputs, config);

    // Merge scored results with memory records
    const enhanced = rawResults.map((r, idx) => {
      const scored = scoredResults[idx]!;
      return {
        memory: r.memory,
        score: r.score,
        confidence: scored.confidence,
        mergedScore: scored.mergedScore,
        recencyBoost: scored.recencyBoost,
        finalScore: scored.finalScore,
        rank: 0, // assigned after sort
        canExpand: canExpandSet.has(r.memory.id),
      };
    });

    // Sort by finalScore descending, then assign ranks
    enhanced.sort((a, b) => b.finalScore - a.finalScore);
    enhanced.forEach((r, idx) => {
      r.rank = idx + 1;
    });

    return enhanced;
  }

  /**
   * Legacy search — returns basic score/rank results.
   * Delegates to searchEnhanced and strips extra fields for backward compat.
   */
  search(params: RecallSearchParams): RecallSearchResult[] {
    const enhanced = this.searchEnhanced(params);
    return enhanced.map((r) => ({
      memory: { ...r.memory, score: r.finalScore, canExpand: r.canExpand },
      score: r.finalScore,
      rank: r.rank,
    }));
  }

  // ==========================================================================
  // 20.3 — Related compressed contexts lookup
  // ==========================================================================

  /**
   * Find compressed context records related to the given memories.
   *
   * Three-tier matching strategy (PRD §23.3):
   *
   *   1. **ccr:<id>** — Direct CCR lookup by ID.
   *      When a memory's sourceRef is `ccr:abc123`, return the CCR
   *      with id=abc123 directly.
   *
   *   2. **orig:<id>** — Find CCRs linked to an original.
   *      When a memory's sourceRef is `orig:abc123`, return CCRs
   *      whose original_ref matches abc123.
   *
   *   3. **Other sourceRefs** (file:, command:, user:manual, legacy) —
   *      Exact match on cc.source_ref or cc.original_ref.
   *
   * Results are deduplicated by ccrId.
   */
  findRelatedCCRs(
    scopeId: string,
    memories: MemoryRecord[],
  ): RelatedCCR[] {
    if (memories.length === 0) return [];

    // Collect non-empty sourceRefs from the memories
    const sourceRefs = [
      ...new Set(
        memories
          .map((m) => m.sourceRef)
          .filter((s): s is string => !!s && s.length > 0),
      ),
    ];

    if (sourceRefs.length === 0) return [];

    // Partition sourceRefs by prefix for tiered matching
    const ccrIds: string[] = [];       // ccr:<id> → direct lookup
    const origRefs: string[] = [];     // orig:<id> → original_ref match
    const genericRefs: string[] = [];  // everything else → source_ref / original_ref match

    for (const ref of sourceRefs) {
      const parsed = parseSourceRef(ref);
      if (parsed.prefix === "ccr" && parsed.value.length > 0) {
        ccrIds.push(parsed.value);
      } else if (parsed.prefix === "orig" && parsed.value.length > 0) {
        origRefs.push(parsed.value);
      } else {
        // file:, command:, user:manual, free-form legacy refs
        genericRefs.push(ref);
      }
    }

    // Collect results into a Map keyed by ccrId for deduplication
    const resultMap = new Map<string, RelatedCCR>();

    // ---- Tier 1: Direct CCR lookup by ID (ccr:<id>) — batched ----
    if (ccrIds.length > 0) {
      const placeholders = ccrIds.map(() => "?").join(", ");
      const rows = queryAll(
        this.db,
        `SELECT id, summary, original_ref, can_retrieve_original
         FROM compressed_contexts
         WHERE id IN (${placeholders}) AND scope_id = ?
         LIMIT 50`,
        [...ccrIds, scopeId],
      );
      for (const r of rows) {
        const id = r["id"] as string;
        if (!resultMap.has(id)) {
          resultMap.set(id, {
            ccrId: id,
            summary: (r["summary"] as string) ?? undefined,
            originalRef: (r["original_ref"] as string) ?? undefined,
            canRetrieveOriginal: Boolean(r["can_retrieve_original"]),
          });
        }
      }
    }

    // ---- Tier 2: Find CCRs by original_ref (orig:<id>) ----
    if (origRefs.length > 0) {
      const placeholders = origRefs.map(() => "?").join(", ");
      const rows = queryAll(
        this.db,
        `SELECT id, summary, original_ref, can_retrieve_original
         FROM compressed_contexts
         WHERE scope_id = ? AND original_ref IN (${placeholders})
         LIMIT 50`,
        [scopeId, ...origRefs],
      );
      for (const r of rows) {
        const id = r["id"] as string;
        if (!resultMap.has(id)) {
          resultMap.set(id, {
            ccrId: id,
            summary: (r["summary"] as string) ?? undefined,
            originalRef: (r["original_ref"] as string) ?? undefined,
            canRetrieveOriginal: Boolean(r["can_retrieve_original"]),
          });
        }
      }
    }

    // ---- Tier 3: Generic sourceRef match (file:, command:, user:manual, legacy) ----
    if (genericRefs.length > 0) {
      const placeholders = genericRefs.map(() => "?").join(", ");
      // Each generic ref appears twice (source_ref IN + original_ref IN)
      const rows = queryAll(
        this.db,
        `SELECT DISTINCT id, summary, original_ref, can_retrieve_original
         FROM compressed_contexts
         WHERE scope_id = ?
           AND (source_ref IN (${placeholders}) OR original_ref IN (${placeholders}))
         LIMIT 50`,
        [scopeId, ...genericRefs, ...genericRefs],
      );
      for (const r of rows) {
        const id = r["id"] as string;
        if (!resultMap.has(id)) {
          resultMap.set(id, {
            ccrId: id,
            summary: (r["summary"] as string) ?? undefined,
            originalRef: (r["original_ref"] as string) ?? undefined,
            canRetrieveOriginal: Boolean(r["can_retrieve_original"]),
          });
        }
      }
    }

    return Array.from(resultMap.values());
  }

  /**
   * Get the FTS index for direct access (used by MemoryService).
   */
  getFtsIndex(): MemoryFtsIndex {
    return this.ftsIndex;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve which memory IDs have related compressed contexts.
   * A memory can be "expanded" if its sourceRef links to a
   * compressed_contexts row that still has retrievable original content.
   *
   * Matching logic (aligned with findRelatedCCRs), batched by prefix group:
   *   1. ccr:<id> → direct CCR lookup by ID (single batch query)
   *   2. orig:<id> → CCR with matching original_ref (single batch query)
   *   3. Other → source_ref or original_ref match (single batch query)
   */
  private resolveCanExpand(
    scopeId: string,
    memoryIds: string[],
  ): Set<string> {
    if (memoryIds.length === 0) return new Set();

    // Fetch source_ref for all memories in this batch
    const placeholders = memoryIds.map(() => "?").join(", ");
    const memRows = queryAll(
      this.db,
      `SELECT id, source_ref FROM memories
       WHERE scope_id = ? AND id IN (${placeholders})`,
      [scopeId, ...memoryIds],
    );

    if (memRows.length === 0) return new Set();

    // Partition memories by sourceRef prefix
    const ccrMap = new Map<string, string[]>();    // ccrId → [memId, ...]
    const origMap = new Map<string, string[]>();   // origRef → [memId, ...]
    const genericMap = new Map<string, string[]>(); // sourceRef → [memId, ...]

    for (const mem of memRows) {
      const memId = mem["id"] as string;
      const sourceRef = (mem["source_ref"] as string) ?? "";
      if (!sourceRef) continue;

      const parsed = parseSourceRef(sourceRef);

      if (parsed.prefix === "ccr" && parsed.value.length > 0) {
        const ids = ccrMap.get(parsed.value) ?? [];
        ids.push(memId);
        ccrMap.set(parsed.value, ids);
      } else if (parsed.prefix === "orig" && parsed.value.length > 0) {
        const ids = origMap.get(parsed.value) ?? [];
        ids.push(memId);
        origMap.set(parsed.value, ids);
      } else {
        // file:, command:, user:manual, free-form legacy — match on exact source_ref
        const ids = genericMap.get(sourceRef) ?? [];
        ids.push(memId);
        genericMap.set(sourceRef, ids);
      }
    }

    const expandable = new Set<string>();

    // ---- Tier 1: Batch CCR lookup by ID ----
    if (ccrMap.size > 0) {
      const ccrIds = [...ccrMap.keys()];
      const ccrPlaceholders = ccrIds.map(() => "?").join(", ");
      const ccrRows = queryAll(
        this.db,
        `SELECT id FROM compressed_contexts
         WHERE id IN (${ccrPlaceholders})
           AND scope_id = ?
           AND can_retrieve_original = 1
         LIMIT ${ccrIds.length + 1}`,
        [...ccrIds, scopeId],
      );
      const foundCcrIds = new Set(ccrRows.map((r) => r["id"] as string));
      for (const ccrId of foundCcrIds) {
        const memIds = ccrMap.get(ccrId) ?? [];
        for (const memId of memIds) {
          expandable.add(memId);
        }
      }
    }

    // ---- Tier 2: Batch original_ref lookup ----
    if (origMap.size > 0) {
      const origRefs = [...origMap.keys()];
      const origPlaceholders = origRefs.map(() => "?").join(", ");
      const origRows = queryAll(
        this.db,
        `SELECT id, original_ref FROM compressed_contexts
         WHERE scope_id = ?
           AND original_ref IN (${origPlaceholders})
           AND can_retrieve_original = 1
         LIMIT ${origRefs.length + 1}`,
        [scopeId, ...origRefs],
      );
      for (const row of origRows) {
        const origRef = (row["original_ref"] as string) ?? "";
        const memIds = origMap.get(origRef) ?? [];
        for (const memId of memIds) {
          expandable.add(memId);
        }
      }
    }

    // ---- Tier 3: Batch generic source_ref / original_ref match ----
    if (genericMap.size > 0) {
      const genericRefs = [...genericMap.keys()];
      const genericPlaceholders = genericRefs.map(() => "?").join(", ");
      // Each ref appears twice (source_ref + original_ref)
      const genericRows = queryAll(
        this.db,
        `SELECT id, source_ref, original_ref FROM compressed_contexts
         WHERE scope_id = ?
           AND (source_ref IN (${genericPlaceholders}) OR original_ref IN (${genericPlaceholders}))
           AND can_retrieve_original = 1
         LIMIT ${genericRefs.length * 2 + 1}`,
        [scopeId, ...genericRefs, ...genericRefs],
      );
      for (const row of genericRows) {
        const ccSourceRef = (row["source_ref"] as string) ?? "";
        const ccOrigRef = (row["original_ref"] as string) ?? "";
        // Match memories whose sourceRef equals this CCR's source_ref or original_ref
        const matchedMemIds = new Set<string>();
        const bySource = genericMap.get(ccSourceRef);
        if (bySource) for (const id of bySource) matchedMemIds.add(id);
        const byOrig = genericMap.get(ccOrigRef);
        if (byOrig) for (const id of byOrig) matchedMemIds.add(id);
        for (const memId of matchedMemIds) {
          expandable.add(memId);
        }
      }
    }

    return expandable;
  }
}
