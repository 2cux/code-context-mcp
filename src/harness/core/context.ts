/**
 * Run Context Factory
 *
 * Builds the RunContext that flows receive during execution.
 * Resolves scope, wires services, and provides helpers for
 * interacting with the CodeContext runtime.
 *
 * PRD §34: Harness 统一执行闭环，RunContext 携带 scope + manifest + services。
 */

import type { Manifest, RunContext, RunId } from "./types.js";

// ── Context Options ───────────────────────────────────────────────────────────

export interface CreateContextOptions {
  runId: RunId;
  manifest: Manifest;
  /** Explicit scopeId override (bypasses git-based resolution). */
  scopeId?: string;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/** Create a RunContext for executing a manifest. */
export function createRunContext(opts: CreateContextOptions): RunContext {
  const scopeId = opts.scopeId ?? resolveDefaultScope();

  return {
    runId: opts.runId,
    manifest: opts.manifest,
    scopeId,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve a default scope when none is explicitly provided. */
function resolveDefaultScope(): string {
  // In production this delegates to resolveScope from src/scope/.
  // Stub returns a sentinel value for now.
  return "scope:default";
}
