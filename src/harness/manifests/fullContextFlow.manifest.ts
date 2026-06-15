/**
 * Full Context Flow Manifest
 *
 * Declares the complete compression + memory acceptance closed-loop.
 * This is the most comprehensive acceptance flow — it exercises every
 * content type, every compression strategy, every memory lifecycle stage,
 * and every audit path.
 *
 * PRD §34: 完整压缩 + 记忆验收 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const fullContextFlowManifest: HarnessManifest = {
  id: "full-context-flow",
  name: "Full Context Flow",
  description:
    "Complete compression + memory acceptance across all content types " +
    "and lifecycle stages — the most comprehensive acceptance flow",
  phases: [
    { name: "setup", description: "Resolve scope and prepare all fixtures" },
    { name: "compress", description: "Compress all 9 content types" },
    { name: "verify_compression", description: "Verify every compression produced valid output" },
    { name: "retrieve", description: "Retrieve originals for all compressions" },
    { name: "remember", description: "Store memories across all categories" },
    { name: "recall", description: "Recall each memory by query" },
    { name: "forget", description: "Forget memories and verify exclusion" },
    { name: "profile", description: "Read and update profile facts" },
    { name: "audit", description: "Verify run receipt covers all sub-receipts" },
  ],
  checkpoints: [
    { name: "full:scope", description: "Resolve current scope", expect: "pass" },
    { name: "full:compress_all", description: "Compress all 9 content types", expect: "pass" },
    { name: "full:verify_compressions", description: "Verify every compression produced valid output", expect: "pass" },
    { name: "full:retrieve_all", description: "Retrieve originals for all compressions", expect: "pass" },
    { name: "full:remember_all", description: "Store memories across all categories", expect: "pass" },
    { name: "full:recall_each", description: "Recall each memory by query", expect: "pass" },
    { name: "full:forget_verify", description: "Forget memories and verify exclusion", expect: "pass" },
    { name: "full:profile_rw", description: "Read and update profile facts", expect: "pass" },
    { name: "full:receipt_audit", description: "Verify run receipt covers all sub-receipts", expect: "pass" },
    { name: "full:stats_consistency", description: "Verify token stats are consistent with receipts", expect: "pass" },
  ],
  artifacts: [
    { name: "full-compression-results", description: "Compression output for all content types", contentType: "application/json" },
    { name: "full-memory-records", description: "All memory records created", contentType: "application/json" },
    { name: "full-receipt-audit", description: "Receipt audit cross-reference", contentType: "application/json" },
  ],
  coversTools: [
    "current_scope",
    "compress_context",
    "retrieve_original",
    "delete_original",
    "list_compressions",
    "remember_context",
    "recall_context",
    "forget_context",
    "list_context",
    "analyze_context",
    "cleanup_originals",
    "list_failures",
    "failure_stats",
    "get_receipt",
  ],
  tags: ["compression", "memory", "profile", "acceptance", "full", "mcp"],
  capability: "full-context",
};
