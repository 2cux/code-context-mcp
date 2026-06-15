/**
 * Memory Flow Manifest
 *
 * Declares the memory lifecycle closed-loop: remember → recall (FTS) →
 * list → forget (supersede) → recall (excluded) → hard delete.
 *
 * PRD §34: 记忆保存 / 召回 / 遗忘闭环 Manifest。
 */

import type { Manifest } from "../core/types.js";

export const memoryFlowManifest: Manifest = {
  name: "memoryFlow",
  description: "Exercises the full memory lifecycle closed loop",
  loopType: "memory",
  tags: ["memory", "smoke", "closed-loop"],
  steps: [
    { name: "remember_fact", description: "Store a fact-type memory", expect: "success" },
    { name: "remember_decision", description: "Store a decision-type memory", expect: "success" },
    { name: "recall_fts", description: "Recall memories via FTS", expect: "success" },
    { name: "list_context", description: "List all active memories", expect: "success" },
    { name: "forget_supersede", description: "Supersede a memory", expect: "success" },
    { name: "recall_excludes_superseded", description: "Recall should exclude superseded memories", expect: "success" },
    { name: "forget_hard_delete", description: "Hard delete a memory", expect: "success" },
    { name: "recall_excludes_deleted", description: "Recall should exclude hard-deleted memories", expect: "success" },
  ],
};
