/**
 * Originals Flow Manifest
 *
 * Declares the originals closed-loop: compress → retrieve original →
 * verify match → delete original → confirm deletion → cleanup.
 *
 * PRD §34: 原文取回 / 删除闭环 Manifest。
 */

import type { Manifest } from "../core/types.js";

export const originalsFlowManifest: Manifest = {
  name: "originalsFlow",
  description: "Exercises the original content retrieval and deletion closed loop",
  loopType: "originals",
  tags: ["originals", "smoke", "closed-loop"],
  steps: [
    { name: "compress_with_original", description: "Compress content with original preservation", expect: "success" },
    { name: "retrieve_original", description: "Retrieve original by CCR ID", expect: "success" },
    { name: "verify_match", description: "Verify retrieved original matches input byte-for-byte", expect: "success" },
    { name: "delete_original", description: "Delete original content", expect: "success" },
    { name: "confirm_deletion", description: "Confirm retrieval returns 404 after deletion", expect: "failure" },
    { name: "cleanup_originals", description: "Run batch cleanup of expired originals", expect: "success" },
  ],
};
