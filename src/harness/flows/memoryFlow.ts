/**
 * Memory Closed-Loop Flow
 *
 * Exercises the memory lifecycle loop:
 *   remember project_rule → recall → remember new rule → supersede old →
 *   recall after supersede → list audit → forget hard → write report
 *
 * PRD §34 / §9.3: 记忆保存 / 召回 / 遗忘闭环。
 */

import type { HarnessContext } from "../core/types.js";
import type { CodeContextAdapter, RememberResult, ForgetResult } from "../adapters/codeContextAdapter.js";

// ── Input Types ────────────────────────────────────────────────────────────────

export interface MemoryFlowInput {
  adapter: CodeContextAdapter;
}

// ── Output Types ───────────────────────────────────────────────────────────────

export interface MemoryOperationRecord {
  operation: "remember" | "recall" | "forget" | "list";
  memoryId?: string;
  memoryType?: string;
  status?: string;
  recallCount?: number;
  supersededBy?: string;
  error?: string;
}

export interface MemoryFlowOutput {
  totalOperations: number;
  remembered: number;
  recalled: number;
  forgotten: number;
  failures: number;
  results: MemoryOperationRecord[];
}

// ── Flow Implementation ────────────────────────────────────────────────────────

export async function memoryFlow(
  ctx: HarnessContext<MemoryFlowInput>,
): Promise<MemoryFlowOutput> {
  const { adapter } = ctx.input;
  const records: MemoryOperationRecord[] = [];
  let remembered = 0;
  let recalled = 0;
  let forgotten = 0;
  let failures = 0;

  let oldRuleId = "";
  let newRuleId = "";

  // ── Phase 1: remember_project_rule ───────────────────────────────────────────

  ctx.phase("remember_project_rule");
  ctx.log("Storing initial project_rule memory...");

  try {
    const result: RememberResult = adapter.runRememberContext(
      "Always use TypeScript strict mode for all source files",
      "project_rule",
      ["typescript", "strict"],
    );
    oldRuleId = result.memoryId;

    ctx.checkpoint(
      "memory:remember_rule",
      "pass",
      `memoryId=${result.memoryId} type=${result.type} status=${result.status}`,
    );
    records.push({
      operation: "remember",
      memoryId: result.memoryId,
      memoryType: result.type,
      status: result.status,
    });
    remembered++;
    ctx.log(`Stored project_rule: ${result.memoryId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("memory:remember_rule", "fail", msg);
    records.push({ operation: "remember", error: msg });
    failures++;
    ctx.log(`Remember failed: ${msg}`);
  }

  // ── Phase 2: recall_project_rule ─────────────────────────────────────────────

  ctx.phase("recall_project_rule");
  ctx.log("Recalling the stored project_rule...");

  try {
    const recallResult = adapter.runRecallContext("TypeScript strict mode", 10);
    const foundOld = recallResult.items.some((item) => item.id === oldRuleId);

    ctx.checkpoint(
      "memory:recall_finds_rule",
      foundOld ? "pass" : "fail",
      `found=${foundOld} total=${recallResult.total}`,
    );
    records.push({
      operation: "recall",
      memoryId: oldRuleId,
      recallCount: recallResult.total,
    });
    recalled++;
    ctx.log(`Recall returned ${recallResult.total} results, found target: ${foundOld}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("memory:recall_finds_rule", "fail", msg);
    records.push({ operation: "recall", error: msg });
    failures++;
  }

  // ── Phase 3: remember_new_rule ───────────────────────────────────────────────

  ctx.phase("remember_new_rule");
  ctx.log("Storing updated project_rule...");

  try {
    const result: RememberResult = adapter.runRememberContext(
      "Always use TypeScript strict mode with noUncheckedIndexAccess for all source files",
      "project_rule",
      ["typescript", "strict", "noUncheckedIndexAccess"],
    );
    newRuleId = result.memoryId;

    ctx.checkpoint(
      "memory:remember_new_rule",
      "pass",
      `memoryId=${result.memoryId} type=${result.type} status=${result.status}`,
    );
    records.push({
      operation: "remember",
      memoryId: result.memoryId,
      memoryType: result.type,
      status: result.status,
    });
    remembered++;
    ctx.log(`Stored new project_rule: ${result.memoryId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("memory:remember_new_rule", "fail", msg);
    records.push({ operation: "remember", error: msg });
    failures++;
  }

  // ── Phase 4: supersede_old_rule ──────────────────────────────────────────────

  ctx.phase("supersede_old_rule");
  ctx.log("Superseding old project_rule with new...");

  try {
    const forgetResult: ForgetResult | null = adapter.runForgetContext(oldRuleId, "supersede");

    if (forgetResult) {
      ctx.checkpoint(
        "memory:supersede_old",
        "pass",
        `oldId=${oldRuleId} previousStatus=${forgetResult.previousStatus} → newStatus=${forgetResult.newStatus}`,
      );
      records.push({
        operation: "forget",
        memoryId: forgetResult.memoryId,
        status: forgetResult.newStatus,
        supersededBy: newRuleId,
      });
      forgotten++;
      ctx.log(`Superseded ${oldRuleId}: ${forgetResult.previousStatus} → ${forgetResult.newStatus}`);
    } else {
      ctx.checkpoint("memory:supersede_old", "fail", `forget returned null for id=${oldRuleId}`);
      records.push({ operation: "forget", memoryId: oldRuleId, error: "forget returned null" });
      failures++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("memory:supersede_old", "fail", msg);
    records.push({ operation: "forget", error: msg });
    failures++;
  }

  // ── Phase 5: recall_after_supersede ──────────────────────────────────────────

  ctx.phase("recall_after_supersede");
  ctx.log("Recalling after supersede — old should be excluded, new should be active...");

  try {
    const recallResult = adapter.runRecallContext("TypeScript strict mode", 10);
    const foundOld = recallResult.items.some((item) => item.id === oldRuleId);
    const foundNew = recallResult.items.some((item) => item.id === newRuleId);

    // Old rule should NOT appear in recall (superseded)
    ctx.checkpoint(
      "memory:recall_excludes_superseded",
      foundOld ? "fail" : "pass",
      `oldFound=${foundOld} (expected: false)`,
    );

    // New rule SHOULD appear in recall
    ctx.checkpoint(
      "memory:recall_includes_new",
      foundNew ? "pass" : "fail",
      `newFound=${foundNew} (expected: true)`,
    );

    records.push({
      operation: "recall",
      memoryId: newRuleId,
      recallCount: recallResult.total,
    });
    recalled++;
    ctx.log(`Post-supersede recall: oldFound=${foundOld}, newFound=${foundNew}, total=${recallResult.total}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("memory:recall_excludes_superseded", "fail", msg);
    ctx.checkpoint("memory:recall_includes_new", "fail", msg);
    records.push({ operation: "recall", error: msg });
    failures++;
  }

  // ── Phase 6: list_context_audit ──────────────────────────────────────────────

  ctx.phase("list_context_audit");
  ctx.log("Listing all context for audit...");

  try {
    const listResult = adapter.runListContext(undefined, 50, 0);
    const totalItems = listResult.items?.length ?? 0;

    ctx.checkpoint(
      "memory:list_audit",
      "pass",
      `total=${totalItems}`,
    );
    records.push({
      operation: "list",
      recallCount: totalItems,
    });
    ctx.log(`List audit: ${totalItems} total items`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("memory:list_audit", "fail", msg);
    records.push({ operation: "list", error: msg });
    failures++;
  }

  // ── Hard delete a test memory ────────────────────────────────────────────────

  ctx.log("Hard-deleting a test memory...");
  try {
    // Create a disposable memory to hard-delete
    const tempResult = adapter.runRememberContext(
      "Temporary memory for hard-delete test",
      "project_rule",
      ["temp"],
    );
    const delResult = adapter.runForgetContext(tempResult.memoryId, "hard_delete");
    const deleted = delResult !== null;

    ctx.checkpoint(
      "memory:forget_hard",
      deleted ? "pass" : "fail",
      `hardDeleted=${deleted} memoryId=${tempResult.memoryId}`,
    );
    if (deleted) {
      records.push({
        operation: "forget",
        memoryId: tempResult.memoryId,
        status: delResult!.newStatus,
      });
      forgotten++;
    } else {
      records.push({ operation: "forget", error: "hard_delete returned null" });
      failures++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("memory:forget_hard", "fail", msg);
    records.push({ operation: "forget", error: msg });
    failures++;
  }

  // ── Phase 7: write_report ────────────────────────────────────────────────────

  ctx.phase("write_report");

  const totalOperations = records.length;

  const output: MemoryFlowOutput = {
    totalOperations,
    remembered,
    recalled,
    forgotten,
    failures,
    results: records,
  };

  ctx.writeArtifact(
    "memory-records",
    JSON.stringify(records, null, 2),
    "application/json",
  );
  ctx.writeArtifact(
    "recall-results",
    JSON.stringify({ remembered, recalled, forgotten, failures }, null, 2),
    "application/json",
  );
  ctx.writeArtifact(
    "memory-report",
    JSON.stringify(output, null, 2),
    "application/json",
  );

  ctx.log(`Memory flow complete: ${remembered} remembered, ${recalled} recalled, ${forgotten} forgotten, ${failures} failures`);
  return output;
}
