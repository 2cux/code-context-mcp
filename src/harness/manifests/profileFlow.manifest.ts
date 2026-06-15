/**
 * Profile Flow Manifest
 *
 * Declares the profile closed-loop: current_scope → read static →
 * update static → read dynamic → update dynamic → verify persistence.
 *
 * PRD §34: profile 闭环 Manifest。
 */

import type { Manifest } from "../core/types.js";

export const profileFlowManifest: Manifest = {
  name: "profileFlow",
  description: "Exercises the repo profile static/dynamic closed loop",
  loopType: "profile",
  tags: ["profile", "smoke", "closed-loop"],
  steps: [
    { name: "current_scope", description: "Resolve current scope", expect: "success" },
    { name: "read_static_profile", description: "Read static profile facts", expect: "success" },
    { name: "update_static_profile", description: "Update a static profile fact", expect: "success" },
    { name: "read_dynamic_profile", description: "Read dynamic profile facts", expect: "success" },
    { name: "update_dynamic_profile", description: "Update a dynamic profile fact", expect: "success" },
    { name: "verify_persistence", description: "Re-read and verify updates persisted", expect: "success" },
  ],
};
