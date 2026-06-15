/**
 * Compression Flow Manifest
 *
 * Declares the compression closed-loop: detect type → compress → store →
 * retrieve original → verify round-trip → list compressions → token stats.
 *
 * PRD §34: 压缩闭环 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const compressionFlowManifest: HarnessManifest = {
  id: "compression-flow",
  name: "Compression Flow",
  description:
    "Exercises the full compression closed loop across all content types: " +
    "detect → compress → store → retrieve original → verify round-trip → " +
    "list compressions → token stats",
  phases: [
    { name: "setup", description: "Resolve scope and prepare fixtures" },
    { name: "compress", description: "Detect content type and compress each fixture type" },
    { name: "retrieve", description: "Retrieve original content for each compression" },
    { name: "verify", description: "Verify round-trip: retrieved original matches input" },
  ],
  checkpoints: [
    { name: "compress:scope", description: "Resolve current scope", expect: "pass" },
    { name: "compress:detect_and_compress", description: "Detect type and compress for each fixture", expect: "pass" },
    { name: "compress:retrieve_original", description: "Retrieve original for each compression", expect: "pass" },
    { name: "compress:verify_roundtrip", description: "Verify retrieved original matches input", expect: "pass" },
    { name: "compress:list", description: "List all compressed context records", expect: "pass" },
    { name: "compress:token_stats", description: "Verify token statistics are recorded", expect: "pass" },
  ],
  artifacts: [
    { name: "compression-results", description: "Compression output per content type", contentType: "application/json" },
    { name: "roundtrip-diff", description: "Diff between original and retrieved content", contentType: "text/plain" },
  ],
  coversTools: [
    "current_scope",
    "compress_context",
    "retrieve_original",
    "delete_original",
    "list_compressions",
    "get_receipt",
  ],
};
