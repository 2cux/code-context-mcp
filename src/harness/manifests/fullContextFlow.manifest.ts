/**
 * Full Context Flow Manifest
 *
 * Declares the complete compression + memory acceptance closed-loop.
 * This is the final acceptance flow — it exercises the entire main
 * value chain end-to-end.
 *
 * Covers: current_scope → compress_context → retrieve_original →
 *         remember_context → recall_context → forget_context →
 *         list_context → get_receipt
 *
 * PRD §34 / §9.5: 完整压缩 + 记忆验收 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const fullContextFlowManifest: HarnessManifest = {
  id: "full-context-flow",
  name: "Full Context Flow",
  description:
    "Complete compression + memory acceptance across the full value chain — " +
    "the final acceptance flow that exercises every major capability",
  phases: [
    { name: "resolve_scope", description: "Resolve current repository scope" },
    { name: "compress_test_output", description: "Compress a test_output fixture end-to-end" },
    { name: "retrieve_original", description: "Retrieve original content for the compression" },
    { name: "save_test_failure_as_memory", description: "Save compression result as test_failure memory" },
    { name: "recall_related_memory", description: "Recall memories related to the test failure" },
    { name: "verify_related_compressed_context", description: "Verify recalled memory links to compressed context" },
    { name: "supersede_memory", description: "Supersede the old memory with updated context" },
    { name: "list_audit", description: "List all context and verify audit trail" },
    { name: "verify_receipts", description: "Cross-reference all operation receipts" },
    { name: "write_final_report", description: "Write the final acceptance report" },
  ],
  checkpoints: [
    { name: "full:scope", description: "Resolve current scope", expect: "pass" },
    { name: "full:compress", description: "Compress test_output fixture", expect: "pass" },
    { name: "full:compress_valid", description: "Verify compression output is valid", expect: "pass" },
    { name: "full:retrieve_original", description: "Retrieve original content for compression", expect: "pass" },
    { name: "full:original_match", description: "Verify retrieved original matches input", expect: "pass" },
    { name: "full:remember_failure", description: "Save test failure as memory", expect: "pass" },
    { name: "full:recall_finds_memory", description: "Recall finds the saved memory", expect: "pass" },
    { name: "full:memory_links_ccr", description: "Verify memory references the compressed context", expect: "pass" },
    { name: "full:supersede", description: "Supersede memory with updated context", expect: "pass" },
    { name: "full:recall_excludes_old", description: "Recall excludes superseded memory", expect: "pass" },
    { name: "full:list_audit", description: "List context shows correct lifecycle states", expect: "pass" },
    { name: "full:receipt_cross_ref", description: "Cross-reference receipts for all operations", expect: "pass" },
    { name: "full:receipt_complete", description: "Verify run receipt covers all sub-receipts", expect: "pass" },
  ],
  artifacts: [
    { name: "full-compression-results", description: "Compression output for test_output fixture", contentType: "application/json" },
    { name: "full-memory-records", description: "All memory records created during the flow", contentType: "application/json" },
    { name: "full-receipt-audit", description: "Receipt audit cross-reference", contentType: "application/json" },
    { name: "full-final-report", description: "Final acceptance report", contentType: "application/json" },
  ],
  coversTools: [
    "current_scope",
    "compress_context",
    "retrieve_original",
    "remember_context",
    "recall_context",
    "forget_context",
    "list_context",
    "get_receipt",
  ],
  tags: ["compression", "memory", "acceptance", "full", "mcp"],
  capability: "full-context",
};
