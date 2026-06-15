/**
 * Harness Context Implementation
 *
 * Provides the HarnessContext that flows receive during execution.
 * Tracks current phase, collects checkpoints, writes artifacts,
 * and creates receipts.
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
import { writeArtifact as persistArtifact } from "./artifactStore.js";

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
    // Validate that the phase is declared in the manifest
    const valid = this.manifest.phases.some((p) => p.name === name);
    if (!valid) {
      this._logs.push(
        `[warn] phase "${name}" not declared in manifest phases: [${this.manifest.phases.map((p) => p.name).join(", ")}]`,
      );
    }
    this._currentPhase = name;
  }

  // ── Log ────────────────────────────────────────────────────────────────────

  log(message: string): void {
    this._logs.push(message);
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
  }

  // ── Artifact ───────────────────────────────────────────────────────────────

  writeArtifact(name: string, content: string, contentType?: string): void {
    persistArtifact(this.runId, name, content);
    this._artifacts.push({
      name,
      path: `${this.runId}/${name}`,
      ...(contentType !== undefined ? { contentType } : {}),
      size: Buffer.byteLength(content, "utf-8"),
    });
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
