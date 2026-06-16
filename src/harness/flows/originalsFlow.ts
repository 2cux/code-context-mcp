/**
 * Originals Closed-Loop Flow
 *
 * Exercises the original content retrieval and deletion loop:
 *   compress with original → retrieve before delete → delete original →
 *   retrieve after delete (expect null) → verify canRetrieveOriginal →
 *   cleanup → write report
 *
 * This is the most critical Harness flow — it directly covers the
 * highest-failure link: original content storage, retrieval, and deletion.
 *
 * PRD §34 / §9.2: 原文取回 / 删除闭环。
 */

import type { HarnessContext } from "../core/types.js";
import type { CodeContextAdapter } from "../adapters/codeContextAdapter.js";

// ── Input Types ────────────────────────────────────────────────────────────────

export interface OriginalsFlowInput {
  adapter: CodeContextAdapter;
  /** Test content to use for the originals lifecycle test. */
  testContent: string;
  /** Optional content type hint. */
  contentType?: string;
}

// ── Output Types ───────────────────────────────────────────────────────────────

export interface OriginalsFlowOutput {
  ccrId: string;
  originalRef: string;
  canRetrieveBeforeDelete: boolean;
  retrievedBeforeDelete: boolean;
  contentMatchBeforeDelete: boolean;
  deleteSucceeded: boolean;
  retrievedAfterDelete: boolean;
  canRetrieveAfterDelete: boolean;
  cleanupRan: boolean;
  passed: boolean;
}

// ── Flow Implementation ────────────────────────────────────────────────────────

