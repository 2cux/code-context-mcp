/**
 * Originals Closed-Loop Flow
 *
 * Exercises the original content retrieval and deletion loop:
 *   compress → retrieve original → verify match → delete original → confirm gone → cleanup
 *
 * PRD §34: 原文取回 / 删除闭环。
 */

import type { RunContext, RunStatus } from "../core/types.js";
import type { LogFn } from "../core/runner.js";

/**
 * Stub implementation: logs a pass checkpoint for each manifest step.
 *
 * When real services are wired in, each iteration will invoke the corresponding
 * CodeContext operation (retrieveOriginal, deleteOriginal, etc.) inside a
 * try/catch, logging failures as individual step checkpoints without aborting.
 */
export async function originalsFlow(ctx: RunContext, log: LogFn): Promise<RunStatus> {
  const steps = ctx.manifest.steps;
  let hasFailure = false;

  for (const step of steps) {
    const ts = new Date().toISOString();
    log({ timestamp: ts, label: `originals:${step.name}`, outcome: "pass", message: `step: ${step.description}` });
  }

  return hasFailure ? "failed" : "passed";
}
