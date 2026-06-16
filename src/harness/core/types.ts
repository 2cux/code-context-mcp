/**
 * Harness Core Types
 *
 * Central type definitions for the CodeContext harness framework.
 * Defines HarnessManifest, HarnessModule, HarnessContext, RunState,
 * Checkpoint, RunId, and supporting types.
 *
 * PRD §34: Harness — unified business closed-loop execution framework.
 */

import type { JsonSchema } from "../schemas/common.js";

// ── Run Identity ──────────────────────────────────────────────────────────────

/** Unique run identifier (e.g. "run_20260615_abc123_001"). */
export type RunId = string & { readonly __brand: "RunId" };

/** Monotonic checkpoint counter within a single run. */
export type CheckpointSeq = number;

// ── Run Status ────────────────────────────────────────────────────────────────

/**
 * Run lifecycle status.
 *
 * created → running → failed | completed
 *
 * "blocked" is intentionally excluded in v1 — checkpoints record events
 * without blocking execution.
 */
export type RunStatus = "created" | "running" | "failed" | "completed";

export const RUN_STATUS_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  created: ["running"],
  running: ["failed", "completed"],
  failed: [],
  completed: [],
} as const;

// ── Checkpoint ────────────────────────────────────────────────────────────────

/** Outcome of a single checkpoint. */
export type CheckpointOutcome = "pass" | "fail" | "warn" | "skip";

/**
 * Result returned by each checkpoint call.
 *
 * Checkpoints are record-only by design — they never block execution,
 * never transition the run to "blocked", and never wait for human
 * confirmation. This result makes that contract explicit.
 */
export interface CheckpointResult {
  approved: true;
  mode: "record_only";
}

/** A single checkpoint entry logged during a run. */
export interface Checkpoint {
  /** Monotonic sequence number within the run. */
  seq: CheckpointSeq;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Phase that was active when this checkpoint was logged. */
  phase: string;
  /** Human-readable label (e.g. "compress:code", "recall:fts_search"). */
  label: string;
  /** Outcome of this step. */
  outcome: CheckpointOutcome;
  /** Optional diagnostic message. */
  message?: string;
  /** Optional structured metadata (e.g. token counts, timing). */
  metadata?: Record<string, unknown>;
}

// ── Error ─────────────────────────────────────────────────────────────────────

/** JSON-safe error shape for run records. */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError | null;
}

// ── HarnessManifest ───────────────────────────────────────────────────────────

/** A declared phase within a manifest. */
export interface ManifestPhase {
  /** Phase identifier (e.g. "compress", "retrieve", "verify"). */
  name: string;
  /** Human-readable description of what this phase does. */
  description: string;
}

/** A declared checkpoint expectation within a manifest. */
export interface ManifestCheckpointDecl {
  /** Checkpoint label (e.g. "compress:code", "retrieve:original"). */
  name: string;
  /** Human-readable description of what this checkpoint verifies. */
  description: string;
  /** Expected outcome for this checkpoint. */
  expect: CheckpointOutcome;
}

/** A declared artifact that the flow is expected to produce. */
export interface ManifestArtifactDecl {
  /** Artifact name (e.g. "compressed-output", "roundtrip-diff"). */
  name: string;
  /** Human-readable description of the artifact. */
  description: string;
  /** Optional MIME content type hint. */
  contentType?: string;
}

/**
 * Declares a business-capability closed loop to execute.
 *
 * A HarnessManifest describes WHAT a flow exercises — its phases,
 * expected checkpoints, artifacts, and which MCP tools it covers.
 * It does NOT declare HOW each step is implemented.
 */
export interface HarnessManifest {
  /** Unique manifest identifier (e.g. "compression-flow"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Human-readable description of the closed loop. */
  description: string;
  /** Optional JSON Schema for expected input shape. */
  inputSchema?: JsonSchema;
  /** Optional JSON Schema for expected output shape. */
  outputSchema?: JsonSchema;
  /** Ordered phases — what the loop exercises, not how. */
  phases: ManifestPhase[];
  /** Expected checkpoints across all phases. */
  checkpoints: ManifestCheckpointDecl[];
  /** Expected artifacts the flow produces. */
  artifacts: ManifestArtifactDecl[];
  /**
   * CodeContext-specific: MCP tool names that this flow exercises.
   *
   * Example for compression-flow:
   *   ["current_scope", "compress_context", "retrieve_original",
   *    "delete_original", "list_compressions", "get_receipt"]
   */
  coversTools: string[];

  /**
   * Optional tags for filtering and categorization.
   *
   * Example: ["compression", "smoke", "acceptance", "cli", "mcp"]
   */
  tags?: string[];

  /**
   * Optional capability category for high-level grouping.
   *
   * Example: "compression", "memory", "originals", "profile",
   *          "full-context", "smoke-test"
   */
  capability?: string;
}

