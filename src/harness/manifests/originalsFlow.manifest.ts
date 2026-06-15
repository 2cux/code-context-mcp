/**
 * Originals Flow Manifest
 *
 * Declares the original content lifecycle closed-loop:
 * store original → retrieve → verify → delete → verify deletion.
 *
 * PRD §34: 原文取回 / 删除闭环 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const originalsFlowManifest: HarnessManifest = {
  id: "originals-flow",
  name: "Originals Flow",
  description:
    "Exercises the original content retrieval and deletion closed loop: " +
    "compress → retrieve original → verify match → delete → confirm deletion → cleanup",
  phases: [
    { name: "setup", description: "Resolve scope and prepare test content" },
    { name: "store", description: "Compress content with original preservation" },
    { name: "retrieve", description: "Retrieve and verify original content" },
    { name: "delete", description: "Delete original and confirm removal" },
    { name: "cleanup", description: "Batch cleanup of expired originals" },
  ],
  checkpoints: [
    { name: "originals:compress_with_original", description: "Compress content with original preservation", expect: "pass" },
    { name: "originals:retrieve_original", description: "Retrieve original by CCR ID", expect: "pass" },
    { name: "originals:verify_match", description: "Verify retrieved original matches input byte-for-byte", expect: "pass" },
    { name: "originals:delete_original", description: "Delete original content", expect: "pass" },
    { name: "originals:confirm_deletion", description: "Confirm retrieval returns not-found after deletion", expect: "fail" },
    { name: "originals:cleanup", description: "Run batch cleanup of expired originals", expect: "pass" },
  ],
  artifacts: [
    { name: "originals-retrieval-log", description: "Log of retrieve operations and results", contentType: "application/json" },
    { name: "originals-deletion-log", description: "Log of delete operations and results", contentType: "application/json" },
  ],
  coversTools: [
    "current_scope",
    "compress_context",
    "retrieve_original",
    "delete_original",
    "cleanup_originals",
    "get_receipt",
  ],
};
