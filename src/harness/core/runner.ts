/**
 * Harness Runner
 *
 * Executes a HarnessModule as a Run using a fixed 14-step pipeline:
 *
 *   1. registry.get(moduleId)    [runModule only]
 *   2. validate input
 *   3. create runId              [runModule only]
 *   4. write input.json
 *   5. create harness_run receipt
 *   6. execute setup
 *   7. execute run
 *   8. validate output
 *   9. execute check
 *  10. write output.json
 *  11. write artifacts
 *  12. mark completed
 *  13. update run receipt
 *  14. return output
 *
 * On any failure, enters the failure flow:
 *   - Write logs.jsonl  (error event)
 *   - Write state.json  (markFailed)
 *   - Write failed receipt
 *   - Write error artifact (error.json)
 *   - Return structured error (RunState with error field)
 *
 * PRD §34: Run 执行记录持久化到 runs/ 目录。
 * checkpoint 只记录，不阻塞 — 不中断执行。
 * 不提供 getProvider()，暂不做 ProviderRegistry。
 */

import type {
  HarnessManifest,
  HarnessModule,
  RunId,
  RunState,
} from "./types.js";
import type { TransitionSnapshot } from "./stateStore.js";
import type { ReceiptService } from "../../receipts/receiptService.js";
import type { Snapshot } from "./context.js";
import {
  createHarnessContext,
  HarnessContextImpl,
} from "./context.js";
import {
  createRun,
  markRunning,
  writeOutput,
  markCompleted,
  markFailed,
} from "./stateStore.js";
import { recordCompleted, recordError } from "./reporter.js";
import { serializeError } from "../utils/serializeError.js";
import { generateRunId } from "../utils/runId.js";
import { validateJsonSchema } from "./validate.js";
import { writeArtifact } from "./artifactStore.js";
import { nowISO } from "../../utils/time.js";
import * as fs from "node:fs";
import { runDirPath } from "../utils/runPaths.js";
import { getRunsDir } from "./stateStore.js";

// ── Module Registry (import + re-export from unified registry) ────────────────

import {
  getModule,
  listModules,
} from "./registry.js";

export {
  registerModule,
  registerModules,
  getModule,
  listModules,
  clearModules,
  hasModule,
} from "./registry.js";

// ── RunModule (primary public API) ────────────────────────────────────────────

export interface RunModuleOptions {
  /** Input data for the run. */
  input?: unknown;
  /** Override the initial phase (defaults to first declared phase). */
  initialPhase?: string;
  /** Optional ReceiptService for persisting run receipts to the database. */
  receipts?: ReceiptService;
}

/**
 * Execute a registered HarnessModule by moduleId.
 *
 * Implements the full 14-step runner pipeline: looks up the module from
 * the registry, generates a runId, validates input/output, and manages
 * receipts. On any failure, enters the failure flow and returns a failed
 * RunState (never throws on execution failures).
 *
 * @throws Only if the moduleId is not found in the registry.
 */
export async function runModule(
  moduleId: string,
  opts: RunModuleOptions = {},
): Promise<RunState> {
  // ── 1. registry.get(moduleId) ──────────────────────────────────────────────

  const mod = getModule(moduleId);
  if (!mod) {
    throw new Error(
      `Module "${moduleId}" not found in registry. ` +
        `Registered modules: [${listModules().join(", ")}]`,
    );
  }

  // ── 3. create runId ────────────────────────────────────────────────────────

  const runId = generateRunId() as RunId;

  return _executeRun({
    module: mod,
    runId,
    input: opts.input,
    initialPhase: opts.initialPhase,
    receipts: opts.receipts,
  });
}

// ── ExecuteOptions (low-level API) ────────────────────────────────────────────

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
 * Execute a HarnessModule with a pre-generated runId.
 *
 * Low-level API — caller provides the module and runId directly.
 * Does NOT require the module to be registered. For normal use
 * where you only have the moduleId, prefer {@link runModule}.
 *
 * Follows the same 14-step pipeline but skips registry lookup
 * and runId generation (steps 1 & 3).
 */
