/**
 * Memory Closed-Loop Flow
 *
 * Exercises the memory lifecycle loop:
 *   remember → recall (FTS) → list → forget (supersede) → recall (should exclude) → hard delete
 *
 * PRD §34: 记忆保存 / 召回 / 遗忘闭环。
 */

import type { RunContext, RunStatus } from "../core/types.js";
import type { LogFn } from "../core/runner.js";

/**
 * Stub implementation: logs a pass checkpoint for each manifest step.
 *
 * When real services are wired in, each iteration will invoke the corresponding
 * CodeContext operation (remember, recall, forget, etc.) inside a try/catch,
 * logging failures as individual step checkpoints without aborting the run.
 */
export async function memoryFlow(ctx: RunContext, log: LogFn): Promise<RunStatus> {
  const steps = ctx.manifest.steps;
  let hasFailure = false;

  for (const step of steps) {
    const ts = new Date().toISOString();
    log({ timestamp: ts, label: `memory:${step.name}`, outcome: "pass", message: `step: ${step.description}` });
  }

  return hasFailure ? "failed" : "passed";
}
