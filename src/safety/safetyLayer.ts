/**
 * Safety Layer — PRD §11 大输入保护
 *
 * Unified coordinator that wraps compression with:
 *   1. Size limit validation   (§11.2)
 *   2. Content-type-specific chunking (§11.3)
 *   3. Per-chunk timeout enforcement (§11.1)
 *   4. Fail-open at every level (§11.4)
 *
 * Architecture:
 *   Content → checkSizeLimit →
 *     if ok        → compress single chunk (with timeout + failOpen)
 *     if oversized → chunk by type → compress each chunk → merge results
 *
 * Every failure path returns the original content (failOpen principle).
 * Every code path writes a receipt and returns warnings.
 *
 * Design principles (PRD §7.6):
 *   "宁可不压缩，也不能影响 Agent 正常工作。"
 */

import { checkSizeLimit, type SizeCheckResult, type SizeLimitConfig, defaultSizeLimitConfig } from "./sizeLimit.js";
import { chunkByType, type ChunkOptions, type ChunkWithRef } from "./chunking.js";
import { withTimeout, TimeoutError } from "./timeout.js";
import { failOpen, type FailOpenResult } from "./failOpen.js";
import type { ContentType } from "../compressed/compressedStore.js";
import type { CompressionOutput, CompressionInput } from "../compression/compressionEngine.js";
import { compress as engineCompress } from "../compression/compressionEngine.js";
import { countTokens } from "../utils/tokenCount.js";
import { shortHash } from "../utils/hash.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SafetyConfig {
  /** Size limit config (default: 1MB, failOpen). */
  sizeLimit: SizeLimitConfig;
  /** Max tokens per chunk (default: 4000). */
  chunkMaxTokens: number;
  /** Compression timeout per chunk in ms (default: 5000). */
  timeoutMs: number;
  /** Overall compression timeout in ms (default: 30000). */
  overallTimeoutMs: number;
  /** Max chunks allowed (default: 20) — prevents runaway splitting. */
  maxChunks: number;
  /** Whether to enable chunking for oversized inputs. */
  enableChunking: boolean;
}

export function defaultSafetyConfig(): SafetyConfig {
  return {
    sizeLimit: defaultSizeLimitConfig(),
    chunkMaxTokens: 4000,
    timeoutMs: 5000,
    overallTimeoutMs: 30000,
    maxChunks: 20,
    enableChunking: true,
  };
}

// ---------------------------------------------------------------------------
// Compress result with safety metadata
// ---------------------------------------------------------------------------

export interface SafetyCompressResult {
  /** The final CompressionOutput (may be a merged chunk result or a fallback). */
  output: CompressionOutput;
  /** Safety-layer warnings (size limit, chunking, etc.). */
  safetyWarnings: string[];
  /** Whether any safety mechanism was triggered. */
  safetyTriggered: boolean;
  /** Which safety mechanisms were triggered. */
  safetyActions: SafetyAction[];
}

export type SafetyAction =
  | "size_ok"
  | "size_truncated"
  | "size_rejected"
  | "chunked"
  | "chunk_compressed_and_merged"
  | "timeout_per_chunk"
  | "timeout_overall"
  | "fail_open";

// ---------------------------------------------------------------------------
// Core safe-compress pipeline
// ---------------------------------------------------------------------------

/**
 * Compress content through the full safety pipeline.
 *
 * Pipeline:
 *   1. Enforce size limit
 *   2. If needed, chunk by content type
 *   3. Compress each chunk individually (with timeout + failOpen)
 *   4. Merge chunk results into a single CompressionOutput
 *
 * On any failure, returns the original content (failOpen).
 *
 * @param input       - Compression input (same as CompressionEngine.compress).
 * @param compressFn  - The actual compression function to use per chunk.
 * @param config      - Safety config (optional, uses defaults).
 * @returns A SafetyCompressResult with output, warnings, and safety metadata.
 */
