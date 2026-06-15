/**
 * Run Runner
 *
 * Executes a Manifest as a Run: creates a RunRecord, invokes the flow handler,
 * collects checkpoints, transitions status, and persists the final record.
 *
 * PRD §34: Run 执行记录持久化到 runs/ 目录。
 * checkpoint 只记录，不阻塞 — 不中断执行。
 */

import type { Checkpoint, Manifest, RunContext, RunId, RunRecord, RunStatus } from "./types.js";
import { saveRun } from "./stateStore.js";

// ── Flow Handler Types ────────────────────────────────────────────────────────

/** Checkpoint without `seq` — what flow handlers pass to `log()`. */
export type LogEntry = Omit<Checkpoint, "seq">;

/** Log callback provided to flow handlers. */
export type LogFn = (checkpoint: LogEntry) => void;

/** Signature of a flow handler function. */
export type FlowHandler = (
  ctx: RunContext,
  log: LogFn,
) => Promise<RunStatus>;

const flowHandlers = new Map<string, FlowHandler>();

// ── Flow Registration ─────────────────────────────────────────────────────────

/** Register a flow handler for a manifest name. */
export function registerFlow(manifestName: string, handler: FlowHandler): void {
  flowHandlers.set(manifestName, handler);
}

// ── Execute ───────────────────────────────────────────────────────────────────

/** Execute a manifest as a run. */
export async function executeRun(
  manifest: Manifest,
  runId: RunId,
  scopeId: string,
): Promise<RunRecord> {
  const handler = flowHandlers.get(manifest.name);
  if (!handler) {
    throw new Error(`No flow handler registered for manifest "${manifest.name}".`);
  }

  const ctx: RunContext = { runId, manifest, scopeId };
  const checkpoints: RunRecord["checkpoints"] = [];
  let seq = 0;

  const log: LogFn = (cp) => {
    checkpoints.push({ ...cp, seq: seq++ });
  };

  const record: RunRecord = {
    runId,
    manifestName: manifest.name,
    scopeId,
    status: "running",
    createdAt: new Date().toISOString(),
    checkpoints,
    subReceiptIds: [],
    tags: manifest.tags ?? [],
    metadata: {},
  };

  log({ timestamp: new Date().toISOString(), label: "run:start", outcome: "pass" });

  try {
    const finalStatus = await handler(ctx, log);
    record.status = finalStatus;
  } catch (err) {
    record.status = "failed";
    log({
      timestamp: new Date().toISOString(),
      label: "run:error",
      outcome: "fail",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  record.completedAt = new Date().toISOString();
  log({ timestamp: record.completedAt, label: `run:${record.status}`, outcome: record.status === "passed" ? "pass" : "fail" });

  saveRun(record);
  return record;
}

// ── Clear ─────────────────────────────────────────────────────────────────────

/** Remove all registered flow handlers (test helper). */
export function clearFlows(): void {
  flowHandlers.clear();
}
