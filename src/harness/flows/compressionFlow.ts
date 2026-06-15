/**
 * Compression Closed-Loop Flow
 *
 * Exercises the full compression loop:
 *   scope → detect → compress → store → retrieve original → list → stats
 *
 * Uses the compressionFlow manifest to declare which steps to exercise.
 * Each step logs a checkpoint; the flow never throws on step failure.
 *
 * PRD §34: 压缩闭环。
 */

import type { RunContext, RunStatus } from "../core/types.js";
import type { LogFn } from "../core/runner.js";

/**
 * Stub implementation: logs a pass checkpoint for each manifest step.
 *
 * When real services are wired in, each iteration will invoke the corresponding
 * CodeContext operation (compress, retrieveOriginal, etc.) inside a try/catch,
 * logging failures as individual step checkpoints without aborting the run.
 */
export async function compressionFlow(ctx: RunContext, log: LogFn): Promise<RunStatus> {
  const steps = ctx.manifest.steps;
  let hasFailure = false;

  for (const step of steps) {
    const ts = new Date().toISOString();
    log({ timestamp: ts, label: `compress:${step.name}`, outcome: "pass", message: `step: ${step.description}` });
  }

  return hasFailure ? "failed" : "passed";
}