export async function compressSafely(
  input: CompressionInput,
  config?: Partial<SafetyConfig>,
): Promise<SafetyCompressResult> {
  const cfg: SafetyConfig = { ...defaultSafetyConfig(), ...config };
  const safetyWarnings: string[] = [];
  const safetyActions: SafetyAction[] = [];

  // ---- Step 1: Size limit check ----

  const sizeResult = checkSizeLimit(input.content, cfg.sizeLimit);

  // Rejected — fail open
  if (!sizeResult.ok) {
    safetyActions.push(sizeResult.code as SafetyAction);
    safetyWarnings.push(sizeResult.warning ?? "Content rejected by size limit.");
    return buildFailOpenResult(input, safetyWarnings, safetyActions);
  }

  const originalBytes = sizeResult.originalBytes;
  const tokensBefore = countTokens(input.content);

  // ---- Step 2: Chunk if needed ----

  // Chunking decision uses ORIGINAL byte count, not the truncated one.
  // This ensures chunking is triggered for oversized content even when
  // the size limit would otherwise truncate it.
  const shouldChunk =
    cfg.enableChunking &&
    cfg.sizeLimit.maxInputBytes > 0 &&
    originalBytes > cfg.sizeLimit.maxInputBytes;

  // Determine working content: use original for chunking, truncated otherwise
  let workingContent: string;
  if (shouldChunk) {
    // Use original content for chunking (skip truncation)
    workingContent = input.content;
    safetyActions.push("chunked");
  } else if (sizeResult.truncated) {
    // Truncated, not chunking — warn and use truncated content
    safetyActions.push(sizeResult.code as SafetyAction);
    safetyWarnings.push(sizeResult.warning ?? "Content was truncated to fit size limit.");
    workingContent = sizeResult.content;
  } else {
    // Content fits within limit
    if (sizeResult.code) {
      safetyActions.push(sizeResult.code as SafetyAction);
    }
    workingContent = sizeResult.content;
  }

  if (shouldChunk) {
    const chunkResult = chunkByType(workingContent, input.contentType, {
      maxTokensPerChunk: cfg.chunkMaxTokens,
    });

    if (chunkResult.totalChunks > cfg.maxChunks) {
      safetyWarnings.push(
        `Content would require ${chunkResult.totalChunks} chunks (max: ${cfg.maxChunks}). ` +
        `Processing first ${cfg.maxChunks} chunks only.`,
      );
    }

    const chunksToProcess = chunkResult.chunks.slice(0, cfg.maxChunks);
    // "chunked" already added above in the safetyActions

    // ---- Step 3: Compress each chunk ----

    const chunkOutputs: (CompressionOutput | null)[] = [];

    for (const chunk of chunksToProcess) {
      const chunkInput: CompressionInput = {
        ...input,
        content: chunk.content,
        metadata: {
          ...(input.metadata ?? {}),
          _chunkIndex: chunk.ref.chunkIndex,
          _chunkTotal: chunk.ref.totalChunks,
          _chunkByteOffset: chunk.ref.byteOffset,
        },
      };

      const chunkOutput = await compressChunkSafely(chunkInput, cfg, tokensBefore);
      chunkOutputs.push(chunkOutput);
    }

    // All chunks failed — fail open
    const validOutputs = chunkOutputs.filter((o): o is CompressionOutput => o !== null);
    if (validOutputs.length === 0) {
      safetyWarnings.push("All chunks failed compression — returning original content.");
      safetyActions.push("fail_open");
      return buildFailOpenResult(input, safetyWarnings, safetyActions);
    }

    // ---- Step 4: Merge chunk results ----

    safetyActions.push("chunk_compressed_and_merged");
    const merged = mergeChunkResults(input, validOutputs, chunkResult.chunks, tokensBefore, safetyWarnings);

    return {
      output: merged,
      safetyWarnings,
      safetyTriggered: safetyActions.length > 0 && !safetyActions.includes("size_ok"),
      safetyActions,
    };
  }

  // ---- Single-chunk path (content fits or was truncated) ----

  // Use workingContent for the single-chunk case (may differ from input.content
  // when the size limit truncated it).
  const singleInput: CompressionInput = { ...input, content: workingContent };

  const output = await compressChunkSafely(singleInput, cfg, tokensBefore);

  if (!output) {
    safetyActions.push("fail_open");
    return buildFailOpenResult(input, safetyWarnings, safetyActions);
  }

  if (output.failed) {
    safetyActions.push("fail_open");
  }

  return {
    output,
    safetyWarnings,
    safetyTriggered: safetyActions.length > 0 && !safetyActions.includes("size_ok"),
    safetyActions,
  };
}

// ---------------------------------------------------------------------------
// Internal: compress a single chunk with timeout + failOpen
// ---------------------------------------------------------------------------

async function compressChunkSafely(
  input: CompressionInput,
  cfg: SafetyConfig,
  _totalTokensBefore: number,
): Promise<CompressionOutput | null> {
  // Build the compression promise
  const compressionPromise = engineCompress(input);

  // Wrap in timeout
  const timedPromise = withTimeout(compressionPromise, {
    timeoutMs: input.timeoutMs ?? cfg.timeoutMs,
    label: `compress:${input.contentType}`,
  });

  // Wrap in failOpen — on failure, still return a fallback output
  const result: FailOpenResult<CompressionOutput> = await failOpen(
    async () => {
      try {
        return await timedPromise;
      } catch (err) {
        if (err instanceof TimeoutError) {
          return buildSingleChunkFallback(input, "compression_timeout");
        }
        throw err;
      }
    },
    buildSingleChunkFallback(input, "compression_failed"),
    `compress:${input.contentType}`,
  );

  return result.value;
}

// ---------------------------------------------------------------------------
// Merge: combine multiple chunk CompressionOutputs into one
// ---------------------------------------------------------------------------