export async function executeRun(opts: ExecuteOptions): Promise<RunState> {
  return _executeRun(opts);
}

// ── Internal: Shared Execution Engine ─────────────────────────────────────────

interface _ExecuteRunOpts {
  module: HarnessModule;
  runId: RunId;
  input?: unknown;
  initialPhase?: string;
  receipts?: ReceiptService;
}

/**
 * Core 14-step execution engine shared by runModule and executeRun.
 *
 * Steps executed:
 *   2. validate input
 *   4. write input.json
 *   5. create harness_run receipt
 *   6. execute setup
 *   7. execute run
 *   8. validate output
 *   9. execute check
 *  10. write output.json
 *  11. write artifacts
 *  12. mark completed
 *  13. update run receipt
 *  14. return output
 */
async function _executeRun(opts: _ExecuteRunOpts): Promise<RunState> {
  const {
    module: mod,
    runId,
    input = {},
    initialPhase,
    receipts,
  } = opts;

  const manifest = mod.manifest;
  const moduleId = manifest.id;

  // ── 2. validate input ──────────────────────────────────────────────────────

  const inputValidation = validateJsonSchema(
    manifest.inputSchema,
    input,
    "input",
  );

  if (!inputValidation.valid) {
    // Input validation failure — enter failure flow
    const errMsg = `Input validation failed: ${inputValidation.errors.join("; ")}`;
    return _handleFailure({
      moduleId,
      runId,
      error: new Error(errMsg),
      input,
      receipts,
      manifest,
      phase: "validate:input",
      checkpoints: [],
      artifacts: [],
    });
  }

  // ── 4. write input.json ────────────────────────────────────────────────────

  const startPhase = initialPhase ?? manifest.phases[0]?.name;
  createRun(runId, moduleId, input, startPhase);

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

  // ── 5. create harness_run receipt ──────────────────────────────────────────

  try {
    ctx.createReceipt();
  } catch {
    // Best-effort: receipt failure must not block the run
  }

  // ── Transition to running ──────────────────────────────────────────────────

  markRunning(runId);

  ctx.phase("system");
  ctx.checkpoint("run:start", "pass", `module: ${moduleId}`);

  // ── 6–9. execute setup → run → validate output → check ─────────────────────

  let output: unknown;

  try {
    // ── 6. execute setup ────────────────────────────────────────────────────

    if (mod.setup) {
      ctx.phase("setup");
      ctx.log("Running setup hook");
      await mod.setup(ctx);
      ctx.checkpoint("run:setup", "pass");
    }

    // ── 7. execute run ──────────────────────────────────────────────────────

    ctx.phase(manifest.phases[0]?.name ?? "run");
    output = await mod.run(ctx);

    // ── 8. validate output ──────────────────────────────────────────────────

    const outputValidation = validateJsonSchema(
      manifest.outputSchema,
      output,
      "output",
    );

    if (!outputValidation.valid) {
      throw new Error(
        `Output validation failed: ${outputValidation.errors.join("; ")}`,
      );
    }

    // ── 9. execute check ────────────────────────────────────────────────────

    if (mod.check) {
      ctx.phase("check");
      ctx.log("Running check hook");
      await mod.check(ctx, output);
      ctx.checkpoint("run:check", "pass");
    }

    // ── 10. write output.json ───────────────────────────────────────────────

    writeOutput(runId, output);

    // ── 11. write artifacts ─────────────────────────────────────────────────
    // Artifacts are already persisted to disk via ctx.writeArtifact() during
    // execution. The snapshot collects them for the final state write.

    // ── 12. mark completed ──────────────────────────────────────────────────

    ctx.checkpoint("run:completed", "pass", `runId: ${runId}`);

    // Take snapshot AFTER adding run:completed so it's included
    const snap = ctx.snapshot();
    const transitionSnap: TransitionSnapshot = {
      currentPhase: snap.currentPhase,
      checkpoints: [...snap.checkpoints],
      artifacts: [...snap.artifacts],
      output,
    };
    const final = markCompleted(runId, transitionSnap);

    recordCompleted(runId);

    // ── 13. update run receipt ──────────────────────────────────────────────

    if (receipts) {
      try {
        receipts.create({
          operation: "harness_run",
          scopeId: "harness",
          runId,
          moduleId,
          eventType: "completed",
          phase: snap.currentPhase,
          coveredTools: manifest.coversTools,
          artifactPaths: snap.artifacts.map((a) => a.path),
        });
      } catch {
        // Best-effort: receipt update failure must not mask run success
      }
    }

    // ── 14. return output ───────────────────────────────────────────────────

    return final;
  } catch (err) {
    // ── Failure flow ────────────────────────────────────────────────────────

    const errMsg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("run:error", "fail", errMsg);
    ctx.checkpoint("run:failed", "fail", `runId: ${runId}`);

    const finalSnap = ctx.snapshot();

    return _handleFailure({
      moduleId,
      runId,
      error: err,
      input,
      receipts,
      manifest,
      phase: finalSnap.currentPhase,
      checkpoints: finalSnap.checkpoints,
      artifacts: finalSnap.artifacts,
    });
  }
}

