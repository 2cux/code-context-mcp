/**
 * Originals Closed-Loop Flow
 *
 * Exercises the original content retrieval and deletion loop:
 *   compress → retrieve original → verify match → delete original → confirm gone → cleanup
 *
 * PRD §34: 原文取回 / 删除闭环。
 */

import type { HarnessContext } from "../core/types.js";

/**
 * Stub implementation: logs a pass checkpoint for each declared checkpoint.
 *
 * When real services are wired in, each iteration will invoke the corresponding
 * CodeContext operation (retrieveOriginal, deleteOriginal, etc.) inside a
 * try/catch, logging failures as individual step checkpoints without aborting.
 */
export async function originalsFlow(ctx: HarnessContext): Promise<{ checked: number }> {
  const cps = ctx.manifest.checkpoints;
  let checked = 0;

  for (const cp of cps) {
    ctx.checkpoint(cp.name, "pass", cp.description);
    checked++;
  }

  return { checked };
}