export async function originalsFlow(
  ctx: HarnessContext<OriginalsFlowInput>,
): Promise<OriginalsFlowOutput> {
  const { adapter, testContent, contentType } = ctx.input;
  const retrievalLog: Array<{ stage: string; success: boolean; match?: boolean; error?: string }> = [];
  const deletionLog: Array<{ stage: string; success: boolean; error?: string }> = [];

  let ccrId = "";
  let originalRef = "";
  let canRetrieveBeforeDelete = false;
  let retrievedBeforeDelete = false;
  let contentMatchBeforeDelete = false;
  let deleteSucceeded = false;
  let retrievedAfterDelete = false;
  let canRetrieveAfterDelete = false;
  let cleanupRan = false;

  // ── Phase 1: compress_with_original ─────────────────────────────────────────

  ctx.phase("compress_with_original");
  ctx.log("Compressing content with keepOriginal=true...");

  try {
    const result = await adapter.runCompressContext(testContent, {
      contentType,
      strategy: "conservative",
      keepOriginal: true,
    });

    ccrId = result.ccrId;
    originalRef = result.originalRef ?? "";

    ctx.checkpoint(
      "originals:compress",
      result.failed ? "fail" : "pass",
      `ccrId=${ccrId} contentType=${result.contentType} strategy=${result.strategy}`,
    );

    canRetrieveBeforeDelete = result.canRetrieveOriginal;
    ctx.checkpoint(
      "originals:can_retrieve_true",
      canRetrieveBeforeDelete ? "pass" : "fail",
      `canRetrieveOriginal=${canRetrieveBeforeDelete} originalRef=${originalRef}`,
    );

    ctx.log(`Compressed: ccrId=${ccrId}, canRetrieveOriginal=${canRetrieveBeforeDelete}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("originals:compress", "fail", msg);
    ctx.checkpoint("originals:can_retrieve_true", "fail", `compression failed: ${msg}`);
    ctx.log(`Compression failed: ${msg}`);

    return {
      ccrId: "", originalRef: "",
      canRetrieveBeforeDelete: false, retrievedBeforeDelete: false,
      contentMatchBeforeDelete: false, deleteSucceeded: false,
      retrievedAfterDelete: false, canRetrieveAfterDelete: false,
      cleanupRan: false, passed: false,
    };
  }

  // ── Phase 2: retrieve_before_delete ─────────────────────────────────────────

  ctx.phase("retrieve_before_delete");
  ctx.log("Retrieving original content before deletion...");

  try {
    const original = await adapter.runRetrieveOriginal(ccrId);
    retrievedBeforeDelete = original !== null;

    ctx.checkpoint(
      "originals:retrieve_before_delete",
      retrievedBeforeDelete ? "pass" : "fail",
      `ccrId=${ccrId} retrieved=${retrievedBeforeDelete}`,
    );
    retrievalLog.push({ stage: "before_delete", success: retrievedBeforeDelete });

    if (retrievedBeforeDelete && original) {
      contentMatchBeforeDelete = original.content === testContent;
      ctx.checkpoint(
        "originals:content_match",
        contentMatchBeforeDelete ? "pass" : "fail",
        `byteMatch=${contentMatchBeforeDelete}`,
      );
      retrievalLog.push({ stage: "before_delete_match", success: contentMatchBeforeDelete, match: contentMatchBeforeDelete });
    } else {
      ctx.checkpoint("originals:content_match", "skip", "retrieval failed, skipping content match");
      retrievalLog.push({ stage: "before_delete_match", success: false, error: "no content to compare" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("originals:retrieve_before_delete", "fail", msg);
    ctx.checkpoint("originals:content_match", "skip", "retrieve threw, skipping match");
    retrievalLog.push({ stage: "before_delete", success: false, error: msg });
  }

  // ── Phase 3: delete_original ────────────────────────────────────────────────

  ctx.phase("delete_original");
  ctx.log("Deleting original content...");

  try {
    deleteSucceeded = await adapter.runDeleteOriginal(ccrId);
    ctx.checkpoint(
      "originals:delete",
      deleteSucceeded ? "pass" : "fail",
      `ccrId=${ccrId} deleted=${deleteSucceeded}`,
    );
    deletionLog.push({ stage: "delete", success: deleteSucceeded });
    ctx.log(`Delete result: ${deleteSucceeded}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("originals:delete", "fail", msg);
    deletionLog.push({ stage: "delete", success: false, error: msg });
    ctx.log(`Delete failed: ${msg}`);
  }

  // ── Phase 4: retrieve_after_delete ──────────────────────────────────────────

  ctx.phase("retrieve_after_delete");
  ctx.log("Attempting retrieval after deletion (should return null)...");

  try {
    const afterDelete = await adapter.runRetrieveOriginal(ccrId);
    retrievedAfterDelete = afterDelete !== null;

    // Expected: retrieval should FAIL (return null) after deletion.
    // retrievedAfterDelete=true means content is still retrievable → bad (flow step fails)
    // retrievedAfterDelete=false means content is gone → good (flow step passes)
    ctx.checkpoint(
      "originals:retrieve_after_delete",
      retrievedAfterDelete ? "fail" : "pass",
      `ccrId=${ccrId} stillRetrievable=${retrievedAfterDelete} (expected: false)`,
    );
    retrievalLog.push({ stage: "after_delete", success: !retrievedAfterDelete });

    // Verify canRetrieveOriginal is now false
    // We do this by checking if runRetrieveOriginal returns null
    canRetrieveAfterDelete = !retrievedAfterDelete;
    ctx.checkpoint(
      "originals:can_retrieve_false",
      canRetrieveAfterDelete ? "pass" : "fail",
      `canRetrieveAfterDelete=${canRetrieveAfterDelete}`,
    );
    retrievalLog.push({ stage: "can_retrieve_check", success: canRetrieveAfterDelete });

    ctx.log(`After-delete retrieval: retrieved=${retrievedAfterDelete}, canRetrieve=${canRetrieveAfterDelete}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("originals:retrieve_after_delete", "fail", msg);
    ctx.checkpoint("originals:can_retrieve_false", "fail", msg);
    retrievalLog.push({ stage: "after_delete", success: false, error: msg });
  }

  // ── Phase 5: verify_canRetrieveOriginal ─────────────────────────────────────

  ctx.phase("verify_canRetrieveOriginal");
  ctx.log("Verifying canRetrieveOriginal flag transition...");

  // The flag was verified in Phase 4. This phase is a logical grouping.
  ctx.log(
    `canRetrieveOriginal: before=${canRetrieveBeforeDelete} → after=${canRetrieveAfterDelete}`,
  );

  // ── Phase 6: write_report ───────────────────────────────────────────────────

  ctx.phase("write_report");

  // Run cleanup — exercises the cleanup_originals MCP tool path
  try {
    const cleanupResult = adapter.runCleanupOriginals();
    cleanupRan = cleanupResult.deleted >= 0; // 0 deleted is also valid (nothing expired)
    ctx.checkpoint(
      "originals:cleanup",
      "pass",
      `deleted=${cleanupResult.deleted} affectedCcrIds=${cleanupResult.affectedCcrIds.length}`,
    );
    ctx.log(`Cleanup complete: ${cleanupResult.deleted} deleted, ${cleanupResult.affectedCcrIds.length} CCRs affected`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    cleanupRan = false;
    ctx.checkpoint("originals:cleanup", "fail", msg);
  }

  const overallPassed = canRetrieveBeforeDelete && contentMatchBeforeDelete &&
    deleteSucceeded && canRetrieveAfterDelete;

  const output: OriginalsFlowOutput = {
    ccrId,
    originalRef,
    canRetrieveBeforeDelete,
    retrievedBeforeDelete,
    contentMatchBeforeDelete,
    deleteSucceeded,
    retrievedAfterDelete,
    canRetrieveAfterDelete,
    cleanupRan,
    passed: overallPassed,
  };

  ctx.writeArtifact(
    "originals-retrieval-log",
    JSON.stringify(retrievalLog, null, 2),
    "application/json",
  );
  ctx.writeArtifact(
    "originals-deletion-log",
    JSON.stringify(deletionLog, null, 2),
    "application/json",
  );
  ctx.writeArtifact(
    "originals-report",
    JSON.stringify(output, null, 2),
    "application/json",
  );

  ctx.log(`Originals flow complete: passed=${overallPassed}`);
  return output;
}
