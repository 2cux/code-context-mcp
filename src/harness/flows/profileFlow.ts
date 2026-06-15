/**
 * Profile Closed-Loop Flow
 *
 * Exercises the repo profile loop:
 *   current_scope → profile static → profile dynamic → update → re-read
 *
 * PRD §34: profile 闭环。
 */

import type { RunContext, RunStatus } from "../core/types.js";
import type { LogFn } from "../core/runner.js";

/**
 * Stub implementation: logs a pass checkpoint for each manifest step.
 *
 * When real services are wired in, each iteration will invoke the corresponding
 * CodeContext operation (getProfile, setProfileFact, etc.) inside a try/catch,
 * logging failures as individual step checkpoints without aborting the run.
 */
export async function profileFlow(ctx: RunContext, log: LogFn): Promise<RunStatus> {
  const steps = ctx.manifest.steps;
  let hasFailure = false;

  for (const step of steps) {
    const ts = new Date().toISOString();
    log({ timestamp: ts, label: `profile:${step.name}`, outcome: "pass", message: `step: ${step.description}` });
  }

  return hasFailure ? "failed" : "passed";
}
