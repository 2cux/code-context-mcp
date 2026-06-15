/**
 * Profile Flow Manifest
 *
 * Declares the profile management closed-loop:
 * read profile → write facts → read back → verify.
 *
 * PRD §34: profile 闭环 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const profileFlowManifest: HarnessManifest = {
  id: "profile-flow",
  name: "Profile Flow",
  description:
    "Exercises the repo profile static/dynamic closed loop: " +
    "read → update → verify persistence",
  phases: [
    { name: "setup", description: "Resolve scope" },
    { name: "read", description: "Read static and dynamic profile facts" },
    { name: "update", description: "Update static and dynamic profile facts" },
    { name: "verify", description: "Re-read and verify updates persisted" },
  ],
  checkpoints: [
    { name: "profile:current_scope", description: "Resolve current scope", expect: "pass" },
    { name: "profile:read_static", description: "Read static profile facts", expect: "pass" },
    { name: "profile:update_static", description: "Update a static profile fact", expect: "pass" },
    { name: "profile:read_dynamic", description: "Read dynamic profile facts", expect: "pass" },
    { name: "profile:update_dynamic", description: "Update a dynamic profile fact", expect: "pass" },
    { name: "profile:verify_persistence", description: "Re-read and verify updates persisted", expect: "pass" },
  ],
  artifacts: [
    { name: "profile-snapshot", description: "Full profile snapshot after updates", contentType: "application/json" },
  ],
  coversTools: [
    "current_scope",
    "analyze_context",
    "remember_context",
    "recall_context",
    "get_receipt",
  ],
};
