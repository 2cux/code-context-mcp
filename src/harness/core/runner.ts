/**
 * Harness Runner
 *
 * Executes a HarnessModule as a Run: creates the run directory, invokes
 * setup → run → check, collects checkpoints, transitions status,
 * and persists the final state.
 *
 * PRD §34: Run 执行记录持久化到 runs/ 目录。
 * checkpoint 只记录，不阻塞 — 不中断执行。
 * 不提供 getProvider()，暂不做 ProviderRegistry。
 */

import type { HarnessModule, RunId, RunState } from "./types.js";
import type { TransitionSnapshot } from "./stateStore.js";
import type { ReceiptService } from "../../receipts/receiptService.js";
import { createHarnessContext } from "./context.js";
import {
  createRun,
  markRunning,
  writeOutput,
  markCompleted,
  markFailed,
} from "./stateStore.js";
import { recordCompleted, recordError } from "./reporter.js";
import { serializeError } from "../utils/serializeError.js";

// ── Module Registry (re-exports from unified registry) ────────────────────────

export {
  registerModule,
  registerModules,
  getModule,
  listModules,
  clearModules,
  hasModule,
} from "./registry.js";

// ── Execute ──────────────────────────────────────────────────────────────────

export interface ExecuteOptions {
  /** The module to execute. */
  module: HarnessModule;
  /** Unique run identifier. */
  runId: RunId;
  /** Input data for the run. */
  input?: unknown;
  /** Override the initial phase. */
  initialPhase?: string;
  /** Optional ReceiptService for persisting run receipts to the database. */
  receipts?: ReceiptService;
}

/**
 * Execute a HarnessModule as a run.
 *
 * Lifecycle:
 *   1. Create run directory with input.json and initial state.json
 *   2. Transition to running (validated)
 *   3. Call module.setup() (if provided)
 *   4. Call module.run()
 *   5. Call module.check() (if provided)
 *   6. Transition to completed or failed (single write with snapshot)
 */
export async function executeRun(opts: ExecuteOptions): Promise<RunState> {
  const { module: mod, runId, input = {}, initialPhase, receipts } = opts;
  const manifest = mod.manifest;
  const startPhase = initialPhase ?? manifest.phases[0]?.name;

  // ── Create run directory and initial state ─────────────────────────────────

  createRun(runId, manifest.id, input, startPhase);

  // ── Create HarnessContext ──────────────────────────────────────────────────

  const ctx = createHarnessContext({
    runId,
    input,
    manifest,
    initialPhase: startPhase,
  });

  // Inject ReceiptService for run receipt persistence (§34)
  if (receipts) {
    ctx.setReceiptService(receipts);
  }

  // ── Transition to running (validated) ──────────────────────────────────────

  markRunning(runId);

  // Log run:start using an internal lifecycle phase ("system" is special-cased
  // by HarnessContextImpl to skip manifest-declaration validation).
  ctx.phase("system");
  ctx.checkpoint("run:start", "pass", `module: ${manifest.id}`);

  // ── Execute ────────────────────────────────────────────────────────────────

  let output: unknown;

  try {
    // Setup phase — "setup" is a lifecycle phase, also special-cased
    if (mod.setup) {
      ctx.phase("setup");
      ctx.log("Running setup hook");
      await mod.setup(ctx);
      ctx.checkpoint("run:setup", "pass");
    }

    // Run phase — execute the closed loop
    ctx.phase(manifest.phases[0]?.name ?? "run");
    output = await mod.run(ctx);

    // Persist output
    writeOutput(runId, output);

    // Check phase — "check" is a lifecycle phase, also special-cased
    if (mod.check) {
      ctx.phase("check");
      ctx.log("Running check hook");
      await mod.check(ctx, output);
      ctx.checkpoint("run:check", "pass");
    }

    // ── Finalize: Completed (single write) ───────────────────────────────────

    ctx.checkpoint("run:completed", "pass", `runId: ${runId}`);

    const snap = ctx.snapshot();
    const transitionSnap: TransitionSnapshot = {
      currentPhase: snap.currentPhase,
      checkpoints: [...snap.checkpoints],
      artifacts: [...snap.artifacts],
      output,
    };
    const final = markCompleted(runId, transitionSnap);

    // Record completion event
    recordCompleted(runId);

    return final;
  } catch (err) {
    // ── Finalize: Failed (single write) ──────────────────────────────────────

    const serialized = serializeError(err);
    ctx.checkpoint(
      "run:error",
      "fail",
      err instanceof Error ? err.message : String(err),
    );
    ctx.checkpoint("run:failed", "fail", `runId: ${runId}`);

    // Record error event
    recordError(runId, serialized);

    const snap = ctx.snapshot();
    const transitionSnap: TransitionSnapshot = {
      currentPhase: snap.currentPhase,
      checkpoints: [...snap.checkpoints],
      artifacts: [...snap.artifacts],
    };
    const final = markFailed(runId, serialized, transitionSnap);

    return final;
  }
}

// ── Legacy Compatibility ─────────────────────────────────────────────────────

export {
  registerModule as registerFlow,
} from "./registry.js";
