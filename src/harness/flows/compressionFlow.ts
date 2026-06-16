/**
 * Compression Closed-Loop Flow
 *
 * Exercises the full compression loop:
 *   resolve scope → compress fixtures → verify CCR → retrieve original →
 *   verify receipt → write report
 *
 * Each phase processes ALL fixtures before moving to the next phase,
 * matching the sequential phase declaration in the manifest.
 *
 * PRD §34 / §9.1: 压缩闭环。
 */

import type { HarnessContext, CheckpointOutcome } from "../core/types.js";
import type { CodeContextAdapter, CompressResult } from "../adapters/codeContextAdapter.js";

// ── Input Types ────────────────────────────────────────────────────────────────

export interface CompressionFixture {
  /** Human-readable label for this fixture. */
  label: string;
  /** Raw content to compress. */
  content: string;
  /** Optional content type hint (auto-detected if omitted). */
  contentType?: string;
}

export interface CompressionFlowInput {
  adapter: CodeContextAdapter;
  fixtures: CompressionFixture[];
}

// ── Output Types ───────────────────────────────────────────────────────────────

export interface CompressionFixtureResult {
  label: string;
  ccrId: string;
  contentType: string;
  strategy: string;
  compressed: boolean;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  compressionRatio: number;
  originalRef?: string;
  canRetrieveOriginal: boolean;
  receiptId: string;
  failed: boolean;
  errorReason?: string;
  roundtripMatch?: boolean;
  warnings: string[];
}

export interface CompressionFlowOutput {
  totalFixtures: number;
  totalCompressed: number;
  totalFailures: number;
  totalTokensBefore: number;
  totalTokensAfter: number;
  totalTokensSaved: number;
  aggregateSavingsPercent: number;
  allOriginalRefsPresent: boolean;
  allReceiptsPresent: boolean;
  results: CompressionFixtureResult[];
}

// ── Per-fixture intermediate state ─────────────────────────────────────────────

interface FixtureState {
  fixture: CompressionFixture;
  result: CompressResult | null;
  error?: string;
  roundtripMatch?: boolean;
}

// ── Flow Implementation ────────────────────────────────────────────────────────

