/**
 * Compression Flow Manifest
 *
 * Declares the compression closed-loop: detect type → compress → store →
 * retrieve original → verify round-trip → list compressions → token stats.
 *
 * PRD §34: 压缩闭环 Manifest。
 */

import type { Manifest } from "../core/types.js";

export const compressionFlowManifest: Manifest = {
  name: "compressionFlow",
  description: "Exercises the full compression closed loop across all content types",
  loopType: "compression",
  tags: ["compression", "smoke", "closed-loop"],
  steps: [
    { name: "scope", description: "Resolve current scope", expect: "success" },
    { name: "detect_and_compress_all_types", description: "Detect content type and compress for each fixture type", expect: "success" },
    { name: "retrieve_original", description: "Retrieve original content for each compression", expect: "success" },
    { name: "verify_roundtrip", description: "Verify retrieved original matches input", expect: "success" },
    { name: "list_compressions", description: "List all compressed context records", expect: "success" },
    { name: "token_stats", description: "Verify token statistics are recorded", expect: "success" },
  ],
};
