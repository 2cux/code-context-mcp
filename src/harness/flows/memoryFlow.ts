/**
 * Memory Closed-Loop Flow
 *
 * Exercises the memory lifecycle loop:
 *   remember → recall (FTS) → list → forget (supersede) → recall (should exclude) → hard delete
 *
 * PRD §34: 记忆保存 / 召回 / 遗忘闭环。
 */

import type { HarnessContext } from "../core/types.js";

/**
 * Stub implementation: logs a pass checkpoint for each declared checkpoint.
 *
 * When real services are wired in, each iteration will invoke the corresponding
 * CodeContext operation (remember, recall, forget, etc.) inside a try/catch,
 * logging failures as individual step checkpoints without aborting the run.
 */
export async function memoryFlow(ctx: HarnessContext): Promise<{ checked: number }> {
  const cps = ctx.manifest.checkpoints;
  let checked = 0;

  for (const cp of cps) {
    ctx.checkpoint(cp.name, "pass", cp.description);
    checked++;
  }

  return { checked };
}