export async function compressionFlow(
  ctx: HarnessContext<CompressionFlowInput>,
): Promise<CompressionFlowOutput> {
  const { adapter, fixtures } = ctx.input;
  const states: FixtureState[] = fixtures.map((f) => ({ fixture: f, result: null }));

  // ── Phase 1: resolve_scope ──────────────────────────────────────────────────

  ctx.phase("resolve_scope");
  ctx.log("Resolving current repository scope...");

  let scopeId: string;
  try {
    const scopeResult = adapter.runCurrentScope();
    scopeId = scopeResult.scopeId;
    ctx.checkpoint("compress:resolve_scope", "pass", `scopeId: ${scopeId}`);
    ctx.log(`Scope resolved: ${scopeId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("compress:resolve_scope", "fail", msg);
    ctx.log(`Scope resolution failed: ${msg}`);
    scopeId = "unknown";
  }

  // ── Phase 2: compress_input ─────────────────────────────────────────────────

  ctx.phase("compress_input");

  for (const state of states) {
    const { fixture } = state;
    ctx.log(`Compressing fixture "${fixture.label}"...`);

    try {
      state.result = await adapter.runCompressContext(fixture.content, {
        contentType: fixture.contentType,
        strategy: "conservative",
        keepOriginal: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.error = msg;
    }
  }

  // Record per-fixture compression checkpoints (all within compress phase)
  for (const state of states) {
    const { fixture, result, error } = state;
    if (error || !result) {
      const msg = error ?? "unknown error";
      ctx.checkpoint("compress:detect_type", "fail", `fixture="${fixture.label}" ${msg}`);
      ctx.checkpoint("compress:execute", "fail", `fixture="${fixture.label}" ${msg}`);
      continue;
    }

    const detectedType = result.detection.method === "auto"
      ? result.detection.detectedAs ?? "unknown"
      : result.detection.specifiedType ?? "unknown";
    ctx.checkpoint(
      "compress:detect_type",
      result.contentType !== "unknown" ? "pass" : "warn",
      `fixture="${fixture.label}" detected=${detectedType} method=${result.detection.method}`,
    );

    const compressOutcome: CheckpointOutcome = result.failed ? "fail" : "pass";
    ctx.checkpoint(
      "compress:execute",
      compressOutcome,
      `fixture="${fixture.label}" ccrId=${result.ccrId} ` +
      `tokensBefore=${result.tokensBefore} tokensAfter=${result.tokensAfter} ` +
      `strategy=${result.strategy}`,
    );
  }

  // ── Phase 3: verify_ccr ─────────────────────────────────────────────────────

  ctx.phase("verify_ccr");

  for (const state of states) {
    const { fixture, result, error } = state;
    if (error || !result) {
      const msg = error ?? "unknown error";
      ctx.checkpoint("compress:original_ref", "fail", `fixture="${fixture.label}" ${msg}`);
      ctx.checkpoint("compress:tokens_saved", "fail", `fixture="${fixture.label}" ${msg}`);
      continue;
    }

    const hasOriginalRef = result.originalRef != null && result.originalRef.length > 0;
    ctx.checkpoint(
      "compress:original_ref",
      hasOriginalRef ? "pass" : "fail",
      `fixture="${fixture.label}" originalRef=${result.originalRef ?? "(none)"}`,
    );

    const tokensSavedValid = typeof result.tokensSaved === "number" && result.tokensSaved >= 0;
    ctx.checkpoint(
      "compress:tokens_saved",
      tokensSavedValid ? "pass" : "fail",
      `fixture="${fixture.label}" tokensSaved=${result.tokensSaved}`,
    );
  }

  // ── Phase 4: retrieve_original ──────────────────────────────────────────────

  ctx.phase("retrieve_original");

  for (const state of states) {
    const { fixture, result, error } = state;
    if (error || !result) {
      ctx.checkpoint("compress:retrieve_original", "skip", `fixture="${fixture.label}" compression failed`);
      ctx.checkpoint("compress:roundtrip_match", "skip", `fixture="${fixture.label}" compression failed`);
      continue;
    }

    const hasOriginalRef = result.originalRef != null && result.originalRef.length > 0;
    if (!hasOriginalRef) {
      ctx.checkpoint("compress:retrieve_original", "skip", "no originalRef, skipping retrieval");
      ctx.checkpoint("compress:roundtrip_match", "skip", "no originalRef, skipping roundtrip");
      continue;
    }

    try {
      const original = await adapter.runRetrieveOriginal(result.ccrId);
      const retrieved = original !== null;

      ctx.checkpoint(
        "compress:retrieve_original",
        retrieved ? "pass" : "fail",
        `fixture="${fixture.label}" ccrId=${result.ccrId} retrieved=${retrieved}`,
      );

      const match = retrieved && original!.content === fixture.content;
      state.roundtripMatch = match;
      ctx.checkpoint(
        "compress:roundtrip_match",
        match ? "pass" : "fail",
        `fixture="${fixture.label}" roundtrip=${match}`,
      );
    } catch (retrieveErr) {
      const msg = retrieveErr instanceof Error ? retrieveErr.message : String(retrieveErr);
      ctx.checkpoint("compress:retrieve_original", "fail", msg);
      ctx.checkpoint("compress:roundtrip_match", "skip", "retrieve failed, skipping roundtrip");
    }
  }

  // ── Phase 5: verify_receipt ─────────────────────────────────────────────────

  ctx.phase("verify_receipt");

  for (const state of states) {
    const { fixture, result, error } = state;
    if (error || !result) {
      const msg = error ?? "unknown error";
      ctx.checkpoint("compress:receipt_exists", "fail", `fixture="${fixture.label}" ${msg}`);
      ctx.checkpoint("compress:receipt_fields", "fail", `fixture="${fixture.label}" ${msg}`);
      continue;
    }

    const receiptExists = result.receiptId != null && result.receiptId.length > 0;
    ctx.checkpoint(
      "compress:receipt_exists",
      receiptExists ? "pass" : "fail",
      `fixture="${fixture.label}" receiptId=${result.receiptId}`,
    );

    const receiptFieldsOk = receiptExists && result.ccrId.length > 0;
    ctx.checkpoint(
      "compress:receipt_fields",
      receiptFieldsOk ? "pass" : "fail",
      `fixture="${fixture.label}" ccrId=${result.ccrId} tokensSaved=${result.tokensSaved}`,
    );
  }

  // ── Phase 6: write_report ───────────────────────────────────────────────────

  ctx.phase("write_report");

  // Build final results from intermediate states
  const results: CompressionFixtureResult[] = states.map((state) => {
    const { fixture, result, error } = state;
    if (error || !result) {
      return {
        label: fixture.label,
        ccrId: "",
        contentType: "unknown",
        strategy: "none",
        compressed: false,
        tokensBefore: 0,
        tokensAfter: 0,
        tokensSaved: 0,
        compressionRatio: 0,
        canRetrieveOriginal: false,
        receiptId: "",
        failed: true,
        errorReason: error ?? "unknown error",
        roundtripMatch: false,
        warnings: [error ?? "unknown error"],
      };
    }

    return {
      label: fixture.label,
      ccrId: result.ccrId,
      contentType: result.contentType,
      strategy: result.strategy,
      compressed: result.compressed,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      tokensSaved: result.tokensSaved,
      compressionRatio: result.compressionRatio,
      originalRef: result.originalRef,
      canRetrieveOriginal: result.canRetrieveOriginal,
      receiptId: result.receiptId,
      failed: result.failed,
      errorReason: result.errorReason,
      roundtripMatch: state.roundtripMatch,
      warnings: result.warnings,
    };
  });

  // List compressions checkpoint
  ctx.checkpoint(
    "compress:list",
    results.length > 0 ? "pass" : "warn",
    `total_ccrs=${results.length}`,
  );

  // Compute aggregate stats
  const totalFixtures = results.length;
  const totalCompressed = results.filter((r) => r.compressed && !r.failed).length;
  const totalFailures = results.filter((r) => r.failed).length;
  const totalTokensBefore = results.reduce((sum, r) => sum + r.tokensBefore, 0);
  const totalTokensAfter = results.reduce((sum, r) => sum + r.tokensAfter, 0);
  const totalTokensSaved = results.reduce((sum, r) => sum + r.tokensSaved, 0);
  const aggregateSavingsPercent = totalTokensBefore > 0
    ? Math.round((totalTokensSaved / totalTokensBefore) * 10000) / 100
    : 0;
  const allOriginalRefsPresent = results.every((r) => r.originalRef != null && r.originalRef.length > 0);
  const allReceiptsPresent = results.every((r) => r.receiptId != null && r.receiptId.length > 0);

  const output: CompressionFlowOutput = {
    totalFixtures,
    totalCompressed,
    totalFailures,
    totalTokensBefore,
    totalTokensAfter,
    totalTokensSaved,
    aggregateSavingsPercent,
    allOriginalRefsPresent,
    allReceiptsPresent,
    results,
  };

  ctx.writeArtifact(
    "compression-results",
    JSON.stringify(results, null, 2),
    "application/json",
  );
  ctx.writeArtifact(
    "compression-report",
    JSON.stringify(output, null, 2),
    "application/json",
  );

  ctx.log(`Compression flow complete: ${totalCompressed}/${totalFixtures} compressed, ${totalFailures} failures`);
  ctx.log(`Aggregate savings: ${aggregateSavingsPercent}% (${totalTokensSaved} tokens saved)`);

  return output;
}
