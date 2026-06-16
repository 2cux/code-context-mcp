/**
 * Originals Flow Manifest
 *
 * Declares the original content lifecycle closed-loop:
 *   compress_with_original → retrieve_before_delete → delete_original →
 *   retrieve_after_delete → verify_canRetrieveOriginal → write_report
 *
 * This is the most critical Harness flow — it directly covers the
 * highest-failure link: original content storage, retrieval, and deletion.
 *
 * PRD §34 / §9.2: 原文取回 / 删除闭环 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const originalsFlowManifest: HarnessManifest = {
  id: "originals-flow",
  name: "Originals Flow",
  description:
    "Exercises the original content retrieval and deletion closed loop: " +
    "compress with original → retrieve → verify → delete → " +
    "confirm retrieval fails → cleanup → write report",
  phases: [
    { name: "compress_with_original", description: "Compress content with original preservation enabled" },
    { name: "retrieve_before_delete", description: "Retrieve and verify original content before deletion" },
    { name: "delete_original", description: "Delete original content by CCR id" },
    { name: "retrieve_after_delete", description: "Attempt retrieval after deletion (expect not-found)" },
    { name: "verify_canRetrieveOriginal", description: "Verify canRetrieveOriginal flag transitions correctly" },
    { name: "write_report", description: "Write aggregate originals flow report artifact" },
  ],
  checkpoints: [
    { name: "originals:compress", description: "Compress content with keepOriginal=true", expect: "pass" },
    { name: "originals:can_retrieve_true", description: "Verify canRetrieveOriginal is true after compression", expect: "pass" },
    { name: "originals:retrieve_before_delete", description: "Retrieve original content before deletion", expect: "pass" },
    { name: "originals:content_match", description: "Verify retrieved content matches input byte-for-byte", expect: "pass" },
    { name: "originals:delete", description: "Delete original content successfully", expect: "pass" },
    { name: "originals:retrieve_after_delete", description: "Attempt retrieval after deletion (should return null — flow passes when retrieval correctly fails)", expect: "pass" },
    { name: "originals:can_retrieve_false", description: "Verify canRetrieveOriginal is false after deletion", expect: "pass" },
    { name: "originals:cleanup", description: "Run batch cleanup of expired originals", expect: "pass" },
  ],
  artifacts: [
    { name: "originals-retrieval-log", description: "Log of retrieve operations and results", contentType: "application/json" },
    { name: "originals-deletion-log", description: "Log of delete operations and results", contentType: "application/json" },
    { name: "originals-report", description: "Aggregate originals flow report", contentType: "application/json" },
  ],
  coversTools: [
    "compress_context",
    "retrieve_original",
    "delete_original",
    "cleanup_originals",
  ],
  tags: ["originals", "acceptance", "mcp", "critical"],
  capability: "originals",
};
