/**
 * Memory Flow Manifest
 *
 * Declares the memory lifecycle closed-loop: remember → recall (FTS) →
 * list → forget (supersede) → recall (excluded) → hard delete.
 *
 * PRD §34: 记忆保存 / 召回 / 遗忘闭环 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const memoryFlowManifest: HarnessManifest = {
  id: "memory-flow",
  name: "Memory Flow",
  description:
    "Exercises the full memory lifecycle closed loop: " +
    "remember → recall → list → forget → recall (excluded) → hard delete",
  phases: [
    { name: "setup", description: "Resolve scope and prepare memory fixtures" },
    { name: "remember", description: "Store fact and decision memories" },
    { name: "recall", description: "Recall memories via FTS" },
    { name: "list", description: "List all active memories" },
    { name: "forget", description: "Supersede and hard-delete memories" },
    { name: "verify", description: "Verify recall excludes forgotten memories" },
  ],
  checkpoints: [
    { name: "memory:remember_fact", description: "Store a fact-type memory", expect: "pass" },
    { name: "memory:remember_decision", description: "Store a decision-type memory", expect: "pass" },
    { name: "memory:recall_fts", description: "Recall memories via FTS", expect: "pass" },
    { name: "memory:list_active", description: "List all active memories", expect: "pass" },
    { name: "memory:forget_supersede", description: "Supersede a memory", expect: "pass" },
    { name: "memory:recall_excludes_superseded", description: "Recall excludes superseded memories", expect: "pass" },
    { name: "memory:forget_hard_delete", description: "Hard delete a memory", expect: "pass" },
    { name: "memory:recall_excludes_deleted", description: "Recall excludes hard-deleted memories", expect: "pass" },
  ],
  artifacts: [
    { name: "memory-records", description: "Created memory records", contentType: "application/json" },
    { name: "recall-results", description: "Recall query results per stage", contentType: "application/json" },
  ],
  coversTools: [
    "current_scope",
    "remember_context",
    "recall_context",
    "forget_context",
    "list_context",
    "get_receipt",
  ],
  tags: ["memory", "acceptance", "mcp"],
  capability: "memory",
};
