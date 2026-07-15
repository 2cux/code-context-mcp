/**
 * Compression Engine — Phase 2
 *
 * Routes content to the appropriate type-specific compressor
 * and produces a CompressedContextRecord.
 *
 * Design principles (per PRD §13.1):
 *   - MUST preserve: errors, paths, line numbers, commands, exit codes,
 *     stack traces, source refs, metadata, originalRef.
 *   - MUST NOT silently drop: error stacks, failed test names, file paths,
 *     public API, type definitions, user-focused content.
 *   - If compression fails, return original content (failOpen).
 */

import type { ContentType } from "../router/contentRouter.js";
import { countTokens } from "../utils/tokenCount.js";
import { shortHash } from "../utils/hash.js";
import { failOpen } from "../safety/failOpen.js";
import { withTimeout, TimeoutError } from "../safety/timeout.js";

// ---------------------------------------------------------------------------
// Defaults (per PRD §18)
// ---------------------------------------------------------------------------

/** Default maxOutputTokens (PRD §18: maxOutputTokens) */
export const DEFAULT_MAX_TOKENS = 2000;
/** Default compression timeout in ms (PRD §18: compressionTimeoutMs) */
export const DEFAULT_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressionInput {
  scopeId: string;
  content: string;
  contentType: ContentType;
  metadata?: Record<string, unknown>;
  /** Strategy mode: "conservative" (default) or "auto" */
  strategy?: string;
  keepOriginal: boolean;
  /** Max output tokens (default 2000, per PRD §18: maxOutputTokens) */
  maxTokens?: number;
  /** Compression timeout in ms (default 5000, per PRD §18: compressionTimeoutMs) */
  timeoutMs?: number;
}

export interface CompressionOutput {
  ccrId: string;
  compressed: boolean;
  scopeId: string;
  contentType: ContentType;
  /** Strategy identifier, e.g. "test_output_conservative_v1" */
  strategy: string;
  /** Full strategy semver, e.g. "1.0.0" — used by CacheAligner for cache key computation */
  strategyVersion: string;
  compressedContent: string;
  summary?: string;
  originalRef?: string;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  compressionRatio: number;
  canRetrieveOriginal: boolean;
  receiptId: string;
  warnings: string[];
  // Failure fields
  failed?: boolean;
  errorReason?: string;
}

// ---------------------------------------------------------------------------
// Strategy interface & registry
// ---------------------------------------------------------------------------

/**
 * A compression strategy implements a content-type-specific algorithm.
 *
 * Each strategy has a name, a semantic version, and a compress() method.
 * The compress() method receives the raw content and a token budget,
 * and returns the compressed content plus any warnings and an optional
 * human-readable summary.
 */
export interface CompressionStrategy {
  /** Unique name, e.g. "plain_text", "log", "code" */
  name: string;
  /** Semantic version, e.g. "1.0.0", "0.1.0" */
  version: string;
  /**
   * Compress content to fit within maxTokens.
   *
   * MUST NOT throw — throw safety is handled by the engine's failOpen
   * wrapper, but strategies should still avoid throwing where possible.
   */
  compress(content: string, maxTokens: number): StrategyResult;
}

