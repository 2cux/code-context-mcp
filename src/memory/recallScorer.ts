/**
 * Recall Scorer — Phase 9 (Quality Gate)
 *
 * Configurable scoring function that combines BM25 relevance, confidence,
 * and recency into a final ranked score.
 *
 * All parameters are tunable — no embedding or external model dependency.
 *
 * Scoring pipeline:
 *   1. effectiveConfidence = confidenceBase + confidence × confidenceWeight
 *   2. mergedScore = bm25Score × effectiveConfidence
 *   3. recencyBoost = exp(-ageDays / recencyDecayDays)
 *   4. finalScore = mergedScore × (1 + recencyBoost × recencyMaxBoost)
 *
 * Tuning levers:
 *   - confidenceBase (0–1): Minimum effective confidence weight.
 *     Higher → low-confidence memories get more score. Lower → confidence dominates.
 *   - confidenceWeight (0–1): How much raw confidence contributes.
 *     With base=0.3, weight=0.7 → effective range is [0.3, 1.0].
 *   - recencyDecayDays (1–365): Days to decay to ~0.37 (1/e).
 *     Higher → slower decay, older memories retained longer.
 *   - recencyMaxBoost (0–2): Maximum additional score from recency.
 *     Higher → newer memories boosted more aggressively.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RecallScorerConfig {
  /** Minimum effective confidence weight (default: 0.2). Range: [0, 1]. */
  confidenceBase: number;
  /** Weight multiplier on raw confidence (default: 0.8). Range (0, 1]. */
  confidenceWeight: number;
  /** Days for exponential recency decay (default: 60). Higher = slower decay. */
  recencyDecayDays: number;
  /** Maximum boost multiplier for brand-new memories (default: 0.5). */
  recencyMaxBoost: number;
}

/**
 * Default scorer configuration tuned for quality gate targets.
 *
 * Design rationale:
 *   - confidenceBase=0.2: Even low-confidence (0.3) memories retain ~44% score weight.
 *     This prevents high-BM25 but medium-confidence memories from dropping too far.
 *   - confidenceWeight=0.8: Raw confidence still matters but doesn't zero out results.
 *   - recencyDecayDays=60: Slower decay than the original 30-day default.
 *     Month-old memories still have ~0.61 boost factor (vs ~0.37 at 30 days).
 *   - recencyMaxBoost=0.5: Stronger recency signal. Brand-new memories get 50% more
 *     weight vs 30% previously. This ensures recent context is prioritized.
 */
export const DEFAULT_SCORER_CONFIG: RecallScorerConfig = {
  confidenceBase: 0.2,
  confidenceWeight: 0.8,
  recencyDecayDays: 60,
  recencyMaxBoost: 0.5,
};

// Legacy configuration matching original hardcoded values (before tuning)
export const LEGACY_SCORER_CONFIG: RecallScorerConfig = {
  confidenceBase: 0.0,
  confidenceWeight: 1.0,
  recencyDecayDays: 30,
  recencyMaxBoost: 0.3,
};

// ---------------------------------------------------------------------------
// Scoring function
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

export interface ScoreInput {
  bm25Score: number;
  confidence: number;
  createdAt: string; // ISO timestamp
  now?: number; // Override for deterministic testing
}

export interface ScoredResult {
  bm25Score: number;
  confidence: number;
  effectiveConfidence: number;
  mergedScore: number;
  recencyBoost: number;
  finalScore: number;
}

/**
 * Compute ranked scores for a list of search results.
 *
 * Pure function — no side effects, suitable for unit testing.
 * Scores are rounded to 4 decimal places.
 */
export function scoreResults(
  inputs: ScoreInput[],
  config: RecallScorerConfig = DEFAULT_SCORER_CONFIG,
): ScoredResult[] {
  const now = inputs[0]?.now ?? Date.now();

  const scored = inputs.map((input) => {
    const { bm25Score, confidence, createdAt } = input;

    // Step 1: Effective confidence — blends base minimum with raw confidence
    const effectiveConfidence =
      config.confidenceBase + confidence * config.confidenceWeight;

    // Step 2: Merge BM25 score with confidence
    const mergedScore = bm25Score * effectiveConfidence;

    // Step 3: Compute recency decay
    const ageMs = now - new Date(createdAt).getTime();
    const ageDays = Math.max(0, ageMs) / MS_PER_DAY;
    const recencyBoost = Math.exp(-ageDays / config.recencyDecayDays);

    // Step 4: Apply recency bonus to merged score
    const finalScore = mergedScore * (1 + recencyBoost * config.recencyMaxBoost);

    return {
      bm25Score: Math.round(bm25Score * 10_000) / 10_000,
      confidence: Math.round(confidence * 10_000) / 10_000,
      effectiveConfidence: Math.round(effectiveConfidence * 10_000) / 10_000,
      mergedScore: Math.round(mergedScore * 10_000) / 10_000,
      recencyBoost: Math.round(recencyBoost * 10_000) / 10_000,
      finalScore: Math.round(finalScore * 10_000) / 10_000,
    };
  });

  return scored;
}

/**
 * Compute a single final score. Convenience wrapper around scoreResults.
 */
export function scoreOneResult(
  input: ScoreInput,
  config?: RecallScorerConfig,
): ScoredResult {
  return scoreResults([input], config)[0]!;
}
