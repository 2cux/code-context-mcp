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

import type { Manifest } from "../core/types.js";

export const fullContextFlowManifest: Manifest = {
  name: "fullContextFlow",
  description: "Complete compression + memory acceptance across all content types and lifecycle stages",
  loopType: "fullContext",
  tags: ["full", "acceptance", "closed-loop"],
  steps: [
    { name: "scope", description: "Resolve current scope", expect: "success" },
    { name: "compress_all_types", description: "Compress all 9 content types", expect: "success" },
    { name: "verify_all_compressions", description: "Verify every compression produced valid output", expect: "success" },
    { name: "retrieve_all_originals", description: "Retrieve originals for all compressions", expect: "success" },
    { name: "remember_all_categories", description: "Store memories across all categories", expect: "success" },
    { name: "recall_each", description: "Recall each memory by query", expect: "success" },
    { name: "forget_and_verify", description: "Forget memories and verify exclusion", expect: "success" },
    { name: "profile_read_write", description: "Read and update profile facts", expect: "success" },
    { name: "receipt_audit", description: "Verify run receipt covers all sub-receipts", expect: "success" },
    { name: "stats_consistency", description: "Verify token stats are consistent with receipts", expect: "success" },
  ],
};