export interface StrategyResult {
  compressedContent: string;
  warnings: string[];
  summary?: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const strategyRegistry = new Map<ContentType, CompressionStrategy>();

/** Types that intentionally use the generic plain-text strategy. */
const PLAIN_TEXT_FALLBACK_TYPES: ReadonlySet<ContentType> = new Set([
  "file_summary",
  "unknown",
]);

/**
 * Register a compression strategy for a content type.
 * Overwrites any previously registered strategy for the same type.
 */
export function registerStrategy(
  contentType: ContentType,
  strategy: CompressionStrategy,
): void {
  strategyRegistry.set(contentType, strategy);
}

/**
 * Look up the registered strategy for a content type.
 * Returns undefined if no strategy is registered.
 */
export function getStrategy(
  contentType: ContentType,
): CompressionStrategy | undefined {
  return strategyRegistry.get(contentType);
}

/**
 * List all content types that have a registered strategy.
 */
export function listRegisteredTypes(): ContentType[] {
  return Array.from(strategyRegistry.keys());
}

/**
 * Returns true when a strategy is registered for the given type.
 */
export function hasStrategy(contentType: ContentType): boolean {
  return strategyRegistry.has(contentType);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

let _ccrCounter = 0;

function generateCcrId(): string {
  _ccrCounter += 1;
  const seq = String(_ccrCounter).padStart(6, "0");
  const ts = Date.now().toString(36);
  const rand = shortHash(String(Math.random())); // ~8 hex chars
  return `ccr_${ts}_${rand}_${seq}`;
}

function generateReceiptId(): string {
  const ts = Date.now().toString(36);
  const rand = shortHash(String(Math.random() + _ccrCounter));
  return `rcp_${ts}_${rand}`;
}

/**
 * Build a fallback CompressionOutput used when compression fails.
 * Returns the original content unchanged, preserving the agent's ability
 * to work (failOpen principle).
 */
function buildFallbackOutput(
  input: CompressionInput,
  tokensBefore: number,
): CompressionOutput {
  return {
    ccrId: generateCcrId(),
    compressed: false,
    scopeId: input.scopeId,
    contentType: input.contentType,
    strategy: "",
    strategyVersion: "",
    compressedContent: input.content,
    originalRef: input.keepOriginal
      ? `orig_${shortHash(input.content)}`
      : undefined,
    tokensBefore,
    tokensAfter: tokensBefore,
    tokensSaved: 0,
    compressionRatio: 0,
    canRetrieveOriginal: input.keepOriginal,
    receiptId: generateReceiptId(),
    warnings: [],
    failed: true,
  };
}

/**
 * Build a PRD-format strategy identifier.
 *
 * PRD §11.2 format: `{contentType}_{mode}_v{version}`
 * Example: "test_output_conservative_v1"
 */
function buildStrategyId(
  contentType: ContentType,
  mode: string,
  version: string,
): string {
  // Extract major version from semver (e.g. "1.0.0" → "1")
  const major = version.split(".")[0] ?? "1";
  return `${contentType}_${mode}_v${major}`;
}

/**
 * Core compression entry point.
 *
 * 1. Resolves the strategy for the given content type.
 * 2. Falls back to plain_text when no strategy is registered.
 * 3. Wraps compression in timeout + failOpen guards.
 * 4. If anything fails, returns the original content (failOpen principle).
 */
export async function compress(
  input: CompressionInput,
): Promise<CompressionOutput> {
  const strategyMode = input.strategy ?? "conservative";
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const contentType = input.contentType;
  const tokensBefore = countTokens(input.content);

  // Validate strategy mode — only "conservative" and "auto" are valid (PRD §18)
  if (strategyMode !== "conservative" && strategyMode !== "auto") {
    const fallback = buildFallbackOutput(input, tokensBefore);
    fallback.errorReason = `Invalid strategy mode: "${strategyMode}"`;
    fallback.warnings = [
      `Unknown strategy mode "${strategyMode}" — valid modes: conservative, auto`,
    ];
    return fallback;
  }

  // Resolve strategy. Only types explicitly designed to use the generic
  // strategy may fall back to plain_text. A missing strategy for a concrete
  // supported type is an initialization failure and must fail open rather
  // than being reported as a successful compression.
  let strategy = strategyRegistry.get(contentType);
  let fallbackUsed = false;

  if (!strategy && PLAIN_TEXT_FALLBACK_TYPES.has(contentType)) {
    strategy = strategyRegistry.get("plain_text");
    fallbackUsed = true;
  }

  if (!strategy && !PLAIN_TEXT_FALLBACK_TYPES.has(contentType)) {
    const output = buildFallbackOutput(input, tokensBefore);
    output.errorReason = `Compression strategy not registered for content type: ${contentType}`;
    output.warnings = [
      `Compression failed open because strategy "${contentType}" is not registered.`,
    ];
    return output;
  }

  // If even plain_text is missing, fail open immediately
  if (!strategy) {
    const output = buildFallbackOutput(input, tokensBefore);
    output.errorReason = "No compression strategy available (plain_text missing)";
    output.warnings = ["No strategy registered for any content type"];
    return output;
  }

  const strategyId = buildStrategyId(
    fallbackUsed ? "plain_text" : contentType,
    strategyMode,
    strategy.version,
  );

  // Wrap compression in timeout + failOpen
  const compressionPromise = failOpen(
    async () => {
      const strategyResult = strategy!.compress(input.content, maxTokens);

      const tokensAfter = countTokens(strategyResult.compressedContent);
      const tokensSaved = Math.max(0, tokensBefore - tokensAfter);
      const compressionRatio =
        tokensBefore > 0
          ? Math.round((tokensSaved / tokensBefore) * 10000) / 10000
          : 0;

      const ccrId = generateCcrId();
      const receiptId = generateReceiptId();

      const warnings = [...strategyResult.warnings];

      // Audit trail: strategy info as first warning
      warnings.unshift(`strategy=${strategyId}`);

      if (fallbackUsed && contentType !== "plain_text") {
        warnings.push(
          `No strategy registered for "${contentType}", fell back to plain_text`,
        );
      }

      // Token savings summary
      if (tokensSaved > 0) {
        warnings.push(
          `Token savings: ${tokensBefore} → ${tokensAfter} ` +
            `(${tokensSaved} saved, ${Math.round(compressionRatio * 100)}% reduction)`,
        );
      }

      const output: CompressionOutput = {
        ccrId,
        compressed: tokensSaved > 0,
        scopeId: input.scopeId,
        contentType,
        strategy: strategyId,
        strategyVersion: strategy.version,
        compressedContent: strategyResult.compressedContent,
        summary: strategyResult.summary,
        originalRef: input.keepOriginal
          ? `orig_${shortHash(input.content)}`
          : undefined,
        tokensBefore,
        tokensAfter,
        tokensSaved,
        compressionRatio,
        canRetrieveOriginal: input.keepOriginal,
        receiptId,
        warnings,
      };

      return output;
    },
    buildFallbackOutput(input, tokensBefore),
    "compression",
  );

  // Apply timeout
  const result = await withTimeout(compressionPromise, {
    timeoutMs,
    label: `compress:${contentType}`,
  }).catch(async (err) => {
    if (err instanceof TimeoutError) {
      const fallback = buildFallbackOutput(input, tokensBefore);
      fallback.errorReason = "compression_timeout";
      fallback.warnings = [
        "Compression failed open and returned original content.",
      ];
      return { success: false as const, value: fallback, error: err.message };
    }
    throw err;
  });

  if (result.success) {
    return result.value;
  }

  // failOpen caught an error — return fallback with error info
  const fallback = result.value;
  // Prefer timeout's explicit "compression_timeout" over generic error message
  fallback.errorReason = fallback.errorReason || result.error;
  if (!fallback.warnings.length) {
    fallback.warnings = [
      "Compression failed open and returned original content.",
    ];
  }
  return fallback;
}
