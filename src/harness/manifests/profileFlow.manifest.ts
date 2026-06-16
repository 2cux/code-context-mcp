/**
 * Profile Flow Manifest
 *
 * Declares the repo profile closed-loop:
 *   save_static_fact → save_dynamic_context → recall_with_profile →
 *   verify_static_profile → verify_dynamic_profile → write_report
 *
 * PRD §34 / §9.4: profile 闭环 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const profileFlowManifest: HarnessManifest = {
  id: "profile-flow",
  name: "Profile Flow",
  description:
    "Exercises the repo profile static/dynamic closed loop: " +
    "save static fact → save dynamic context → recall with profile → " +
    "verify static → verify dynamic → write report",
  phases: [
    { name: "save_static_fact", description: "Store a static profile fact (e.g. framework, language)" },
    { name: "save_dynamic_context", description: "Store dynamic context (e.g. current task, recent decisions)" },
    { name: "recall_with_profile", description: "Recall memories with profile enrichment" },
    { name: "verify_static_profile", description: "Re-read and verify static facts persisted correctly" },
    { name: "verify_dynamic_profile", description: "Re-read and verify dynamic context persisted correctly" },
    { name: "write_report", description: "Write aggregate profile flow report artifact" },
  ],
  checkpoints: [
    { name: "profile:save_static_fact", description: "Save a static profile fact via remember_context", expect: "pass" },
    { name: "profile:save_dynamic_context", description: "Save dynamic context via remember_context", expect: "pass" },
    { name: "profile:recall_enriched", description: "Recall returns results enriched with profile context", expect: "pass" },
    { name: "profile:verify_static", description: "Verify static fact is retrievable and unchanged", expect: "pass" },
    { name: "profile:verify_dynamic", description: "Verify dynamic context is retrievable and unchanged", expect: "pass" },
    { name: "profile:list_context", description: "List all context records for audit", expect: "pass" },
  ],
  artifacts: [
    { name: "profile-snapshot", description: "Full profile snapshot before and after updates", contentType: "application/json" },
    { name: "profile-report", description: "Aggregate profile flow report", contentType: "application/json" },
  ],
  coversTools: [
    "remember_context",
    "recall_context",
    "list_context",
  ],
  tags: ["profile", "acceptance", "mcp"],
  capability: "profile",
};