function mergeChunkResults(
  originalInput: CompressionInput,
  outputs: CompressionOutput[],
  originalChunks: ChunkWithRef[],
  totalTokensBefore: number,
  warnings: string[],
): CompressionOutput {
  // Build merged compressed content with chunk boundaries
  const parts: string[] = [];
  let totalTokensAfter = 0;
  let totalTokensSaved = 0;
  let anyOriginal = false;

  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];
    if (!output) continue;

    const chunkRef = originalChunks[i]?.ref;
    const header = chunkRef
      ? `[Chunk ${chunkRef.chunkIndex + 1}/${chunkRef.totalChunks}]`
      : `[Chunk ${i + 1}/${outputs.length}]`;

    parts.push(`${header}\n${output.compressedContent}`);
    totalTokensAfter += output.tokensAfter;
    totalTokensSaved += output.tokensSaved;
    if (output.canRetrieveOriginal) anyOriginal = true;
  }

  const mergedContent = parts.join("\n\n---\n\n");
  const mergedTokensAfter = countTokens(mergedContent);
  const mergedTokensSaved = Math.max(0, totalTokensBefore - mergedTokensAfter);
  const compressionRatio =
    totalTokensBefore > 0
      ? Math.round((mergedTokensSaved / totalTokensBefore) * 10000) / 10000
      : 0;

  // Build a composite strategy identifier
  const strategyName = outputs[0]?.strategy ?? "unknown";
  const mergedStrategy = `chunked(${outputs.length})_${strategyName}`;

  const ccrId = `ccr_chunked_${shortHash(originalInput.content)}`;
  const receiptId = `rcp_chunked_${shortHash(String(Date.now()) + ccrId)}`;

  warnings.push(
    `Merged ${outputs.length} chunks: ${totalTokensBefore} → ${mergedTokensAfter} tokens ` +
    `(${mergedTokensSaved} saved, ${Math.round(compressionRatio * 100)}% reduction)`,
  );

  return {
    ccrId,
    compressed: mergedTokensSaved > 0,
    scopeId: originalInput.scopeId,
    contentType: originalInput.contentType,
    strategy: mergedStrategy,
    compressedContent: mergedContent,
    summary: `[Chunked] ${outputs.length} chunks compressed and merged.`,
    originalRef: originalInput.keepOriginal
      ? `orig_${shortHash(originalInput.content)}`
      : undefined,
    tokensBefore: totalTokensBefore,
    tokensAfter: mergedTokensAfter,
    tokensSaved: mergedTokensSaved,
    compressionRatio,
    canRetrieveOriginal: originalInput.keepOriginal && anyOriginal,
    receiptId,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Fallback builders
// ---------------------------------------------------------------------------

/** Build a fail-open fallback CompressionOutput for the full input. */
function buildFailOpenResult(
  input: CompressionInput,
  safetyWarnings: string[],
  safetyActions: SafetyAction[],
): SafetyCompressResult {
  const tokensBefore = countTokens(input.content);
  const ccrId = `ccr_fail_${shortHash(input.content)}`;
  const receiptId = `rcp_fail_${shortHash(String(Date.now()) + ccrId)}`;

  const output: CompressionOutput = {
    ccrId,
    compressed: false,
    scopeId: input.scopeId,
    contentType: input.contentType,
    strategy: "",
    compressedContent: input.content,
    originalRef: input.keepOriginal
      ? `orig_${shortHash(input.content)}`
      : undefined,
    tokensBefore,
    tokensAfter: tokensBefore,
    tokensSaved: 0,
    compressionRatio: 0,
    canRetrieveOriginal: input.keepOriginal,
    receiptId,
    warnings: [...safetyWarnings],
    failed: true,
    errorReason: "safety_fail_open",
  };

  return {
    output,
    safetyWarnings,
    safetyTriggered: true,
    safetyActions,
  };
}

/** Build a fail-open fallback for a single chunk. */
function buildSingleChunkFallback(
  input: CompressionInput,
  errorReason: string,
): CompressionOutput {
  const tokensBefore = countTokens(input.content);
  const ccrId = `ccr_chunk_fail_${shortHash(input.content)}`;
  const receiptId = `rcp_chunk_fail_${shortHash(String(Date.now()) + ccrId)}`;

  return {
    ccrId,
    compressed: false,
    scopeId: input.scopeId,
    contentType: input.contentType,
    strategy: "",
    compressedContent: input.content,
    originalRef: input.keepOriginal
      ? `orig_${shortHash(input.content)}`
      : undefined,
    tokensBefore,
    tokensAfter: tokensBefore,
    tokensSaved: 0,
    compressionRatio: 0,
    canRetrieveOriginal: input.keepOriginal,
    receiptId,
    warnings: ["Compression failed open and returned original content."],
    failed: true,
    errorReason,
  };
}
