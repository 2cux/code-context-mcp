/**
 * Harness Runner
 *
 * Executes a HarnessModule as a Run: creates RunState, invokes
 * setup → run → check, collects checkpoints, transitions status,
 * and persists the final state.
 *
 * PRD §34: Run 执行记录持久化到 runs/ 目录。
 * checkpoint 只记录，不阻塞 — 不中断执行。
 * 不提供 getProvider()，暂不做 ProviderRegistry。
 */

import type { HarnessManifest, HarnessModule, RunId, RunState, RunStatus } from "./types.js";
import type { HarnessContextImpl } from "./context.js";
import { createHarnessContext } from "./context.js";
import { saveRun } from "./stateStore.js";
import { serializeError } from "../utils/serializeError.js";

// ── Module Registry ──────────────────────────────────────────────────────────

const modules = new Map<string, HarnessModule>();

/** Register a HarnessModule by its manifest id. */
export function registerModule(mod: HarnessModule): void {
  const id = mod.manifest.id;
  if (modules.has(id)) {
    throw new Error(`Module "${id}" is already registered.`);
  }
  modules.set(id, mod);
}

/** Register multiple modules at once. */
export function registerModules(list: HarnessModule[]): void {
  for (const mod of list) {
    registerModule(mod);
  }
}

/** Get a registered module by manifest id. */
export function getModule(id: string): HarnessModule | undefined {
  return modules.get(id);
}

/** List all registered module ids. */
export function listModules(): string[] {
  return [...modules.keys()].sort();
}

/** Remove all registered modules (test helper). */
export function clearModules(): void {
  modules.clear();
}

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
}

/**
 * Execute a HarnessModule as a run.
 *
 * Lifecycle:
 *   1. Create RunState (status: created)
 *   2. Transition to running
 *   3. Call module.setup() (if provided)
 *   4. Call module.run()
 *   5. Call module.check() (if provided)
 *   6. Transition to completed or failed
 *   7. Persist final RunState
 */
export async function executeRun(opts: ExecuteOptions): Promise<RunState> {
  const { module: mod, runId, input = {}, initialPhase } = opts;
  const manifest = mod.manifest;

  // ── Create HarnessContext ──────────────────────────────────────────────────

  const ctx = createHarnessContext({
    runId,
    input,
    manifest,
    initialPhase,
  });

  // ── Initialize RunState ────────────────────────────────────────────────────

  const now = new Date().toISOString();
  const state: RunState = {
    runId,
    moduleId: manifest.id,
    status: "created",
    currentPhase: initialPhase ?? manifest.phases[0]?.name,
    input,
    artifacts: [],
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
  };

  saveRun(state);

  // ── Transition to running ──────────────────────────────────────────────────

  state.status = "running";
  state.updatedAt = new Date().toISOString();
  saveRun(state);

  // Log run:start in a system phase, before any business phase
  ctx.phase("system");
  ctx.checkpoint("run:start", "pass", `module: ${manifest.id}`);

  // ── Execute ────────────────────────────────────────────────────────────────

  let output: unknown;

  try {
    // Setup phase
    if (mod.setup) {
      ctx.phase("setup");
      ctx.log("Running setup hook");
      await mod.setup(ctx);
      ctx.checkpoint("run:setup", "pass");
    }

    // Run phase — execute the closed loop
    ctx.phase(manifest.phases[0]?.name ?? "run");
    output = await mod.run(ctx);
    state.output = output;

    // Check phase — optional post-run validation
    if (mod.check) {
      ctx.phase("check");
      ctx.log("Running check hook");
      await mod.check(ctx, output);
      ctx.checkpoint("run:check", "pass");
    }

    state.status = "completed";
  } catch (err) {
    state.status = "failed";
    state.error = serializeError(err);
    ctx.checkpoint(
      "run:error",
      "fail",
      err instanceof Error ? err.message : String(err),
    );
  }

  // ── Finalize ───────────────────────────────────────────────────────────────

  // Log terminal checkpoint first so its timestamp ≤ completedAt
  ctx.checkpoint(
    `run:${state.status}`,
    state.status === "completed" ? "pass" : "fail",
    `runId: ${runId}`,
  );

  // Snapshot AFTER the final checkpoint so it's included
  const snap = ctx.snapshot();
  state.currentPhase = snap.currentPhase;
  state.checkpoints = [...snap.checkpoints];
  state.artifacts = [...snap.artifacts];
  state.completedAt = new Date().toISOString();
  state.updatedAt = state.completedAt;

  saveRun(state);
  return state;
}

// ── Legacy Compatibility ─────────────────────────────────────────────────────

/**
 * @deprecated Use `registerModule` instead.
 */
export const registerFlow = registerModule;

/**
 * @deprecated Use `clearModules` instead.
 */
export const clearFlows = clearModules;
