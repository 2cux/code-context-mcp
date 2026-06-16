/**
 * Compression Flow Manifest
 *
 * Declares the compression closed-loop:
 *   resolve_scope → compress_input → verify_ccr → retrieve_original →
 *   verify_receipt → write_report
 *
 * Verifies:
 *   - Compression success
 *   - originalRef generation
 *   - tokensSaved correctness
 *   - Original retrievability
 *   - Receipt completeness
 *
 * PRD §34 / §9.1: 压缩闭环 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const compressionFlowManifest: HarnessManifest = {
  id: "compression-flow",
  name: "Compression Flow",
  description:
    "Exercises the full compression closed loop: " +
    "resolve scope → compress input → verify CCR → retrieve original → " +
    "verify receipt → write report",
  phases: [
    { name: "resolve_scope", description: "Resolve current repository scope" },
    { name: "compress_input", description: "Detect content type and compress test fixtures" },
    { name: "verify_ccr", description: "Verify compressed context record integrity" },
    { name: "retrieve_original", description: "Retrieve original content for each compression" },
    { name: "verify_receipt", description: "Verify receipt completeness and correctness" },
    { name: "write_report", description: "Write aggregate compression report artifact" },
  ],
  checkpoints: [
    { name: "compress:resolve_scope", description: "Resolve current scope successfully", expect: "pass" },
    { name: "compress:detect_type", description: "Detect content type for test fixtures", expect: "pass" },
    { name: "compress:execute", description: "Compress content and produce valid output", expect: "pass" },
    { name: "compress:original_ref", description: "Verify originalRef is generated and non-empty", expect: "pass" },
    { name: "compress:tokens_saved", description: "Verify tokensSaved > 0 and is a valid number", expect: "pass" },
    { name: "compress:retrieve_original", description: "Retrieve original content by CCR id", expect: "pass" },
    { name: "compress:roundtrip_match", description: "Verify retrieved original matches input byte-for-byte", expect: "pass" },
    { name: "compress:receipt_exists", description: "Verify receipt was created for compression", expect: "pass" },
    { name: "compress:receipt_fields", description: "Verify receipt contains required fields", expect: "pass" },
    { name: "compress:list", description: "List all compressed context records", expect: "pass" },
  ],
  artifacts: [
    { name: "compression-results", description: "Per-fixture compression results", contentType: "application/json" },
    { name: "compression-report", description: "Aggregate compression flow report", contentType: "application/json" },
  ],
  coversTools: [
    "current_scope",
    "compress_context",
    "retrieve_original",
    "list_compressions",
    "get_receipt",
  ],
  tags: ["compression", "acceptance", "mcp"],
  capability: "compression",
};