// ── HarnessModule ─────────────────────────────────────────────────────────────

/**
 * A module that bundles a manifest with its execution logic.
 *
 * TInput  — the shape of input data the flow expects.
 * TOutput — the shape of output data the flow produces.
 */
export interface HarnessModule<TInput = unknown, TOutput = unknown> {
  /** The manifest declaring what this module exercises. */
  manifest: HarnessManifest;

  /**
   * Optional setup hook. Runs before `run`.
   * Use for fixture preparation, scope resolution, etc.
   */
  setup?: (ctx: HarnessContext<TInput>) => Promise<void>;

  /**
   * Execute the closed loop.
   * Receives a HarnessContext for logging checkpoints, writing artifacts,
   * and creating receipts.
   */
  run: (ctx: HarnessContext<TInput>) => Promise<TOutput>;

  /**
   * Optional post-run check hook. Runs after `run` succeeds.
   * Use for output validation, consistency checks, etc.
   * Should throw on fatal check failures.
   */
  check?: (ctx: HarnessContext<TInput>, output: TOutput) => Promise<void>;
}

// ── HarnessContext ────────────────────────────────────────────────────────────

/**
 * Execution context passed to HarnessModule methods.
 *
 * Provides phase tracking, checkpoint logging, artifact writing,
 * and receipt creation. Does NOT expose provider or provider registry
 * (excluded in v1).
 *
 * Checkpoints are audit-only — they record events without blocking
 * execution or changing run status to "blocked".
 */
export interface HarnessContext<TInput = unknown> {
  /** Unique run identifier. */
  readonly runId: RunId;

  /** The manifest that defines this run. */
  readonly manifest: HarnessManifest;

  /** Input data for this run. */
  readonly input: TInput;

  /**
   * Switch to a named phase. Subsequent checkpoints are scoped to this phase.
   * Must match a phase name declared in the manifest.
   */
  phase(name: string): void;

  /**
   * Log a free-form informational message.
   * Unlike checkpoints, log messages are not structured audit entries.
   */
  log(message: string): void;

  /**
   * Record a structured checkpoint entry.
   * Does NOT block execution or change run status.
   *
   * The current phase (set via `phase()`) is automatically attached.
   * `seq` and `timestamp` are filled in by the context implementation.
   *
   * Returns a CheckpointResult confirming that the checkpoint is
   * record-only — it never blocks, never enters "blocked" status,
   * and never waits for human confirmation.
   */
  checkpoint(
    label: string,
    outcome: CheckpointOutcome,
    message?: string,
    metadata?: Record<string, unknown>,
  ): CheckpointResult;

  /**
   * Write an artifact (captured output, diff, log) keyed by name.
   * Persisted under runs/<runId>/<name>.
   */
  writeArtifact(name: string, content: string, contentType?: string): void;

  /**
   * Create a receipt for this run. Returns the receipt ID.
   * The run receipt covers the entire closed-loop execution and
   * references sub-receipts from individual operations.
   */
  createReceipt(): string;
}

// ── RunState ──────────────────────────────────────────────────────────────────

/** An artifact entry recorded in RunState. */
export interface ArtifactEntry {
  /** Logical artifact name. */
  name: string;
  /** Filesystem path relative to the run directory. */
  path: string;
  /** Optional MIME content type. */
  contentType?: string;
  /** File size in bytes. */
  size: number;
}

/**
 * Persisted run execution state.
 *
 * Stored under runs/<runId>.json. Updated throughout the run lifecycle
 * from created → running → failed | completed.
 */
export interface RunState {
  /** Unique run identifier. */
  runId: RunId;

  /** The manifest id that defined this run. */
  moduleId: string;

  /** Current lifecycle status. */
  status: RunStatus;

  /** The phase currently being executed (set by ctx.phase()). */
  currentPhase?: string;

  /** Input data supplied to the run. */
  input: unknown;

  /** Output data produced by the run (set on completion). */
  output?: unknown;

  /** Artifacts produced during the run. */
  artifacts: ArtifactEntry[];

  /** Ordered list of checkpoints logged during the run. */
  checkpoints: Checkpoint[];

  /** Serialized error if the run failed. */
  error?: SerializedError;

  /** ISO 8601 creation timestamp. */
  createdAt: string;

  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;

  /** ISO 8601 completion timestamp (set when terminal). */
  completedAt?: string;
}

// ── Legacy Aliases (backward compatibility during migration) ──────────────────

/**
 * @deprecated Use `HarnessManifest` instead.
 */
export type Manifest = HarnessManifest;

/**
 * @deprecated Use `HarnessManifest` instead.
 */
export type RunContext = HarnessContext;

/**
 * @deprecated Use `RunState` instead.
 */
export type RunRecord = RunState;