// ── Failure Flow (§34) ────────────────────────────────────────────────────────

interface _HandleFailureOpts {
  moduleId: string;
  runId: RunId;
  error: unknown;
  input: unknown;
  receipts?: ReceiptService;
  manifest: HarnessManifest;
  phase: string;
  checkpoints: Snapshot["checkpoints"];
  artifacts: Snapshot["artifacts"];
}

/**
 * Execute the failure flow:
 *   1. Write logs.jsonl (error event)
 *   2. Write state.json (markFailed)
 *   3. Write failed receipt
 *   4. Write error artifact (error.json)
 *   5. Return structured error (RunState with error field)
 */
function _handleFailure(opts: _HandleFailureOpts): RunState {
  const {
    moduleId,
    runId,
    error,
    input,
    receipts,
    manifest,
    phase,
    checkpoints,
    artifacts,
  } = opts;

  const serialized = serializeError(error);
  const errMsg =
    error instanceof Error ? error.message : String(error);

  // ── Ensure run directory exists and is in "running" status ────────────────
  // For input validation failures, the run directory hasn't been created yet.
  // We must transition through "running" to satisfy the state machine:
  //   created → running → failed
  // For execution failures, markRunning was already called in _executeRun,
  // so the directory exists and the state is already "running".

  const runDir = runDirPath(getRunsDir(), runId);
  if (!fs.existsSync(runDir)) {
    createRun(runId, moduleId, input, phase);
    markRunning(runId);
  }

  // ── 1. Write logs.jsonl — record the error event ─────────────────────────

  recordError(runId, serialized);

  // ── 2. Write state.json — transition to failed ────────────────────────────

  const transitionSnap: TransitionSnapshot = {
    currentPhase: phase,
    checkpoints: [...checkpoints],
    artifacts: [...artifacts],
  };
  const final = markFailed(runId, serialized, transitionSnap);

  // ── 3. Write failed receipt ───────────────────────────────────────────────

  if (receipts) {
    try {
      receipts.create({
        operation: "harness_run",
        scopeId: "harness",
        runId,
        moduleId,
        failed: true,
        errorReason: errMsg,
        eventType: "failed",
        phase,
        coveredTools: manifest.coversTools,
      });
    } catch {
      // Best-effort: receipt failure must not mask the original error
    }
  }

  // ── 4. Write error artifact ───────────────────────────────────────────────

  try {
    const errorPayload = JSON.stringify(
      {
        error: serialized,
        moduleId,
        runId,
        phase,
        timestamp: nowISO(),
      },
      null,
      2,
    );
    writeArtifact(runId, "error.json", errorPayload);
  } catch {
    // Best-effort
  }

  // ── 5. Return structured error ────────────────────────────────────────────

  return final;
}

// ── Legacy Compatibility ─────────────────────────────────────────────────────

export { registerModule as registerFlow } from "./registry.js";
