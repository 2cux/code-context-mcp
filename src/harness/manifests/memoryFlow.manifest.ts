/**
 * Memory Flow Manifest
 *
 * Declares the memory lifecycle closed-loop:
 *   remember_project_rule → recall_project_rule → remember_new_rule →
 *   supersede_old_rule → recall_after_supersede → list_context_audit →
 *   write_report
 *
 * PRD §34 / §9.3: 记忆保存 / 召回 / 遗忘闭环 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const memoryFlowManifest: HarnessManifest = {
  id: "memory-flow",
  name: "Memory Flow",
  description:
    "Exercises the full memory lifecycle closed loop: " +
    "remember → recall → supersede → recall after supersede → " +
    "list audit → write report",
  phases: [
    { name: "remember_project_rule", description: "Store a project_rule memory" },
    { name: "recall_project_rule", description: "Recall the stored project_rule by query" },
    { name: "remember_new_rule", description: "Store a newer version of the project_rule" },
    { name: "supersede_old_rule", description: "Supersede the old rule with the new one" },
    { name: "recall_after_supersede", description: "Recall after supersede — old rule excluded, new rule active" },
    { name: "list_context_audit", description: "List all memories and verify lifecycle states" },
    { name: "write_report", description: "Write aggregate memory flow report artifact" },
  ],
  checkpoints: [
    { name: "memory:remember_rule", description: "Store a project_rule memory", expect: "pass" },
    { name: "memory:recall_finds_rule", description: "Recall finds the stored project_rule", expect: "pass" },
    { name: "memory:remember_new_rule", description: "Store a newer version of the rule", expect: "pass" },
    { name: "memory:supersede_old", description: "Supersede old rule — status transitions to superseded", expect: "pass" },
    { name: "memory:recall_excludes_superseded", description: "Recall excludes the superseded rule", expect: "pass" },
    { name: "memory:recall_includes_new", description: "Recall includes the new active rule", expect: "pass" },
    { name: "memory:list_audit", description: "List all memories and verify state consistency", expect: "pass" },
    { name: "memory:forget_hard", description: "Hard-delete a memory and verify it is gone", expect: "pass" },
  ],
  artifacts: [
    { name: "memory-records", description: "Created memory records with lifecycle states", contentType: "application/json" },
    { name: "recall-results", description: "Recall query results per stage", contentType: "application/json" },
    { name: "memory-report", description: "Aggregate memory flow report", contentType: "application/json" },
  ],
  coversTools: [
    "remember_context",
    "recall_context",
    "forget_context",
    "list_context",
  ],
  tags: ["memory", "acceptance", "mcp"],
  capability: "memory",
};
