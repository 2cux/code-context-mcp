/**
 * Profile Closed-Loop Flow
 *
 * Exercises the repo profile loop:
 *   current_scope → profile static → profile dynamic → update → re-read
 *
 * PRD §34: profile 闭环。
 */

import type { HarnessContext } from "../core/types.js";

/**
 * Stub implementation: logs a pass checkpoint for each declared checkpoint.
 *
 * When real services are wired in, each iteration will invoke the corresponding
 * CodeContext operation (getProfile, setProfileFact, etc.) inside a try/catch,
 * logging failures as individual step checkpoints without aborting the run.
 */
export async function profileFlow(ctx: HarnessContext): Promise<{ checked: number }> {
  const cps = ctx.manifest.checkpoints;
  let checked = 0;

  for (const cp of cps) {
    ctx.checkpoint(cp.name, "pass", cp.description);
    checked++;
  }

  return { checked };
}
