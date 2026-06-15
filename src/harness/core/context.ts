/**
 * Harness Context Implementation
 *
 * Provides the HarnessContext that flows receive during execution.
 * Tracks current phase, collects checkpoints, writes artifacts,
 * creates receipts, and persists events via FileReporter.
 *
 * PRD §34: HarnessContext 携带 runId + input + phase/log/checkpoint/
 * writeArtifact/createReceipt 方法。
 * checkpoint 只记录，不阻塞 — 不改变 run 为 blocked。
 * 不提供 getProvider()，暂不做 ProviderRegistry。
 */

import type {
  ArtifactEntry,
  Checkpoint,
  CheckpointOutcome,
  CheckpointSeq,
  HarnessContext,
  HarnessManifest,
  RunId,
} from "./types.js";
import { writeArtifact as persistArtifact, sanitizeArtifactName } from "./artifactStore.js";
import {
  recordPhase,
  recordLog as persistLog,
  recordCheckpoint as persistCheckpoint,
  recordArtifact as persistArtifactRecord,
} from "./reporter.js";

/** Framework lifecycle phases that are always valid (not required in manifest). */
const LIFECYCLE_PHASES = new Set(["system", "setup", "check"]);

// ── HarnessContext Implementation ─────────────────────────────────────────────

export class HarnessContextImpl<TInput = unknown> implements HarnessContext<TInput> {
  readonly runId: RunId;
  readonly input: TInput;

  private _currentPhase: string;
  private _checkpoints: Checkpoint[] = [];
  private _artifacts: ArtifactEntry[] = [];
  private _logs: string[] = [];
  private _seq: CheckpointSeq = 0;
  readonly manifest: HarnessManifest;

  constructor(
    runId: RunId,
    input: TInput,
    manifest: HarnessManifest,
    initialPhase?: string,
  ) {
    this.runId = runId;
    this.input = input;
    this.manifest = manifest;
    this._currentPhase = initialPhase ?? manifest.phases[0]?.name ?? "default";
  }

  // ── Phase ──────────────────────────────────────────────────────────────────

  phase(name: string): void {
    // Validate that the phase is declared in the manifest (skip lifecycle phases)
    if (!LIFECYCLE_PHASES.has(name)) {
      const valid = this.manifest.phases.some((p) => p.name === name);
      if (!valid) {
        this._logs.push(
          `[warn] phase "${name}" not declared in manifest phases: [${this.manifest.phases.map((p) => p.name).join(", ")}]`,
        );
      }
    }
    this._currentPhase = name;

    // Persist phase change via FileReporter
    recordPhase(this.runId, name);
  }

  // ── Log ────────────────────────────────────────────────────────────────────

  log(message: string): void {
    this._logs.push(message);

    // Persist log message via FileReporter
    persistLog(this.runId, message);
  }

  // ── Checkpoint ─────────────────────────────────────────────────────────────

  checkpoint(
    label: string,
    outcome: CheckpointOutcome,
    message?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const cp: Checkpoint = {
      seq: this._seq++,
      timestamp: new Date().toISOString(),
      phase: this._currentPhase,
      label,
      outcome,
      ...(message !== undefined ? { message } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    };
    this._checkpoints.push(cp);

    // Persist checkpoint via FileReporter
    persistCheckpoint(this.runId, cp);
  }

  // ── Artifact ───────────────────────────────────────────────────────────────

  writeArtifact(name: string, content: string, contentType?: string): void {
    persistArtifact(this.runId, name, content);
    const safeName = sanitizeArtifactName(name);
    const entry: ArtifactEntry = {
      name: safeName,
      path: `${this.runId}/artifacts/${safeName}`,
      ...(contentType !== undefined ? { contentType } : {}),
      size: Buffer.byteLength(content, "utf-8"),
    };
    this._artifacts.push(entry);

    // Persist artifact record via FileReporter
    persistArtifactRecord(this.runId, entry);
  }

  // ── Receipt ────────────────────────────────────────────────────────────────

  createReceipt(): string {
    const receiptId = generateReceiptId(this.runId);
    this._logs.push(`[receipt] created run receipt: ${receiptId}`);
    return receiptId;
  }

  // ── Snapshot (for RunState persistence) ────────────────────────────────────

  /** Export collected state as a defensive snapshot — no mutable refs leak. */
  snapshot(): Snapshot {
    return {
      currentPhase: this._currentPhase,
      checkpoints: [...this._checkpoints],
      artifacts: [...this._artifacts],
      logs: [...this._logs],
    };
  }
}

/** Immutable snapshot of HarnessContextImpl internal state. */
export interface Snapshot {
  currentPhase: string;
  checkpoints: Checkpoint[];
  artifacts: ArtifactEntry[];
  logs: string[];
}

// ── Receipt ID Generator ─────────────────────────────────────────────────────

/**
 * Generate a run-level receipt ID.
 *
 * In production this delegates to the receipt service (src/receipts/).
 * The stub generates a deterministic ID from the run ID.
 */
function generateReceiptId(runId: RunId): string {
  // Stub: production would call receiptService.createRunReceipt(runId)
  return `receipt_${runId}`;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export interface CreateContextOptions<TInput = unknown> {
  runId: RunId;
  input: TInput;
  manifest: HarnessManifest;
  /** Override the initial phase (defaults to the first declared phase). */
  initialPhase?: string;
}

/** Create a HarnessContext for executing a manifest. */
export function createHarnessContext<TInput = unknown>(
  opts: CreateContextOptions<TInput>,
): HarnessContextImpl<TInput> {
  return new HarnessContextImpl(
    opts.runId,
    opts.input,
    opts.manifest,
    opts.initialPhase,
  );
}
